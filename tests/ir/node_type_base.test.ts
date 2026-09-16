// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, item 5 (4): the node base's `type`, one shape in both IRs.
//
// - (4a) A construct's `type` is its DECLARATION (owner, 2026-09-16), so it is
//   REQUIRED on binaryen-ts's block / loop / if / try / try_table — as on
//   wabt-ts's. Nothing is left to derive.
// - (4d) br_on's `from` / `to` are `?: T`, not `?: T | undefined`.
// - (4b) Every other node carries `type?` in both IRs (step 3: absent means "not
//   derived yet"). wabt-ts's is `ExprType`, which IS binaryen-ts's `Type`.
//
// The alias trial (binaryen-ts's `Expression` := wabt-ts's `Expr`) went 305 →
// 73 errors: 248 of them were these two facts.
//
// Compile-time pins; `deno task check` enforces them.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import type {
  BlockResult,
  CallExpr as WCallExpr,
  ExprType,
  IfExpr as WIfExpr,
} from '../../src/wabt-ts/ir/ir.ts';
import type {
  BlockExpr,
  BrOnExpr,
  CallExpr,
  IfExpr,
  LoopExpr,
  TryExpr,
  TryTableExpr,
} from '../../src/binaryen-ts/ir/expressions.ts';
import type { Type } from '../../src/binaryen-ts/ir/types.ts';

type Same<A, C> = [A] extends [C] ? ([C] extends [A] ? true : false) : false;
const same = <A, C>(v: Same<A, C>): Same<A, C> => v;
/** `true` when `K` is a REQUIRED key of `T`. */
type IsRequired<T, K extends keyof T> = Partial<Pick<T, K>> extends Pick<T, K> ? false : true;

describe('the node base: `type`', () => {
  it("(4a) a construct's type is required, and is a BlockResult", () => {
    same<IsRequired<BlockExpr, 'type'>, true>(true);
    same<IsRequired<LoopExpr, 'type'>, true>(true);
    same<IsRequired<IfExpr, 'type'>, true>(true);
    same<IsRequired<TryExpr, 'type'>, true>(true);
    same<IsRequired<TryTableExpr, 'type'>, true>(true);
    same<BlockExpr['type'], BlockResult>(true);
    same<IfExpr['type'], WIfExpr['type']>(true);
    // @ts-expect-error — a block with no declaration is not a block
    const noType: BlockExpr = { kind: 'block', label: '', children: [] };
    assertEquals(noType.kind, 'block');
  });

  it("(4b) any other node's type is optional in both, and one type", () => {
    same<ExprType, Type>(true);
    same<IsRequired<CallExpr, 'type'>, false>(true);
    same<IsRequired<WCallExpr, 'type'>, false>(true);
    same<NonNullable<WCallExpr['type']>, Type>(true);
  });
});

describe('the node base: an optional field is absent, not undefined', () => {
  it("(4d) br_on's from / to: omit them, as in wabt-ts", () => {
    // Under `exactOptionalPropertyTypes` `from?: T | undefined` admits a
    // PRESENT `undefined`, which wabt-ts's `from?: T` does not — one of the
    // alias trial's last base differences.
    // @ts-expect-error — present-but-undefined is not "no from"
    const bad: Pick<BrOnExpr, 'from'> = { from: undefined };
    const ok: Pick<BrOnExpr, 'from'> = {};
    assertEquals([bad, ok].length, 2);
  });
});
