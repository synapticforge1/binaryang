/**
 * @module binaryen-ts/passes/remove-unused-brs
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
  type Expression,
  ExpressionKind,
  type IfExpr,
  labelName,
  makeDrop,
  makeNop,
  makeSelect,
  type RegionExpr,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { None, ValType } from '../ir/types.ts';
import { deepEffects, invalidates, mergeEffects } from '../ir/effects.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { mapExpression } from '../ir/walk.ts';

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
  if (expr.kind !== ExpressionKind.Block) return expr;
  return _optimizeBlock(expr);
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

function _optimizeBlock(
  block: Extract<Expression, { kind: typeof ExpressionKind.Block }>,
): Expression {
  if (!block.label || block.children.length === 0) return block;

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
