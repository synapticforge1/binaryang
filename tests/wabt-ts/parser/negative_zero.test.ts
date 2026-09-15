// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `f32.const -0` keeps its sign.
//
// The INTEGER-spelled literal lost it: the float paths route an integer token
// through `parseNatText`, which returns a bigint, and `BigInt('-0')` is `0n`.
// So `(f64.const -0)` assembled to +0 — bits `0x0000000000000000` where upstream
// `wat2wasm` writes `0x8000000000000000`, measured 2026-09-15. Every other
// spelling was right (`-0.0`, `-0.0e0`, `-0x0p0`, `-nan`, `-inf`, `-1`), which is
// why nothing noticed: a corpus module writes `-0.0`, not `-0`.
//
// The sign of a zero is observable — `f64.copysign`, `1/x`, and the bits
// themselves — so this is a value change, not a spelling one.
//
// ⚠️ The expected bits here are UPSTREAM's, not ours: a fixture assembled by the
// tool under test cannot show that the tool is wrong (an earlier version of the
// NaN-payload test built its `-0` case with `wat2wasm` and compared +0 to +0).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

/** The constant's immediate bytes, as hex, from the one `f32/f64.const` in the module. */
function constBits(bytes: Uint8Array, width: 4 | 8): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const m = hex.match(width === 4 ? /43([0-9a-f]{8})0b/ : /44([0-9a-f]{16})0b/);
  assert(m, 'no float const found in the module');
  return m[1]!;
}

const CASES: ReadonlyArray<readonly ['f32' | 'f64', string, string]> = [
  // [type, literal, little-endian immediate bytes upstream wat2wasm writes]
  ['f32', '-0', '00000080'],
  ['f32', '-0.0', '00000080'],
  ['f32', '0', '00000000'],
  ['f64', '-0', '0000000000000080'],
  ['f64', '-0.0', '0000000000000080'],
  ['f64', '0', '0000000000000000'],
];

describe('wabt-ts — a negative zero keeps its sign', () => {
  for (const [ty, literal, want] of CASES) {
    it(`${ty}.const ${literal}`, () => {
      const wat = `(module (func (export "f") (result ${ty}) (${ty}.const ${literal})))`;
      const { binary } = wat2wasm(wat);
      assert(binary.length > 0, 'wat2wasm produced nothing');
      assertEquals(constBits(binary, ty === 'f32' ? 4 : 8), want);
    });
  }

  it('and the sign is observable at run time', async () => {
    const wat = `(module (func (export "f") (result f64) (f64.const -0)))`;
    const { instance } = await WebAssembly.instantiate(
      wat2wasm(wat).binary as BufferSource,
    );
    assert(Object.is((instance.exports.f as () => number)(), -0), 'expected -0, got +0');
  });
});
