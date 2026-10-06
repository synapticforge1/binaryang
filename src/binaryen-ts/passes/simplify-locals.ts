/**
 * @module binaryen-ts/passes/simplify-locals
 *
 * SimplifyLocals pass — SINKS a `local.set`'s value forward to the first
 * `local.get` that reads it (open-work 2, step 3b):
 *
 * - the local has no other `local.get` in the function → the get becomes the
 *   value, and the set goes;
 * - it has others → the get becomes `local.tee(value)`, and the set goes.
 *
 * Only along STRAIGHT-LINE code: a set is a candidate ("sinkable") from where it
 * stands until the walk, in evaluation order, meets
 *
 * - a branch, return, throw, loop, `if` arm or `try` — any control flow, so
 *   the set never becomes conditional and never crosses a merge;
 * - the end of a block (a branch to it may skip the set);
 * - code whose effects may not change places with the value's
 *   ({@link invalidates}: a write it reads, a call, a trap, …).
 *
 * The value moves; nothing it does is lost or reordered against anything it
 * could observe. A value that holds control flow of its own, or a `pop`, never
 * moves. Repeated to a fixed point, as a sink exposes another.
 *
 * Upstream (`SimplifyLocals.cpp`) also builds `if` / block RESULT values from
 * sets in their arms; that is not done here.
 *
 * @license MIT
 */

import {
  type Expression,
  ExpressionKind,
  type LocalGetExpr,
  type LocalSetExpr,
  makeLocalTee,
  makeNop,
  typeOf,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { mapChildrenShallow, visitChildren, walkExpression } from '../ir/walk.ts';
import { requireIndex } from '../../wabt-ts/ir/ir.ts';
import {
  deepEffects,
  type Effects,
  invalidates,
  mergeEffects,
  shallowEffects,
} from '../ir/effects.ts';

/** Rounds before giving up on a fixed point; each round is linear. */
const MAX_ROUNDS = 10;

/** Sinks each `local.set` into the first `local.get` that reads it. */
export class SimplifyLocalsPass implements Pass {
  readonly name = 'SimplifyLocals';
  readonly description =
    'Sinks a local.set into the local.get that reads it, along straight-line code.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (!_sinkRound(fn)) break;
      }
    }
  }
}

registerPass(SimplifyLocalsPass);

interface Sinkable {
  set: LocalSetExpr;
  /** The value's effects, and the write of the local itself. */
  effects: Effects;
}

/** One pass over `fn`: find every sink, then apply them. True if any. */
function _sinkRound(fn: WasmFunction): boolean {
  const gets = new Map<number, number>();
  walkExpression(fn.body, (e) => {
    if (e.kind === ExpressionKind.LocalGet) {
      const i = requireIndex(e.var, 'local index');
      gets.set(i, (gets.get(i) ?? 0) + 1);
    }
  });

  // get → the set it takes the value of; sets that go.
  const sinks = new Map<LocalGetExpr, LocalSetExpr>();
  const sunk = new Set<LocalSetExpr>();
  const sunkEffects = new Map<LocalSetExpr, Effects>();
  const sinkables = new Map<number, Sinkable>();
  const clear = () => sinkables.clear();
  const invalidate = (by: Effects) => {
    for (const [i, s] of sinkables) if (invalidates(s.effects, by)) sinkables.delete(i);
  };

  const visit = (e: Expression): void => {
    switch (e.kind) {
      case ExpressionKind.If:
        visit(e.condition);
        clear();
        visit(e.ifTrue);
        clear();
        if (e.ifFalse !== null) visit(e.ifFalse);
        clear();
        return;
      case ExpressionKind.Loop:
        clear();
        visit(e.body);
        clear();
        return;
      case ExpressionKind.Block:
        for (const c of e.children) visit(c);
        // A branch to it may arrive here without what the block set — and a
        // branch names its target by DEPTH as well as by label, so an empty
        // label proves nothing.
        clear();
        return;
      case ExpressionKind.Region:
        for (const c of e.children) visit(c);
        return;
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
        clear();
        visitChildren(e, visit);
        clear();
        return;
    }
    visitChildren(e, visit);

    if (e.kind === ExpressionKind.LocalGet) {
      const i = requireIndex(e.var, 'local index');
      const s = sinkables.get(i);
      if (s !== undefined) {
        sinks.set(e, s.set);
        sunk.add(s.set);
        sunkEffects.set(s.set, s.effects);
        sinkables.delete(i);
        // Nothing still waiting needs checking against the value landing here:
        // each was checked against the value's nodes where they stood, and
        // keeps its order relative to it.
        return;
      }
      // 🔧 A read is an effect too: a value that WRITES this local (a tee
      // inside it) may not move past it. Returning before this let one do
      // (the fuzzer's seed 128).
    }
    const own = shallowEffects(e);
    // Stated outright, though {@link invalidates} would agree: every sinkable
    // writes its local, and a branch conflicts with any effect.
    if (own.branches || own.unknown) {
      clear();
    } else {
      invalidate(own);
    }
    if (e.kind === ExpressionKind.LocalSet) {
      const i = requireIndex(e.var, 'local index');
      const effects = mergeEffects(deepEffects(e.value), own);
      // 🔧 A value that ANOTHER set was sunk into runs that set's value — and,
      // as a tee, its write — wherever this one moves. Its effects are as
      // rewritten, not as read (the fuzzer's seed 128: a tee moved past a get
      // of its local).
      walkExpression(e.value, (x) => {
        const from = x.kind === ExpressionKind.LocalGet ? sinks.get(x) : undefined;
        if (from !== undefined) mergeEffects(effects, sunkEffects.get(from)!);
      });
      if (!effects.branches && !effects.unknown && !effects.pop && !_hasStructure(e.value)) {
        sinkables.set(i, { set: e, effects });
      }
    }
  };
  visit(fn.body);
  if (sinks.size === 0) return false;

  // Apply, in evaluation order: a set is rebuilt (its value may hold sinks of
  // its own) before the get it moves to.
  const moved = new Map<LocalSetExpr, Expression>();
  const rebuild = (e: Expression): Expression => {
    if (e.kind === ExpressionKind.LocalSet && sunk.has(e)) {
      moved.set(e, rebuild(e.value));
      return makeNop();
    }
    if (e.kind === ExpressionKind.LocalGet) {
      const set = sinks.get(e);
      if (set === undefined) return e;
      const value = moved.get(set);
      if (value === undefined) throw new Error('SimplifyLocals: a get before its set');
      const i = requireIndex(e.var, 'local index');
      const type = typeOf(e);
      // The only read: the value itself, when its type is the local's (a
      // subtype would retype the parent). Else a tee.
      if (gets.get(i) === 1 && _sameType(typeOf(value), type)) return value;
      return makeLocalTee(e.var, value, type as never);
    }
    const r = mapChildrenShallow(e, rebuild);
    if (
      (r.kind === ExpressionKind.Block || r.kind === ExpressionKind.Region) &&
      r.children.some((c) => c.kind === ExpressionKind.Nop)
    ) {
      // The sets that went leave no `nop` behind (a pipeline without Vacuum
      // would keep it); `nop`s that were there stay.
      const before = (e as typeof r).children;
      const children = r.children.filter((c, k) =>
        !(c.kind === ExpressionKind.Nop && before[k]!.kind === ExpressionKind.LocalSet)
      );
      return { ...r, children } as Expression;
    }
    return r;
  };
  fn.body = rebuild(fn.body) as typeof fn.body;
  return true;
}

/** Holds control flow of its own — a value that never moves. */
function _hasStructure(e: Expression): boolean {
  let found = false;
  walkExpression(e, (x) => {
    switch (x.kind) {
      case ExpressionKind.Block:
      case ExpressionKind.Loop:
      case ExpressionKind.If:
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
      case ExpressionKind.Region:
        found = true;
    }
  });
  return found;
}

function _sameType(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
