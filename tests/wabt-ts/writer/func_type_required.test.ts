// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8b4: a function's `typeVar` is optional (absent before `synthesizeTypes`, as
// a `call_indirect`'s is), so the binary writer must REFUSE a function without
// one rather than write some index. Deriving one structurally picks the FIRST
// of several identical types (T1); writing 0 would be worse. A mutant writing
// index 0 survived every test until this one.

import { describe, it } from '@std/testing/bdd';
import { assert, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import type { Module } from '../../../src/wabt-ts/ir/ir.ts';

function readWithoutType(wat: string): Module {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const m = readBinaryIr(r.binary, makeErrorList(), {});
  delete m.functions[0]!.typeVar;
  return m;
}

describe('M8b4 — a function without a type index is refused, never guessed', () => {
  it('the binary writer throws', () => {
    const m = readWithoutType('(module (type (func)) (type (func)) (func (type 1)))');
    assertThrows(() => writeBinaryIr(m), Error, 'no type index');
  });

  it('the validator reports it', () => {
    const m = readWithoutType('(module (func))');
    const errors = makeErrorList();
    validateModule(m, errors);
    assert(formatErrors(errors).includes('no type index'), formatErrors(errors));
  });
});
