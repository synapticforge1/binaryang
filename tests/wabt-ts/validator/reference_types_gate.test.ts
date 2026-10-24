// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 41 (2026-10-24): two of wasmrt's feature-gate rows, still open on
// binaryang's main — since contract v33 both runtimes take their meaning from
// binaryang's gating, so an acceptance here is one there.
//
// - `funcref` / `externref` as a VALUE type (param, result, local, global, a
//   type's param) need reference types. Wasm 1.0 had `funcref` only as a
//   table's element type, so a funcref table and its element segment stay
//   valid with the feature off. wasm-tools 1.262: "reference types support is
//   not enabled".
// - A table's initializer expression needs function references (the spec's
//   3.0 change history, "Typeful References"). wasm-tools 1.262: "tables with
//   expression initializers require the function-references proposal".

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures, defaultFeatures } from '../../../src/core/feature.ts';
import * as fsx from '../../test_fs.ts';
import type { Features } from '../../../src/core/feature.ts';
import { Result } from '../../../src/core/result.ts';
import { formatErrors } from '../../../src/core/error.ts';

const bin = (src: string) => wat2wasm(src, { textForm: false, features: allFeatures() }).binary!;
const validate = (src: string, off: Partial<Features>) => {
  const v = wasmValidate(bin(src), { features: { ...allFeatures(), ...off } });
  return { ok: v.result === Result.Ok, text: formatErrors(v.errors) };
};

describe('funcref / externref as value types need referenceTypes', () => {
  const VALUE_SITES: [string, string][] = [
    ['an externref param', '(module (func (param externref)))'],
    ['an externref result', '(module (func (result externref) (ref.null extern)))'],
    ['a funcref param', '(module (func (param funcref)))'],
    ['a funcref local', '(module (func (local funcref)))'],
    ['an externref global', '(module (global (mut externref) (ref.null extern)))'],
    ['an externref table', '(module (table 1 externref))'],
  ];
  for (const [name, src] of VALUE_SITES) {
    it(`${name}: valid with it, refused without it, naming it`, () => {
      expect(validate(src, {}).ok).toBe(true);
      const v = validate(src, { referenceTypes: false });
      expect(v.ok).toBe(false);
      expect(v.text).toContain('referenceTypes');
    });
  }

  it('Wasm 1.0 kept: a funcref table, its element segment, an imported funcref table', () => {
    for (
      const src of [
        '(module (table 1 funcref))',
        '(module (func $f) (table 1 funcref) (elem (i32.const 0) $f))',
        '(module (import "m" "t" (table 1 funcref)))',
      ]
    ) {
      expect(validate(src, { referenceTypes: false })).toEqual({ ok: true, text: '' });
    }
  });
});

describe('a funcidx element segment is Wasm 1.0: no proposal needed', () => {
  // 🔧 Its implied `(ref func)` was gated as a typed reference and its entries
  // as the `ref.func` instruction, so under the DEFAULT features every module
  // with a function table was INVALID — every real Rust, Zig and TinyGo build
  // below, since 1.8.1 at least (wasm-tools: valid as Wasm 2.0).
  const BUILDS = [
    'rust-debug',
    'rust-release',
    'tinygo-opt1',
    'tinygo-optz',
    'zig-debug',
    'zig-releasefast',
  ];
  for (const b of BUILDS) {
    it(`${b}: valid under defaultFeatures()`, async () => {
      const bytes = await fsx.readFile(
        new URL(`../../../benches/browser-opt/modules/${b}.wasm`, import.meta.url),
      );
      const v = wasmValidate(bytes, { features: defaultFeatures() });
      expect(formatErrors(v.errors)).toBe('');
      expect(v.result).toBe(Result.Ok);
    });
  }
  it('and with only the MVP: every feature off', () => {
    const none = Object.fromEntries(Object.keys(allFeatures()).map((k) => [k, false]));
    expect(
      validate('(module (func $f) (table 1 funcref) (elem (i32.const 0) $f $f))', {
        ...none,
        mutableGlobals: true,
      }),
    ).toEqual({ ok: true, text: '' });
  });
});

describe("a table's initializer expression needs functionReferences", () => {
  const INIT = '(module (table 1 funcref (ref.null func)))';
  it('valid with it', () => {
    expect(validate(INIT, {}).ok).toBe(true);
  });
  it('refused without it, naming it', () => {
    const v = validate(INIT, { functionReferences: false });
    expect(v.ok).toBe(false);
    expect(v.text).toContain('functionReferences');
  });
  it('a table without one is not caught', () => {
    expect(validate('(module (table 1 funcref))', { functionReferences: false })).toEqual({
      ok: true,
      text: '',
    });
  });
});
