// Based on WebAssembly/binaryen (https://github.com/WebAssembly/binaryen)
// Original source: src/passes/SSAify.cpp
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/ssa-nomerge
 *
 * SSANoMerge (open-work 31, step 16; upstream's ssa-nomerge): a local the compiler REUSES for
 * several values becomes one local per value, where no read can see two of them:
 *
 *     (local.set $x …) (call $f (local.get $x))  (local.set $x …) (call $g (local.get $x))
 *  →  (local.set $x …) (call $f (local.get $x))  (local.set $y …) (call $g (local.get $y))
 *
 * CoalesceLocals then assigns the locals afresh, by liveness alone. Zig's debug output reuses a
 * local across panic checks, so `(call $panic (local.get 7))` and `(call $panic (local.get 8))`
 * hold the same value in different locals, and CodeFolding cannot fold them; re-assigned, they
 * become one tail.
 *
 * Upstream's rule, on the reaching definitions (`local-graph.ts`): a set of a local with more
 * than one definition gets a fresh local unless one of its readers may also read another
 * definition (a MERGE, which needs the old local to join them); a read whose only definition is a
 * renamed set reads the fresh local. A local already in SSA form (one set, no read of the entry
 * value) is left as it is. Not done: upstream's zeroing of a read that only the entry value of a
 * declared local reaches (the constant passes see it already).
 *
 * Left alone, as MergeLocals leaves them (`merge-locals.ts`): a function with `try` /
 * `try_table`.
 *
 * Reference: `WebAssembly/binaryen/src/passes/SSAify.cpp`
 *
 * @license MIT
 */

import { type Expression, ExpressionKind } from '../ir/expressions.ts';
import { requireIndex, type Var, varIndex } from '../ir/ir.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { mapChildrenShallow, visitChildren } from '../ir/walk.ts';
import { ENTRY, localGraph } from './local-graph.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

/** Gives each value of a reused local its own local, where no read merges two of them. */
export class SSANoMergePass implements Pass {
  readonly name = 'SSANoMerge';
  readonly description =
    'Give each value of a reused local its own local, where no read can see two of them.';
  // A set and its reads move to a new local: a non-nullable one must still be set there.
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    // No catch-all, as MergeLocals beside it (open-work 52 (c), 2026-10-28): it hid real bugs.
    for (const fn of module.functions) ssaNoMerge(fn);
  }
}

registerPass(SSANoMergePass);

/** Renames in one function; whether anything moved. */
export function ssaNoMerge(fn: WasmFunction): boolean {
  let unsupported = false;
  const setsOf = new Map<number, Expression[]>(); // local → its sets / tees
  // A node in two places in the tree (a copied constant tree can hold a read) is renamed in both:
  // its local is left as it is (as ConstantPropagation leaves a set the CFG met twice).
  const seen = new Set<Expression>();
  const shared = new Set<number>();
  const scan = (e: Expression): void => {
    if (e.kind === ExpressionKind.Try || e.kind === ExpressionKind.TryTable) unsupported = true;
    if (
      e.kind === ExpressionKind.LocalSet || e.kind === ExpressionKind.LocalTee ||
      e.kind === ExpressionKind.LocalGet
    ) {
      const i = requireIndex(e.var, 'local index');
      if (seen.has(e)) shared.add(i);
      seen.add(e);
      if (e.kind !== ExpressionKind.LocalGet) {
        const list = setsOf.get(i) ?? [];
        list.push(e);
        setsOf.set(i, list);
      }
    }
    if (!unsupported) visitChildren(e, scan);
  };
  scan(fn.body);
  if (unsupported) return false;

  const { reaching, readers } = localGraph(fn);
  const readsEntry = new Set<number>();
  // A read the graph has no answer for (no path reaches it) would keep the old local while its
  // set moved: its local is left as it is.
  const unknown = new Set<number>();
  const findGets = (e: Expression): void => {
    if (e.kind === ExpressionKind.LocalGet) {
      const i = requireIndex(e.var, 'local index');
      const defs = reaching.get(e);
      if (defs === undefined) unknown.add(i);
      else if (defs.has(ENTRY)) readsEntry.add(i);
    }
    visitChildren(e, findGets);
  };
  findGets(fn.body);

  const renamed = new Map<Expression, Var>(); // set / tee → its fresh local
  for (const [local, sets] of setsOf) {
    if (unknown.has(local) || shared.has(local)) continue;
    if (sets.length === 1 && !readsEntry.has(local)) continue; // already SSA
    for (const s of sets) {
      let merges = false;
      for (const g of readers.get(s) ?? []) if ((reaching.get(g)?.size ?? 0) > 1) merges = true;
      if (merges) continue;
      fn.locals.push({ type: fn.locals[local]!.type });
      renamed.set(s, varIndex(fn.locals.length - 1));
    }
  }
  if (renamed.size === 0) return false;

  const moved = new Map<Expression, Var>(); // read → the fresh local of its one definition
  for (const [g, defs] of reaching) {
    if (defs.size !== 1) continue;
    const [d] = defs;
    const v = d === ENTRY || d === undefined ? undefined : renamed.get(d);
    if (v !== undefined) moved.set(g, v);
  }

  const rewrite = (e: Expression): Expression => {
    const r = mapChildrenShallow(e, rewrite);
    const v = renamed.get(e) ?? moved.get(e);
    return v === undefined ? r : { ...r, var: v } as Expression;
  };
  fn.body = rewrite(fn.body) as typeof fn.body;
  return true;
}
