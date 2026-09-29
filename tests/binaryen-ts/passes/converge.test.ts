/**
 * @module binaryen-ts/tests/passes/converge_test
 *
 * Pipeline convergence (`optimizeToConvergence`, `wasm-opt --converge`): the
 * smallest round wins, a repeat of an earlier round's bytes stops it, the
 * threshold is read over a window of rounds, and the rounds never cost
 * behaviour.
 *
 * @license MIT
 */

import { assert, assertEquals, assertThrows } from '@std/assert';

import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import {
  optimizeToConvergence,
  type Pass,
  PassRunner,
} from '../../../src/binaryen-ts/passes/index.ts';
import { parseArgs } from '../../../src/binaryen-ts/tools/wasm-opt.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { makeNop } from '../../../src/binaryen-ts/ir/expressions.ts';

const OZ = { optimizeLevel: 2, shrinkLevel: 2 } as const;

const WAT = `(module
  (func $sq (param i32) (result i32) (i32.mul (local.get 0) (local.get 0)))
  (func (export "f") (param i32) (result i32)
    (local i32) (local i32)
    (local.set 1 (call $sq (local.get 0)))
    (local.set 2 (i32.add (local.get 1) (i32.const 0)))
    (if (result i32) (i32.eqz (i32.const 0))
      (then (i32.add (local.get 2) (call $sq (i32.const 3))))
      (else (unreachable)))))`;

const run = (bytes: Uint8Array, x: number) =>
  (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    a: number,
  ) => number)(x);

Deno.test('converge: never larger than one round, and behaves as the input', () => {
  const once = readWat(WAT);
  new PassRunner(once, OZ).addDefaultOptimizationPasses().run();
  const oneRound = writeWasm(once);

  const { bytes, report } = optimizeToConvergence(
    readWat(WAT),
    OZ,
    (r) => r.addDefaultOptimizationPasses(),
  );
  assert(bytes.length <= oneRound.length, `${bytes.length} > ${oneRound.length}`);
  assertEquals(report.sizes[0], oneRound.length, 'round 1 is one plain -Oz');
  assertEquals(bytes.length, Math.min(...report.sizes));
  assert(WebAssembly.validate(bytes as BufferSource));
  const original = writeWasm(readWat(WAT));
  for (const x of [0, 2, 7]) assertEquals(run(bytes, x), run(original, x), `f(${x})`);
});

/** A pass that changes nothing: every round's bytes are round 1's. */
class Nothing implements Pass {
  readonly name = 'Nothing';
  readonly description = 'changes nothing';
  readonly requiresNonNullableLocalFixups = false;
  run(_m: WasmModule): void {}
}

Deno.test('converge: a round that repeats the last one is a fixed point', () => {
  const { report } = optimizeToConvergence(readWat(WAT), OZ, (r) => r.addPass(new Nothing()));
  assertEquals(report.stoppedBy, 'fixed-point');
  assertEquals(report.sizes.length, 2);
});

/**
 * Grows the first function's body on odd rounds by a `nop` and takes it back
 * on even ones: sizes alternate, so round 3 repeats round 1 — a CYCLE — and
 * the smallest round must win even though it is not the last.
 */
function flipFlop(): (r: PassRunner) => void {
  let round = 0;
  return (r) => {
    round++;
    const grow = round % 2 === 1;
    const pass: Pass = {
      name: 'FlipFlop',
      description: 'adds a nop on odd rounds, removes it on even ones',
      requiresNonNullableLocalFixups: false,
      run(m: WasmModule) {
        const body = m.functions[0]!.body as unknown as { children: unknown[] };
        if (grow) body.children.unshift(makeNop());
        else body.children.shift();
      },
    };
    r.addPass(pass);
  };
}

Deno.test('converge: a cycle stops it, and the SMALLEST round is the result', () => {
  const { bytes, report } = optimizeToConvergence(readWat(WAT), {
    optimizeLevel: 0,
    shrinkLevel: 0,
  }, flipFlop());
  assertEquals(report.stoppedBy, 'cycle');
  assertEquals(report.sizes.length, 3);
  assert(report.sizes[1]! < report.sizes[0]!, `sizes ${report.sizes}`);
  assertEquals(report.bestRound, 2);
  assertEquals(bytes.length, report.sizes[1]);
});

Deno.test('converge: the threshold is averaged over the window', () => {
  // A pass that shrinks nothing and changes nothing would stop as a fixed
  // point; a zero threshold with maxRounds 1 stops at the cap instead.
  const capped = optimizeToConvergence(
    readWat(WAT),
    OZ,
    (r) => r.addDefaultOptimizationPasses(),
    { maxRounds: 1 },
  );
  assertEquals(capped.report.stoppedBy, 'max-rounds');
  assertEquals(capped.report.sizes.length, 1);
  // With a threshold no gain can reach, it stops as soon as the window fills —
  // after window + 1 rounds — unless the bytes repeat first.
  const r = optimizeToConvergence(
    readWat(WAT),
    { optimizeLevel: 0, shrinkLevel: 0 },
    flipFlop(),
    { threshold: 1, window: 1 },
  );
  assertEquals(r.report.stoppedBy, 'threshold');
  assertEquals(r.report.sizes.length, 2);
  assertThrows(
    () => optimizeToConvergence(readWat(WAT), OZ, () => {}, { window: 0 }),
    Error,
    'window',
  );
});

Deno.test('wasm-opt: -c and --converge set converge', () => {
  assertEquals(parseArgs(['in.wasm', '-Oz', '-c']).options.converge, true);
  assertEquals(parseArgs(['in.wasm', '--converge']).options.converge, true);
  assertEquals(parseArgs(['in.wasm', '--converge']).options.passes, undefined, 'not a pass name');
  assertEquals(parseArgs(['in.wasm', '-Oz']).options.converge, undefined);
});
