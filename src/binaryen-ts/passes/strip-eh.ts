/**
 * @module binaryen-ts/passes/strip-eh
 *
 * Strip Exception Handling pass.
 *
 * Removes every EH construct from a module so the result no longer requires
 * the exception-handling feature:
 *
 * - `throw`, `throw_ref`, `rethrow` are replaced by statements that evaluate
 *   and drop each operand (preserving side effects), then trap via `unreachable`
 *   — spliced where the throw stood, not wrapped in a block (see
 *   `mapWithSequences`).
 *   Any exception that the original program would have thrown now traps.
 * - `try` and `try_table` are replaced by their body. Catch bodies are
 *   discarded along with the surrounding construct.
 * - The module's tag list (defined and imported) is cleared and
 *   `hasExceptionHandling` is set to
 *   `false` so downstream consumers stop emitting the EH feature.
 *
 * This mirrors `WebAssembly/binaryen/src/passes/StripEH.cpp`. The upstream pass
 * invokes `ReFinalize`, typing the blocks it builds `unreachable` and relying on
 * its writer to add an `unreachable` after them. Here nothing it builds is
 * typed `unreachable`: a throw's replacement is spliced statements, and a try's
 * body block declares the try's type (a construct's type is what it declares —
 * owner, 2026-09-16).
 *
 * @license MIT
 */

import {
  asStatement,
  type Expression,
  ExpressionKind,
  makeDrop,
  makeUnreachable,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { None } from '../ir/types.ts';
import { mapWithSequences, type Sequence } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

/** Removes all EH instructions and tags; throws become traps. */
export class StripEHPass implements Pass {
  readonly name = 'StripEH';
  readonly description =
    'Removes EH instructions and tags. Throws become unreachable; try / try_table are replaced by their body.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      fn.body = mapWithSequences(fn.body, stripEHNode);
    }
    // Clear tags + disable the EH feature flag. Imported tags go too: every
    // instruction that could reference one has just been stripped, so leaving
    // them would keep the module demanding a tag from its host for nothing —
    // and would re-enable EH validation on an otherwise EH-free module.
    module.tags = [];
    module.imports = module.imports.filter((imp) => imp.kind !== ExternalKind.Tag);
    module.hasExceptionHandling = false;
  }
}

registerPass(StripEHPass);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Per-node EH stripper. Bottom-up; children have already been rewritten.
 *
 * Exported so other passes that want strip-style semantics on a single
 * function body (without running the whole module pass) can reuse it via
 * `mapWithSequences(fn.body, stripEHNode)` — a throw becomes a {@link Sequence}.
 */
export function stripEHNode(expr: Expression): Expression | Sequence {
  switch (expr.kind) {
    case ExpressionKind.Throw:
      return trapWithDroppedOperands(expr.operands);

    case ExpressionKind.ThrowRef:
      return trapWithDroppedOperands([expr.exnref]);

    case ExpressionKind.Rethrow:
      // rethrow has no operands — just trap.
      return makeUnreachable();

    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
      // Replace with the body; catch bodies, destinations and the delegate
      // target are discarded. The body takes the TRY's place — a statement
      // position a region cannot hold — as a block DECLARING the try's type:
      // `asStatement` would type it by the body's last instruction, which is
      // `unreachable` for `(try (result i32) (do (throw $e)) …)`.
      // (One instruction stands as itself, and is already of the try's type.)
      return asStatement(expr.body, expr.type ?? None);

    default:
      return expr;
  }
}

/**
 * Each operand dropped (preserving side effects), then `unreachable` — as a
 * {@link Sequence}, which stands where the throw stood WITHOUT a block: the
 * throw left the stack polymorphic, and a block's `end` would not (see
 * {@link mapWithSequences}). No operands: a bare `unreachable`.
 */
function trapWithDroppedOperands(operands: Expression[]): Expression | Sequence {
  if (operands.length === 0) return makeUnreachable();
  return { sequence: [...operands.map(makeDrop), makeUnreachable()] };
}
