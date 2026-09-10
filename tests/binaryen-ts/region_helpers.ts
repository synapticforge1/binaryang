// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Test helpers for region bodies (S6 Group 2 decision 5).
//
// Before regions were a kind, a body was its lone expression or a synthetic
// wrapper block, and tests read it with a cast — `fn.body as ConstExpr` — or a
// guard — `if (body.kind === ExpressionKind.Return) { assert… }`. The guard form
// was VACUOUS: when the body was anything else, it asserted nothing and passed.
// These helpers state the expectation instead of branching on it.

import { assertEquals } from '@std/assert';
import {
  type Expression,
  ExpressionKind,
  type RegionExpr,
} from '../../src/binaryen-ts/ir/expressions.ts';

/** `e` as a region — failing, not skipping, when it is not one. */
export function region(e: Expression): RegionExpr {
  assertEquals(e.kind, ExpressionKind.Region, `expected a region, got a ${e.kind}`);
  return e as RegionExpr;
}

/** The one instruction a region holds — failing when it holds any other number. */
export function soleInstr(e: Expression): Expression {
  const r = region(e);
  assertEquals(r.children.length, 1, `expected a one-instruction region, got ${r.children.length}`);
  return r.children[0]!;
}

/** The instruction a region holds, asserted to be of `kind`, narrowed to that kind's node. */
export function soleOf<K extends ExpressionKind>(
  e: Expression,
  kind: K,
): Extract<Expression, { kind: K }> {
  const only = soleInstr(e);
  assertEquals<string>(
    only.kind,
    kind,
    `expected the region's instruction to be ${kind}, got ${only.kind}`,
  );
  return only as Extract<Expression, { kind: K }>;
}
