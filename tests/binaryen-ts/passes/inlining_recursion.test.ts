// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Inlining a RECURSIVE callee must not delete the callee.
//
// Inlining removed a callee once every call site it had counted was inlined —
// but inlining a recursive function copies its body, self-call included, into
// the caller, so a call to it SURVIVES the very inlining that consumed the
// original one. And the count read every `__inlined_func$<name>` wrapper in the
// body, so blocks left by earlier iterations were counted again. `$fact` went,
// the caller still called it, and encoding refused: "unresolved call target
// reference". Found 2026-09-14 on three corpus modules at -O3 (the only level
// that runs Inlining): 1_recursion, 39_Phase39Combined, 5e_RecursiveArrow.
//
// Removal is now decided by what REMAINS — references recounted after the
// iteration — rather than by what was consumed.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const WAT = `(module
  ;; recursive: must survive being inlined into $f
  (func $fact (param i32) (result i32)
    (if (result i32) (i32.le_s (local.get 0) (i32.const 1))
      (then (i32.const 1))
      (else (i32.mul (local.get 0) (call $fact (i32.sub (local.get 0) (i32.const 1)))))))
  ;; not recursive: inlined everywhere, so it must still be removed
  (func $double (param i32) (result i32) (i32.add (local.get 0) (local.get 0)))
  (func (export "f") (param i32) (result i32)
    (i32.add (call $fact (local.get 0)) (call $double (local.get 0)))))`;

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  return r.binary;
}

function f(bytes: Uint8Array): (x: number) => number {
  return new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    x: number,
  ) => number;
}

for (
  const [label, configure] of [
    ['Inlining', (r: PassRunner) => r.add('Inlining')],
    ['-O3', (r: PassRunner) => r.addDefaultOptimizationPasses()],
  ] as const
) {
  Deno.test(`${label}: a recursive callee survives, and the module still computes the same`, () => {
    const bytes = assemble(WAT);
    const mod = parseWasm(bytes);
    configure(new PassRunner(mod, { optimizeLevel: 3, shrinkLevel: 0 })).run();
    const names = mod.functions.map((fn) => fn.name);
    assert(names.includes('$fact'), `$fact was removed: ${names.join(' ')}`);
    const out = encodeWasm(mod);
    assertEquals([1, 5, 7].map(f(out)), [1, 5, 7].map(f(bytes)));
  });
}

Deno.test('Inlining: a callee inlined at every call site is still removed', () => {
  const mod = parseWasm(assemble(WAT));
  new PassRunner(mod, { optimizeLevel: 3, shrinkLevel: 0 }).add('Inlining').run();
  assertEquals(mod.functions.some((fn) => fn.name === '$double'), false);
});
