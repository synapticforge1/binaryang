// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// An index space counts only its own kind of import. The binary reader looked
// up an imported function's signature — and an imported tag's — as
// `m.imports[n]`, the nth import of ANY kind, so once a global (or table, or
// memory) import came first, every call to an imported function took the
// wrong signature and popped the wrong operands. The bytes were right; the
// tree every consumer reads was not: `(call $log (global.get $g))` read back
// as a call with no operands beside a stray `global.get`.
//
// Found by S7's reader-agreement measurement (2026-09-19): the parser's and the
// reader's trees for the same bytes disagreed on every such call.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import type { Expr } from '../../../src/wabt-ts/ir/ir.ts';

/** The body of defined function `i`, read back from the bytes of `wat`. */
function readBody(wat: string, i = 0): Expr[] {
  const m = readBinaryIr(wat2wasm(wat, { textForm: false }).binary, makeErrorList());
  return m.functions[i]!.body.children;
}

describe('binary reader — imports are indexed within their own kind', () => {
  it('a call to an imported function after a global import takes its operand', () => {
    const body = readBody(`(module
      (global $g (import "env" "g") i32)
      (import "env" "log" (func $log (param i32)))
      (func (call $log (global.get $g))))`);
    assertEquals(body.length, 1, 'one call, not a stray global.get beside it');
    const call = body[0]!;
    assertEquals(call.kind === 'call' ? call.operands.map((o) => o.kind) : [], ['global.get']);
  });

  it('each of several imported functions keeps its own signature', () => {
    const body = readBody(`(module
      (memory (import "env" "mem") 1)
      (import "env" "one" (func $one (param i32)))
      (import "env" "two" (func $two (param i32 i32)))
      (func (call $one (i32.const 1)) (call $two (i32.const 2) (i32.const 3))))`);
    assertEquals(
      body.map((e) => e.kind === 'call' ? e.operands.length : -1),
      [1, 2],
    );
  });

  it('a throw of an imported tag after a function import takes its operand', () => {
    const body = readBody(`(module
      (import "env" "f" (func $f))
      (tag $t (import "env" "t") (param i32))
      (func (throw $t (i32.const 7))))`);
    const thrown = body[0]!;
    assertEquals(thrown.kind === 'throw' ? thrown.operands.map((o) => o.kind) : [], ['const']);
  });
});
