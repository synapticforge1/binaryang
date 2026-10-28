// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 2 (2026-10-28): `wasm-interp` printed a float through a JavaScript template
// string, which writes -0 as `0` and every NaN as `NaN` — the SIGN and the PAYLOAD were lost, so
// `(f32.const -0.0)` read `f32:0` and `f64.const nan:0x4` read `f64:NaN`: wrong values, not a
// format. Now -0 prints `-0` and a NaN prints in WAT's own spelling, `nan:0x<payload>` with its
// sign, which reads back to the same bits. (Upstream wabt prints `%f`-style floats — `-0.000000`,
// `nan(snan)` — and unsigned integers; that is a format difference, recorded, not changed.)

import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { interpModule, showInvocation } from '../../../src/tools/wasm-interp.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';

const MOD = readForPasses(
  wat2wasm(`(module
    (func (export "negz32") (result f32) (f32.const -0.0))
    (func (export "negz64") (result f64) (f64.const -0.0))
    (func (export "posz64") (result f64) (f64.const 0.0))
    (func (export "nan64") (result f64) (f64.const nan:0x4))
    (func (export "negnan32") (result f32) (f32.const -nan:0x200000))
    (func (export "canon32") (result f32) (f32.const nan))
    (func (export "half") (result f64) (f64.const 2.5)))`).binary!,
);
const lines = (out: ReturnType<typeof interpModule>) => out.map(showInvocation);

describe('code lens 2 — wasm-interp keeps a float result’s sign and NaN payload', () => {
  it('prints -0 with its sign, and +0 and ordinary values as before', () => {
    expect(lines(interpModule(MOD, { runExport: 'negz32' }))).toEqual(['negz32() => f32:-0']);
    expect(lines(interpModule(MOD, { runExport: 'negz64' }))).toEqual(['negz64() => f64:-0']);
    expect(lines(interpModule(MOD, { runExport: 'posz64' }))).toEqual(['posz64() => f64:0']);
    expect(lines(interpModule(MOD, { runExport: 'half' }))).toEqual(['half() => f64:2.5']);
  });

  it('prints a NaN as WAT does, with its sign and payload', () => {
    expect(lines(interpModule(MOD, { runExport: 'nan64' }))).toEqual(['nan64() => f64:nan:0x4']);
    expect(lines(interpModule(MOD, { runExport: 'negnan32' }))).toEqual([
      'negnan32() => f32:-nan:0x200000',
    ]);
    expect(lines(interpModule(MOD, { runExport: 'canon32' }))).toEqual([
      'canon32() => f32:nan:0x400000',
    ]);
  });
});
