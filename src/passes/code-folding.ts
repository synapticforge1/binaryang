/**
 * @module passes/code-folding
 *
 * CodeFolding (open-work 2, step 6c, 2026-10-08): code that both arms of an
 * `if` end with is written once, after the `if`:
 *
 *     (if c (then A… T…) (else B… T…))   →   (if c (then A…) (else B…)) T…
 *
 * The tail `T…` is the longest run of statements, from each arm's end, that
 * are STRUCTURALLY EQUAL in both (immediates, types and operands alike, as
 * LocalCSE keys a node), and that can leave the arm:
 *
 * - it holds no `pop` — a stack value an earlier statement of the arm left,
 *   which would not be there after the `if`;
 * - no branch in either arm names the `if`'s own label — such a branch leaves
 *   the `if` and runs what follows it, which the tail would then be, on a
 *   path that skipped it before;
 * - the `if` has an `else` and no result, so the arm's tail is a statement,
 *   not the arm's value.
 *
 * The `if` stays where it was and the tail follows it in the same sequence,
 * so no block is added (upstream's CodeFolding wraps one and weighs whether
 * it pays; the sequence here is free). A tail that ends the function's body
 * or a block is the same case: the statements after the `if` simply come
 * next. Measured first (`brshapes.ts`, our -Oz output): the arms of 1,105
 * `if`s with `else` end in a statement of the same kind — 206 `local.set`,
 * 161 `call`, 157 `if`, 154 `memory.copy`, 154 `block`, ….
 *
 * **Terminating tails** (open-work 30, step 2): what several places in a
 * function end with before an `unreachable` is written once, at the function's
 * end, each place branching to it ({@link foldTerminatingTails}). Zig's debug
 * builds end every failed check with `(call $panic …) (unreachable)`. And, the
 * same way, what several places end with before a `return` (open-work 31: Zig
 * restores its stack pointer before every return).
 *
 * **Branch tails** (open-work 31): what every way into a block's `end` ends with — its
 * fall-through and each plain `br` to it — is written once, after the block
 * ({@link foldBranchTails}).
 *
 * Reference: `WebAssembly/binaryen/src/passes/CodeFolding.cpp`
 *
 * @license MIT
 */

import {
  type BlockExpr,
  blockParamsOf,
  type Expression,
  ExpressionKind,
  type IfExpr,
  labelName,
  makeBlock,
  makeBreak,
  makeRegion,
  makeReturn,
  neverFallsThrough,
  type RegionExpr,
  typeOf,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import type { Var } from '../ir/ir.ts';
import { None, Unreachable } from '../ir/types.ts';
import { mapChildrenShallow, mapExpression, walkExpression } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Writes once what both arms of an `if` end with. */
export class CodeFoldingPass implements Pass {
  readonly name = 'CodeFolding';
  readonly description = 'Moves the statements both arms of an if end with to after the if.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, _foldSequences);
      for (let round = 0; round < 1000 && foldBranchTails(fn); round++);
      // One fold per round, as upstream: each changes the tails the next sees.
      for (
        let round = 0;
        round < 1000 &&
        (foldTerminatingTails(fn, ExpressionKind.Unreachable) ||
          foldTerminatingTails(fn, ExpressionKind.Return));
        round++
      );
    }
  }
}

registerPass(CodeFoldingPass);

// ---------------------------------------------------------------------------
// Structural equality
// ---------------------------------------------------------------------------

const EXPRESSION_KINDS = new Set<unknown>(Object.values(ExpressionKind));
const isExpr = (v: unknown): v is Expression =>
  v !== null && typeof v === 'object' && EXPRESSION_KINDS.has((v as { kind?: unknown }).kind);

const DECLARES_LABEL = new Set<string>([
  ExpressionKind.Block,
  ExpressionKind.Loop,
  ExpressionKind.If,
  ExpressionKind.Try,
  ExpressionKind.TryTable,
]);

/**
 * A node and its whole subtree as one string: its own fields, then each
 * operand's key, in order. Labels are compared by POSITION, not by name: the
 * reader names every block and `if` it reads (`$block3`, `$if7`), so two
 * arms' identical nested `if`s differ in nothing but those names. A label
 * declared inside the keyed subtree is written as its declaration ordinal,
 * and a branch to it as that ordinal; a branch to a label outside is written
 * by name — the same name from either arm.
 */
export function deepKey(e: Expression, labels: string[] = []): string {
  const own: Record<string, unknown> = {};
  const parts: string[] = [];
  const inner = DECLARES_LABEL.has(e.kind) && (e as { label: string }).label !== ''
    ? [...labels, (e as { label: string }).label]
    : labels;
  const ordinal = (name: string): string => {
    const i = inner.lastIndexOf(name);
    return i < 0 ? `name:${name}` : `#${i}`;
  };
  for (const [k, v] of Object.entries(e)) {
    if (k === 'loc' || k === 'nodeId') continue;
    if (k === 'label' && DECLARES_LABEL.has(e.kind)) {
      own[k] = v === '' ? '' : `#${inner.length - 1}`;
      continue;
    }
    if ((k === 'target' || k === 'defaultTarget' || k === 'delegate') && isVar(v)) {
      own[k] = ordinal(labelName(v));
      continue;
    }
    if (k === 'targets' && Array.isArray(v) && v.every(isVar)) {
      own[k] = v.map((t) => ordinal(labelName(t)));
      continue;
    }
    if (k === 'catches' && Array.isArray(v)) {
      // Each clause as a nested record: its `target` by position like any branch, and a legacy
      // `catch`'s BODY keyed as code. 🔧 It was one plain `JSON.stringify` per clause: a body's
      // labels compared by NAME, and an `i64.const` in it threw "cannot serialize a BigInt"
      // (open-work 30 step 4, keying whole functions: the corpus's legacy-EH modules).
      parts.push(`${k}=[${v.map((c) => deepKey(c as Expression, inner)).join(',')}]`);
      continue;
    }
    if (isExpr(v)) parts.push(`${k}=${deepKey(v, inner)}`);
    else if (Array.isArray(v) && v.some(isExpr)) {
      parts.push(
        `${k}=[${v.map((x) => (isExpr(x) ? deepKey(x, inner) : _json(x))).join(',')}]`,
      );
    } else if (v !== null && typeof v === 'object' && !ArrayBuffer.isView(v) && !Array.isArray(v)) {
      // A nested record holding expressions (block params).
      parts.push(`${k}=${deepKey(v as Expression, inner)}`);
    } else own[k] = v;
  }
  return `${_json(own)}{${parts.join(';')}}`;
}

/** `JSON.stringify` that writes a bigint (an `i64` literal) as `<n>n`. */
const _json = (v: unknown): string =>
  JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? `${x}n` : x));

const isVar = (v: unknown): v is Var =>
  v !== null && typeof v === 'object' && 'kind' in v &&
  ((v as { kind: unknown }).kind === 'index' || (v as { kind: unknown }).kind === 'name');

// ---------------------------------------------------------------------------
// What may leave an arm
// ---------------------------------------------------------------------------

/** The labels `e` declares (blocks, loops, ifs, trys) and the labels it branches to. */
function labelsOf(e: Expression): { declared: Set<string>; targets: Set<string>; pops: boolean } {
  const declared = new Set<string>(), targets = new Set<string>();
  let pops = false;
  walkExpression(e, (x) => {
    switch (x.kind) {
      case ExpressionKind.Pop:
        pops = true;
        break;
      case ExpressionKind.Block:
      case ExpressionKind.Loop:
      case ExpressionKind.If:
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
        if (x.label !== '') declared.add(x.label);
        break;
      case ExpressionKind.Break:
        targets.add(labelName(x.target));
        break;
      case ExpressionKind.Switch:
        for (const t of x.targets) targets.add(labelName(t));
        targets.add(labelName(x.defaultTarget));
        break;
      case ExpressionKind.BrOn:
        targets.add(labelName(x.target));
        break;
      case ExpressionKind.Rethrow:
        targets.add(labelName(x.target));
        break;
      default:
        break;
    }
    if (x.kind === ExpressionKind.TryTable) {
      for (const c of x.catches) targets.add(labelName(c.target));
    }
    if (x.kind === ExpressionKind.Try && x.delegate !== undefined) {
      targets.add(labelName(x.delegate));
    }
  });
  return { declared, targets, pops };
}

/**
 * Whether a statement can move out of an arm to after the `if`: not when it
 * holds a `pop`, a value an earlier statement of the arm left on the stack,
 * which is not there after the `if`. Its branches need no check: a label is
 * in scope only inside its own construct, so a statement can name only the
 * labels it declares itself (they move with it) or those of constructs
 * enclosing the `if` (still in scope after it) — the `if`'s own label is the
 * one exception, handled for the whole arm in {@link commonTail}.
 */
function canLeave(item: Expression): boolean {
  return !labelsOf(item).pops;
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/** The statements both arms end with that can leave, longest first in order; `[]` when none. */
function commonTail(iff: IfExpr): Expression[] {
  const a = iff.ifTrue, b = iff.ifFalse;
  if (b === null || iff.type !== None) return [];
  // 🔧 A branch to the `if`'s OWN label anywhere in an arm leaves the `if` and
  // runs what follows it — which the moved tail would then be, on a path that
  // skipped it before (`(br_if $i …)` ahead of the tail: found by the test,
  // where the fold changed a global). Not folded then.
  if (iff.label !== '' && [a, b].some((arm) => labelsOf(arm).targets.has(iff.label))) return [];
  const tail: Expression[] = [];
  for (let k = 1; k <= Math.min(a.children.length, b.children.length); k++) {
    const x = a.children[a.children.length - k]!, y = b.children[b.children.length - k]!;
    if (x.type !== None || deepKey(x) !== deepKey(y)) break;
    if (!canLeave(x) || !canLeave(y)) break;
    tail.unshift(x);
  }
  return tail;
}

/** A sequence with every foldable `if` followed by its arms' common tail. */
function _foldSequences(e: Expression): Expression {
  if (e.kind !== ExpressionKind.Region && e.kind !== ExpressionKind.Block) return e;
  let changed = false;
  const out: Expression[] = [];
  for (const child of e.children) {
    if (child.kind !== ExpressionKind.If) {
      out.push(child);
      continue;
    }
    const tail = commonTail(child);
    if (tail.length === 0) {
      out.push(child);
      continue;
    }
    changed = true;
    const cut = (r: RegionExpr): RegionExpr => ({
      ...r,
      children: r.children.slice(0, r.children.length - tail.length),
    });
    out.push({ ...child, ifTrue: cut(child.ifTrue), ifFalse: cut(child.ifFalse!) }, ...tail);
  }
  return changed ? { ...e, children: out } : e;
}

// ---------------------------------------------------------------------------
// Terminating tails (open-work 30, step 2)
// ---------------------------------------------------------------------------

/** A region or block: a list of statements whose last may be `unreachable`. */
type Container = RegionExpr | BlockExpr;

/** Upstream's `WORTH_ADDING_BLOCK_TO_REMOVE_THIS_MUCH`: the cost of the block the fold adds. */
const WORTH_ADDING_BLOCK = 3;

/** Nodes in `e`, as upstream's `Measurer` counts them. */
function measure(e: Expression): number {
  let n = 0;
  walkExpression(e, () => n++);
  return n;
}

/** Whether `e` branches to a label it does not declare, or holds a `pop`: it cannot move. */
function pinned(e: Expression): boolean {
  const { declared, targets, pops } = labelsOf(e);
  if (pops) return true;
  for (const t of targets) if (!declared.has(t)) return true;
  return false;
}

/**
 * The containers ending in `ender` (`unreachable` or `return`); `null` if any
 * node is reachable twice (the fold edits the containers in place, so the tree
 * must be one).
 */
function terminatingTails(body: Expression, ender: string): Container[] | null {
  const seen = new Set<Expression>();
  const tails: Container[] = [];
  let shared = false;
  walkExpression(body, (e) => {
    if (seen.has(e)) shared = true;
    seen.add(e);
    if (e.kind !== ExpressionKind.Region && e.kind !== ExpressionKind.Block) return;
    if (e.children[e.children.length - 1]?.kind === ender) tails.push(e);
  });
  return shared ? null : tails;
}

/**
 * What several places end with before an `unreachable`, written once at the
 * end of the function, each place branching to it:
 *
 *     …A… (call $panic x) (unreachable)   …B… (call $panic x) (unreachable)
 *  →  (block $folding-inner …A… (br $folding-inner) …B… (br $folding-inner) (return))
 *     (call $panic x) (unreachable)
 *
 * Upstream's `optimizeTerminatingTails`: the deepest suffix at least two places
 * share (items that branch out of themselves, or hold a `pop`, never move), and
 * only when the nodes saved outweigh the branches and the block added. One fold
 * per call. Not in a function with a `try` or `try_table` (a call moved out of
 * one would no longer be caught: upstream refuses the same, item by item), nor
 * in one with several results.
 */
function foldTerminatingTails(fn: WasmFunction, ender: string): boolean {
  if (fn.sig.results.length > 1 || fn.body.kind !== ExpressionKind.Region) return false;
  const body = fn.body;
  let hasTry = false;
  walkExpression(body, (e) => {
    if (e.kind === ExpressionKind.Try || e.kind === ExpressionKind.TryTable) hasTry = true;
  });
  if (hasTry) return false;
  // The old body must not fall into the shared code: it returns at its end. A
  // valued body whose last statement is not its value is left alone.
  const old = body.children;
  const last = old[old.length - 1];
  const fallsOut = last === undefined || typeOf(last) !== Unreachable;
  if (fallsOut && fn.sig.results.length === 1 && (last === undefined || typeOf(last) === None)) {
    return false;
  }
  const tails = terminatingTails(body, ender);
  if (tails === null || tails.length < 2) return false;

  const item = (t: Container, k: number) => t.children[t.children.length - 1 - k]!;
  let chosen: Container[] = [];
  let depth = 0;
  const explore = (group: Container[], num: number): boolean => {
    const next = group.filter((t) => t.children.length > num && !pinned(item(t, num)));
    if (next.length >= 2) {
      const byKey = new Map<string, Container[]>();
      for (const t of next) {
        const k = deepKey(item(t, num));
        byKey.set(k, [...(byKey.get(k) ?? []), t]);
      }
      for (const same of byKey.values()) {
        if (same.length >= 2 && explore(same, num + 1)) return true;
      }
    }
    if (num === 0) return false;
    let saved = 0;
    for (let k = 0; k < num; k++) saved += measure(item(group[0]!, k)) * (group.length - 1);
    if (saved <= group.length + WORTH_ADDING_BLOCK) return false;
    chosen = group;
    depth = num;
    return true;
  };
  if (!explore(tails, 0)) return false;

  const labels = new Set<string>();
  walkExpression(body, (e) => {
    if (DECLARES_LABEL.has(e.kind) && (e as { label: string }).label !== '') {
      labels.add((e as { label: string }).label);
    }
  });
  let label = 'folding-inner';
  for (let i = 0; labels.has(label); i++) label = `folding-inner${i}`;

  const shared = chosen[0]!.children.slice(-depth);
  for (const t of chosen) t.children.splice(t.children.length - depth, depth, makeBreak(label));
  const inner = !fallsOut
    ? old
    : fn.sig.results.length === 0
    ? [...old, makeReturn()]
    : [...old.slice(0, -1), makeReturn([last!])];
  fn.body = makeRegion([makeBlock(inner, label), ...shared]);
  return true;
}

// ---------------------------------------------------------------------------
// Tails before the branches to a block (open-work 31)
// ---------------------------------------------------------------------------

/**
 * What every way into a block's `end` ends with, written once after the block:
 *
 *     (block $b …A… T… (br $b) …B… T…)   →   (block $b …A… (br $b) …B…) T…
 *
 * Upstream's CodeFolding `visitBlock`. The ways in are the block's own fall-through and each
 * branch to it; every branch must be a plain `br $b` ending its list (any other branch to `$b`,
 * a `br_if` or a `br_table`, is a way in whose tail cannot be cut, so nothing folds), and at
 * least two ways must share the tail. A tail item moves only as a statement that branches to no
 * label it does not declare and holds no `pop` ({@link pinned}). Not for a block with a value or
 * parameters, nor one holding a `try` (a call moved out would no longer be caught). One fold
 * per call, as {@link foldTerminatingTails}.
 */
function foldBranchTails(fn: WasmFunction): boolean {
  // One walk indexes the function. The rebuild below edits by node identity, so a node reachable
  // twice leaves the function alone; so does a `try` (see above). A label declared twice (Inlining
  // copies a callee's) mixes two scopes' branches in the counts: its blocks are skipped.
  const seen = new Set<Expression>();
  const declared = new Set<string>();
  const twice = new Set<string>();
  const ways = new Map<string, WayIn[]>();
  const brs = new Map<string, number>();
  const other = new Set<string>();
  const candidates: BlockExpr[] = [];
  let refuse = false;
  walkExpression(fn.body, (e) => {
    if (seen.has(e)) refuse = true;
    seen.add(e);
    switch (e.kind) {
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
        refuse = true;
        break;
      case ExpressionKind.Break: {
        const t = labelName(e.target);
        brs.set(t, (brs.get(t) ?? 0) + 1);
        break;
      }
      case ExpressionKind.Switch:
        for (const t of [...e.targets, e.defaultTarget]) other.add(labelName(t));
        break;
      case ExpressionKind.BrOn:
      case ExpressionKind.Rethrow:
        other.add(labelName(e.target));
        break;
      default:
        break;
    }
    if (DECLARES_LABEL.has(e.kind)) {
      const l = (e as { label: string }).label;
      if (l !== '') {
        if (declared.has(l)) twice.add(l);
        declared.add(l);
      }
    }
    if (e.kind !== ExpressionKind.Region && e.kind !== ExpressionKind.Block) return;
    const last = e.children[e.children.length - 1];
    if (
      last?.kind === ExpressionKind.Break && last.condition === undefined &&
      last.values.length === 0
    ) {
      const t = labelName(last.target);
      ways.set(t, [...(ways.get(t) ?? []), {
        container: e,
        items: e.children.slice(0, -1),
        br: last,
      }]);
    }
    // Candidates: named void blocks that are statements of a list (the tail goes after them).
    for (const c of e.children) {
      if (
        c.kind === ExpressionKind.Block && c.label !== '' && c.type === None &&
        blockParamsOf(c) === undefined
      ) candidates.push(c);
    }
  });
  if (refuse) return false;

  for (const b of candidates) {
    // Every branch to the label must be one of its plain `br`s: a `br_if`, a `br_table` or a
    // `br_on_*` to it is a way in whose tail cannot be cut.
    const into = ways.get(b.label) ?? [];
    if (into.length === 0 || other.has(b.label) || twice.has(b.label)) continue;
    if (brs.get(b.label) !== into.length) continue;
    const fold = commonWayTail(b, into);
    if (fold === null) continue;
    const { lists, depth } = fold;
    const tail = lists[0]!.items.slice(-depth);
    const edits = new Map<Expression, Expression>();
    for (const { container, items, br } of lists) {
      const kept = items.slice(0, items.length - depth);
      edits.set(container, { ...container, children: br ? [...kept, br] : kept });
    }
    // Top-down over the ORIGINAL nodes (an edited list keeps its original children, so the
    // lists below it are still found by identity), the tail placed after `b`.
    const rebuild = (e: Expression): Expression => {
      const x = edits.get(e) ?? e;
      if (x.kind === ExpressionKind.Region || x.kind === ExpressionKind.Block) {
        const children: Expression[] = [];
        for (const c of x.children) {
          children.push(rebuild(c));
          if (c === b) children.push(...tail);
        }
        return { ...x, children };
      }
      return mapChildrenShallow(x, rebuild);
    };
    fn.body = rebuild(fn.body) as RegionExpr;
    return true;
  }
  return false;
}

/** One way into a block's `end`: the list it ends, its statements before the `br` (if any). */
interface WayIn {
  container: Container;
  items: readonly Expression[];
  br: Expression | null;
}

/** The ways into `b`'s end (its `br`s, `into`, and its fall-through) and the statements all end with. */
function commonWayTail(b: BlockExpr, into: WayIn[]): { lists: WayIn[]; depth: number } | null {
  const ways = [...into];
  // The block's own fall-through, unless its last statement never falls through.
  const last = b.children[b.children.length - 1];
  if (!ways.some((w) => w.container === b) && last !== undefined && !neverFallsThrough(last)) {
    ways.push({ container: b, items: b.children, br: null });
  }
  if (ways.length < 2) return null;
  let depth = 0;
  for (;;) {
    const k = depth + 1;
    if (ways.some((w) => w.items.length < k)) break;
    const at = (w: WayIn) => w.items[w.items.length - k]!;
    const first = at(ways[0]!);
    // The kind first: keying a whole subtree is the expensive part.
    if (first.type !== None || ways.some((w) => at(w).kind !== first.kind) || pinned(first)) break;
    const key = deepKey(first);
    if (!ways.every((w) => deepKey(at(w)) === key)) break;
    depth = k;
  }
  return depth === 0 ? null : { lists: ways, depth };
}
