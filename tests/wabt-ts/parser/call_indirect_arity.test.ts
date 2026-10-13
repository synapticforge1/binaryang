// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression (found by M8d, 2026-09-18): a LINEAR `call_indirect`,
// `return_call_indirect` or `call_ref` drained the whole operand stack.
//
// T10.5 (`call_arity.test.ts`) gave linear `call` its callee's param count; the
// indirect calls kept arity -1, "take everything". A value below the call's own
// arguments that belonged to a LATER instruction became an extra argument — in
// the corpus, a `br_if`'s carried value (`1_fib-rs-opt.wat`, 2 of 222 nodes).
// The bytes were the same either way (the operands are emitted in order), so no
// byte gate saw it; the TREE was wrong, a call with more arguments than its
// signature takes, and M8d's type derivation refused it.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/parser/wast-parser.ts';
import type * as W from '../../../src/ir/ir.ts';
import { constI32 } from '../../../src/ir/ir.ts';
import { allOf, type ExprOf } from '../../expr_walk.ts';

/** Every node of `kind` in function `fn`'s body, in document order. */
function all<K extends W.Expr['kind']>(wat: string, kind: K, fn = 0): ExprOf<K>[] {
  const p = parseWatModule(wat);
  assert(p.module, 'the module parses');
  return allOf(p.module.functions[fn]!.body, kind);
}

const kinds = (xs: { kind: string }[]) => xs.map((x) => x.kind);

describe("a linear indirect call takes its signature's arguments, not the whole stack", () => {
  it('call_indirect (type $t): the value below its argument stays for the br_if', () => {
    const wat = `(module (type $t (func (param i32) (result i32))) (table 1 funcref)
      (func (param i32) (result i32)
        block (result i32)
          i32.const 7
          local.get 0
          i32.const 0
          call_indirect (type $t)
          br_if 0
        end))`;
    const call = all(wat, 'call_indirect')[0]!;
    assertEquals(kinds(call.operands), ['local.get']);
    assertEquals(call.callee.kind, 'const');
    const br = all(wat, 'br')[0]!;
    assertEquals(kinds(br.values), ['const'], "the i32.const 7 is the br_if's value");
  });

  it('call_indirect with an inline signature', () => {
    const wat = `(module (table 1 funcref)
      (func (result i32)
        i32.const 7
        i32.const 1
        i32.const 0
        call_indirect (param i32) (result i32)
        drop))`;
    const call = all(wat, 'call_indirect')[0]!;
    assertEquals(call.operands.length, 1);
  });

  it('return_call_indirect (type $t)', () => {
    const wat = `(module (type $t (func (param i32) (result i32))) (table 1 funcref)
      (func (param i32) (result i32)
        i32.const 7
        local.get 0
        i32.const 0
        return_call_indirect (type $t)))`;
    const call = all(wat, 'call_indirect')[0]!;
    assertEquals(kinds(call.operands), ['local.get']);
  });

  it('call_ref $t', () => {
    const wat = `(module (type $t (func (param i32)))
      (func $g (type $t))
      (elem declare func $g)
      (func
        i32.const 7
        i32.const 1
        ref.func $g
        call_ref $t
        drop))`;
    const call = all(wat, 'call_ref', 1)[0]!;
    assertEquals(kinds(call.operands), ['const']);
    const arg = call.operands[0]!;
    assert(arg.kind === 'const');
    assertEquals(arg.value, constI32(1));
  });
});
