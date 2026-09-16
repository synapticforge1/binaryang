// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, item 5 (2): ONE kind representation.
//
// wabt-ts's nodes are discriminated by literal strings (`kind: 'nop'`);
// binaryen-ts's by a string ENUM whose values were already those strings
// (`Nop = 'nop'`). Equal values, two TYPES: an enum is nominal, so `'nop'` was
// not an `ExpressionKind` and no wabt-ts node could be a binaryen-ts one — ≈50
// of the alias trial's 2,012 errors. `ExpressionKind` is now V4's shape: a const
// object with a same-named union type, so each member IS its literal string.
//
// The pins below are compile-time; `deno task check` enforces them.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import type { Expr } from '../../src/wabt-ts/ir/ir.ts';
import type { Expression, NopExpr } from '../../src/binaryen-ts/ir/expressions.ts';
import { ExpressionKind } from '../../src/binaryen-ts/ir/expressions.ts';

type Same<A, C> = [A] extends [C] ? ([C] extends [A] ? true : false) : false;
const same = <A, C>(v: Same<A, C>): Same<A, C> => v;

describe('ExpressionKind is the union of its literal strings', () => {
  it('a literal kind string is an ExpressionKind, and a member is its literal', () => {
    // An enum rejects both lines (TS2322): '"nop"' is not assignable to
    // 'ExpressionKind'.
    const k: ExpressionKind = 'nop';
    const nop: typeof ExpressionKind.Nop = 'nop';
    assertEquals([k, nop], [ExpressionKind.Nop, ExpressionKind.Nop]);
    same<typeof ExpressionKind.Break, 'br'>(true);
    same<NopExpr['kind'], 'nop'>(true);
  });

  it('a string that is not a kind is not an ExpressionKind', () => {
    // @ts-expect-error — an instruction name, not a kind
    const bad: ExpressionKind = 'i32.add';
    assertEquals(bad, 'i32.add');
  });

  it('the binaryen-ts node a wabt-ts kind selects has that literal as its kind', () => {
    // Under the enum `Extract` already FOUND the node (an enum member is
    // assignable to its literal), but its `kind` was `ExpressionKind.Break`,
    // which a wabt-ts node's `'br'` is not assignable to — so no wabt-ts node
    // could be that binaryen-ts node.
    type WabtBr = Extract<Expr, { kind: 'br' }>['kind'];
    same<Extract<Expression, { kind: WabtBr }>['kind'], 'br'>(true);
  });

  it('the object holds exactly the kind strings, once each', () => {
    const values = Object.values(ExpressionKind);
    assertEquals(new Set(values).size, values.length);
    assertEquals(Object.keys(ExpressionKind).length, values.length);
    assertEquals(ExpressionKind.Switch, 'br_table');
  });
});
