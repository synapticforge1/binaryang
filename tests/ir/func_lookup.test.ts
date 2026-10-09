// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 21, phase 3: `funcAt` and `funcSignature` replaced three private
// copies of one walk (in `wasm-interp`, `witgen`, `wasm-bundle`). They are
// pinned here on what those copies relied on: the index space puts IMPORTS
// first, a name finds either kind, and a declared type's signature wins.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { readWat } from '../../src/tools/read-wat.ts';
import { funcAt, funcSignature, varIndex, varName } from '../../src/ir/ir.ts';
import { Type } from '../../src/core/types.ts';

const m = readWat(`(module
  (type $two (func (param i32 i64) (result f32)))
  (import "env" "first" (func $imported (param f64)))
  (func $defined (type $two) (f32.const 0))
  (func $plain (result i32) (i32.const 1)))`);

describe('funcAt: the function a reference names', () => {
  it('counts imports first in the index space', () => {
    expect(funcAt(m, varIndex(0))?.name).toBe('$imported');
    expect(funcAt(m, varIndex(1))?.name).toBe('$defined');
    expect(funcAt(m, varIndex(2))?.name).toBe('$plain');
  });

  it('finds an imported or a defined function by name', () => {
    expect(funcAt(m, varName('$imported'))).toBe(funcAt(m, varIndex(0)));
    expect(funcAt(m, varName('$plain'))).toBe(funcAt(m, varIndex(2)));
  });

  it('names nothing out of range or under an unknown name', () => {
    expect(funcAt(m, varIndex(3))).toBeUndefined();
    expect(funcAt(m, varName('$nope'))).toBeUndefined();
  });
});

describe('funcSignature: the declared type, else its own', () => {
  it('reads the type-section entry the function declares', () => {
    const f = funcAt(m, varName('$defined'))!;
    expect(funcSignature(m, f)).toEqual({ params: [Type.I32, Type.I64], results: [Type.F32] });
  });

  it('prefers the declared type over a sig that disagrees with it', () => {
    const f = funcAt(m, varName('$defined'))!;
    const stale = { typeVar: f.typeVar!, sig: { params: [], results: [] } };
    expect(funcSignature(m, stale).params).toEqual([Type.I32, Type.I64]);
  });

  it("falls back to the function's own sig without a declared type", () => {
    expect(funcSignature(m, { sig: { params: [Type.F64], results: [] } })).toEqual({
      params: [Type.F64],
      results: [],
    });
    expect(funcSignature(m, funcAt(m, varIndex(0))!).params).toEqual([Type.F64]);
  });
});
