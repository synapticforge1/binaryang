// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/precompute-propagate
 *
 * PrecomputePropagate pass — ConstantPropagation and Precompute, alternated in each function
 * until neither changes anything (open-work 31; upstream's `precompute-propagate`).
 *
 * Each needs the other's result: a constant read makes an operator's operands constant, the
 * operator's value written to a local is a constant to read, and a constant condition that picks
 * an arm removes a merge, so a local the other arm wrote is one constant again. A float's bit
 * pattern taken apart (`i64.reinterpret_f64`, shift, mask, test) is such a chain, each link one
 * round. A fixed number of rounds stops partway along it, and the next `-Oz` run finished the job
 * (open-work 31, step 8: a second run of our own -Oz took 1.5 KB more off the corpus).
 *
 * Both steps only ever remove (a read becomes a constant, a write of the held constant goes, a
 * tree of constants becomes one, a decided branch loses the other arm), so the loop ends; the
 * round limit is a defence.
 *
 * Reference: `WebAssembly/binaryen/src/passes/Precompute.cpp` (`propagateLocals`, and the loop in
 * `doWalkFunction`)
 *
 * @license MIT
 */

import type { WasmModule } from '../ir/module.ts';
import { propagateFunction } from './constant-propagation.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { constantGlobals, precomputeFunction } from './precompute.ts';

/** More rounds than any input measured has needed; a defence, not a tuning knob. */
const MAX_ROUNDS = 32;

/** Alternates ConstantPropagation and Precompute in each function until neither changes it. */
export class PrecomputePropagatePass implements Pass {
  readonly name = 'PrecomputePropagate';
  readonly description =
    'Alternate ConstantPropagation and Precompute in each function until neither changes anything.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    const constants = constantGlobals(module);
    for (const fn of module.functions) {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const propagated = propagateFunction(fn);
        // Precompute runs even when nothing propagated in the first round: what it folds needs no
        // local (a tree of constants, a constant global).
        const computed = precomputeFunction(fn, constants);
        if (!propagated && !computed) break;
      }
    }
  }
}

registerPass(PrecomputePropagatePass);
