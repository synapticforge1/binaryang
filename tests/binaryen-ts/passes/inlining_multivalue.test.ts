// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Inlining a callee with SEVERAL results.
//
// The wrapper block was typed from `callee.results[0]` alone, so a
// `(result i32 i32)` callee landed in a block declaring one value: V8 refused
// the module ("expected 1 elements on the stack for fallthru, found 2") and
// upstream's validator agreed. Found 2026-09-14: 16 of the 421 corpus modules
// at -O3, Inlining alone reproducing each — their string and math helpers
// return pairs. Upstream types the wrapper with the callee's whole result type
// (`block->type = retType`, `Inlining.cpp`), and so does this now.
//
// The fallthrough guard beside it compared `substituted.type !== retType` by
// reference, which a tuple type — an array — always fails: it appended
// `unreachable` after a body that DOES fall through, a module that validates
// and traps. It now asks whether the body falls through with values at all.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { makeBlock, makeRegion } from '../../../src/binaryen-ts/ir/expressions.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

function inlined(wat: string): { before: Uint8Array; after: Uint8Array } {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = parseWasm(r.binary);
  new PassRunner(mod, { optimizeLevel: 3, shrinkLevel: 0 }).add('Inlining').run();
  assertEquals(mod.functions.length, 1, 'the callee was inlined away');
  return { before: r.binary, after: encodeWasm(mod) };
}

function run(bytes: Uint8Array, inputs: number[]): (number | string)[] {
  const f = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    x: number,
  ) => number;
  return inputs.map((x) => {
    try {
      return f(x);
    } catch (e) {
      return e instanceof WebAssembly.RuntimeError ? 'trap' : String(e);
    }
  });
}

const CASES: Record<string, string> = {
  'falls through with two values': `(module
    (func $pair (param i32) (result i32 i32) (local.get 0) (i32.add (local.get 0) (i32.const 10)))
    (func (export "f") (param i32) (result i32) (call $pair (local.get 0)) (i32.sub)))`,
  'leaves through a two-value return': `(module
    (func $pair (param i32) (result i32 i32)
      (if (local.get 0) (then (return (i32.const 1) (i32.const 5))))
      (i32.const 3) (i32.const 9))
    (func (export "f") (param i32) (result i32) (call $pair (local.get 0)) (i32.sub)))`,
  'produces its values in separate instructions around a statement': `(module
    (func $pair (param i32) (result i32 i32) (local $t i32)
      (local.get 0)
      (local.set $t (i32.mul (local.get 0) (i32.const 3)))
      (local.get $t))
    (func (export "f") (param i32) (result i32) (call $pair (local.get 0)) (i32.sub)))`,
};

Deno.test('Inlining a two-result callee whose body is ONE named block: no trapping unreachable', () => {
  // Decoded bodies never take this shape — the decoder seeds `Pop`s beneath a
  // multi-value producer, so the body is always several instructions and the
  // inner block is retyped to the wrapper's own type object. Built IR can: a
  // single named block carrying its OWN tuple type, which a reference comparison
  // calls different from the wrapper's, appending `unreachable` after a body
  // that falls through.
  const r = wat2wasm(CASES['falls through with two values']!);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = parseWasm(r.binary);
  const callee = mod.functions.find((fn) => fn.sig.results.length === 2)!;
  callee.body = makeRegion(
    [makeBlock(callee.body.children, '$named', [ValType.I32, ValType.I32])],
    [ValType.I32, ValType.I32],
  );
  const before = encodeWasm(mod);
  new PassRunner(mod, { optimizeLevel: 3, shrinkLevel: 0 }).add('Inlining').run();
  assertEquals(mod.functions.length, 1, 'the callee was inlined away');
  assertEquals(run(encodeWasm(mod), [0, 2, 7]), run(before, [0, 2, 7]));
});

for (const [name, wat] of Object.entries(CASES)) {
  Deno.test(`Inlining a two-result callee that ${name}: valid, and computes the same`, () => {
    const { before, after } = inlined(wat);
    assertEquals(run(after, [0, 2, 7]), run(before, [0, 2, 7]));
  });
}
