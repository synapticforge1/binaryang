/**
 * @module binaryen-ts/passes/converge
 *
 * Pipeline convergence: run the same pass schedule in ROUNDS on one module
 * until another round stops paying for itself. Opt-in, like upstream
 * `wasm-opt --converge` (`-c`); nothing in `-O` / `-Oz` uses it.
 *
 * The owner's rule (2026-09-19): "perform passes until there is a delta
 * decrease in size in the range of 0.1% then stop" — read over a WINDOW of
 * rounds, so one flat round between two productive ones does not stop it.
 * Upstream's stopping rule is a fixed point (no change at all); this one is
 * cheaper and stops at the same place when the gains run out.
 *
 * The cautions it is built on (cmem/open-work.md, the convergence note):
 * - a round can GROW the module before a later one shrinks it, so the result
 *   is the smallest round seen — never larger than round 1;
 * - passes can undo each other (LocalCSE's tee vs CoalesceLocals), so a round
 *   whose bytes repeat an earlier round's is a cycle, and it stops there;
 * - the delta can only be read by ENCODING each round, which is the honest
 *   measure and a real cost, so there is a round cap.
 *
 * Measured before building (2026-09-28, 2,919 modules at `-Oz`): round 2
 * saves 0.012%, round 3 0.002%, and no round grew a module.
 *
 * @license MIT
 */

import { writeWasm } from '../ir/write-wasm.ts';
import type { WasmModule } from '../ir/module.ts';
import { type PassOptions, PassRunner } from './pass.ts';

/** How {@link optimizeToConvergence} decides to stop. */
export interface ConvergeOptions {
  /**
   * Stop once the average relative gain over the last {@link window} rounds
   * is below this. Default `0.001` — 0.1%.
   */
  threshold: number;
  /** How many rounds the average is taken over. Default `2`. */
  window: number;
  /** The most rounds that run, whatever the gains. Default `20`. */
  maxRounds: number;
}

/** The defaults: 0.1% averaged over two rounds, at most 20 rounds. */
export const defaultConvergeOptions: ConvergeOptions = {
  threshold: 0.001,
  window: 2,
  maxRounds: 20,
};

/** Why the rounds stopped. */
export type ConvergeStop = 'threshold' | 'fixed-point' | 'cycle' | 'max-rounds';

/** What {@link optimizeToConvergence} did. */
export interface ConvergeReport {
  /** The encoded size after each round, round 1 first. */
  sizes: number[];
  /** The round (1-based) whose output is the result: the smallest. */
  bestRound: number;
  /** Why it stopped. */
  stoppedBy: ConvergeStop;
}

/** What {@link optimizeToConvergence} returns. */
export interface ConvergeResult {
  /** The smallest round's encoding — never larger than round 1's. */
  bytes: Uint8Array;
  report: ConvergeReport;
}

/**
 * Run `schedule`'s passes on `module` in rounds until they stop paying
 * (see the module doc) and return the SMALLEST round's encoding.
 *
 * `schedule` fills a fresh {@link PassRunner} for each round — the same passes
 * every time, e.g. `(r) => r.addDefaultOptimizationPasses()`. The module is
 * mutated in place and is left as the LAST round made it; the result is the
 * returned bytes, which may be an earlier round's.
 */
export function optimizeToConvergence(
  module: WasmModule,
  options: Partial<PassOptions>,
  schedule: (runner: PassRunner) => void,
  converge: Partial<ConvergeOptions> = {},
): ConvergeResult {
  const { threshold, window, maxRounds } = { ...defaultConvergeOptions, ...converge };
  if (!(window >= 1) || !(maxRounds >= 1)) {
    throw new Error(`converge: window (${window}) and maxRounds (${maxRounds}) must be at least 1`);
  }
  const sizes: number[] = [];
  const seen = new Map<string, number>(); // bytes hash → round
  let best: Uint8Array | null = null;
  let bestRound = 0;
  let stoppedBy: ConvergeStop = 'max-rounds';

  for (let round = 1; round <= maxRounds; round++) {
    const runner = new PassRunner(module, options);
    schedule(runner);
    runner.run();
    const bytes = writeWasm(module);
    sizes.push(bytes.length);
    if (best === null || bytes.length < best.length) {
      best = bytes;
      bestRound = round;
    }

    const key = hashBytes(bytes);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      // The same bytes as an earlier round: the next rounds repeat what
      // followed it. The previous round is a fixed point; anything older, a cycle.
      stoppedBy = earlier === round - 1 ? 'fixed-point' : 'cycle';
      break;
    }
    seen.set(key, round);

    if (round > window) {
      let gain = 0;
      for (let r = round - window; r < round; r++) {
        gain += (sizes[r - 1]! - sizes[r]!) / sizes[r - 1]!;
      }
      if (gain / window < threshold) {
        stoppedBy = 'threshold';
        break;
      }
    }
  }
  return { bytes: best!, report: { sizes, bestRound, stoppedBy } };
}

/** The bytes' length and a 53-bit FNV-1a — collisions only cost an early stop. */
function hashBytes(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i]!, 0x01000193);
    h2 = Math.imul(h2 ^ b[i]!, 0x5bd1e995);
  }
  return `${b.length}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}
