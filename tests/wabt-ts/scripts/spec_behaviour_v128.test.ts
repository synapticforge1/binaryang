// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Item 6: the behaviour differential's `v128` wrappers
// (scripts/spec-behaviour/v128.ts). The JS API cannot pass or receive a
// `v128`, so every SIMD invocation threw a TypeError on the original and on
// every variant alike — and "agreed" without being run. A planted writer
// miscompile (`replace_lane` writing lane ^ 1; `i8x16.shuffle`'s lanes
// reversed) passed the gate with 0 DIVERGE, and with the wrappers fails it (5
// and 4 modules). Over the suite, 24,110 of 24,115 v128 `assert_return`s
// reproduce the manifest's own lanes through them; the 5 others pass a
// signalling-NaN f32/f64 SCALAR, whose payload no JS number carries.
//
// The wrappers are appended to the bytes by hand, so these tests build their
// modules with wat2wasm and check the appended code with the engine alone.

import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import {
  needsWrapper,
  type Sig,
  v128Lanes,
  withV128Wrappers,
  wrapperName,
} from '../../../scripts/spec-behaviour/v128.ts';

function instance(bytes: Uint8Array): WebAssembly.Exports {
  return new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports;
}

const asm = (wat: string) => wat2wasm(wat, { textForm: false }).binary;

Deno.test('a vector goes in and comes out as two i64 lanes, other values as they are', () => {
  // Beside imports, a rec group and another function, so the new type and
  // function indices are counted past all of them.
  const bytes = asm(`(module
    (import "m" "g" (func $g))
    (rec (type $a (func)) (type $b (struct)))
    (func $other)
    (func (export "add") (param v128 i32) (result v128 i32)
      (i32x4.add (local.get 0) (i32x4.splat (local.get 1)))
      (i32.mul (local.get 1) (i32.const 3))))`);
  const sig: Sig = { params: ['v128', 'i32'], results: ['v128', 'i32'] };
  const out = withV128Wrappers(bytes, new Map([['add', sig]]));
  const mod = new WebAssembly.Module(out as BufferSource);
  const ex = new WebAssembly.Instance(mod, { m: { g: () => {} } }).exports;
  const f = ex[wrapperName('add')] as (...a: unknown[]) => unknown[];
  const [lo, hi] = v128Lanes({ lane_type: 'i32', value: ['1', '2', '3', '4294967295'] });
  const got = f(lo, hi, 10);
  // Lanes 11, 12 | 13, 9 (0xffffffff + 10 wraps), little-endian in i64s.
  assertEquals(got, [(12n << 32n) | 11n, (9n << 32n) | 13n, 30]);
});

Deno.test('a module with nothing to wrap is returned as it was', () => {
  const bytes = asm('(module (func (export "f") (result i32) (i32.const 1)))');
  const scalar: Sig = { params: [], results: ['i32'] };
  assert(!needsWrapper(scalar));
  assertEquals(withV128Wrappers(bytes, new Map([['f', scalar]])), bytes);
});

Deno.test('a type JS cannot spell is left unwrapped rather than guessed', () => {
  assert(!needsWrapper({ params: ['v128', 'anyref'], results: [] }));
  assert(needsWrapper({ params: [], results: ['v128', 'externref'] }));
});

Deno.test("v128 lanes: every lane type, little-endian, negatives two's complement", () => {
  assertEquals(v128Lanes({ lane_type: 'i8', value: ['-1', ...Array(15).fill('0')] }), [0xffn, 0n]);
  assertEquals(v128Lanes({ lane_type: 'i16', value: ['1', '0', '0', '0', '2', '0', '0', '0'] }), [
    1n,
    2n,
  ]);
  assertEquals(v128Lanes({ lane_type: 'i64', value: ['-2', '5'] }), [-2n, 5n]);
  assertEquals(v128Lanes({ lane_type: 'f32', value: ['1065353216', '0', '0', '0'] }), [
    0x3f800000n,
    0n,
  ]);
});

Deno.test('several wrappers in one module, and a function section it had to create', () => {
  // All functions imported: there was no function or code section to extend.
  const bytes = asm(`(module
    (import "m" "id" (func $id (param v128) (result v128)))
    (export "id" (func $id)))`);
  const sig: Sig = { params: ['v128'], results: ['v128'] };
  const out = withV128Wrappers(bytes, new Map([['id', sig]]));
  const ex = new WebAssembly.Instance(new WebAssembly.Module(out as BufferSource), {
    m: { id: (() => {}) as unknown as WebAssembly.ExportValue },
  }).exports;
  assert(typeof ex[wrapperName('id')] === 'function');

  const two = asm(`(module
    (func (export "a") (param v128) (result v128) (local.get 0))
    (func (export "b") (param i64) (result v128) (i64x2.splat (local.get 0))))`);
  const w = withV128Wrappers(
    two,
    new Map<string, Sig>([['a', { params: ['v128'], results: ['v128'] }], [
      'b',
      { params: ['i64'], results: ['v128'] },
    ]]),
  );
  const e = instance(w);
  assertEquals((e[wrapperName('a')] as (...x: bigint[]) => bigint[])(7n, 8n), [7n, 8n]);
  assertEquals((e[wrapperName('b')] as (x: bigint) => bigint[])(-3n), [-3n, -3n]);
});
