// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28), divergence CL22: a table's initializer is an `expr`, as a
// global's is — folded or LINEAR. The parser read only ONE parenthesised instruction, so the
// linear spelling, which `wasm-tools print` writes, was refused: `(table 1 funcref ref.null
// func)` → "expected ), got ref.null" (8 of ~85 wasm-smith modules did not re-parse for this
// alone). Both spellings now give the same bytes; wasm-tools writes those bytes too (measured
// with custom sections stripped). Upstream wabt 1.0.41 refuses the linear form — it is the one
// behind here.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

const bytes = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false, features: allFeatures(), validate: true });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  return [...r.binary];
};

const TYPES = '(type $s (struct (field i32))) (func $f) (elem declare func $f)';

describe('code lens 3 — a table initializer may be written linear', () => {
  for (
    const [linear, folded] of [
      ['(table 1 funcref ref.null func)', '(table 1 funcref (ref.null func))'],
      ['(table 2 funcref ref.func $f)', '(table 2 funcref (ref.func $f))'],
      [
        '(table 1 (ref null $s) struct.new_default $s)',
        '(table 1 (ref null $s) (struct.new_default $s))',
      ],
      [
        '(table 3 (ref null $s) i32.const 7 struct.new $s)',
        '(table 3 (ref null $s) (struct.new $s (i32.const 7)))',
      ],
      ['(table i64 1 funcref ref.null func)', '(table i64 1 funcref (ref.null func))'],
    ]
  ) {
    it(linear, () => {
      assertEquals(
        bytes(`(module ${TYPES} ${linear})`),
        bytes(`(module ${TYPES} ${folded})`),
      );
    });
  }

  it('a table with no initializer is unchanged', () => {
    const b = bytes('(module (table 2 externref))');
    assert(WebAssembly.validate(new Uint8Array(b) as BufferSource));
  });
});
