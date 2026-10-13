// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression (found by M8d, 2026-09-18): in LINEAR text a `br_if` or a
// `br_on_null` / `br_on_non_null` with no carried value got a phantom one.
//
// The linear form pads a short stack with the operand placeholder, and both
// dropped that padding by checking `kind !== 'nop'` — the placeholder WAS a nop
// until S5 (`f27bfd5ca`) made it a `pop`. From then on the padding stayed, as a
// carried value. A `pop` is written as nothing, so the bytes never changed and
// no byte gate could see it; the TREE was wrong, and a value-less `br_if` was
// typed by its phantom value instead of `none`.
//
// Since post-M8 fix 5 the parser knows the target's arity, so a value-less
// branch pops no padding at all; the filter remains only for a target it cannot
// resolve. These tests hold the outcome either way (branch_arity.test.ts holds
// the arity).
//
// `br_table` had the same stale filter (`'nop'`), and in linear text its arity
// is 1 (the index), so it never padded and no placeholder reached the filter.
// It was not harmless: it dropped a real `(nop)` child from the module. Removed
// by post-M8 fix 6 — see br_table_operands.test.ts.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/parser/wast-parser.ts';
import type * as W from '../../../src/ir/ir.ts';
import { type ExprOf, firstOf } from '../../expr_walk.ts';

/** The first node of `kind` in function 0's body. */
function first<K extends W.Expr['kind']>(wat: string, kind: K): ExprOf<K> {
  const p = parseWatModule(wat);
  assert(p.module, 'the module parses');
  return firstOf(p.module.functions[0]!.body, kind);
}

describe('linear branches carry no phantom value', () => {
  it('br_if to a void block carries nothing', () => {
    const br = first('(module (func (param i32) block local.get 0 br_if 0 end))', 'br');
    assertEquals(br.values, []);
    assertEquals(br.condition?.kind, 'local.get');
  });

  it('br_on_null to a void block carries nothing', () => {
    const br = first(
      '(module (func (param externref) block local.get 0 br_on_null 0 drop end))',
      'br_on',
    );
    assertEquals(br.values, []);
    assertEquals(br.ref.kind, 'local.get');
  });

  it('a REAL carried value is kept (the filter drops padding only)', () => {
    const br = first(
      '(module (func (param i32) (result i32) block (result i32) i32.const 7 local.get 0 br_if 0 end))',
      'br',
    );
    assertEquals(br.values.map((v: { kind: string }) => v.kind), ['const']);
  });
});
