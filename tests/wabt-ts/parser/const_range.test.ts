// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.1 — an out-of-range constant was silently TRUNCATED or OVERFLOWED.
//
// Integers went through `BigInt.asIntN(32, n)` with no range check, so
// `(i32.const 0x100000000)` became `i32.const 0`. Floats were rounded by IEEE
// rules with no range check, so `(f32.const 1e39)` became `inf`. Both produce a
// module V8 ACCEPTS and RUNS — computing a different number, with no
// diagnostic anywhere.
//
// The spec calls both malformed:
//
//   const.wast   (assert_malformed (module quote "(func (i32.const 0x100000000) drop)")
//                                  "constant out of range")
//   const.wast   (assert_malformed (module quote "(func (f32.const 0x1.ffffffp127) drop)")
//                                  "constant out of range")
//
// The legal integer span is the union of the signed and unsigned ranges —
// `[-2^31, 2^32)` for i32 — because the text format lets you write a 32-bit
// value either way. For floats, a FINITE literal that rounds to infinity is out
// of range; `inf` must be spelled `inf`.
//
// This was the first item of tranche T12 (`assert_malformed`), ranked first by
// MEASURED consequence rather than by case count: every other open category in
// that tranche is a rejection we fail to make, while this one silently changes
// a program's arithmetic.
//
// assert_malformed (quoted): 666 -> 698 / 1229. Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}
function constModule(ty: string, lit: string): string {
  return `(module (func (export "f") (result ${ty}) (${ty}.const ${lit})))`;
}

describe('T12.1 — integer constants are range-checked, not truncated', () => {
  const OUT_OF_RANGE: [string, string][] = [
    ['i32', '0x100000000'], // 2^32
    ['i32', '4294967296'],
    ['i32', '-2147483649'], // < -2^31
    ['i64', '0x10000000000000000'], // 2^64
    ['i64', '18446744073709551616'],
    ['i64', '-9223372036854775809'], // < -2^63
  ];
  for (const [ty, lit] of OUT_OF_RANGE) {
    it(`rejects ${ty}.const ${lit}`, () => {
      assert(!accepts(constModule(ty, lit)), `accepted ${ty}.const ${lit}`);
    });
  }

  it('names the value and the type in the diagnostic', () => {
    const { errors } = wat2wasm(constModule('i32', '0x100000000'));
    const msg = formatErrors(errors);
    assert(/i32 constant out of range/.test(msg), msg);
    assert(/4294967296/.test(msg), msg);
  });

  const IN_RANGE: [string, string, number | bigint][] = [
    ['i32', '0xffffffff', -1], // unsigned spelling of -1
    ['i32', '2147483647', 2147483647], // 2^31-1
    ['i32', '-2147483648', -2147483648], // -2^31
    ['i64', '0xffffffffffffffff', -1n],
    ['i64', '9223372036854775807', 9223372036854775807n],
  ];
  for (const [ty, lit, want] of IN_RANGE) {
    it(`still accepts ${ty}.const ${lit} at the boundary`, async () => {
      const { binary, errors } = wat2wasm(constModule(ty, lit));
      assert(!hasErrors(errors), `rejected legal ${lit}:\n${formatErrors(errors)}`);
      assert(binary);
      const buf = new ArrayBuffer(binary.byteLength);
      new Uint8Array(buf).set(binary);
      const { instance } = await WebAssembly.instantiate(buf, {});
      assertEquals((instance.exports.f as () => number | bigint)(), want);
    });
  }
});

describe('T12.1 — a finite float literal must not overflow to infinity', () => {
  const OUT_OF_RANGE: [string, string][] = [
    ['f32', '0x1p128'],
    ['f32', '0x1.ffffffp127'], // the midpoint — const.wast says malformed
    ['f32', '1e39'],
    ['f32', '340282356779733661637539395458142568448'],
    ['f32', '-1e39'],
    ['f64', '0x1p1024'],
    ['f64', '1e309'],
    ['f64', '-1e309'],
  ];
  for (const [ty, lit] of OUT_OF_RANGE) {
    it(`rejects ${ty}.const ${lit}`, () => {
      assert(!accepts(constModule(ty, lit)), `accepted ${ty}.const ${lit}`);
    });
  }

  it('still accepts the largest finite value, and explicit inf', () => {
    // The boundary matters in both directions: const.wast has the value just
    // below the midpoint as a plain VALID module.
    for (
      const [ty, lit] of [
        ['f32', '0x1.fffffep127'],
        ['f32', '340282356779733623858607532500980858880'],
        ['f64', '0x1.fffffffffffffp1023'],
        ['f32', 'inf'],
        ['f32', '-inf'],
        ['f64', 'inf'],
        ['f32', 'nan'],
        ['f32', 'nan:0x7fffff'],
      ] as const
    ) {
      assert(accepts(constModule(ty, lit)), `rejected legal ${ty}.const ${lit}`);
    }
  });
});
