// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.4 — SIMD lane immediates and `v128.const` lane values wrapped silently.
//
// The tranche table called this "SIMD lane index out of range". Reading the
// spec cases showed it is TWO things, split across two layers, plus a third the
// entry had not mentioned at all:
//
//   lane index 256+        MALFORMED  "i8 constant out of range"  (simd_lane.wast)
//                          — the immediate is a single BYTE, so 256 does not
//                            fit the encoding at all
//   lane index 16..255     INVALID    "invalid lane index"        (simd_lane.wast)
//                          — fits the byte, exceeds the lane COUNT; already
//                            rejected by the validator since T9.6
//   v128.const lane value  MALFORMED  "i8 constant out of range"  (simd_const.wast)
//
// So 255 and 256 must fail in DIFFERENT layers, which is why the parser checks
// only that the immediate fits `u8` and leaves the count comparison alone.
//
// All three wrapped rather than erroring:
//
//   (i8x16.extract_lane_s 256 …)      -> lane 0
//   (v128.const i8x16 256 …)          -> 0
//   (v128.const i8x16 -129 …)         -> 127
//
// The last is the sharpest: `-129` becoming `127` is a sign flip on every lane,
// in a module V8 accepts and runs.
//
// assert_malformed (quoted): 828 -> 869 / 1229. Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

const Z16 = '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0';
const Z8 = '0 0 0 0 0 0 0 0';

function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}
function rep(v: string, n: number): string {
  return Array(n).fill(v).join(' ');
}

describe('T12.4 — a lane index must fit the u8 immediate (malformed)', () => {
  const MALFORMED: [string, string][] = [
    [
      'i8x16.extract_lane_s',
      `(module (func (result i32) (i8x16.extract_lane_s 256 (v128.const i8x16 ${Z16}))))`,
    ],
    [
      'i8x16.replace_lane',
      `(module (func (result v128) (i8x16.replace_lane 256 (v128.const i8x16 ${Z16}) (i32.const 1))))`,
    ],
    [
      'i16x8.extract_lane_u',
      `(module (func (result i32) (i16x8.extract_lane_u 256 (v128.const i16x8 ${Z8}))))`,
    ],
    [
      'i32x4.extract_lane',
      '(module (func (result i32) (i32x4.extract_lane 256 (v128.const i32x4 0 0 0 0))))',
    ],
    [
      'i64x2.extract_lane',
      '(module (func (result i64) (i64x2.extract_lane 256 (v128.const i64x2 0 0))))',
    ],
    [
      'f64x2.replace_lane',
      '(module (func (result v128) (f64x2.replace_lane 256 (v128.const f64x2 0 0) (f64.const 1))))',
    ],
  ];
  for (const [name, src] of MALFORMED) {
    it(`rejects ${name} with lane 256`, () => {
      assert(!accepts(src), `accepted: ${name}`);
    });
  }
});

describe('T12.4 — a lane index within the byte stays a VALIDATION error', () => {
  // 255 fits the immediate and exceeds the lane count, so it must PARSE and
  // then fail validation. If the parser rejected it too, 255 and 256 would be
  // indistinguishable and the spec's two messages would collapse into one.
  for (const lane of ['16', '255']) {
    it(`parses lane ${lane} and lets the validator reject it`, () => {
      const src =
        `(module (func (result i32) (i8x16.extract_lane_s ${lane} (v128.const i8x16 ${Z16}))))`;
      const { binary, errors } = wat2wasm(src);
      assert(!hasErrors(errors), `parse should accept lane ${lane}:\n${formatErrors(errors)}`);
      assert(binary);
      assertEquals(wasmValidate(binary, { features: allFeatures() }).result, Result.Error);
    });
  }

  it('still accepts a lane index inside the count', () => {
    assert(
      accepts(`(module (func (result i32) (i8x16.extract_lane_s 15 (v128.const i8x16 ${Z16}))))`),
    );
  });
});

describe('T12.4 — v128.const lane values must fit their lane width', () => {
  const MALFORMED: [string, string][] = [
    ['i8x16 256', `(module (func (drop (v128.const i8x16 ${rep('256', 16)}))))`],
    ['i8x16 -129', `(module (func (drop (v128.const i8x16 ${rep('-129', 16)}))))`],
    ['i8x16 0x100', `(module (func (drop (v128.const i8x16 ${rep('0x100', 16)}))))`],
    ['i16x8 65536', `(module (func (drop (v128.const i16x8 ${rep('65536', 8)}))))`],
    ['i16x8 -32769', `(module (func (drop (v128.const i16x8 ${rep('-32769', 8)}))))`],
    ['i32x4 4294967296', '(module (func (drop (v128.const i32x4 4294967296 0 0 0))))'],
  ];
  for (const [name, src] of MALFORMED) {
    it(`rejects v128.const ${name}`, () => {
      assert(!accepts(src), `accepted: ${name}`);
    });
  }

  it('accepts the full signed-or-unsigned span at the boundaries', () => {
    // As for scalar constants, the legal span is the UNION of the two ranges:
    // an i8 lane may be written as -128..255.
    for (
      const src of [
        `(module (func (drop (v128.const i8x16 ${rep('255', 16)}))))`,
        `(module (func (drop (v128.const i8x16 ${rep('-128', 16)}))))`,
        `(module (func (drop (v128.const i16x8 ${rep('65535', 8)}))))`,
        `(module (func (drop (v128.const i16x8 ${rep('-32768', 8)}))))`,
        '(module (func (drop (v128.const i32x4 4294967295 -2147483648 0 0))))',
      ]
    ) {
      const { errors } = wat2wasm(src);
      assert(!hasErrors(errors), `rejected a LEGAL v128.const:\n${formatErrors(errors)}`);
    }
  });

  it('does not wrap a value it accepts', async () => {
    // -128 must stay -128 (0x80), not be confused with the +128 that -129
    // used to wrap to.
    const { binary, errors } = wat2wasm(
      `(module (func (export "f") (result i32) (i8x16.extract_lane_s 0 (v128.const i8x16 ${
        rep('-128', 16)
      }))))`,
    );
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf, {});
    assertEquals((instance.exports.f as () => number)(), -128);
  });
});
