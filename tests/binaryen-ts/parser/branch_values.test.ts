// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A branch or return carries EVERY value its target expects.
//
// The binaryen-ts WAT parser packed a branch's operands into one slot, and that
// packing step dropped values three separate times: `return` (35 corpus modules
// no engine would load), `br`, and — still live until this test — `br_table`,
// which kept only the operand just before its index. Each produced a module V8
// rejects.
//
// Expected bytes are upstream wat2wasm 1.0.41's code section for the same text,
// so these pin the OUTPUT, not the representation: they hold across S6 decision
// 6, which changes how values are stored.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';

/** The code section's payload. */
function codeSection(bytes: Uint8Array): number[] {
  let p = 8;
  while (p < bytes.length) {
    const id = bytes[p++]!;
    let size = 0, shift = 0, b: number;
    do {
      b = bytes[p++]!;
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (id === 10) return [...bytes.slice(p, p + size)];
    p += size;
  }
  throw new Error('no code section');
}

const CASES: [string, string, number[]][] = [
  [
    'br, two values',
    '(func (result i32 i32) (block $b (result i32 i32) (br $b (i32.const 1) (i32.const 2))))',
    [0x01, 0x0b, 0x00, 0x02, 0x00, 0x41, 0x01, 0x41, 0x02, 0x0c, 0x00, 0x0b, 0x0b],
  ],
  [
    'br_if, two values',
    '(func (param i32) (result i32 i32) (block $b (result i32 i32) (br_if $b (i32.const 1) (i32.const 2) (local.get 0))))',
    [0x01, 0x0d, 0x00, 0x02, 0x01, 0x41, 0x01, 0x41, 0x02, 0x20, 0x00, 0x0d, 0x00, 0x0b, 0x0b],
  ],
  [
    'br_table, two values',
    '(func (param i32) (result i32 i32) (block $b (result i32 i32) (br_table $b $b (i32.const 1) (i32.const 2) (local.get 0))))',
    [
      0x01,
      0x0f,
      0x00,
      0x02,
      0x01,
      0x41,
      0x01,
      0x41,
      0x02,
      0x20,
      0x00,
      0x0e,
      0x01,
      0x00,
      0x00,
      0x0b,
      0x0b,
    ],
  ],
  [
    'return, two values',
    '(func (result i32 i32) (return (i32.const 1) (i32.const 2)))',
    [0x01, 0x07, 0x00, 0x41, 0x01, 0x41, 0x02, 0x0f, 0x0b],
  ],
];

describe('every carried value survives — bytes as upstream wat2wasm writes them', () => {
  for (const [name, fn, upstream] of CASES) {
    it(`WAT path: ${name}`, () => {
      const out = encodeWasm(parseWat(`(module ${fn})`));
      assertEquals(WebAssembly.validate(out as BufferSource), true);
      assertEquals(codeSection(out), upstream);
    });
    it(`binary round trip: ${name}`, () => {
      const once = encodeWasm(parseWat(`(module ${fn})`));
      assertEquals(codeSection(encodeWasm(parseWasm(once))), upstream);
    });
  }
});
