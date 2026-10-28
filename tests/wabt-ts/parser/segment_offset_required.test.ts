// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 52 (d), 2026-10-28: an active data or elem segment with NO offset —
// `(data (memory 0) "x")`, `(elem (table 0) func $f)` — got past the parser, and the validator
// then refused the empty offset in other words: "type mismatch in initializer expression,
// expected [i32] but got []". The parser refuses it now, in upstream wabt's words and at its
// column. (Upstream wabt accepts the elem one; wasm-tools refuses both, and the spec's grammar
// requires the offset in both.)

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

const refused = (wat: string) => {
  const r = wat2wasm(wat, { filename: 'm.wat' });
  assert(hasErrors(r.errors), 'accepted');
  const text = formatErrors(r.errors);
  assert(text.includes('expected an offset expr'), text);
  assert(!text.includes('type mismatch'), text);
  return text;
};

describe('open-work 52 — an active segment needs an offset, said by the parser', () => {
  it('a data segment naming its memory', () => {
    assert(refused('(module (memory 1) (data (memory 0) "x"))').includes('m.wat:1:37:'));
  });

  it('a data segment naming its memory by bare index', () => {
    refused('(module (memory 1) (data 0 "x"))');
  });

  it('an elem segment naming its table', () => {
    refused('(module (table 1 funcref) (func $f) (elem (table 0) func $f))');
  });

  it('still accepts both offset spellings', () => {
    for (
      const wat of [
        '(module (memory 1) (data (memory 0) (offset (i32.const 1)) "x"))',
        '(module (memory 1) (data (memory 0) (i32.const 1) "x"))',
        '(module (table 1 funcref) (func $f) (elem (table 0) (i32.const 0) func $f))',
      ]
    ) {
      const r = wat2wasm(wat);
      assert(!hasErrors(r.errors), formatErrors(r.errors));
    }
  });
});
