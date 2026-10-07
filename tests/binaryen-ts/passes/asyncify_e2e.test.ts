/**
 * @module binaryen-ts/tests/passes/asyncify_e2e_test
 *
 * Stage 4 end-to-end tests: the FULL asyncify pipeline (flatten → flow → locals
 * → runtime support) is now runnable. Each test builds a module, asyncifies it
 * with our passes, instantiates it, and drives a real unwind/rewind cycle
 * through the exported control functions — the canonical asyncify usage:
 *
 *   1. call the export; an "async" import triggers `asyncify_start_unwind`, so
 *      the call unwinds the wasm stack and returns a dummy value;
 *   2. `asyncify_stop_unwind`; do the async work; `asyncify_start_rewind`;
 *   3. call the export again — it rewinds to the paused call, which now returns
 *      the real value, and the function runs to completion with its locals
 *      restored.
 *
 * The same driver run against upstream `wasm-opt --asyncify` output — the
 * differential oracle — lives in the comparison suite
 * (`comparison/tests/asyncify_vs_wasm_opt.compare.ts`, 1.7.0).
 *
 * @license MIT
 */

import { assert, assertEquals } from '@std/assert';

import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { listPasses, PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { ADD_GET, asyncify, driveOnce, LOOP_GET } from './asyncify_helpers.ts';

Deno.test('asyncify e2e — suspend/resume across an async call (x + get())', () => {
  const bytes = writeWasm(asyncify(readWat(ADD_GET)));
  // compute(10) with get() → 42 must yield 52 across the unwind/rewind.
  assertEquals(driveOnce(bytes, 'compute', [10], 'get', 42), 52);
});

Deno.test('asyncify e2e — locals survive a rewind (single suspend in a loop)', () => {
  // The loop suspends on the FIRST get(); on rewind, $i/$acc must be restored so
  // it continues. Our single-shot driver resumes once, so the loop runs to
  // completion after the first suspend (get() returns 7 on rewind and on every
  // subsequent normal call).
  const bytes = writeWasm(asyncify(readWat(LOOP_GET)));
  // After resume, get() returns 7 each of the 3 iterations → 21.
  assertEquals(driveOnce(bytes, 'sum', [3], 'get', 7), 21);
});

Deno.test('asyncify e2e — suspend inside a function reached by call_ref (open-work 8)', () => {
  // `call_ref` is an INDIRECT call, as upstream treats it: `compute` must be
  // instrumented, and the partial `x * 3` it holds across the call restored on
  // rewind. compute(10) = 30 + helper(10) = 30 + (10 + get()) = 82 with get → 42.
  const bytes = writeWasm(asyncify(readWat(`(module
    (import "env" "get" (func $get (result i32)))
    (memory 1)
    (export "memory" (memory 0))
    (type $h (func (param i32) (result i32)))
    (elem declare func $helper)
    (func $helper (type $h) (param $y i32) (result i32)
      (i32.add (local.get $y) (call $get)))
    ;; Counts its runs: an instrumented function SKIPS what it already did when
    ;; it rewinds; one left uninstrumented runs it again (the count shows 2).
    (global $runs (mut i32) (i32.const 0))
    (func $compute (export "compute") (param $x i32) (result i32)
      (global.set $runs (i32.add (global.get $runs) (i32.const 1)))
      (i32.add
        (i32.mul (global.get $runs) (i32.const 100))
        (i32.add
          (i32.mul (local.get $x) (i32.const 3))
          (call_ref $h (local.get $x) (ref.func $helper)))))
    ;; A CALLER: instrumented only if compute is known to change state —
    ;; which only the call_ref can tell.
    (func $main (export "main") (param $x i32) (result i32)
      (i32.add (i32.const 1) (call $compute (local.get $x)))))`)));
  // runs = 1 on the resumed path: 1 + 100 + 30 + (10 + 42).
  assertEquals(driveOnce(bytes, 'main', [10], 'get', 42), 183);
});

Deno.test('asyncify — return_call_ref is refused, as the other tail calls are', () => {
  const mod = readWat(`(module
    (memory 1)
    (type $v (func))
    (elem declare func $f)
    (func $f)
    (func $g (return_call_ref $v (ref.func $f))))`);
  let message = '';
  try {
    asyncify(mod);
  } catch (e) {
    message = (e as Error).message;
  }
  assert(/return_call_ref/.test(message), message);
});

Deno.test('asyncify — registered as a pass, runnable via PassRunner (lowercase name)', () => {
  assert(listPasses().includes('Asyncify'), 'Asyncify should be a registered pass');
  const mod = readWat(ADD_GET);
  // Resolve the upstream-style lowercase flag name case-insensitively.
  new PassRunner(mod).add('asyncify').run();
  assertEquals(driveOnce(writeWasm(mod), 'compute', [10], 'get', 42), 52);
});
