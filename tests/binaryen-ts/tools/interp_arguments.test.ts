// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): wasm-interp read `--argument` with `Number()` / `BigInt()` and
// `--fuel` with `Number()`, which guess. Text it could not read became NaN (or crashed: "Failed
// to parse String to BigInt"), `inf` / `0x1p3` / `nan:0x1` were NaN, `-nan` lost its sign, an f32
// was rounded twice (decimal → f64 → f32), `4294967296` wrapped to i32 0, and `--fuel=abc` meant
// unlimited fuel — every one with exit 0. Floats now go through the WAT literal parsers, integers
// are range-checked, upstream's typed form `<type>:<value>` is taken, and the rest is an error.

import { describe, it } from 'node:test';
import { assert, assertEquals, assertThrows } from '@std/assert';
import { join } from 'node:path';

import { interpModule } from '../../../src/tools/wasm-interp.ts';
import { readValidWat } from '../../../src/tools/read-wat.ts';
import * as fsx from '../../test_fs.ts';
import { runTs } from '../../run_ts.ts';

const WAT = `(module
  (func (export "f32bits") (param f32) (result i32) (i32.reinterpret_f32 (local.get 0)))
  (func (export "f64bits") (param f64) (result i64) (i64.reinterpret_f64 (local.get 0)))
  (func (export "id32") (param i32) (result i32) (local.get 0))
  (func (export "id64") (param i64) (result i64) (local.get 0))
  (func (export "spin") (result i32) (local i32)
    (loop $l (local.set 0 (i32.add (local.get 0) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get 0) (i32.const 100000))))
    (local.get 0)))`;

/** The single value `name(arg)` returns, as a number or bigint. */
function call(name: string, arg: string): number | bigint {
  const [inv] = interpModule(readValidWat(WAT, 'args.wat'), { runExport: name, args: [arg] });
  assert(
    inv !== undefined && 'values' in inv.outcome,
    JSON.stringify(inv?.outcome, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)),
  );
  const v = inv.outcome.values[0] as { value: number | bigint };
  return v.value;
}

describe('code lens 3 — wasm-interp reads --argument exactly', () => {
  it('f32: one rounding, inf, hex floats, NaN payloads and signs, the typed form', () => {
    assertEquals(call('f32bits', '1.000000059604644775390626'), 1065353217); // not 1065353216
    assertEquals(call('f32bits', 'inf'), 0x7f800000);
    assertEquals(call('f32bits', '0x1p3'), 0x41000000);
    assertEquals(call('f32bits', 'nan:0x1'), 0x7f800001);
    assertEquals(Number(call('f32bits', '-nan')) >>> 0, 0xffc00000);
    assertEquals(call('f32bits', 'f32:8'), 0x41000000);
  });

  it('f64 and integers: exact, signed or unsigned, in range', () => {
    assertEquals(call('f64bits', '-0'), -(2n ** 63n));
    assertEquals(call('id32', '4294967295'), -1);
    assertEquals(call('id32', '-2147483648'), -2147483648);
    assertEquals(call('id32', 'i32:8'), 8);
    assertEquals(call('id64', '0xffffffffffffffff'), -1n);
  });

  it('refuses what it cannot read, or what does not fit', () => {
    for (
      const [name, arg] of [
        ['f32bits', 'hello'],
        ['id32', '4294967296'],
        ['id32', '-2147483649'],
        ['id32', '1.5'],
        ['id64', '18446744073709551616'],
        ['id32', 'f32:8'],
      ] as const
    ) {
      assertThrows(() => call(name, arg), Error, '--argument', `${name}(${arg}) was accepted`);
    }
  });
});

describe('code lens 3 — --fuel must be a number', () => {
  it('refuses --fuel=abc in wasm-interp and wasm-ctor-eval, and still honours --fuel=100', async () => {
    const dir = await fsx.makeTempDir({ prefix: 'binaryang-fuel-' });
    try {
      const file = join(dir, 'args.wat');
      await fsx.writeTextFile(file, WAT);
      const main = new URL('../../../main.ts', import.meta.url);
      const bad = runTs(main, ['wasm-interp', file, '--run-export=spin', '--fuel=abc']);
      assertEquals(bad.code, 1, bad.stdout);
      assert(bad.stderr.includes('--fuel'), bad.stderr);
      const ok = runTs(main, ['wasm-interp', file, '--run-export=spin', '--fuel=100']);
      assert(ok.stdout.includes('out of fuel'), ok.stdout);
      const ctor = runTs(main, ['wasm-ctor-eval', file, '--ctors=spin', '--fuel=1e3x']);
      assertEquals(ctor.code, 1, ctor.stdout);
      assert(ctor.stderr.includes('--fuel'), ctor.stderr);
    } finally {
      await fsx.remove(dir, { recursive: true });
    }
  });
});
