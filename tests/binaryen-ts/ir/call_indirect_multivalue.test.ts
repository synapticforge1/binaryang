// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Found by M8d (2026-09-18): `makeCallIndirect` typed a multi-value call by its
// FIRST result (`sig.results[0] ?? None`), where `makeCall` and `makeCallRef`
// type theirs by every result. The decoder built every `call_indirect` through
// it. No byte changes with the fix — the node's type is not written — so these
// hold the type, and that a pass still handles the tuple-typed node.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { makeCallIndirect, makeI32Const } from '../../../src/binaryen-ts/ir/expressions.ts';
import { None, ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { varIndex } from '../../../src/wabt-ts/ir/ir.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const WAT = `(module
  (type $two (func (param i32) (result i64 i32)))
  (table 1 funcref)
  (elem (i32.const 0) $pair)
  (func $pair (type $two) (i64.extend_i32_u (local.get 0)) (local.get 0))
  (func (export "f") (param i32) (result i64)
    (call_indirect (type $two) (local.get 0) (i32.const 0))
    (i64.extend_i32_u)
    (i64.add)))`;

/** Every call_indirect's type in the module's functions. */
function types(m: { functions: { body: unknown }[] }): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if ((v as { kind?: unknown }).kind === 'call_indirect') out.push((v as { type: unknown }).type);
    for (const [k, x] of Object.entries(v)) if (k !== 'loc') walk(x);
  };
  m.functions.forEach((f) => walk(f.body));
  return out;
}

describe('a multi-value call_indirect is typed by every result', () => {
  it('the factory: none, one, or the tuple — as makeCall', () => {
    const call = (results: ValType[]) =>
      makeCallIndirect(varIndex(0), makeI32Const(0), [], { params: [], results }).type;
    assertEquals(call([]), None);
    assertEquals(call([ValType.F32]), ValType.F32);
    assertEquals(call([ValType.I32, ValType.I64]), [ValType.I32, ValType.I64]);
  });

  it('the decoder builds it that way', () => {
    assertEquals(types(readForPasses(wat2wasm(WAT).binary)), [[ValType.I64, ValType.I32]]);
  });

  it('the optimizer still takes it: -O3 is valid and computes the same', async () => {
    const run = async (bytes: Uint8Array) => {
      const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
      return (instance.exports.f as (x: number) => bigint)(5);
    };
    assert(WebAssembly.validate(wat2wasm(WAT).binary as BufferSource), 'the input is valid');
    const m = readForPasses(wat2wasm(WAT).binary);
    new PassRunner(m, { optimizeLevel: 3, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    const optimized = writeWasm(m);
    assert(WebAssembly.validate(optimized as BufferSource));
    assertEquals(await run(optimized), await run(wat2wasm(WAT).binary));
    assertEquals(await run(optimized), 10n);
  });
});
