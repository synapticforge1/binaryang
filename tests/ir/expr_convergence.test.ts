// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5: wabt-ts's `Expr` and binaryen-ts's `Expression` are ONE type.
//
// This file was the RATCHET that got them there — every kind both unions
// declared, pinned `identical` / `types` / `names` against the compiler, so
// progress had to be recorded to land and regress could not land silently.
// Measured when written (2026-09-15, `3a9462423`): 35 identical, 14 types, 23
// names. Its last reading, the commit before the alias: 85 identical, 5 types
// (the five constructs, over their node BASE), 0 names.
//
// Item 5 (6c) made the alias: `Expression = Expr`, and every binaryen-ts node
// type is `Extract<Expr, { kind: … }>` — wabt-ts's declaration, readonly. A
// per-kind comparison of a type with itself measures nothing, so what is pinned
// now is the identity, and the two ways it could quietly stop holding:
//
// - a binaryen-ts node type redeclared instead of aliased (it would no longer be
//   wabt-ts's);
// - `ExpressionKind` naming a kind no node has, or missing one a node has (an
//   `Extract` over a kind with no node is `never`, and compiles).
//
// Compile-time; `deno task check` enforces it.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import type * as W from '../../src/wabt-ts/ir/ir.ts';
import type * as B from '../../src/binaryen-ts/ir/expressions.ts';
import { ExpressionKind } from '../../src/binaryen-ts/ir/expressions.ts';

type Same<A, C> = [A] extends [C] ? ([C] extends [A] ? true : false) : false;
const same = <A, C>(v: Same<A, C>): Same<A, C> => v;

describe('S6 step 5 — Expr and Expression are one type', () => {
  it('the unions are the same type, over the same kinds', () => {
    same<B.Expression, W.Expr>(true);
    // `Expr['kind']` is read OFF the nodes, so this is also "every kind has a node,
    // and every node's kind is a member" — the `never` case above.
    same<B.ExpressionKind, W.Expr['kind']>(true);
  });

  it("a binaryen-ts node type IS wabt-ts's declaration, readonly included", () => {
    same<B.BlockExpr, W.BlockExpr>(true);
    same<B.CallIndirectExpr, W.CallIndirectExpr>(true);
    same<B.RefNullExpr, W.RefNullExpr>(true);
    same<B.AtomicLoadExpr, W.AtomicLoadExpr>(true);
    same<B.CodeMetadataExpr, W.CodeMetadataExpr>(true);
    // `readonly` is invisible to assignability, so pin it directly: a mutable
    // redeclaration would admit this write.
    const blk = {} as B.BlockExpr;
    // @ts-expect-error — the merged node is readonly
    blk.label = 'x';
  });

  it('the kind object holds exactly the union kinds', () => {
    // 85 kinds: the count the ratchet ended at, and `deno task operators`' shared count.
    assertEquals(new Set(Object.values(ExpressionKind)).size, 85);
  });
});
