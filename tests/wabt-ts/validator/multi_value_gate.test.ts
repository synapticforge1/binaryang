// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 35: with multi-value OFF, binaryang accepted every multi-value shape. The verdicts and
// words below are upstream's, measured 2026-10-24: wabt 1.0.41's `wat2wasm --disable-multi-value`
// (the text path) and `wasm-validate --disable-multi-value` (the binary path), which wasm-tools
// 1.262.0 `validate --features=-multi-value` agrees with module for module.
//
// The two paths differ upstream, and here: a block type NAMING a type index is refused only in
// the binary form — wabt's binary reader refuses the encoding, while its `wat2wasm` accepts
// `(block (type $t))` naming a type with one result or none.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures, defaultFeatures } from '../../../src/core/feature.ts';

const MULTI = 'multiple result values are not supported without multi-value enabled.';
const SIG = 'expected valid block signature type';
// [name, WAT, text path verdict, binary path verdict]; null = valid.
const CASES: [string, string, string | null, string | null][] = [
  [
    'a function with two results',
    '(module (func (result i32 i32) i32.const 1 i32.const 2))',
    MULTI,
    MULTI,
  ],
  ['a type entry with two results', '(module (type (func (result i32 i64))))', MULTI, MULTI],
  ['an import with two results', '(module (import "m" "f" (func (result i32 i32))))', MULTI, MULTI],
  [
    'a block with two results',
    '(module (func (result i32) (block (result i32 i32) i32.const 1 i32.const 2) drop))',
    MULTI,
    MULTI,
  ],
  [
    'an if with two results',
    '(module (func (param i32) (result i32) local.get 0 (if (result i32 i32) (then i32.const 1 i32.const 2) (else i32.const 3 i32.const 4)) drop))',
    MULTI,
    MULTI,
  ],
  [
    'a block with a parameter',
    '(module (func (result i32) i32.const 1 (block (param i32) (result i32))))',
    'block params not currently supported.',
    'block params not currently supported.',
  ],
  [
    'a loop with a parameter',
    '(module (func (result i32) i32.const 1 (loop (param i32) (result i32))))',
    'loop params not currently supported.',
    'loop params not currently supported.',
  ],
  [
    'a block naming a one-result type',
    '(module (type $t (func (result i32))) (func (result i32) (block (type $t) i32.const 1)))',
    null,
    SIG,
  ],
  [
    'a block naming the empty type',
    '(module (type $t (func)) (func (block (type $t))))',
    null,
    SIG,
  ],
  // Wasm 1.0's own block types stay valid: none, or one value type, written inline.
  [
    'a block with one inline result',
    '(module (func (result i32) (block (result i32) i32.const 1)))',
    null,
    null,
  ],
  [
    'an empty block, loop and if',
    '(module (func (param i32) (block) (loop) (if (local.get 0) (then))))',
    null,
    null,
  ],
  [
    'many PARAMETERS (not multi-value)',
    '(module (func (param i32 i32 i64) (result i32) local.get 0))',
    null,
    null,
  ],
];

const OFF = { ...defaultFeatures(), multiValue: false };
const firstError = (errors: { message: string }[]) => errors[0]?.message ?? null;

describe('multi-value OFF: refused as upstream refuses', () => {
  for (const [name, wat, text, binary] of CASES) {
    it(`${name}: text ${text === null ? 'valid' : 'refused'}, binary ${binary === null ? 'valid' : 'refused'}`, () => {
      // `validate: true` is what the CLI does by default (the library's default is false).
      expect(firstError(wat2wasm(wat, { features: OFF, validate: true }).errors)).toBe(text);
      const bytes = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
      expect(firstError(wasmValidate(bytes, { features: OFF }).errors)).toBe(binary);
    });
  }
});

describe('multi-value ON (the default): every shape is valid', () => {
  for (const [name, wat] of CASES) {
    it(name, () => {
      expect(
        wat2wasm(wat, { features: allFeatures(), validate: true }).errors.map((e) => e.message),
      )
        .toEqual([]);
      const bytes = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
      expect(wasmValidate(bytes, { features: defaultFeatures() }).errors.map((e) => e.message))
        .toEqual([]);
    });
  }
});
