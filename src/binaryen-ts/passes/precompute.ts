/**
 * @module binaryen-ts/passes/precompute
 *
 * Precompute pass — an expression whose value is known at compile time becomes
 * that value (open-work 23, stage E2).
 *
 * Built on the evaluator's numeric core (`interp/numeric.ts`), so a constant is
 * computed here exactly as the interpreter and OptimizeInstructions compute it,
 * and decided by the same rule (`foldedLiteral`): a trap is never folded away,
 * and a NaN only from an operator exact on the bits.
 *
 * Bottom-up, so a whole tree of constants folds in one run:
 * - a `unary` / `binary` of constants → its value;
 * - an `if` whose condition is a constant → the arm it takes (in a block
 *   carrying the `if`'s label when something branches to it), or nothing;
 * - a `select` whose condition is a constant → the operand it picks, when the
 *   other has no effect and cannot trap (both were evaluated);
 * - a `br_if` whose condition is a constant → a `br`, or its values falling
 *   through;
 * - a `br_table` whose index is a constant → a `br` to the target it picks.
 *
 * What a constant flows through — locals — is ConstantPropagation's; what a
 * condition becomes once known is this pass's. Unreachable code a taken branch
 * leaves behind is DCE's. `v128` operators are not evaluated (E1's limit).
 *
 * Reference: `WebAssembly/binaryen/src/passes/Precompute.cpp`
 *
 * @license MIT
 */

import {
  asStatement,
  blockOf,
  type Expression,
  ExpressionKind,
  labelName,
  type Literal,
  makeBreak,
  makeConst,
  makeNop,
  type RegionExpr,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import type { BlockResult } from '../../wabt-ts/ir/ir.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { ValType } from '../ir/types.ts';
import { deepEffects, hasSideEffects } from '../ir/effects.ts';
import { mapExpression } from '../ir/walk.ts';
import { evalBinary, evalUnary, foldedLiteral } from '../interp/numeric.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Replaces expressions whose value is known at compile time with that value. */
export class PrecomputePass implements Pass {
  readonly name = 'Precompute';
  readonly description =
    'Replace expressions whose value is known at compile time with that value; a constant condition picks its arm.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    const constants = _constantGlobals(module);
    const fold = (e: Expression): Expression => _precompute(e, constants);
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, fold);
    }
  }
}

/**
 * The value of every immutable, DEFINED global whose initialiser is one
 * constant — keyed by name and by its index in the global index space
 * (imports first), as a `global.get` may name it either way. Reading such a
 * global is reading its constant (open-work 2, step 6d; upstream's
 * Precompute and SimplifyGlobals both apply it): the read becomes the
 * constant, and what then holds only constants folds on — a function every
 * caller passes the same global's value becomes DAE's constant parameter.
 * An imported global has no known value; a mutable one may change.
 */
function _constantGlobals(module: WasmModule): Map<string | number, Literal> {
  const out = new Map<string | number, Literal>();
  let index = module.imports.filter((i) => i.kind === ExternalKind.Global).length;
  for (const g of module.globals) {
    const init = g.init?.children;
    if (!g.mutable && init?.length === 1 && init[0]!.kind === ExpressionKind.Const) {
      out.set(g.name, init[0]!.value);
      out.set(index, init[0]!.value);
    }
    index++;
  }
  return out;
}

registerPass(PrecomputePass);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** The value of an `i32` constant condition: true / false, or `undefined` when not a constant. */
function _condition(e: Expression): boolean | undefined {
  if (e.kind !== ExpressionKind.Const || e.value.type !== ValType.I32) return undefined;
  return e.value.value !== 0;
}

/** The index an `i32` constant gives a `br_table`, unsigned, or `undefined`. */
function _index(e: Expression): number | undefined {
  if (e.kind !== ExpressionKind.Const || e.value.type !== ValType.I32) return undefined;
  return e.value.value >>> 0;
}

const _removable = (e: Expression): boolean => !hasSideEffects(deepEffects(e));

function _precompute(e: Expression, constants: Map<string | number, Literal>): Expression {
  switch (e.kind) {
    case ExpressionKind.GlobalGet: {
      const lit = constants.get(e.var.kind === 'name' ? e.var.name : e.var.value);
      return lit === undefined ? e : makeConst(lit);
    }

    case ExpressionKind.Unary: {
      if (e.value.kind !== ExpressionKind.Const) return e;
      const lit = foldedLiteral(e.opcode, evalUnary(e.opcode, e.value.value));
      return lit === null ? e : makeConst(lit);
    }

    case ExpressionKind.Binary: {
      if (e.left.kind !== ExpressionKind.Const || e.right.kind !== ExpressionKind.Const) return e;
      const lit = foldedLiteral(e.opcode, evalBinary(e.opcode, e.left.value, e.right.value));
      return lit === null ? e : makeConst(lit);
    }

    case ExpressionKind.If: {
      const taken = _condition(e.condition);
      if (taken === undefined) return e;
      const arm: RegionExpr | null = taken ? e.ifTrue : e.ifFalse;
      const type = e.type as BlockResult;
      if (arm === null) return makeNop(); // no else: a `none` if, nothing runs
      // A branch to the `if`'s label leaves the arm: keep the label on a block.
      // Unreferenced labels are RemoveUnusedNames' to drop.
      if (e.label !== '') return blockOf(arm, type, e.label);
      return arm.children.length === 0 ? makeNop() : asStatement(arm, type);
    }

    case ExpressionKind.Select: {
      const taken = _condition(e.condition);
      if (taken === undefined) return e;
      const [kept, other] = taken ? [e.val1, e.val2] : [e.val2, e.val1];
      // Both operands were evaluated, in order; the one not picked may go only
      // when it does nothing — no effect, no trap.
      return _removable(other) ? kept : e;
    }

    case ExpressionKind.Break: {
      if (e.condition === undefined) return e;
      const taken = _condition(e.condition);
      if (taken === undefined) return e;
      if (taken) return makeBreak(labelName(e.target), undefined, e.values);
      // Not taken: its values fall through, which is all a `br_if` leaves.
      if (e.values.length === 0) return makeNop();
      return e.values.length === 1 ? e.values[0]! : e;
    }

    case ExpressionKind.Switch: {
      const i = _index(e.condition);
      if (i === undefined) return e;
      const target = i < e.targets.length ? e.targets[i]! : e.defaultTarget;
      return makeBreak(labelName(target), undefined, e.values);
    }

    default:
      return e;
  }
}
