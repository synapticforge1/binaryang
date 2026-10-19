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
 * Only tail-position branches are considered. Branches that appear earlier in
 * a block, or that target an outer block, are left unchanged.
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
import { branchTargets, mapExpression, walkExpression } from '../ir/walk.ts';

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
      fn.body = _tailReturn(mapExpression(fn.body, _removeUnusedBrsNode));
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
