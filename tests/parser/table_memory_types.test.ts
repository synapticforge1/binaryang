// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Tranche 4 of the spec-testsuite parse-gap scope: table64 / memory64 index
// types, plus the table-definition shapes that turned out to sit in the same
// code path.
//
//   1. `(table $t i64 30 30 funcref)` -- `i32` / `i64` in that slot is the
//      table's INDEX TYPE (the table64 proposal), not its element type;
//      element types are always REFERENCE types. The parser classified any
//      ValueType there as the element type, so `i64` was consumed as the
//      elemtype, `30 30` became the limits, and the real element type then
//      failed the closing paren with "expected ), got ValueType".
//      `parseLimits` already knew how to consume the index type.
//
//   2. `(memory i64 (data "..."))` -- the inline-data branch only matched a
//      bare `(data`, so the index-type spelling fell through to parseLimits
//      and reported "expected limit initial value". The synthesized data
//      segment also needs an i64 offset: an i32.const offset on a 64-bit
//      memory produces a binary V8 rejects.
//
//   3. `(table $t64 i64 funcref (elem $f))` -- the abbreviated inline-elem
//      form with an index type.
//
//   4. `(table $t 10 funcref (ref.null func))` -- a table initializer
//      expression, which fills every slot.
//
//   5. `(table $t funcref (elem (ref.func $f) (ref.null func)))` -- an inline
//      elem list of element EXPRESSIONS rather than a bare funcidx list.
//
//   6. `(elem (table $t) (i32.const 1) (ref func) (ref.func $d))` -- an elem
//      segment whose element type is the parenthesized typed-ref form, which
//      starts with `(` and so missed the bare-ValueType check.
//
// Testsuite: 214 -> 230/257 clean, zero regressions.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

/** Compile and assert V8 accepts the result — parsing alone is not enough. */
function v8Accepts(wat: string): boolean {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

describe('table index types (table64)', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['i64 with min and max', '(module (table $t i64 30 30 funcref))'],
    ['i64 with min only', '(module (table $t i64 10 funcref))'],
    ['explicit i32', '(module (table $t i32 10 funcref))'],
    ['i64 with inline export', '(module (table (export "t") i64 10 funcref))'],
    ['i64 externref elements', '(module (table $t i64 2 externref))'],
    ['no index type (unchanged)', '(module (table $t 10 funcref))'],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      assert(v8Accepts(wat), `V8 rejected: ${wat}`);
    });
  }
});

describe('memory index types (memory64)', () => {
  it('(memory i64 (data ...)) parses and gets an i64 offset', () => {
    // An i32.const offset on a 64-bit memory is rejected by V8, so this
    // asserts the synthesized data segment offset, not just the parse.
    assert(v8Accepts('(module (memory i64 (data "abcd")))'));
  });

  it('(memory (data ...)) still uses an i32 offset', () => {
    assert(v8Accepts('(module (memory (data "abcd")))'));
  });

  it('(memory i64 N) still works', () => {
    assert(v8Accepts('(module (memory i64 1))'));
  });
});

describe('table definition shapes', () => {
  it('index type with an abbreviated inline elem', () => {
    assert(v8Accepts('(module (func $f) (table $t64 i64 funcref (elem $f)))'));
  });

  it('initializer expression fills the table', async () => {
    const binary = compile(`(module
      (func $f (result i32) (i32.const 7))
      (table $t (export "t") 3 funcref (ref.func $f)))`);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    const table = instance.exports.t as WebAssembly.Table;
    assertEquals(table.length, 3);
    // Every slot takes the initializer, not just slot 0.
    for (let i = 0; i < 3; i++) {
      assertEquals((table.get(i) as () => number)(), 7, `slot ${i}`);
    }
  });

  it('inline elem list of element expressions', async () => {
    const binary = compile(`(module
      (func $f (result i32) (i32.const 11))
      (func $g (result i32) (i32.const 22))
      (table $t (export "t") funcref (elem (ref.func $f) (ref.null func) (ref.func $g))))`);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    const table = instance.exports.t as WebAssembly.Table;
    // Three expressions must land as three ordered elements.
    assertEquals(table.length, 3);
    assertEquals((table.get(0) as () => number)(), 11);
    assertEquals(table.get(1), null);
    assertEquals((table.get(2) as () => number)(), 22);
  });

  it('inline elem list of bare funcidxs still works', () => {
    assert(v8Accepts('(module (func $f) (table $t funcref (elem $f)))'));
  });
});

describe('elem segment element types', () => {
  it('accepts the parenthesized (ref H) form', () => {
    assert(v8Accepts(
      '(module (func $d) (table $t 3 funcref) (elem (table $t) (i32.const 1) (ref func) (ref.func $d)))',
    ));
  });

  it('bare funcref element type still works', () => {
    assert(v8Accepts(
      '(module (func $d) (table $t 3 funcref) (elem (table $t) (i32.const 1) funcref (item (ref.func $d))))',
    ));
  });
});
