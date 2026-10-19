/**
 * @module passes/remove-unused-brs
 *
 * RemoveUnusedBrs pass — removes branches that go to where execution would
 * fall through anyway.
 *
 * Two transformations are applied at the end of named blocks:
 *
 * 1. `(block $B ... (br $B))` — the unconditional branch at the tail of its
 *    own block is always redundant: execution falls through to the block exit
 *    regardless. Removed.
 *
 * 2. `(block $B ... (br_if $B cond))` — a conditional branch to the block's
 *    own exit at the tail. Whether the condition is true or false, execution
 *    ends up at the block exit, so the branch becomes `(drop cond)`.
 *    (The condition is preserved because it may have side effects.)
 *
 * And the same where a branch is in tail position further down: the last
 * statement of an `if` arm or a loop body that is itself last, up to the block
 * it names ({@link _dropFlowingBrs}, open-work 31) — with `(br_if $a x) (br $b)`
 * there, `$a` reached by falling through, becoming `(br_if $b (i32.eqz x))`.
 * Branches anywhere else are left unchanged, apart from jump threading below.
 *
 * Precondition: the tail child must have type `none` so that removing the
 * branch does not change the block's result type.
 *
 * Reference: `WebAssembly/binaryen/src/passes/RemoveUnusedBrs.cpp`
 *
 * @license MIT
 */

import {
  blockParamsOf,
  type BreakExpr,
  type Expression,
  ExpressionKind,
  type IfExpr,
  labelName,
  makeBreak,
  makeDrop,
  makeIf,
  makeNop,
  makeRegion,
  makeSelect,
  makeUnary,
  type RegionExpr,
  UnaryOp,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { None, ValType } from '../ir/types.ts';
import { deepEffects, invalidates, mergeEffects } from '../ir/effects.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { branchTargets, mapChildrenShallow, mapExpression, walkExpression } from '../ir/walk.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Removes unconditional and conditional branches to the immediately-following block exit. */
export class RemoveUnusedBrsPass implements Pass {
  readonly name = 'RemoveUnusedBrs';
  readonly description =
    'Removes branches to where execution falls through anyway (tail-of-block optimisation).';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      const body = _tailReturn(mapExpression(fn.body, _removeUnusedBrsNode));
      fn.body = _dropFlowingBrs(body, new Set()) as RegionExpr;
    }
  }
}

registerPass(RemoveUnusedBrsPass);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function _removeUnusedBrsNode(expr: Expression): Expression {
  if (expr.kind === ExpressionKind.If) return _optimizeIf(expr);
  if (expr.kind === ExpressionKind.Region) return _threadJumps(expr);
  if (expr.kind !== ExpressionKind.Block) return expr;
  const threaded = _threadJumps(expr);
  return threaded.kind === ExpressionKind.Block ? _optimizeBlock(threaded) : threaded;
}

const _DECLARES_LABEL = new Set<string>([
  ExpressionKind.Block,
  ExpressionKind.Loop,
  ExpressionKind.If,
  ExpressionKind.Try,
  ExpressionKind.TryTable,
]);

/**
 * Jump threading (open-work 31, upstream's `JumpThreader`): a block followed directly by an
 * unconditional, valueless `br $y` — a branch to the block lands right before that `br`, so it
 * may go to `$y` itself:
 *
 *     (block $x … (br_if $x c) …) (br $y)   →   (block $x … (br_if $y c) …) (br $y)
 *
 * The plain branches (`br`, `br_if`, `br_table`) move; when nothing else names `$x`, the block
 * goes (Vacuum). Only when the block has no result or parameters (its branches carry nothing), no
 * label inside it is spelled `$x` or `$y` (a shadowing label would catch the branch), and `$y` is
 * named, not an index (an index means a depth, which differs inside the block). `$y` is in scope
 * wherever the block is: the `br $y` after it is.
 */
function _threadJumps<T extends Expression & { children: Expression[] }>(e: T): T {
  let changed = false;
  const children = e.children.map((x, i) => {
    const next = e.children[i + 1];
    if (
      x.kind !== ExpressionKind.Block || x.label === '' || x.type !== None ||
      blockParamsOf(x) !== undefined
    ) return x;
    if (
      next?.kind !== ExpressionKind.Break || next.condition !== undefined ||
      next.values.length !== 0 || next.target.kind !== 'name'
    ) return x;
    const from = x.label, y = next.target;
    if (y.name === from) return x;
    // A label inside spelled `$x` or `$y` would catch a branch: then nothing is threaded. Other
    // kinds of branch to `$x` (`br_on_*`, a `try_table` catch) may stay; the block stays for them.
    let ok = true, named = false;
    walkExpression(x, (n) => {
      if (n === x) return;
      if (_DECLARES_LABEL.has(n.kind)) {
        const l = (n as { label: string }).label;
        if (l === from || l === y.name) ok = false;
      }
      if (n.kind === ExpressionKind.Break && labelName(n.target) === from) named = true;
      if (
        n.kind === ExpressionKind.Switch &&
        [...n.targets, n.defaultTarget].some((t) => labelName(t) === from)
      ) named = true;
    });
    if (!ok || !named) return x;
    changed = true;
    const retarget = (n: Expression): Expression => {
      if (n.kind === ExpressionKind.Break && labelName(n.target) === from) {
        return { ...n, target: y };
      }
      if (n.kind === ExpressionKind.Switch) {
        const t = (v: typeof n.defaultTarget) => (labelName(v) === from ? y : v);
        return { ...n, targets: n.targets.map(t), defaultTarget: t(n.defaultTarget) };
      }
      return n;
    };
    return { ...x, children: x.children.map((c) => mapExpression(c, retarget)) };
  });
  return changed ? { ...e, children } : e;
}

/**
 * A plain `br` that goes where falling through would go anyway (open-work 31, upstream's
 * flowing branches): the last statement of an arm, a loop body or a block that is itself in
 * tail position, all the way up to the block it names:
 *
 *     (block $b … (if c (then … (br $b))))   →   (block $b … (if c (then …)))
 *
 * `tail` holds the labels whose `end` control reaches by falling off the end of `e`. A void
 * block adds its own label for its last child; a void `if` passes `tail` (and its own label) to
 * both arms; a loop passes `tail` to its body (falling off the body leaves the loop; a `br` to
 * the loop's label goes back to its start, so that label is not added). A construct with a
 * result, or any other node, starts over with none. A construct declaring a label removes that
 * name from `tail` first, so a shadowed outer label is never matched. Only valueless,
 * unconditional branches go. A node is rebuilt only when something under it changed.
 */
function _dropFlowingBrs(e: Expression, tail: ReadonlySet<string>): Expression {
  const own = (label: string, add: boolean): Set<string> => {
    const s = new Set(tail);
    if (label !== '') {
      s.delete(label);
      if (add) s.add(label);
    }
    return s;
  };
  const list = (children: readonly Expression[], reached: ReadonlySet<string>) => {
    // 🔧 A branch also DISCARDS what earlier statements left on the stack; falling through keeps
    // it for the `end` (spec `unwind.wast`: `(i32.const 3) (block (i64.const 1) (br 1))`, invalid
    // at -O2 once the `br` went — found by the gate's spec-behaviour). So a list counts as
    // reaching an end only when everything before its last statement leaves nothing.
    const end = children.slice(0, -1).every((c) => c.type === None) ? reached : _NONE;
    let changed = false;
    const out = children.map((c, i) => {
      const d = _dropFlowingBrs(c, i === children.length - 1 ? end : _NONE);
      if (d !== c) changed = true;
      return d;
    });
    // The list's end flows to every label in `end`. What a branch there would do, falling
    // through does: a `br` to one goes; a `br_if` to one keeps only its condition; and
    // `(br_if $a x) (br $b)` with `$a` in `end` is `(br_if $b (i32.eqz x))`.
    const plain = (x: Expression | undefined): x is BreakExpr =>
      x?.kind === ExpressionKind.Break && x.values.length === 0;
    const last = out[out.length - 1];
    if (plain(last) && last.condition === undefined && end.has(labelName(last.target))) {
      out.pop();
      changed = true;
      const prev = out[out.length - 1];
      if (plain(prev) && prev.condition !== undefined && end.has(labelName(prev.target))) {
        out[out.length - 1] = makeDrop(prev.condition);
      }
    } else if (plain(last) && last.condition !== undefined && end.has(labelName(last.target))) {
      out[out.length - 1] = makeDrop(last.condition);
      changed = true;
    } else if (plain(last) && last.condition === undefined) {
      const prev = out[out.length - 2];
      if (
        plain(prev) && prev.condition !== undefined && end.has(labelName(prev.target)) &&
        labelName(prev.target) !== labelName(last.target)
      ) {
        out.splice(
          out.length - 2,
          2,
          makeBreak(labelName(last.target), makeUnary(UnaryOp.EqzI32, prev.condition)),
        );
        changed = true;
      }
    }
    return changed ? out : null;
  };
  switch (e.kind) {
    case ExpressionKind.Region: {
      const out = list(e.children, tail);
      return out === null ? e : { ...e, children: out };
    }
    case ExpressionKind.Block: {
      const end = e.type === None && blockParamsOf(e) === undefined ? own(e.label, true) : _NONE;
      const out = list(e.children, end);
      return out === null ? e : { ...e, children: out };
    }
    case ExpressionKind.If: {
      const end = e.type === None ? own(e.label, true) : _NONE;
      const ifTrue = list(e.ifTrue.children, end);
      const ifFalse = e.ifFalse === null ? null : list(e.ifFalse.children, end);
      const condition = _dropFlowingBrs(e.condition, _NONE);
      if (ifTrue === null && ifFalse === null && condition === e.condition) return e;
      return {
        ...e,
        condition,
        ifTrue: ifTrue === null ? e.ifTrue : { ...e.ifTrue, children: ifTrue },
        ifFalse: e.ifFalse === null || ifFalse === null
          ? e.ifFalse
          : { ...e.ifFalse, children: ifFalse },
      };
    }
    case ExpressionKind.Loop: {
      const out = list(e.body.children, e.type === None ? own(e.label, false) : _NONE);
      return out === null ? e : { ...e, body: { ...e.body, children: out } };
    }
    default: {
      let changed = false;
      const r = mapChildrenShallow(e, (c) => {
        const d = _dropFlowingBrs(c, _NONE);
        if (d !== c) changed = true;
        return d;
      });
      return changed ? r : e;
    }
  }
}

const _NONE: ReadonlySet<string> = new Set();

/**
 * A `return` that is the function body's last instruction returns to where
 * the body ends anyway: `(return v)` → `v`, `(return)` → nothing (open-work
 * 2, step 3c). One value at most — the body's tail is its result.
 */
function _tailReturn(body: RegionExpr): RegionExpr {
  const last = body.children[body.children.length - 1];
  if (last?.kind !== ExpressionKind.Return || last.values.length > 1) return body;
  const children = body.children.slice(0, -1);
  // 🔧 A `return` also DISCARDS what earlier instructions left on the stack
  // (spec `unwind.wast`: `(i32.const 3) (i64.const 1) (return (i32.const 9))`).
  // Falling through instead would leave them as results: only when every
  // instruction before it leaves nothing.
  if (children.some((c) => c.type !== None)) return body;
  if (last.values.length === 1) children.push(last.values[0]!);
  return { ...body, children };
}

const _NUMERIC = new Set<unknown>([ValType.I32, ValType.I64, ValType.F32, ValType.F64]);

/** A value with no effect at all, cheap to compute whether it is used or not. */
const _cheap = (e: Expression | undefined): e is Expression =>
  e !== undefined &&
  (e.kind === ExpressionKind.Const || e.kind === ExpressionKind.LocalGet ||
    e.kind === ExpressionKind.GlobalGet);

const _sole = (
  r: RegionExpr | null,
) => (r !== null && r.children.length === 1 ? r.children[0] : undefined);

/**
 * Open-work 2, step 3c:
 * - `if (c) (then (br $l))` → `br_if $l c` — not when `$l` is the `if` itself;
 * - `if (result t) c (then a) (else b)` → `select a b c` for a numeric `t` and
 *   arms that are each one constant or read. A `select` evaluates `a` and `b`
 *   BEFORE `c`: only when `c` writes nothing they read.
 */
function _optimizeIf(expr: IfExpr): Expression {
  const t = _sole(expr.ifTrue);
  if (
    expr.ifFalse === null && expr.type === None && t?.kind === ExpressionKind.Break &&
    t.condition === undefined && t.values.length === 0 && labelName(t.target) !== expr.label
  ) {
    // A `br` is `unreachable`; a valueless `br_if` falls through: `none`.
    return { ...t, condition: expr.condition, type: None };
  }
  const a = _sole(expr.ifTrue), b = _sole(expr.ifFalse);
  if (_NUMERIC.has(expr.type) && _cheap(a) && _cheap(b)) {
    const arms = mergeEffects(deepEffects(a), deepEffects(b));
    if (!invalidates(arms, deepEffects(expr.condition))) {
      return makeSelect(a, b, expr.condition);
    }
  }
  return expr;
}

/** A valueless `br_if` to `label`, with no other values. */
const _isBrIfTo = (e: Expression | undefined, label: string): e is BreakExpr =>
  e?.kind === ExpressionKind.Break && e.condition !== undefined && e.values.length === 0 &&
  labelName(e.target) === label;

/**
 * Open-work 2, step 6b (2026-10-08). A block whose only branch is a `br_if`
 * to itself as its FIRST statement is an `if` on the negated condition:
 *
 *     (block $b (br_if $b c) rest…)            → (if (i32.eqz c) (then rest…))
 *     (block $out (loop $in (br_if $out c) rest…)) → (loop $in (if (i32.eqz c) (then rest…)))
 *
 * The second is how every counted loop in the corpus tests its exit (2,529 of
 * them; 380 of the first). `rest…` may still branch to `$in` or outward; it
 * cannot name `$b` / `$out` (checked), so that label goes with its block:
 * `block … end` and the `br_if`'s label byte for an `i32.eqz` and the `if`'s
 * `end` — and OptimizeInstructions folds the `eqz` into a comparison. Not a
 * block (or loop) with PARAMETERS: they sit on the stack beneath the `br_if`,
 * which discards them when taken, and an `if` would leave them on the path it
 * skips. (A block opening with a valueless `br_if` to itself cannot carry a
 * result — nothing is on the stack for the branch to carry — so the types
 * need no check; two mutants restoring one were equivalent.)
 */
function _leadingBrIfToIf(
  block: Extract<Expression, { kind: typeof ExpressionKind.Block }>,
): Expression | null {
  if (blockParamsOf(block) !== undefined) return null;
  const label = block.label;
  const first = block.children[0];
  if (_isBrIfTo(first, label)) {
    const rest = block.children.slice(1);
    if (rest.some((c) => branchTargets(c).has(label))) return null;
    if (branchTargets(first.condition!).has(label)) return null;
    return makeIf(makeUnary(UnaryOp.EqzI32, first.condition!), makeRegion(rest));
  }
  if (block.children.length !== 1 || first?.kind !== ExpressionKind.Loop) return null;
  const loop = first;
  if (blockParamsOf(loop) !== undefined) return null;
  const head = loop.body.children[0];
  if (!_isBrIfTo(head, label)) return null;
  const rest = loop.body.children.slice(1);
  if (rest.some((c) => branchTargets(c).has(label))) return null;
  if (branchTargets(head.condition!).has(label)) return null;
  return {
    ...loop,
    body: makeRegion([makeIf(makeUnary(UnaryOp.EqzI32, head.condition!), makeRegion(rest))]),
  };
}

function _optimizeBlock(
  block: Extract<Expression, { kind: typeof ExpressionKind.Block }>,
): Expression {
  if (!block.label || block.children.length === 0) return block;
  const leading = _leadingBrIfToIf(block);
  if (leading !== null) return leading;

  const last = block.children[block.children.length - 1]!; // children is non-empty (guard above)

  // Case 1: (br $name) — unconditional, no value, at end of own block
  if (
    last.kind === ExpressionKind.Break &&
    last.condition === undefined &&
    last.values.length === 0 &&
    labelName(last.target) === block.label
  ) {
    const rest = block.children.slice(0, -1);
    if (rest.length === 0) return makeNop();
    const newLast = rest[rest.length - 1]!; // `rest` is non-empty (checked above)
    // Only safe when the new tail has type none (block type is preserved)
    if (newLast.type !== None) return block;
    return { ...block, type: None, children: rest };
  }

  // Case 2: (br_if $name cond) — conditional, no value, at end of own block
  if (
    last.kind === ExpressionKind.Break &&
    last.condition !== undefined &&
    last.values.length === 0 &&
    labelName(last.target) === block.label
  ) {
    const drop = makeDrop(last.condition);
    const newChildren = [...block.children.slice(0, -1), drop];
    return { ...block, type: None, children: newChildren };
  }

  return block;
}
