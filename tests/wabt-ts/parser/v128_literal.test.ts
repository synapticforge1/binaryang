// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Parser support for `v128.const <interpretation> <lanes...>` literals.
 *
 * Verifies that every WAT lane form (i8x16, i16x8, i32x4, i64x2, f32x4,
 * f64x2) parses, encodes to the expected 16 raw bytes (little-endian per
 * lane), and round-trips through V8's native validator.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';

function findV128ConstBytes(binary: Uint8Array): Uint8Array | null {
  // v128.const is encoded as 0xfd 0x0c followed by 16 raw bytes.
  // Sweep the binary for the prefix and return the 16 bytes that follow.
  for (let i = 0; i + 17 < binary.length; i++) {
    if (binary[i] === 0xfd && binary[i + 1] === 0x0c) {
      return binary.slice(i + 2, i + 18);
    }
  }
  return null;
}

async function parseAndExtract(wat: string): Promise<Uint8Array> {
  const r = wat2wasm(wat);
  if (r.result !== Result.Ok) {
    console.log('parse errors:\n' + formatErrors(r.errors));
  }
  assertEquals(r.result, Result.Ok);
  const buf = new ArrayBuffer(r.binary.byteLength);
  new Uint8Array(buf).set(r.binary);
  await WebAssembly.compile(buf);
  const bytes = findV128ConstBytes(r.binary);
  if (bytes === null) throw new Error('no v128.const found in binary');
  return bytes;
}

describe('parser: v128.const literal', () => {
  it('i8x16 — 16 lanes of i8', async () => {
    const bytes = await parseAndExtract(`(module (func (result v128)
      (v128.const i8x16 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16)))`);
    assertEquals(Array.from(bytes), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('i8x16 — negative + wrap-around lanes', async () => {
    const bytes = await parseAndExtract(`(module (func (result v128)
      (v128.const i8x16 -1 -128 127 0 0 0 0 0 0 0 0 0 0 0 0 0)))`);
    assertEquals(bytes[0], 0xff);
    assertEquals(bytes[1], 0x80);
    assertEquals(bytes[2], 0x7f);
  });

  it('i16x8 — 8 lanes of i16 little-endian', async () => {
    const bytes = await parseAndExtract(`(module (func (result v128)
      (v128.const i16x8 0x0100 0x0302 0 0 0 0 0 0)))`);
    // Lane 0 = 0x0100 little-endian → bytes [0x00, 0x01]
    assertEquals(bytes[0], 0x00);
    assertEquals(bytes[1], 0x01);
    assertEquals(bytes[2], 0x02);
    assertEquals(bytes[3], 0x03);
  });

  it('i32x4 — 4 lanes of i32 little-endian', async () => {
    const bytes = await parseAndExtract(`(module (func (result v128)
      (v128.const i32x4 0x04030201 0 0 0)))`);
    assertEquals(bytes[0], 0x01);
    assertEquals(bytes[1], 0x02);
    assertEquals(bytes[2], 0x03);
    assertEquals(bytes[3], 0x04);
  });

  it('i64x2 — 2 lanes of i64 little-endian', async () => {
    const bytes = await parseAndExtract(`(module (func (result v128)
      (v128.const i64x2 0x0807060504030201 0)))`);
    for (let i = 0; i < 8; i++) assertEquals(bytes[i], i + 1);
  });

  it('f32x4 — 4 lanes of f32', async () => {
    // 1.0 as f32 has bit pattern 0x3f800000
    const bytes = await parseAndExtract(`(module (func (result v128)
      (v128.const f32x4 1.0 0 0 0)))`);
    // Little-endian: bytes 0..4 = 00 00 80 3f
    assertEquals(bytes[0], 0x00);
    assertEquals(bytes[1], 0x00);
    assertEquals(bytes[2], 0x80);
    assertEquals(bytes[3], 0x3f);
  });

  it('f64x2 — 2 lanes of f64', async () => {
    // 1.0 as f64 has bit pattern 0x3ff0000000000000
    const bytes = await parseAndExtract(`(module (func (result v128)
      (v128.const f64x2 1.0 0)))`);
    // Little-endian: bytes 0..8 = 00 00 00 00 00 00 f0 3f
    assertEquals(bytes[6], 0xf0);
    assertEquals(bytes[7], 0x3f);
  });

  it('integer literals in f32x4 are IEEE-754 encoded, not raw bits', async () => {
    // `f32x4 1` should be value 1.0 (bit pattern 0x3f800000), not 0x00000001.
    const bytes = await parseAndExtract(`(module (func (result v128)
      (v128.const f32x4 1 2 3 4)))`);
    // Lane 0 = 1.0 → bytes 0..4 = 00 00 80 3f
    assertEquals(bytes[2], 0x80);
    assertEquals(bytes[3], 0x3f);
  });
});
