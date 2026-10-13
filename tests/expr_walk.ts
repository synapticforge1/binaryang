// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Typed tree walks for tests: every IR expression of one `kind`, found by the
// tree's STRUCTURE (any object with that `kind`, `loc` skipped) rather than by
// the IR's own visitor, so a test does not lean on the code it checks. Typed by
// `kind`, so a test that reads a field the IR does not have fails `deno check`;
// these were `any` until 2026-10-13 (the 21 `noExplicitAny` suppressions).

import type * as W from '../src/ir/ir.ts';

/**
 * The `W.Expr` member(s) whose `kind` includes `K`. Not `Extract<W.Expr, { kind: K }>`:
 * one member may cover several kinds (`'any.convert_extern' | 'extern.convert_any'`),
 * and `Extract` would drop it.
 */
export type ExprOf<K extends W.Expr['kind']> = W.Expr extends infer E
  ? E extends { readonly kind: infer EK } ? K extends EK ? E : never : never
  : never;

/** Every node of `kind` under `root`, in document order. */
export function allOf<K extends W.Expr['kind']>(root: unknown, kind: K): ExprOf<K>[] {
  const out: ExprOf<K>[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if ((v as { kind?: unknown }).kind === kind) out.push(v as ExprOf<K>);
    for (const [k, x] of Object.entries(v)) if (k !== 'loc') walk(x);
  };
  walk(root);
  return out;
}

/** The first node of `kind` under `root`, in document order; throws if there is none. */
export function firstOf<K extends W.Expr['kind']>(
  root: unknown,
  kind: K,
  what = `a ${kind} node`,
): ExprOf<K> {
  const found = allOf(root, kind)[0];
  if (found === undefined) throw new Error(`expected ${what}`);
  return found;
}
