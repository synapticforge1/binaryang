// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/passes/dead-argument-elimination
 *
 * DeadArgumentElimination (DAE) — removes the parameters a function does not
 * need from it and from every call (open-work 2, step 4b). Upstream:
 * `DeadArgumentElimination.cpp`.
 *
 * Only for a function every reference to which is a DIRECT `call` /
 * `return_call`: not exported, never the operand of a
 * `ref.func` (in code, a global, or an element segment — which also covers
 * every `call_indirect` and `call_ref` that could reach it), not imported. Its
 * signature is then a private matter between it and its callers. (The start
 * function takes no parameters, so there is nothing to remove from it.)
 *
 * A parameter goes when either
 * - nothing READS it, and every call passes it a value with no effect at all
 *   (dropping the operand loses nothing); or
 * - every call passes it the SAME constant: the parameter becomes a local,
 *   set to that constant on entry.
 * Either way the parameter becomes a plain local (a write to it stays valid);
 * the passes after it fold the constant in and drop what is left unused.
 *
 * Not done (upstream does): removing a result every caller drops, moving an
 * operand with effects out of the call, refining parameter types.
 */

import {
  type Expression,
  ExpressionKind,
  makeLocalSet,
  type RegionExpr,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { mapChildrenShallow, mapExpression, walkExpression } from '../ir/walk.ts';
import { deepEffects, hasSideEffects } from '../ir/effects.ts';
import { requireIndex, type Var, varIndex } from '../../wabt-ts/ir/ir.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { makeTypeInterner } from '../../wabt-ts/ir/synthesize-types.ts';

type CallNode = Extract<Expression, { kind: typeof ExpressionKind.Call }>;
type ConstNode = Extract<Expression, { kind: typeof ExpressionKind.Const }>;

/** Removes unneeded parameters from functions only ever called directly. */
export class DeadArgumentEliminationPass implements Pass {
  readonly name = 'DeadArgumentElimination';
  readonly description =
    'Removes parameters a directly-called function never reads, or is always passed the same constant.';
  // A non-nullable reference parameter can become a local.
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    const imported = module.imports.filter((i) => i.kind === ExternalKind.Func).length;
    const byName = new Map(module.functions.map((f, i) => [f.name, i]));
    /** The DEFINED function a reference names, or undefined for an import. */
    const resolve = (v: Var): number | undefined => {
      if (v.kind === 'name') return byName.get(v.name);
      const i = v.value - imported;
      return i >= 0 && i < module.functions.length ? i : undefined;
    };

    // Every function reached other than by a direct call keeps its signature.
    const escapes = new Set<number>();
    const escape = (v: Var) => {
      const i = resolve(v);
      if (i !== undefined) escapes.add(i);
    };
    for (const e of module.exports) if (e.kind === ExternalKind.Func) escape(e.var);
    const calls = module.functions.map((): CallNode[] => []);
    const scan = (root: Expression) =>
      walkExpression(root, (e) => {
        if (e.kind === ExpressionKind.RefFunc) escape(e.func);
        else if (e.kind === ExpressionKind.Call) {
          const i = resolve(e.func);
          if (i !== undefined) calls[i]!.push(e);
        }
      });
    for (const f of module.functions) scan(f.body);
    for (const g of module.globals) if (g.init !== undefined) scan(g.init);
    for (const s of module.elements) {
      for (const r of s.elemExprs) scan(r);
      if (s.offset !== undefined) scan(s.offset);
    }
    for (const s of module.dataSegments) if (s.offset !== undefined) scan(s.offset);
    for (const t of module.tables) {
      const init = (t as { init?: RegionExpr }).init;
      if (init !== undefined) scan(init);
    }

    // 1. Decide, on the tree as it is.
    const removals = new Map<number, Map<number, ConstNode | null>>();
    // call → the operand positions it loses.
    const dropAt = new Map<CallNode, Set<number>>();
    for (const [fi, f] of module.functions.entries()) {
      const sites = calls[fi]!;
      if (escapes.has(fi) || sites.length === 0) continue;
      const read = _readLocals(f);
      const remove = new Map<number, ConstNode | null>();
      for (let p = 0; p < f.sig.params.length; p++) {
        const ops = sites.map((c) => c.operands[p]);
        if (ops.some((o) => o === undefined)) continue;
        const first = ops[0]!;
        if (first.kind === ExpressionKind.Const && ops.every((o) => _sameConst(o!, first))) {
          remove.set(p, first);
        } else if (!read.has(p) && ops.every((o) => !hasSideEffects(deepEffects(o!)))) {
          remove.set(p, null);
        }
      }
      if (remove.size === 0) continue;
      removals.set(fi, remove);
      for (const c of sites) dropAt.set(c, new Set(remove.keys()));
    }
    if (removals.size === 0) return;

    // 2. Every call loses its operands — matched by IDENTITY, so before any
    //    other rewrite copies a node.
    const prune = (e: Expression): Expression => {
      const at = e.kind === ExpressionKind.Call ? dropAt.get(e) : undefined;
      if (at !== undefined && e.kind === ExpressionKind.Call) {
        return { ...e, operands: e.operands.filter((_, k) => !at.has(k)).map(prune) };
      }
      return mapChildrenShallow(e, prune);
    };
    for (const f of module.functions) f.body = prune(f.body) as RegionExpr;

    // 3. Each function: its parameters become locals, its type follows.
    const intern = makeTypeInterner(module);
    for (const [fi, remove] of removals) {
      const f = module.functions[fi]!;
      _removeParams(f, remove);
      f.typeVar = varIndex(intern(f.sig));
    }
  }
}

registerPass(DeadArgumentEliminationPass);

/** Every local index `f` reads. */
function _readLocals(f: WasmFunction): Set<number> {
  const read = new Set<number>();
  walkExpression(f.body, (e) => {
    if (e.kind === ExpressionKind.LocalGet) read.add(requireIndex(e.var, 'local index'));
  });
  return read;
}

/** The same constant, bit for bit (a float by its bits: `-0` is not `0`, NaNs by payload). */
function _sameConst(a: Expression, b: ConstNode): boolean {
  if (a.kind !== ExpressionKind.Const) return false;
  const key = (c: ConstNode) =>
    JSON.stringify(c.value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
  return key(a) === key(b);
}

/**
 * Turns each parameter in `remove` into a local — appended after the others,
 * every index renumbered — set to its constant on entry when it has one.
 */
function _removeParams(f: WasmFunction, remove: Map<number, ConstNode | null>): void {
  const nParams = f.sig.params.length;
  const order: number[] = [];
  for (let i = 0; i < nParams; i++) if (!remove.has(i)) order.push(i);
  for (let i = nParams; i < f.locals.length; i++) order.push(i);
  for (const p of [...remove.keys()].sort((a, b) => a - b)) order.push(p);
  const now = new Map(order.map((old, i) => [old, i]));
  const renumber = (v: Var): Var => varIndex(now.get(requireIndex(v, 'local index'))!);

  f.locals = order.map((old) => f.locals[old]!);
  f.sig = { params: f.sig.params.filter((_, i) => !remove.has(i)), results: f.sig.results };
  const body = mapExpression(f.body, (e) => {
    switch (e.kind) {
      case ExpressionKind.LocalGet:
      case ExpressionKind.LocalSet:
      case ExpressionKind.LocalTee:
        return { ...e, var: renumber(e.var) };
    }
    return e;
  });
  const inits: Expression[] = [];
  for (const [p, k] of [...remove].sort((a, b) => a[0] - b[0])) {
    if (k !== null) inits.push(makeLocalSet(varIndex(now.get(p)!), k));
  }
  f.body = { ...body, children: [...inits, ...body.children] };
}
