// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/merge-locals
 *
 * MergeLocals (open-work 31, step 15; upstream's merge-locals): after a copy
 * `local.set $b (local.get $a)`, a read of `$b` that only the copy can feed reads `$a` instead,
 * wherever `$a` still holds the value it had at the copy:
 *
 *     (local.set $b (local.get $a))  …  (i32.ne (local.get $b) (local.get $a))
 *  →  (local.set $b (local.get $a))  …  (i32.ne (local.get $a) (local.get $a))
 *
 * OptimizeInstructions then folds the comparison, and a copy left with no reader is CoalesceLocals'
 * to drop. A local a compiler reuses for several values (Zig's debug output does) hides this from
 * every pass that sees a local as one value; the reaching definitions (`local-graph.ts`) see each
 * read on its own.
 *
 * Upstream's method, kept: the copy is instrumented as `(local.set $b (local.tee $a (local.get
 * $a)))`, so the copy point is a definition of `$a`; each candidate read is rewritten to `$a`; and
 * a second graph keeps a rewrite only where the copy's tee is the read's ONLY reaching definition
 * — no write of `$a` on any path between. A rewrite changes a read, never what a read can reach,
 * so each is judged on its own (upstream undoes all of a copy's rewrites when one fails: measured,
 * six modules the same, corpus +3 bytes). Not done: upstream's reverse direction (reads of `$a`
 * after the copy read `$b`).
 *
 * Left alone, as Local2Stack leaves them (`stack-ir.ts`): a function with `try` / `try_table`. A
 * copy between locals of different types is not one.
 *
 * Reference: `WebAssembly/binaryen/src/passes/MergeLocals.cpp`
 *
 * @license MIT
 */

import {
  type Expression,
  ExpressionKind,
  type LocalGetExpr,
  type LocalSetExpr,
  type LocalTeeExpr,
  makeLocalGet,
  makeLocalTee,
} from '../ir/expressions.ts';
import { requireIndex, valueTypeEquals } from '../ir/ir.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { mapExpression, visitChildren } from '../ir/walk.ts';
import { localGraph } from './local-graph.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

/** Redirects reads of a copied local to the original, where it still holds the value. */
export class MergeLocalsPass implements Pass {
  readonly name = 'MergeLocals';
  readonly description =
    'Read the original local instead of its copy, where the original still holds the value.';
  // A read moves to another local: a non-nullable one must still be structurally set there.
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      const body = fn.body;
      try {
        mergeLocals(fn);
      } catch {
        fn.body = body; // an untyped node, an unresolvable branch: the function stays as it is
      }
    }
  }
}

registerPass(MergeLocalsPass);

const localOf = (e: LocalGetExpr | LocalSetExpr | LocalTeeExpr) =>
  requireIndex(e.var, 'local index');

/** Merges in one function; whether a read moved. */
export function mergeLocals(fn: WasmFunction): boolean {
  let unsupported = false;
  const scan = (e: Expression): void => {
    if (e.kind === ExpressionKind.Try || e.kind === ExpressionKind.TryTable) unsupported = true;
    if (!unsupported) visitChildren(e, scan);
  };
  scan(fn.body);
  if (unsupported) return false;

  // The copies: a set / tee of $b whose value reads another $a of the same type. The read inside
  // it is a leaf, kept by identity through mapExpression, so it names the copy across rewrites.
  const copyOf = new Map<Expression, LocalGetExpr>(); // copy set / tee → its read of $a
  const visit = (e: Expression): void => {
    if (
      (e.kind === ExpressionKind.LocalSet || e.kind === ExpressionKind.LocalTee) &&
      e.value.kind === ExpressionKind.LocalGet
    ) {
      const a = localOf(e.value), b = localOf(e);
      if (a !== b && valueTypeEquals(fn.locals[a]!.type, fn.locals[b]!.type)) {
        copyOf.set(e, e.value);
      }
    }
    visitChildren(e, visit);
  };
  visit(fn.body);
  if (copyOf.size === 0) return false;

  // The candidates: a read whose only reaching definition is a copy. A copy's own read stays a
  // read of what it copies (a chain of copies is the next round's).
  const inner = new Set<Expression>(copyOf.values());
  const tracked = new Set<number>(); // the graphs follow only the locals copies touch
  for (const [c, g] of copyOf) tracked.add(localOf(c as LocalSetExpr)).add(localOf(g));
  const source = new Map<Expression, LocalGetExpr>(); // candidate read → the copy's read of $a
  for (const [get, defs] of localGraph(fn, tracked).reaching) {
    if (defs.size !== 1 || inner.has(get)) continue;
    const from = copyOf.get([...defs][0] as Expression);
    if (from !== undefined) source.set(get, from);
  }
  if (source.size === 0) return false;

  // Rewrite each candidate to read $a, and instrument each copy it relies on with a tee of $a.
  const used = new Set(source.values());
  const tees = new Map<LocalGetExpr, Expression>(); // copy's read of $a → its tee
  const moved = new Map<Expression, [Expression, LocalGetExpr]>(); // new read → [old read, source]
  fn.body = mapExpression(fn.body, (e) => {
    const from = source.get(e);
    if (from !== undefined) {
      const r = makeLocalGet(from.var, fn.locals[localOf(from)]!.type);
      moved.set(r, [e, from]);
      return r;
    }
    if (
      (e.kind === ExpressionKind.LocalSet || e.kind === ExpressionKind.LocalTee) &&
      e.value.kind === ExpressionKind.LocalGet && used.has(e.value)
    ) {
      const t = makeLocalTee(e.value.var, e.value, fn.locals[localOf(e.value)]!.type);
      tees.set(e.value, t);
      return { ...e, value: t };
    }
    return e;
  });

  // A rewrite stands where the copy's tee is all that reaches it; then the tees come out.
  const reaching = localGraph(fn, tracked).reaching;
  const keep = new Set<Expression>();
  for (const [r, [, from]] of moved) {
    const defs = reaching.get(r);
    const t = tees.get(from);
    if (defs !== undefined && defs.size === 1 && t !== undefined && defs.has(t)) keep.add(r);
  }
  fn.body = mapExpression(fn.body, (e) => {
    const m = moved.get(e);
    if (m !== undefined) return keep.has(e) ? e : m[0];
    if (
      e.kind === ExpressionKind.LocalTee && e.value.kind === ExpressionKind.LocalGet &&
      tees.has(e.value)
    ) return e.value;
    return e;
  });
  return keep.size > 0;
}
