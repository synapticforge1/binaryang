// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// binaryang's optimizer beside upstream `wasm-opt`, on one module: both
// outputs must validate and compute the same.
//
// This was `tests/binaryen-ts/interop/hybrid_mode.test.ts` until 1.7.0, when
// hybrid mode — `Module.optimize(flags, true)` and `wasm-opt --hybrid`, which
// handed the module to upstream — left the product (owner, 2026-09-28). The
// bridge it used, `BinaryenInterop.optimizeViaSubprocess`, moved here with it.
// What hybrid mode's history found still holds for the bridge (K4): upstream
// needs our feature list, not `--all-features` (compact imports, which V8
// refuses), and the result must come back through a FILE — on Windows stdout
// is text mode and every `0a` became `0d 0a`.
//
// Runs only where upstream `wasm-opt` is on PATH.

import { assert, assertEquals } from '@std/assert';

import { createModule } from '../../src/binaryen-ts/api/index.ts';
import { readWat } from '../../src/binaryen-ts/tools/read-wat.ts';
import { writeWat } from '../../src/binaryen-ts/ir/write-wasm.ts';
import { BinaryenInterop } from '../interop/binaryen-js.ts';

async function wasmOptOnPath(): Promise<boolean> {
  try {
    return (await new Deno.Command('wasm-opt', { args: ['--version'] }).output()).code === 0;
  } catch {
    return false;
  }
}
const ignore = !(await wasmOptOnPath());
if (ignore) {
  console.warn('comparison: wasm-opt not on PATH — the upstream -O2 comparison is skipped');
}

/**
 * Uses bulk memory, has two imports from ONE module — what compact imports
 * compacts, so a run with it on is refused by V8 — and computes something.
 */
const WAT = `(module
  (import "env" "log" (func $log (param i32)))
  (import "env" "tick" (func $tick))
  (memory 1)
  (func (export "f") (param i32) (result i32)
    (memory.fill (i32.const 0) (local.get 0) (i32.const 16))
    (call $log (local.get 0))
    (call $tick)
    (i32.add (i32.load8_u (i32.const 3)) (i32.const 1))))`;

const run = (bytes: Uint8Array) =>
  (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {
    env: { log: () => {}, tick: () => {} },
  }).exports.f as (x: number) => number)(41);

Deno.test({
  name: 'ours and upstream -O2: both valid, both compute the same',
  ignore,
  async fn() {
    const mod = createModule(() => {});
    Object.assign(mod.ir, readWat(WAT));
    const ours = await mod.optimize('-O2');
    const upstream = await BinaryenInterop.optimizeViaSubprocess(writeWat(readWat(WAT)), ['-O2']);
    assert(WebAssembly.validate(ours as BufferSource), 'the engine accepts ours');
    assert(WebAssembly.validate(upstream as BufferSource), 'the engine accepts upstream');
    assertEquals(run(ours), 42);
    assertEquals(run(upstream), 42);
  },
});
