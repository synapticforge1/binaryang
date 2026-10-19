/**
 * @module passes/vacuum
 *
 * Vacuum pass — removes obviously unneeded code.
 *
 * Transformations applied:
 *
 * - `nop` instructions are removed from block children (they contribute no
 *   value and have no side effects).
 * - Empty blocks (after nop removal) collapse to `nop`.
 * - Unnamed single-child blocks collapse to their sole child.
 * - Unnamed blocks splice into their parent, and a named block's head (statements before the
 *   first that names its label) moves out in front of it.
 * - `drop(nop)` → `nop`.
 * - `drop(unreachable)` → `unreachable` (propagate unreachability).
 * - `drop(const)` → `nop` (constants have no side effects).
 * - `drop(local.get)` → `nop` (local reads have no side effects).
 * - `drop(global.get)` → `nop` (global reads have no side effects).
 *
 * Reference: `WebAssembly/binaryen/src/passes/Vacuum.cpp`
 *
 * @license MIT
 */

import {
  blockParamsOf,
  type Expression,
  ExpressionKind,
  makeNop,
  neverFallsThrough,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { None, Unreachable } from '../ir/types.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { branchTargets, mapExpression, walkExpression } from '../ir/walk.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Removes nops, empty blocks, and dropped pure expressions. */
export class VacuumPass implements Pass {
  readonly name = 'Vacuum';
  readonly description =
    'Removes nop instructions, empty/redundant blocks, and dropped pure expressions.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, _vacuumNode);
    }
    for (const global of module.globals) {
      if (global.init !== undefined) global.init = mapExpression(global.init, _vacuumNode);
    }
  }
}

registerPass(VacuumPass);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Bottom-up vacuum transform for a single expression node.
 *
 * Exposed for callers that need to apply Vacuum semantics to a single
 * function body without running the whole module pass — e.g. the
 * `InliningOptimizing` pass cleans inlined call sites this way.
 */
export function vacuumNode(expr: Expression): Expression {
  return _vacuumNode(expr);
}

function _vacuumNode(expr: Expression): Expression {
  switch (expr.kind) {
    case ExpressionKind.Block:
      return _simplifyBlock(expr);

    // ⚠️ Every loop / if / try / function body. They were unnamed Blocks before
    // regions were a kind and were vacuumed by the case above; without this one
    // `default` would have returned them untouched. Only the nop filter
    // applies: a slot always holds a region, so one cannot turn into a `nop` or
    // collapse into its child the way a block can.
    case ExpressionKind.Region: {
      const kept = _spliced(expr.children);
      return kept.length === expr.children.length && kept.every((c, i) => c === expr.children[i])
        ? expr
        : { ...expr, children: kept };
    }

    case ExpressionKind.Drop: {
      const inner = expr.value;
      if (inner.kind === ExpressionKind.Nop) return makeNop();
      // 🔧 This read `inner.type === Unreachable`, which is true of a node that
      // merely HAS an unreachable operand — and such a node still pushes its
      // value in the bytes, so dropping the `drop` left it for the enclosing
      // `end`: invalid output from `wasm-opt` (see `neverFallsThrough`).
      if (neverFallsThrough(inner)) return inner;
      if (
        inner.kind === ExpressionKind.Const ||
        inner.kind === ExpressionKind.LocalGet ||
        inner.kind === ExpressionKind.GlobalGet
      ) {
        return makeNop();
      }
      return expr;
    }

    default:
      return expr;
  }
}

/**
 * A sequence's children without its nops, and with every UNNAMED, parameterless
 * block child replaced by that block's own children (open-work 2, step 6a,
 * 2026-10-08 — upstream's MergeBlocks and its binary writer both do this).
 * Nothing branches to a block without a label, so its only effect is a
 * sequence boundary; the stack is the same on both sides of it (a block's body
 * starts empty and ends with exactly its results, so a `pop` inside it takes
 * a value produced inside it, and one after it takes the block's result —
 * the last spliced child's, as before). Measured first: our -Oz output held
 * 1,321 such blocks, each a `block … end` in the binary, and upstream's
 * re-encoding of our output dropped exactly those (−1,323) before our own
 * passes found 4.4 KB more in the straight-line code they had hidden.
 */
function _spliced(children: readonly Expression[]): Expression[] {
  const out: Expression[] = [];
  for (const child of children) {
    if (child.kind === ExpressionKind.Nop) continue;
    if (child.kind === ExpressionKind.Block && blockParamsOf(child) === undefined) {
      if (child.label === '') {
        for (const c of child.children) if (c.kind !== ExpressionKind.Nop) out.push(c);
        continue;
      }
      const head = _headOutside(child.children, child.label);
      if (head > 0) {
        for (const c of child.children.slice(0, head)) {
          if (c.kind !== ExpressionKind.Nop) out.push(c);
        }
        out.push({ ...child, children: child.children.slice(head) });
        continue;
      }
    }
    out.push(child);
  }
  return out;
}

/**
 * How many of a NAMED block's leading children may stand before it instead (open-work 31,
 * upstream MergeBlocks' head): statements that never name its label run the same outside it,
 * since nothing can jump to the block's end before they finish. Stops at the first one that
 * names it or has a value type, and always keeps the last child inside. Moving them is what lets
 * the passes after it see the block as the `if` or loop it now is.
 *
 * ⚠️ Nothing moves out of a block holding a `pop`: a void statement is not always stack-neutral.
 * `(local.set $a (call $two))` takes one of two results and leaves the other for a later `pop`
 * in the same block; moved out, it leaves that value OUTSIDE, where the `pop` cannot reach
 * (`27_number-parsing`: "expected i32 but nothing on stack").
 */
function _headOutside(children: readonly Expression[], label: string): number {
  let pops = false;
  for (const c of children) {
    walkExpression(c, (x) => {
      if (x.kind === ExpressionKind.Pop) pops = true;
    });
  }
  if (pops) return 0;
  let n = 0;
  while (n < children.length - 1) {
    const c = children[n]!;
    if (c.type !== None || branchTargets(c).has(label)) break;
    n++;
  }
  return n;
}

function _simplifyBlock(
  block: Extract<Expression, { kind: typeof ExpressionKind.Block }>,
): Expression {
  // Filter nops — they contribute nothing to a block body — and splice in the
  // children of an unnamed block.
  const filtered = _spliced(block.children);

  // Empty block → nop
  if (filtered.length === 0) return makeNop();

  // Unnamed single-child block → collapse (the name is only needed for
  // branch targets; without a name there are no branches targeting it). Safe
  // when the surviving child carries the block's declared result type, OR when
  // it is `unreachable` (the bottom type — valid in any type position, and the
  // block never falls through, so a bare `unreachable` stands in for it). The
  // ONE unsafe case is a child of a *different concrete* type than the block's
  // declared result (e.g. a result-typed block whose sole child is a void
  // statement): collapsing would silently change the type the block presents to
  // its parent. In that case fall through and keep the wrapper so `block.type`
  // is preserved (as the multi-child path does below).
  const only = filtered.length === 1 ? filtered[0] : undefined;
  if (
    only !== undefined && block.label === '' &&
    (only.type === block.type || only.type === Unreachable)
  ) {
    return only;
  }

  // No change
  if (filtered.length === block.children.length) return block;

  // Preserve the block's declared result type. Removing nops never changes the
  // value the block yields at its tail, so recomputing the type from the last
  // child is wrong when that child is `unreachable` (a `br`/`return` tail):
  // overwriting a declared `i32` with `unreachable` makes the encoder emit a
  // void blocktype and trips "expected N for fallthru, found 0" upstream.
  return { ...block, children: filtered };
}
