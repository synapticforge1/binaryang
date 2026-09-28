// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/passes/lower-block-params
 *
 * Lowers block PARAMETERS to locals, where optimization begins (S6 decision
 * 7b(i), divergence B1) — as a TREE pass (One front end, stage 2, inventory row
 * R15).
 *
 * Both front ends keep a parametrised `block` / `loop` / `if` / `try` /
 * `try_table` as written: its entry values on the node, its region starting
 * with one typed `pop` per parameter (R13 / R14), a branch back to a
 * parametrised loop carrying the loop's parameters. That is what fidelity
 * needs, and no pass here was written for it — upstream binaryen has no block
 * parameters, its reader lowers them, and every pass in this directory is a
 * port of one that never saw any.
 *
 * 🔧 It used to lower them by RE-DECODING: encode the module and decode it
 * again with the decoder's `lowerBlockParams` flag. That lowering was WRONG for
 * two of the eight corpus modules with block parameters, before any pass ran
 * (`spec/fac/fac.0.wasm`: "not enough arguments on the stack for local.set";
 * `spec/if/if.0.wasm`: "start-arity and end-arity of one-armed if must
 * match"), and it could not survive stage 3, which deletes that decoder.
 *
 * 🔑 **Positional, not by `pop`.** A `pop` is the tree's notation for "this
 * value is already on the stack", and the values a parametrised construct
 * deals in are exactly those: an entry value may be consumed deep in an
 * operand, passed through untouched (`if.0`'s arm is `[(pop), (pop)]`), or
 * carried back to a loop by a branch whose values are produced INSIDE its own
 * condition by a multi-result call (`fac.0`'s `br_if`). No rewrite of
 * individual `pop`s covers all three, and a first attempt that tried
 * (`wip/r15-tree-pass`) failed on six of the eight modules. So the lowering
 * works where the stack is explicit, and never renames a `pop`:
 *
 * - **Entry**: the entry values go into fresh locals just before the
 *   construct, and each of its regions STARTS by reading them back — so every
 *   instruction inside finds the stack exactly as before. A one-armed `if`
 *   gains the `else` that this makes necessary: an arm that only reads them
 *   back, which is what the missing arm did.
 * - **Back-edge**: a branch to a parametrised loop writes the loop's locals
 *   and carries nothing; a `br_if` reads them back after it, for the path that
 *   falls through. The loop's region reads them at its start, so the next
 *   iteration sees what the branch carried.
 *
 * ⚠️ **Why the tree is taken apart around them.** The locals must be written
 * from values ALREADY on the stack, and a `block` cannot reach those — a
 * wrapper block around `local.set`s of `pop`s is invalid (it is how the first
 * attempt emitted "expected 2 elements on the stack"). So a statement holding
 * such a construct or branch in an operand is split into statements, in
 * evaluation order, up to the last operand that needs it; the rest stays
 * nested. The bytes do not change: a `pop` writes nothing, and the order of
 * evaluation is the order of emission. The spill (`spill-stack-values.ts`),
 * run after this, nests what it can again.
 *
 * - **A `br_table` mixing** a parametrised loop with other targets goes through
 *   a trampoline: the table selects a case, each case branches in its target's
 *   convention.
 *
 * Refused rather than mis-lowered: a `br_on_*` to a parametrised loop, a
 * `try_table` catch to one, and a branch that names its target by depth. None
 * occurs in the corpus; each needs a rewrite of the control flow rather than of
 * a node.
 *
 * Nothing here runs unless a construct actually keeps parameters: 8 of 3,083
 * corpus modules, 41 constructs (14 `block`, 13 `loop`, 13 `if`, 1
 * `try_table`), every one of them in the spec testsuite's own multi-value
 * tests.
 */

import {
  type BlockParams,
  blockParamsOf,
  type Expression,
  ExpressionKind,
  makeBlock,
  makeBreak,
  makeLocalGet,
  makeLocalSet,
  makePop,
  makeRegion,
  makeSwitch,
  type RegionExpr,
  typeOf,
} from '../ir/expressions.ts';
import { deriveTypes, slots } from '../ir/derive-types.ts';
import type { ValueType } from '../ir/gc-types.ts';
import { None, Unreachable } from '../ir/types.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { mapChildrenShallow, walkExpression } from '../ir/walk.ts';
import { operandsInOrder } from '../ir/phantoms.ts';
import { type Var, varIndex } from '../../wabt-ts/ir/ir.ts';

/** Whether any construct in `e` keeps block parameters. */
export function hasBlockParams(e: Expression): boolean {
  let found = false;
  walkExpression(e, (n) => {
    if (!found && blockParamsOf(n) !== undefined) found = true;
  });
  return found;
}

/** A parametrised construct's locals: one per parameter, in order. */
interface Slots {
  readonly slots: readonly number[];
  readonly types: readonly ValueType[];
}

/** A construct's parameters, when it keeps any. */
function paramsOf(e: Expression): BlockParams | undefined {
  const p = blockParamsOf(e);
  return p !== undefined && p.types.length > 0 ? p : undefined;
}

/** The one `pop` that stands where `e` stood once `e` is a statement before it. */
function popFor(e: Expression): Expression {
  const values = slots(typeOf(e));
  return makePop(values.length > 0 ? values[values.length - 1]! : Unreachable);
}

/** A region with `lead` in front of its instructions. */
function led(r: RegionExpr, lead: Expression[], rest: Expression[]): RegionExpr {
  return { ...r, children: [...lead, ...rest] } as RegionExpr;
}

/** One function's lowering. */
class Lowering {
  /** The parametrised loops whose bodies are being lowered, by label. */
  private readonly loops = new Map<string, Slots>();

  constructor(private readonly f: WasmFunction) {}

  /** A sequence, lowered: each statement, split where it must be. */
  sequence(children: readonly Expression[]): Expression[] {
    const out: Expression[] = [];
    for (const c of children) {
      if (this.needs(c)) out.push(...this.split(c));
      else out.push(this.inside(c));
    }
    return out;
  }

  /**
   * Whether `e` must be split into statements: it IS a parametrised construct
   * or a branch to a parametrised loop, or one of its operands holds one. A
   * construct inside a REGION of `e` does not count — that region is a sequence
   * of its own and is lowered there.
   */
  private needs(e: Expression): boolean {
    if (paramsOf(e) !== undefined || this.backEdge(e) !== undefined) return true;
    return operandsInOrder(e).some((c) => this.needs(c));
  }

  /** `e`, with every region under it lowered and nothing split. */
  private inside(e: Expression): Expression {
    if (e.kind === ExpressionKind.Block || e.kind === ExpressionKind.Region) {
      return { ...e, children: this.sequence(e.children) } as Expression;
    }
    return mapChildrenShallow(e, (c) => this.inside(c));
  }

  /** Statements that leave `e`'s values on the stack, lowered. */
  private split(e: Expression): Expression[] {
    const params = paramsOf(e);
    if (params !== undefined) return this.construct(e, params);
    const loop = this.backEdge(e);
    if (loop !== undefined) return this.branch(e, loop);

    // Anything else: its operands up to the last one that needs splitting
    // become statements before it, and it takes each from the stack.
    const ops = operandsInOrder(e);
    let last = -1;
    ops.forEach((c, i) => {
      if (this.needs(c)) last = i;
    });
    const out: Expression[] = [];
    const replaced = new Map<Expression, Expression>();
    ops.forEach((c, i) => {
      if (i > last) return;
      out.push(...this.hoist(c));
      replaced.set(c, c.kind === ExpressionKind.Pop ? c : popFor(c));
    });
    out.push(mapChildrenShallow(e, (c) => replaced.get(c) ?? this.inside(c)));
    return out;
  }

  /** `e` as statements of its own; a `pop` is already on the stack, so it is none. */
  private hoist(e: Expression): Expression[] {
    if (e.kind === ExpressionKind.Pop) return [];
    return this.needs(e) ? this.split(e) : [this.inside(e)];
  }

  /**
   * Statements that take `values` — then, when given, a `last` operand
   * evaluated after them — off the stack into `into` (and a fresh local for
   * `last`, returned as the local to read it from).
   *
   * Where every value is one plain value, each is written as it is evaluated:
   * nothing between them can read these locals, since only the construct's own
   * region reads them. Otherwise — a `pop`, a multi-result call, a value that
   * must itself be split — they are left on the stack in order and taken from
   * the top. ⚠️ Then `last` must go FIRST: it is on top of them, and so is
   * anything a `pop` in it would take.
   */
  private take(
    values: readonly Expression[],
    into: Slots,
    last?: Expression,
  ): { out: Expression[]; last?: Expression } {
    const plain = values.length === into.slots.length &&
      values.every((v) =>
        v.kind !== ExpressionKind.Pop && slots(typeOf(v)).length === 1 && !this.needs(v)
      );
    if (plain) {
      const out = values.map((v, i) => makeLocalSet(varIndex(into.slots[i]!), this.inside(v)));
      if (last === undefined) return { out };
      if (!this.needs(last)) return { out, last: this.inside(last) };
      return { out: [...out, ...this.hoist(last)], last: popFor(last) };
    }
    const out: Expression[] = [];
    for (const v of values) out.push(...this.hoist(v));
    let lastRead: Expression | undefined;
    if (last !== undefined) {
      // The TOP value: `if.0`'s condition is a call returning `(i64 i32)`, whose
      // first value is the parameter and whose last is the condition.
      const type = (popFor(last) as { type: ValueType }).type;
      const temp = this.local(type);
      out.push(...this.hoist(last), makeLocalSet(varIndex(temp), makePop(type)));
      lastRead = makeLocalGet(varIndex(temp), type);
    }
    for (let i = into.slots.length - 1; i >= 0; i--) {
      out.push(makeLocalSet(varIndex(into.slots[i]!), makePop(into.types[i]!)));
    }
    return lastRead === undefined ? { out } : { out, last: lastRead };
  }

  /** A parametrised construct: its entry values into locals, its regions reading them back. */
  private construct(c: Expression, params: BlockParams): Expression[] {
    const into: Slots = { slots: params.types.map((t) => this.local(t)), types: params.types };
    const reads = () => into.slots.map((s, i) => makeLocalGet(varIndex(s), into.types[i]!));
    const region = (r: RegionExpr) => led(r, reads(), this.sequence(r.children));
    const condition = c.kind === ExpressionKind.If ? c.condition : undefined;
    const { out, last } = this.take(params.values, into, condition);

    // The written index named a type WITH parameters (7c); without them the
    // header is derived again.
    const bare = { ...c } as Expression & { params?: BlockParams; typeIndex?: number };
    delete bare.params;
    delete bare.typeIndex;
    switch (c.kind) {
      case ExpressionKind.Block:
        (bare as { children: Expression[] }).children = [...reads(), ...this.sequence(c.children)];
        break;
      case ExpressionKind.Loop: {
        const label = c.label;
        const outer = this.loops.get(label);
        this.loops.set(label, into);
        (bare as { body: RegionExpr }).body = region(c.body);
        if (outer === undefined) this.loops.delete(label);
        else this.loops.set(label, outer);
        break;
      }
      case ExpressionKind.If:
        (bare as { condition: Expression }).condition = last!;
        (bare as { ifTrue: RegionExpr }).ifTrue = region(c.ifTrue);
        // 🔧 A one-armed `if` must now leave the stack as it found it, and it
        // leaves its results — "start-arity and end-arity of one-armed if must
        // match". The missing arm passed the parameters through; it reads them.
        (bare as { ifFalse: RegionExpr }).ifFalse = region(c.ifFalse ?? makeRegion([], None));
        break;
      case ExpressionKind.Try:
        (bare as { body: RegionExpr }).body = region(c.body);
        // A handler's entry values are the TAG's, not the try's.
        (bare as { catches: unknown }).catches = c.catches.map((k) => ({
          ...k,
          body: led(k.body, [], this.sequence(k.body.children)),
        }));
        break;
      case ExpressionKind.TryTable:
        this.refuseCatchTo(c);
        (bare as { body: RegionExpr }).body = region(c.body);
        break;
      default:
        throw new Error(`lower-block-params: ${String(c.kind)} keeps parameters`);
    }
    out.push(bare);
    return out;
  }

  /** A branch to a parametrised loop: the loop's locals written, nothing carried. */
  private branch(n: Expression, loop: Slots): Expression[] {
    if (n.kind === ExpressionKind.Break) {
      const hasCondition = n.condition !== undefined && n.condition !== null;
      const { out, last } = this.take(n.values, loop, hasCondition ? n.condition! : undefined);
      out.push({ ...n, values: [], ...(hasCondition ? { condition: last! } : {}) } as Expression);
      // Not taken, a `br_if` leaves its values: they are what it just wrote.
      if (hasCondition) {
        out.push(...loop.slots.map((s, i) => makeLocalGet(varIndex(s), loop.types[i]!)));
      }
      return out;
    }
    if (n.kind === ExpressionKind.Switch) {
      const all = [...n.targets, n.defaultTarget];
      if (all.every((v) => this.loopAt(v) === loop)) {
        const { out, last } = this.take(n.values, loop, n.condition);
        out.push({ ...n, values: [], condition: last! } as Expression);
        return out;
      }
      return this.trampoline(n, loop.types);
    }
    throw new Error(`lower-block-params: ${String(n.kind)} is not a branch`);
  }

  /**
   * A `br_table` whose targets MIX a parametrised loop with other frames. No one
   * table fits: the loop now takes nothing, the others still take the values. So
   * the values go into temporaries, the table only selects a CASE, and each case
   * branches in its own target's convention — a parametrised loop's locals
   * written and a value-less `br`, any other target the values read back and
   * carried:
   *
   *     block $c1                    ;; one block per case but the last
   *       block $c0
   *         br_table $c0 $c1 … (index)
   *       end
   *       <case 0>  br …
   *     end
   *     <case 1>  br …                ;; the last case follows the chain, so the
   *                                   ;; sequence still ends in a transfer
   *
   * The decoder's lowering built the same trampoline (`multivalue.test.ts`).
   */
  private trampoline(
    n: Expression & { kind: typeof ExpressionKind.Switch },
    types: readonly ValueType[],
  ): Expression[] {
    const temps: Slots = { slots: types.map((t) => this.local(t)), types };
    const { out, last } = this.take(n.values, temps, n.condition);
    const reads = () => temps.slots.map((s, i) => makeLocalGet(varIndex(s), types[i]!));

    // One case per DISTINCT target, in order of first appearance.
    const all = [...n.targets, n.defaultTarget];
    const cases: Var[] = [];
    const caseOf = (v: Var) => {
      const name = this.labelOf(v);
      let i = cases.findIndex((c) => this.labelOf(c) === name);
      if (i < 0) i = cases.push(v) - 1;
      return i;
    };
    const indices = all.map(caseOf);
    const labels = cases.map(() => this.fresh());
    const branchTo = (target: Var): Expression[] => {
      const loop = this.loopAt(target);
      if (loop !== undefined) {
        return [
          ...loop.slots.map((s, i) =>
            makeLocalSet(varIndex(s), makeLocalGet(varIndex(temps.slots[i]!), types[i]!))
          ),
          makeBreak(this.labelOf(target)),
        ];
      }
      return [makeBreak(this.labelOf(target), undefined, reads())];
    };
    const select = makeSwitch(
      indices.slice(0, -1).map((i) => labels[i]!),
      labels[indices[indices.length - 1]!]!,
      last!,
    );
    // Innermost first: case k's code follows the end of block $c_k.
    let chain: Expression[] = [select];
    for (let k = 0; k < cases.length - 1; k++) {
      chain = [makeBlock(chain, labels[k]!, None), ...branchTo(cases[k]!)];
    }
    // The last case needs no block of its own: nothing branches past it.
    const lastLabel = labels[cases.length - 1]!;
    chain = [makeBlock(chain, lastLabel, None)];
    out.push(...chain, ...branchTo(cases[cases.length - 1]!));
    return out;
  }

  /** A label the function does not already use. */
  private fresh(): string {
    if (this.used === undefined) {
      this.used = new Set();
      walkExpression(this.f.body, (e) => {
        const label = (e as { label?: string }).label;
        if (label) this.used!.add(label);
      });
    }
    while (this.used.has(`$case${this.cases}`)) this.cases++;
    const name = `$case${this.cases++}`;
    this.used.add(name);
    return name;
  }
  private used: Set<string> | undefined;
  private cases = 0;

  /**
   * The parametrised loop `e` branches back to, if any. Throws for the shapes
   * this does not lower — see the module doc.
   */
  private backEdge(e: Expression): Slots | undefined {
    switch (e.kind) {
      case ExpressionKind.Break:
        return this.loopAt(e.target);
      case ExpressionKind.Switch:
        // Any parametrised loop among the targets: `branch` lowers the table,
        // through a trampoline when the targets mix.
        return [...e.targets, e.defaultTarget].map((v) => this.loopAt(v)).find((l) => l);
      case ExpressionKind.BrOn:
        if (this.loopAt(e.target) !== undefined) {
          throw new Error('lower-block-params: a br_on_* to a parametrised loop is not lowered');
        }
        return undefined;
      case ExpressionKind.TryTable:
        this.refuseCatchTo(e);
        return undefined;
      default:
        return undefined;
    }
  }

  /** A `try_table` catch delivers values to its target: to a parametrised loop, refused. */
  private refuseCatchTo(e: Expression & { catches: readonly { target: Var }[] }): void {
    if (e.catches.some((k) => this.loopAt(k.target) !== undefined)) {
      throw new Error(
        'lower-block-params: a try_table catch to a parametrised loop is not lowered',
      );
    }
  }

  /** The label a branch target names — see {@link loopAt} for depth targets. */
  private labelOf(v: Var): string {
    if (v.kind !== 'name') {
      throw new Error('lower-block-params: a branch names its target by depth, not by label');
    }
    return v.name;
  }

  /** The parametrised loop a branch target names, if it names one. */
  private loopAt(v: Var): Slots | undefined {
    if (this.loops.size === 0) return undefined;
    if (v.kind !== 'name') {
      throw new Error('lower-block-params: a branch names its target by depth, not by label');
    }
    return this.loops.get(v.name);
  }

  /** A fresh local. Params come first in the one index space. */
  private local(type: ValueType): number {
    this.f.locals.push({ type });
    return this.f.locals.length - 1;
  }
}

/**
 * Lowers every block parameter in `module` to locals, in place. Returns how
 * many functions were rewritten — 0, with the module untouched, when none keep
 * parameters.
 */
export function lowerBlockParams(module: WasmModule): number {
  const targets = module.functions.filter((f) => hasBlockParams(f.body));
  if (targets.length === 0) return 0;
  for (const f of targets) {
    const lowering = new Lowering(f);
    f.body = led(f.body, [], lowering.sequence(f.body.children));
  }
  // Every node this built or rebuilt is typed by the one set of rules, and the
  // new `pop`s by what they will find.
  deriveTypes(module);
  return targets.length;
}
