// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Typed `select` (0x1c) — standard since reference types, and the ONLY legal
// select over references (the untyped 0x1b form is limited to numeric and
// vector operands).
//
// binaryen-ts did not decode it at all ("unknown opcode 0x1c"), always emitted
// 0x1b, and its WAT parser read `(result …)` as an operand. So a module with a
// reference-typed select could neither be read nor written.
//
// Fixtures are upstream wat2wasm 1.0.41's bytes for the text beside each, and
// each module is RUN, not only validated: the reference case returns whether
// the selected funcref is null, so taking the wrong arm changes the answer.
//
// ⚠️ Not pinned here: a NUMERIC select written typed re-encodes UNTYPED — valid,
// same behaviour, different bytes. Keeping the written form is S6 decision 7.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));

// (module (func $f) (elem declare func $f)
//   (func (export "go") (param i32) (result i32)
//     (ref.is_null (select (result funcref) (ref.null func) (ref.func $f) (local.get 0)))))
const REF_WAT =
  '(module (func $f) (elem declare func $f) (func (export "go") (param i32) (result i32) (ref.is_null (select (result funcref) (ref.null func) (ref.func $f) (local.get 0)))))';
const REF_BYTES = hex(`00 61 73 6d 01 00 00 00 01 09 02 60 00 00 60 01 7f 01 7f 03 03 02 00 01 07 06
  01 02 67 6f 00 01 09 05 01 03 00 01 00 0a 11 02 02 00 0b 0c 00 d0 70 d2 00 20 00 1c 01 70 d1 0b`);

// (module (func (export "go") (param i32) (result i32)
//   (select (result i32) (i32.const 11) (i32.const 22) (local.get 0))))
const NUM_BYTES = hex(`00 61 73 6d 01 00 00 00 01 06 01 60 01 7f 01 7f 03 02 01 00 07 06 01 02 67 6f
  00 00 0a 0d 01 0b 00 41 0b 41 16 20 00 1c 01 7f 0b`);

async function go(bytes: Uint8Array, arg: number): Promise<number> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
  return (instance.exports.go as (x: number) => number)(arg);
}

describe('typed select', () => {
  it('a reference-typed select round-trips byte-identically and runs the same', async () => {
    const out = encodeWasm(parseWasm(REF_BYTES));
    assertEquals(out, REF_BYTES);
    // cond 1 → the null arm → 1; cond 0 → ref.func → 0
    assertEquals([await go(out, 1), await go(out, 0)], [1, 0]);
  });

  it('the WAT path writes a reference-typed select exactly as upstream does', async () => {
    const out = encodeWasm(parseWat(REF_WAT));
    assertEquals(out, REF_BYTES);
    assertEquals([await go(out, 1), await go(out, 0)], [1, 0]);
  });

  it('a numeric typed select decodes and runs the same (written form: decision 7)', async () => {
    const out = encodeWasm(parseWasm(NUM_BYTES));
    assertEquals(WebAssembly.validate(out as BufferSource), true);
    assertEquals([await go(out, 1), await go(out, 0)], [11, 22]);
  });
});
