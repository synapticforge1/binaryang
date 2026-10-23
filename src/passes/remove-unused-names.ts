// Based on WebAssembly/binaryen (https://github.com/WebAssembly/binaryen)
// Original source: src/passes/RemoveUnusedNames.cpp
// Copyright 2015 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module passes/remove-unused-names
 *
 * RemoveUnusedNames pass — strips block and loop labels that are never
 * referenced by a branch instruction.
 *
 * A block label is unused when nothing names it as a branch target — not a
 * `br` / `br_if` / `br_table`, and not one of the label references that are
 * easy to forget: `br_on_*`, a `try_table` catch destination, a
 * `try…delegate` target, or a `rethrow`. Such names are meaningless noise that the
 * encoder still has to emit (and the decoder parse), so removing them
 * shrinks the binary and simplifies downstream passes.
 *
 * An unnamed loop (no back-edge `br` to its label) executes at most once
 * and is therefore equivalent to a straight-line sequence — the loop wrapper
 * is replaced by its body.
 *
 * Reference: `WebAssembly/binaryen/src/passes/RemoveUnusedNames.cpp`
 *
 * @license MIT
 */

import {
  asRegion,
  asStatement,
  type BlockExpr,
  type Expression,
  ExpressionKind,
  type LoopExpr,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { None } from '../ir/types.ts';
import { branchTargets, mapExpression } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Removes unused block/loop names and replaces no-back-edge loops with their bodies. */
export class RemoveUnusedNamesPass implements Pass {
  readonly name = 'RemoveUnusedNames';
  readonly description =
    'Remove unused block and loop names; replace back-edge-free loops with their bodies.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      fn.body = asRegion(_processBody(fn.body));
    }
  }
}

registerPass(RemoveUnusedNamesPass);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function _processBody(body: Expression): Expression {
  // Pass 1: collect every branch-target name that appears in the tree.
  const targets = branchTargets(body);

  // Pass 2: strip unused names bottom-up so inner structures are cleaned first.
  return mapExpression(body, (expr) => _strip(expr, targets));
}

function _strip(expr: Expression, targets: Set<string>): Expression {
  if (expr.kind === ExpressionKind.Block) {
    const block = expr as BlockExpr;
    if (block.label !== '' && !targets.has(block.label)) {
      return { ...block, label: '' };
    }
    return block;
  }

  if (expr.kind === ExpressionKind.Loop) {
    const loop = expr as LoopExpr;
    // A loop with no back-edge br executes exactly once — replace with body.
    // Type guard: only replace when types match (always true for valid MVP WASM).
    if (!targets.has(loop.label) && loop.type === loop.body.type) {
      // The body takes the LOOP's place — a statement or operand position,
      // which a region cannot occupy and which `Expression` would not refuse.
      return asStatement(loop.body, loop.type ?? None);
    }
    return loop;
  }

  return expr;
}
