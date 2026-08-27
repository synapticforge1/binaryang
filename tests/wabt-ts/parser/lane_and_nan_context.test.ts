// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.6 — two more silent defaults in the "unexpected token" group.
//
// 1. **A MISSING lane immediate compiled as lane 0.** `parseSimdLane` returned
//    0 whenever the next token was not a number, so
//    `(i8x16.extract_lane_s (local.get 0) (v128.const i8x16 …))` — which omits
//    the lane entirely — silently became `extract_lane_s 0`. Every lane op
//    requires its immediate; there is no default.
//
// 2. **`nan:canonical` / `nan:arithmetic` were accepted as LITERALS.** They are
//    `assert_return` RESULT PATTERNS meaning "any canonical NaN", not values.
//    In a real `f32.const` they silently became the canonical NaN bit pattern.
//
// The second could not be a global rule, and getting that wrong is recorded
// because the metric caught it: a v128 result may carry the patterns PER LANE —
// `(assert_return … (v128.const f32x4 nan:canonical nan:canonical …))` is legal
// and pervasive in simd_f32x4.wast — and those lanes go through the same
// `parseF32Bits` an instruction const uses. Rejecting them outright dropped
// parse-clean from 257 to 249 across eight SIMD files. The rule is contextual:
// legal in an expected-result position, malformed in an instruction.
//
// assert_malformed (quoted): 1045 -> 1087 / 1229. Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { parseWastScript } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

const Z16 = '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0';
const Z8 = '0 0 0 0 0 0 0 0';

function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}

describe('T12.6 — a lane op requires its lane immediate', () => {
  const MISSING: [string, string][] = [
    [
      'i8x16.extract_lane_s',
      `(module (func (param i32) (result i32) (i8x16.extract_lane_s (local.get 0) (v128.const i8x16 ${Z16}))))`,
    ],
    [
      'i8x16.extract_lane_u',
      `(module (func (param i32) (result i32) (i8x16.extract_lane_u (local.get 0) (v128.const i8x16 ${Z16}))))`,
    ],
    [
      'i16x8.extract_lane_s',
      `(module (func (param i32) (result i32) (i16x8.extract_lane_s (local.get 0) (v128.const i16x8 ${Z8}))))`,
    ],
    [
      'i32x4.extract_lane',
      '(module (func (param i32) (result i32) (i32x4.extract_lane (local.get 0) (v128.const i32x4 0 0 0 0))))',
    ],
    [
      'f32x4.extract_lane',
      '(module (func (param i32) (result f32) (f32x4.extract_lane (local.get 0) (v128.const f32x4 0 0 0 0))))',
    ],
    [
      'i8x16.replace_lane',
      `(module (func (param i32) (result v128) (i8x16.replace_lane (local.get 0) (v128.const i8x16 ${Z16}) (i32.const 1))))`,
    ],
  ];
  for (const [name, src] of MISSING) {
    it(`rejects ${name} with no lane index`, () => {
      assert(!accepts(src), `accepted ${name} without a lane`);
    });
  }

  it('still accepts one that supplies the lane', () => {
    assert(
      accepts(`(module (func (result i32) (i8x16.extract_lane_s 3 (v128.const i8x16 ${Z16}))))`),
    );
  });
});

describe('T12.6 — a NaN result pattern is not a literal', () => {
  for (const ty of ['f32', 'f64']) {
    for (const pat of ['nan:canonical', 'nan:arithmetic']) {
      it(`rejects ${ty}.const ${pat} in an instruction`, () => {
        assert(
          !accepts(`(module (func (result ${ty}) (${ty}.const ${pat})))`),
          `accepted ${ty}.const ${pat}`,
        );
      });
    }
  }

  it('still accepts real NaN literals in an instruction', () => {
    for (const lit of ['nan', '-nan', 'nan:0x1', 'nan:0x400000']) {
      assert(accepts(`(module (func (result f32) (f32.const ${lit})))`), `rejected ${lit}`);
    }
  });
});

describe('T12.6 — the patterns stay legal in an expected-result position', () => {
  it('accepts a scalar nan:canonical result', () => {
    const { errors } = parseWastScript(`
      (module (func (export "f") (result f32) (f32.const nan)))
      (assert_return (invoke "f") (f32.const nan:canonical))`);
    assert(!hasErrors(errors), formatErrors(errors));
  });

  it('accepts nan patterns PER LANE inside a v128 result', () => {
    // This is the shape that made the rule contextual — rejecting it globally
    // cost eight SIMD files from parse-clean.
    const { script, errors } = parseWastScript(`
      (module (func (export "f") (result v128) (v128.const f32x4 0 0 0 0)))
      (assert_return (invoke "f")
        (v128.const f32x4 nan:canonical nan:canonical nan:arithmetic 0))`);
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(script.commands.map((c) => c.kind), ['module', 'assert_return']);
  });

  it('does not leak the allowance back out to instructions after a result', () => {
    // The flag is saved and restored, so a malformed const AFTER an
    // assert_return is still caught.
    const { errors } = parseWastScript(`
      (module (func (export "f") (result f32) (f32.const nan)))
      (assert_return (invoke "f") (f32.const nan:canonical))
      (module (func (result f32) (f32.const nan:canonical)))`);
    assert(hasErrors(errors), 'the trailing instruction const was accepted');
  });
});
