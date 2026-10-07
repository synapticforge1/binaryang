/**
 * @module binaryen-ts/passes/local-cse
 *
 * LocalCSE pass — common subexpression elimination: an expression computed
 * again, with nothing in between changing what it reads, reuses the first
 * result. The first occurrence becomes `local.tee(fresh, expr)`, every later
 * one `local.get(fresh)`.
 *
 * Rewritten on the shared effect analysis (`ir/effects.ts`; open-work 2 and
 * 3–5, 2026-10-06). The pass it replaces keyed an ALLOW-LIST of kinds (consts,
 * locals, globals, non-trapping unary / binary), looked only at the direct
 * children of one block, and invalidated by a hand-kept list of writing kinds
 * that had drifted four times (the `fib`, `itoa`, `call_ref` and
 * `monthFromDays` entries of its history). Upstream's `local-cse` still found
 * 3.5 KB on our -Oz output — repeated `i32.shl` index arithmetic, loads,
 * `memory.size`, trapping conversions, `select`.
 *
 * **What is a candidate**: any expression whose only effects are READS and
 * possibly a TRAP — keyed structurally (kind, immediates, type, operands' keys).
 * A trap is no obstacle: if the first evaluation did not trap, a second over
 * the same unchanged inputs does not either. Never control flow, a `pop`, or a
 * REFERENCE-typed value — which also keeps out every allocation (`struct.new`,
 * `array.new*`: two are distinct objects, and `ref.eq` sees it). ⚠️ If
 * reference values ever become candidates, allocations must be excluded by
 * kind: `local_cse_effects.test.ts` holds the `ref.eq` case. Worth caching only by upstream's
 * `isRelevant` rule (`_isRelevant`).
 *
 * **Where**: along straight-line code, in evaluation order — the available set
 * is cleared at a loop's start, around each `if` arm, at the end of every
 * block (a branch may arrive there without the first evaluation), and around
 * a `try`'s body and each of its handlers. A branch in between is no obstacle:
 * a later occurrence it skips is simply not reached.
 *
 * **Invalidation**: an available expression goes when something runs that
 * writes what it reads ({@link writesWhatItReads}): a local it reads, a global,
 * memory, a table, the GC heap — or any call, for the state a call may touch.
 *
 * Reference: `WebAssembly/binaryen/src/passes/LocalCSE.cpp`
 *
 * @license MIT
 */

import { type Expression, ExpressionKind, makeLocalGet, makeLocalTee } from '../ir/expressions.ts';
import type { Local, WasmFunction, WasmModule } from '../ir/module.ts';
import { isValType, type ValType } from '../ir/types.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { mapChildrenShallow, visitChildren, walkExpression } from '../ir/walk.ts';
import { varIndex } from '../../wabt-ts/ir/ir.ts';
import {
  type Effects,
  hasSideEffects,
  mergeEffects,
  noEffects,
  shallowEffects,
  writesWhatItReads,
} from '../ir/effects.ts';

/** Reuses an expression computed earlier along straight-line code. */
export class LocalCSEPass implements Pass {
  readonly name = 'LocalCSE';
  readonly description =
    'Common subexpression elimination: an expression computed again reuses the first result through a local.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, options: PassOptions): void {
    for (const fn of module.functions) _cseFunction(fn, options.shrinkLevel);
  }
}

registerPass(LocalCSEPass);

const EXPRESSION_KINDS = new Set<unknown>(Object.values(ExpressionKind));

/** Control flow: never keyed, and the walk treats it apart. */
const CONTROL = new Set<string>([
  ExpressionKind.Block,
  ExpressionKind.Region,
  ExpressionKind.Loop,
  ExpressionKind.If,
  ExpressionKind.Try,
  ExpressionKind.TryTable,
]);

const isExpr = (v: unknown): boolean =>
  v !== null && typeof v === 'object' && EXPRESSION_KINDS.has((v as { kind?: unknown }).kind);

/** A node's own fields — immediates and type, not its operands — as a string. */
function shallowKey(e: Expression): string {
  const own: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'loc' || k === 'nodeId') continue;
    if (isExpr(v) || (Array.isArray(v) && v.some(isExpr))) continue;
    own[k] = v;
  }
  return JSON.stringify(own, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
}

/** One straight-line walk of `fn`, then the rewrite. */
function _cseFunction(fn: WasmFunction, shrinkLevel: number): void {
  const keys = new Map<Expression, string | null>();
  const effects = new Map<Expression, Effects>();
  const available = new Map<string, { first: Expression; effects: Effects }>();
  // A later occurrence → the first one it reuses; in walk order.
  const dupes: Expression[] = [];
  const dupeOf = new Map<Expression, Expression>();
  // Keys made available, in walk order, for undoing those made inside a repeat.
  const added: string[] = [];

  const clear = () => available.clear();

  const visit = (e: Expression): void => {
    switch (e.kind) {
      case ExpressionKind.If:
        visit(e.condition);
        clear();
        visit(e.ifTrue);
        clear();
        if (e.ifFalse !== null) visit(e.ifFalse);
        clear();
        keys.set(e, null);
        return;
      case ExpressionKind.Loop:
        clear();
        visit(e.body);
        clear();
        keys.set(e, null);
        return;
      case ExpressionKind.Block:
      case ExpressionKind.Region:
        for (const c of e.children) visit(c);
        if (e.kind === ExpressionKind.Block) clear();
        keys.set(e, null);
        return;
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
        // A handler runs after a throw from anywhere in the body: nothing the
        // body computed is known to have run.
        clear();
        visitChildren(e, (c) => {
          visit(c);
          clear();
        });
        keys.set(e, null);
        return;
    }

    const before = dupes.length;
    const beforeAdded = added.length;
    const own = shallowEffects(e);
    const all = mergeEffects(noEffects(), own);
    let childKeys: (string | null)[] | null = [];
    visitChildren(e, (c) => {
      visit(c);
      const ce = effects.get(c);
      if (ce === undefined) childKeys = null;
      else mergeEffects(all, ce);
      const k = keys.get(c) ?? null;
      if (k === null) childKeys = null;
      else childKeys?.push(k);
    });
    effects.set(e, all);

    const keyable = childKeys !== null && !CONTROL.has(e.kind) &&
      isValType(e.type) && !_writesOrMoves(all);
    const key = keyable ? `${e.kind}${shallowKey(e)}(${(childKeys as string[]).join(',')})` : null;
    keys.set(e, key);

    if (key !== null && _isRelevant(e, shrinkLevel)) {
      const hit = available.get(key);
      if (hit !== undefined) {
        // A later occurrence: reused whole, so what was found INSIDE it is moot.
        for (const d of dupes.splice(before)) dupeOf.delete(d);
        // …and so are the first occurrences made inside it: replaced by a read,
        // their tees never run, and a later reuse would read an unset local.
        for (const k of added.splice(beforeAdded)) available.delete(k);
        dupeOf.set(e, hit.first);
        dupes.push(e);
      } else {
        available.set(key, { first: e, effects: all });
        added.push(key);
      }
    }
    // What this node does, it does after its operands: what it writes, no
    // later occurrence of what reads it may reuse.
    if (hasSideEffects(own)) {
      for (const [k, a] of available) if (writesWhatItReads(own, a.effects)) available.delete(k);
    }
  };
  visit(fn.body);
  if (dupeOf.size === 0) return;

  // Rewrite: each first that a later occurrence reuses becomes a tee of a
  // fresh local; each later occurrence, a read of it.
  const slot = new Map<Expression, number>();
  const newLocals: Local[] = [];
  for (const first of new Set(dupeOf.values())) {
    slot.set(first, fn.locals.length + newLocals.length);
    newLocals.push({ type: first.type as ValType });
  }
  const rebuild = (e: Expression): Expression => {
    const first = dupeOf.get(e);
    if (first !== undefined) return makeLocalGet(varIndex(slot.get(first)!), first.type as ValType);
    const s = slot.get(e);
    const r = mapChildrenShallow(e, rebuild);
    return s === undefined ? r : makeLocalTee(varIndex(s), r, e.type as ValType);
  };
  fn.body = rebuild(fn.body) as typeof fn.body;
  fn.locals = [...fn.locals, ...newLocals];
}

/** Any effect beyond reading state and possibly trapping. */
function _writesOrMoves(e: Effects): boolean {
  return e.unknown || e.pop || e.calls || e.branches || e.localsWritten.size > 0 ||
    e.globalsWritten.size > 0 || e.writesMemory || e.writesTable || e.writesHeap;
}

/**
 * Whether a repeated expression is WORTH caching — upstream's `isRelevant`
 * (`WebAssembly/binaryen/src/passes/LocalCSE.cpp:344`), ported rule for rule.
 *
 * - never a `local.get`: that is what CSE rewrites INTO;
 * - never a constant: it would undo constant propagation;
 * - when shrinking, only size ≥ 3 (two copies → 6 nodes, and a tee + get
 *   replacing one copy is then not a loss);
 * - otherwise size ≥ 2.
 *
 * (cmem/divergences.md C1: the port once had no such rule, and cached bare
 * reads and constants.)
 */
function _isRelevant(expr: Expression, shrinkLevel: number): boolean {
  if (expr.kind === ExpressionKind.LocalGet || expr.kind === ExpressionKind.Const) return false;
  let size = 0;
  walkExpression(expr, () => size++);
  return shrinkLevel > 0 ? size >= 3 : size >= 2;
}
