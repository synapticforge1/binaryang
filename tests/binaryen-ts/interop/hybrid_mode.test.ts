// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Hybrid mode — `Module.optimize(flags, true)` and `wasm-opt --hybrid` — hands
// the module to upstream `wasm-opt` as text. Nothing tested it, and it failed
// four independent ways at once (K4, 2026-09-28):
//
// - `toWat()` printed invalid WAT (numeric opcodes, `(function …)`) and threw on
//   most kinds — the subprocess was rarely even reached;
// - upstream ran with its DEFAULT features and refused 330 of the 421 corpus
//   modules (bulk memory, multi-value, EH); `--all-features` then turned on
//   compact imports, an encoding V8 refuses;
// - on Windows the result came back through stdout, in text mode: every `0a`
//   became `0d 0a`, and every result was invalid;
// - a BINARY input to `wasm-opt --hybrid` was disassembled by piping it to
//   upstream's stdin — corrupted the same way.
//
// Runs only where upstream `wasm-opt` is on PATH (not in CI).

import { assert, assertEquals } from '@std/assert';

import { createModule } from '../../../src/binaryen-ts/api/index.ts';
import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { wasmOpt } from '../../../src/binaryen-ts/tools/wasm-opt.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

async function wasmOptOnPath(): Promise<boolean> {
  try {
    return (await new Deno.Command('wasm-opt', { args: ['--version'] }).output()).code === 0;
  } catch {
    return false;
  }
}
const ignore = !(await wasmOptOnPath());

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
  name: 'hybrid Module.optimize: valid output that computes the same',
  ignore,
  async fn() {
    const mod = createModule(() => {});
    Object.assign(mod.ir, readWat(WAT));
    const out = await mod.optimize('-O2', true);
    assert(WebAssembly.validate(out as BufferSource), 'the engine accepts it');
    assertEquals(run(out), 42);
  },
});

Deno.test({
  name: 'wasm-opt --hybrid on a BINARY input: valid output that computes the same',
  ignore,
  async fn() {
    const path = await Deno.makeTempFile({ suffix: '.wasm' });
    try {
      await Deno.writeFile(path, wat2wasm(WAT).binary);
      const out = (await wasmOpt(path, { hybridMode: true, optimizeLevel: 2 })) as Uint8Array;
      assert(WebAssembly.validate(out as BufferSource), 'the engine accepts it');
      assertEquals(run(out), 42);
    } finally {
      await Deno.remove(path);
    }
  },
});
