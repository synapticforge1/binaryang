// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression: over-precise hex-float consts were TRUNCATED instead of
// round-to-nearest-even.
//
// The parser reconstructed a JS `number` via `(int + frac) * 2^exp` and let
// `Math.fround` / the f64 store do the final rounding. A JS double keeps only
// 52 fraction bits, so any mantissa bit past bit 52 of the literal was dropped
// BEFORE the format rounding ran. A value just above an f32/f64 rounding
// midpoint therefore collapsed onto the midpoint and then rounded the wrong way
// (to even, i.e. down). The fix reconstructs the exact significand with BigInt
// and keeps a sticky bit over the discarded low bits.
//
// Surfaced by wasmtk's WASM-spec-testsuite runner (22 const.wast failures).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

async function f32Bits(lit: string): Promise<number> {
  const wat = `(module (func (export "f") (result f32) (f32.const ${lit})))`;
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  const { instance } = await WebAssembly.instantiate(buf);
  const v = (instance.exports.f as () => number)();
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v, true);
  return dv.getUint32(0, true);
}

async function f64Bits(lit: string): Promise<bigint> {
  const wat = `(module (func (export "f") (result f64) (f64.const ${lit})))`;
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  const { instance } = await WebAssembly.instantiate(buf);
  const v = (instance.exports.f as () => number)();
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v, true);
  return dv.getBigUint64(0, true);
}

describe('hex-float f32 round-to-nearest-even', () => {
  it('rounds up a value just above the midpoint (reported case)', async () => {
    // 2^-50 + 2^-74 + tiny: just above the f32 midpoint -> rounds up.
    assertEquals(await f32Bits('+0x1.00000100000000001p-50'), 0x26800001);
  });

  it('ties to even at an exact midpoint (rounds down to even)', async () => {
    // 2^-50 + exactly 2^-74: exact midpoint, even neighbor wins.
    assertEquals(await f32Bits('+0x1.000001p-50'), 0x26800000);
  });

  it('exact representable value is unchanged', async () => {
    assertEquals(await f32Bits('0x1.5p0'), 0x3fa80000); // 1.3125
  });

  it('over-precise value just below max-finite midpoint rounds down, not up', async () => {
    // Just above max-finite but well below the midpoint to 2^128 -> max finite.
    assertEquals(await f32Bits('0x1.fffffe0000001p127'), 0x7f7fffff);
  });

  it('value above the max-finite midpoint overflows to infinity', async () => {
    // Above 0x1.ffffff·2^127 (the rounding boundary) -> +inf.
    assertEquals(await f32Bits('0x1.ffffff8p127'), 0x7f800000);
  });

  it('largest finite f32 encodes exactly', async () => {
    assertEquals(await f32Bits('0x1.fffffep127'), 0x7f7fffff);
  });
});

describe('hex-float f64 round-to-nearest-even', () => {
  it('rounds up a value just above the midpoint', async () => {
    assertEquals(
      await f64Bits('0x1.000000000000080000001p-50'),
      0x3cd0000000000001n,
    );
  });

  it('ties to even at an exact midpoint (rounds down to even)', async () => {
    assertEquals(await f64Bits('0x1.0000000000000800p-50'), 0x3cd0000000000000n);
  });

  it('exact representable value is unchanged', async () => {
    assertEquals(await f64Bits('0x1.921fb54442d18p+2'), 0x401921fb54442d18n); // ~pi
  });
});
