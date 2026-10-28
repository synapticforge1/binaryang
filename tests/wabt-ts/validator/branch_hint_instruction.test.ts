// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 50 (2026-10-28): a branch hint's target was checked by the BYTE at its offset alone,
// so a hint landing inside an immediate whose value is 4 (`if`) or 13 (`br_if`) passed:
// `(func i32.const 4 drop)`, body `00 41 04 1a 0b`, hinted at offset 2 — the `04` immediate —
// validated. The offset must now be where the reader decoded an `if` or `br_if` instruction.

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';
import { Result } from '../../../src/core/result.ts';

const validate = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false, features: allFeatures() });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  return wasmValidate(r.binary, { features: allFeatures() });
};

/** A raw branch-hint section: function 0, one hint at `offset`. */
const hintAt = (offset: number) =>
  `(@custom "metadata.code.branch_hint" (after code) "\\01\\00\\01\\${
    offset.toString(16).padStart(2, '0')
  }\\01\\01")`;

describe('open-work 50 — a branch hint must point at a branch INSTRUCTION', () => {
  it('refuses a hint on an immediate whose value is an if opcode', () => {
    const v = validate(`(module (func i32.const 4 drop) ${hintAt(2)})`);
    assert(v.result === Result.Error, 'a hint on the 04 immediate was accepted');
    assert(formatErrors(v.errors).includes('invalid target'), formatErrors(v.errors));
  });

  it('refuses one on a br_if-valued immediate (13) too', () => {
    const v = validate(`(module (func i32.const 13 drop) ${hintAt(2)})`);
    assert(v.result === Result.Error, 'a hint on the 0d immediate was accepted');
  });

  it('accepts a hint on a real if and a real br_if', () => {
    // body: 00 (locals) | 41 01 (i32.const 1) | 04 40 (if) 0b (end) ...: the `if` is at offset 3.
    assert(validate(`(module (func (if (i32.const 1) (then))) ${hintAt(3)})`).result === Result.Ok);
    // 00 | 02 40 (block) | 41 01 | 0d 00 (br_if 0) ...: the `br_if` is at offset 5.
    assert(
      validate(`(module (func (block (br_if 0 (i32.const 1)))) ${hintAt(5)})`).result === Result.Ok,
    );
  });
});
