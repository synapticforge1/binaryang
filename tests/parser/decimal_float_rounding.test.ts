// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression: DECIMAL float literals in f32 position were double-rounded.
//
// `f32.const <decimal>` was parsed as `f32ValueToBits(parseFloat(text))`:
// `parseFloat` rounds the decimal to an f64, then the store rounds that f64 to
// f32 — two roundings. An input crafted to sit at an f32 midpoint has an
// intermediate f64 that lands on (or just past) that midpoint, so ties-to-even
// on the f64→f32 step sends it to a different neighbor than a single correct
// rounding of the ORIGINAL decimal would. The fix evaluates the decimal as an
// exact BigInt rational and rounds once (`decimalToBits`).
//
// f64 is unaffected: JS `parseFloat` is a correctly-rounded decimal→f64 and
// storing that exact f64 adds no second rounding, so only the f32 path needed
// the change.
//
// Surfaced by wasmtk's WASM-spec-testsuite runner (the last 4 const.wast
// failures after A/br_if and B/hex-float were fixed). Bug C.

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

function froundBits(lit: string): number {
  const v = Math.fround(parseFloat(lit));
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v, true);
  return dv.getUint32(0, true);
}

describe('decimal→f32 single-rounding (no double-round)', () => {
  it('rounds the reported crafted midpoint input correctly', async () => {
    // 8.8817847263968443574e-16 sits just ABOVE the midpoint between
    // 0x26800000 (2^-50) and 0x26800001 (2^-50 + 2^-73), so a single correct
    // rounding gives 0x26800001. The double-rounding path (parseFloat→fround)
    // truncates to 0x26800000. (Authoritative: verified with exact BigInt
    // rational comparison of the decimal against the A/B midpoint.)
    assertEquals(await f32Bits('8.8817847263968443574e-16'), 0x26800001);
    assertEquals(froundBits('8.8817847263968443574e-16'), 0x26800000); // the bug
  });

  it('rounds an exact midpoint by ties-to-even (down to the even neighbor)', async () => {
    // Exact midpoint between 0x26800000 (even LSB) and 0x26800001 (odd LSB):
    //   M = 2^-50 + 2^-74 = (2^24 + 1) / 2^74,  a terminating decimal.
    const num = (1n << 24n) + 1n; // 2^24 + 1 = 16777217
    const digits = (num * 5n ** 74n).toString().padStart(74, '0');
    const midpoint = '0.' + digits; // = num / 10^74 exactly

    // Exact tie -> rounds to the even neighbor 0x26800000.
    assertEquals(await f32Bits(midpoint), 0x26800000);
    // A hair above the midpoint (append a nonzero digit) -> rounds up.
    assertEquals(await f32Bits(midpoint + '1'), 0x26800001);
  });

  it('agrees with fround on ordinary (non-midpoint) values', async () => {
    // Away from midpoints the two paths must produce identical results — the
    // fix changes only the crafted midpoint corners, nothing else.
    const values = [
      '1.0',
      '0.5',
      '3.14159',
      '2.5',
      '1e10',
      '1e-10',
      '1e-50',
      '1e38',
      '3.4028234663852886e+38', // FLT_MAX
      '1.1754943508222875e-38', // smallest normal
      '1.4e-45',
      '1e-45',
      '1e-46',
      '123456789.0',
      '0.1',
      '0.2',
      '0.3',
      '-1.5',
      '6.62607015e-34',
      '2.99792458e8',
      '1.6180339887',
    ];
    for (const lit of values) {
      assertEquals(await f32Bits(lit), froundBits(lit), `mismatch on ${lit}`);
    }
  });

  it('overflows to infinity above the max-finite midpoint', async () => {
    // > (FLT_MAX + 2^128)/2 -> +inf.
    assertEquals(await f32Bits('3.5e38'), 0x7f800000);
    // FLT_MAX itself stays finite.
    assertEquals(await f32Bits('3.4028234663852886e+38'), 0x7f7fffff);
  });
});
