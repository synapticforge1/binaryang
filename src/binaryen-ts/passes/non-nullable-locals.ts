/**
 * @module binaryen-ts/passes/non-nullable-locals
 *
 * The non-nullable-local fixup, run by `PassRunner` after every pass that
 * declares {@link Pass.requiresNonNullableLocalFixups}.
 *
 * A non-nullable local (`(local $x (ref $T))`) has no default value, so wasm
 * validates every `local.get` of it against its SETS, structurally: a
 * `local.set` / `local.tee` makes the local readable until the end of the
 * enclosing `block` / `loop` / `if` arm / `try` body or catch / `try_table`,
 * and no further. A pass that moves a set into a nested construct can leave a
 * read that no set covers — Flatten does exactly that to
 * `(if (result (ref $T)) …)`, writing the local in each arm and reading it after
 * the `if`, and V8 then refuses the module ("uninitialized non-defaultable
 * local"). Measured 2026-09-14.
 *
 * The fix is upstream's (`TypeUpdating::handleNonDefaultableLocals` over
 * `LocalStructuralDominance`, `WebAssembly/binaryen/src/ir/`): every local with a
 * read no set covers becomes NULLABLE, and each of its reads — and each of its
 * tees, whose type is the local's — is wrapped in `ref.as_non_null`, which
 * restores the non-null type the surrounding code expects. Behaviour is
 * unchanged, because the program never reads the local before writing it at
 * RUN time; only the validator's structural view needed help.
 *
 * Two departures from upstream, both toward fixing more locals, never fewer:
 *
 * - **Every `block` is a scope.** Upstream skips unnamed blocks because its
 *   writer never emits them; binaryen-ts's encoder emits every `Block`.
 * - **A branch's values are walked before its condition**, wasm's evaluation
 *   order. The shared walker visits the condition first (kept for byte
 *   stability, see open-work), which would call `(br_if $l (local.get $x)
 *   (local.tee $x …))`'s read covered.
 *
 * @license MIT
 */

import {
  type Expression,
  ExpressionKind,
  makeRefAsNonNull,
  type RegionExpr,
} from '../ir/expressions.ts';
import { isRefType, type RefType } from '../ir/gc-types.ts';
import type { WasmFunction } from '../ir/module.ts';
import { mapExpression, visitChildren } from '../ir/walk.ts';
import { requireIndex } from '../../wabt-ts/ir/ir.ts';

/** The non-nullable VARS (never params) with a read that no set structurally covers. */
export function uncoveredNonNullableLocals(fn: WasmFunction): Set<number> {
  const bad = new Set<number>();
  const interesting = new Set<number>();
  for (let i = fn.params.length; i < fn.locals.length; i++) {
    const t = fn.locals[i]!.type;
    if (isRefType(t) && !t.nullable) interesting.add(i);
  }
  if (interesting.size === 0) return bad;

  const set = new Set<number>(); // interesting locals readable right now
  const scopes: number[][] = []; // per open scope, the locals it made readable

  const scope = (visit: () => void): void => {
    scopes.push([]);
    visit();
    for (const i of scopes.pop()!) set.delete(i);
  };
  const markSet = (i: number): void => {
    if (!interesting.has(i) || set.has(i)) return;
    set.add(i);
    scopes[scopes.length - 1]?.push(i); // at the function's top level it stays set
  };

  const scan = (e: Expression): void => {
    switch (e.kind) {
      case ExpressionKind.LocalGet: {
        const i = requireIndex(e.var, 'local.get');
        if (interesting.has(i) && !set.has(i)) bad.add(i);
        return;
      }
      case ExpressionKind.LocalSet:
      case ExpressionKind.LocalTee:
        scan(e.value); // the value is evaluated first
        markSet(requireIndex(e.var, e.kind));
        return;
      case ExpressionKind.Block:
        e.params?.values.forEach(scan);
        scope(() => e.children.forEach(scan));
        return;
      case ExpressionKind.If:
        e.params?.values.forEach(scan);
        scan(e.condition);
        scope(() => scan(e.ifTrue));
        if (e.ifFalse) scope(() => scan(e.ifFalse!));
        return;
      case ExpressionKind.Loop:
        e.params?.values.forEach(scan);
        scope(() => scan(e.body));
        return;
      case ExpressionKind.Try:
        e.params?.values.forEach(scan);
        scope(() => scan(e.body));
        for (const c of e.catches) scope(() => scan(c.body));
        return;
      case ExpressionKind.TryTable:
        e.params?.values.forEach(scan);
        scope(() => scan(e.body));
        return;
      case ExpressionKind.Break:
        e.values.forEach(scan);
        if (e.condition) scan(e.condition);
        return;
      case ExpressionKind.Switch:
        e.values.forEach(scan);
        scan(e.condition);
        return;
      default:
        visitChildren(e, scan);
    }
  };

  scan(fn.body);
  return bad;
}

/**
 * Makes every non-nullable local with an uncovered read nullable, and wraps its
 * reads and tees in `ref.as_non_null`. A function with no such local is left
 * exactly as it was — same objects, no rebuild.
 */
export function handleNonDefaultableLocals(fn: WasmFunction): void {
  const bad = uncoveredNonNullableLocals(fn);
  if (bad.size === 0) return;

  const nonNull = new Map<number, RefType>();
  for (const i of bad) {
    const t = fn.locals[i]!.type as RefType;
    nonNull.set(i, t);
    fn.locals[i] = { ...fn.locals[i]!, type: { ...t, nullable: true } };
  }

  fn.body = mapExpression(fn.body, (e) => {
    if (e.kind !== ExpressionKind.LocalGet && e.kind !== ExpressionKind.LocalTee) return e;
    const t = nonNull.get(requireIndex(e.var, e.kind));
    if (t === undefined) return e;
    return makeRefAsNonNull({ ...e, type: fn.locals[requireIndex(e.var, e.kind)]!.type }, t);
  }) as RegionExpr;
}
