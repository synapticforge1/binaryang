/**
 * @module passes/simplify-locals
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
 * A block whose every way out sets one local gets that value as its RESULT,
 * set once ({@link _structureRound}, upstream's `optimizeBlockReturn`; open-work
 * 31). Upstream's `if` form is not done: measured, it cost bytes here.
 *
 * @license MIT
 */

import {
  blockParamsOf,
  type BreakExpr,
  type Expression,
  ExpressionKind,
  labelName,
  type LocalGetExpr,
  type LocalSetExpr,
  makeBlock,
  makeBreak,
  makeLocalSet,
  makeLocalTee,
  makeNop,
  neverFallsThrough,
  typeOf,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { None, Unreachable } from '../ir/types.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { mapChildrenShallow, visitChildren, walkExpression } from '../ir/walk.ts';
import { requireIndex, type ValueType } from '../ir/ir.ts';
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
      // Block results only once sinking stops: a fold can expose a sink, but each costs a walk.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (!_sinkRound(fn) && !_structureRound(fn)) break;
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

// ---------------------------------------------------------------------------
// Block result values from sets (open-work 31, upstream's optimizeBlockReturn)
// ---------------------------------------------------------------------------

/** `e` is `local.set` (not a tee) whose value is a real value: the index, else undefined. */
function _setIndex(e: Expression | undefined): number | undefined {
  if (e?.kind !== ExpressionKind.LocalSet || typeOf(e.value) === Unreachable) return undefined;
  return requireIndex(e.var, 'local index');
}

/**
 * Sets at every way out of a block, of one local, become the block's RESULT, set once:
 *
 *     (block $b …(local.set $x a) (br $b)… …(local.set $x c))
 *  →  (local.set $x (block $b (result T) …(br $b a)… …c))
 *
 * `T` is the local's declared type. For a block, every branch to it must be a plain `br`
 * ending its list right after a set of the local (any other branch to it, or a label declared
 * twice, stops it), and its own last statement is the fall-through's set. Nothing moves: each
 * value runs where it ran, and the one write of the local happens as control leaves the
 * construct, where the set it replaces was the last thing that path did. One `local.set` per
 * way out but one goes. True when something changed.
 *
 * Measured, not kept: upstream's `if` form, `(if c (then … (local.set $x a)) (else … (local.set $x
 * b)))` → `(local.set $x (if (result T) c …))`: six modules 0, corpus +1,106 bytes — the passes
 * after it (CodeFolding's arms among them) work on void `if`s (open-work 31, step 12).
 */
function _structureRound(fn: WasmFunction): boolean {
  // One walk indexes the function: the plain `br`s ending a list, and every label reference.
  const seen = new Set<Expression>();
  const declared = new Map<string, number>();
  const refs = new Map<string, number>();
  const ways = new Map<string, Array<{ list: Expression[]; at: number }>>();
  let shared = false;
  const ref = (l: string) => refs.set(l, (refs.get(l) ?? 0) + 1);
  walkExpression(fn.body, (e) => {
    if (seen.has(e)) shared = true;
    seen.add(e);
    switch (e.kind) {
      case ExpressionKind.Block:
      case ExpressionKind.Loop:
      case ExpressionKind.If:
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
        if (e.label !== '') declared.set(e.label, (declared.get(e.label) ?? 0) + 1);
        break;
    }
    for (const l of branchTargetList(e)) ref(l);
    if (e.kind !== ExpressionKind.Block && e.kind !== ExpressionKind.Region) return;
    const last = e.children[e.children.length - 1];
    if (
      last?.kind === ExpressionKind.Break && last.condition === undefined &&
      last.values.length === 0
    ) {
      const l = labelName(last.target);
      ways.set(l, [...(ways.get(l) ?? []), { list: e.children, at: e.children.length - 1 }]);
    }
  });
  // An edit by node identity needs a tree, not a graph.
  if (shared) return false;

  const typeOfLocal = (i: number) => fn.locals[i]?.type;

  // The blocks: each whose every way out sets one local. Nested ones fold in the same round:
  // a way's set is followed by its `br`, a fall-through's set ends its list, so no node is
  // edited for two blocks, and the rebuild below recurses through both.
  const chosen = new Map<
    Expression,
    { t: ValueType; label: string; set: LocalSetExpr; fallsThrough: boolean }
  >();
  const removed = new Set<Expression>();
  const brs = new Map<Expression, LocalSetExpr>();
  walkExpression(fn.body, (e) => {
    if (
      e.kind !== ExpressionKind.Block || e.label === '' || e.type !== None ||
      blockParamsOf(e) !== undefined || declared.get(e.label) !== 1
    ) return;
    const into = ways.get(e.label) ?? [];
    if (into.length === 0 || refs.get(e.label) !== into.length) return;
    if (!into.every((w) => w.at > 0)) return;
    // The fall-through sets the local too — or there is none: the last statement never falls
    // through (often the block's own last `br`, one of the ways above).
    const last = e.children[e.children.length - 1];
    const fallsThrough = last !== undefined && !neverFallsThrough(last);
    const set = (fallsThrough ? last : into[0]!.list[into[0]!.at - 1]) as LocalSetExpr;
    const i = _setIndex(set);
    const t = i === undefined ? undefined : typeOfLocal(i);
    if (t === undefined || !into.every((w) => _setIndex(w.list[w.at - 1]) === i)) return;
    chosen.set(e, { t, label: e.label, set, fallsThrough });
    for (const w of into) {
      const set = w.list[w.at - 1] as LocalSetExpr;
      removed.add(set);
      brs.set(w.list[w.at]!, set);
    }
  });
  if (chosen.size === 0) return false;
  // Top-down over the ORIGINAL nodes, which the index above names.
  const rebuild = (e: Expression): Expression => {
    const set = brs.get(e);
    if (set !== undefined) {
      return makeBreak(labelName((e as BreakExpr).target), undefined, [rebuild(set.value)]);
    }
    if (e.kind !== ExpressionKind.Block && e.kind !== ExpressionKind.Region) {
      return mapChildrenShallow(e, rebuild);
    }
    const children = e.children.filter((c) => !removed.has(c)).map(rebuild);
    const block = chosen.get(e);
    if (block === undefined) return { ...e, children } as Expression;
    const body = block.fallsThrough
      ? [...children.slice(0, -1), (children[children.length - 1] as LocalSetExpr).value]
      : children;
    return makeLocalSet(block.set.var, makeBlock(body, block.label, block.t));
  };
  fn.body = rebuild(fn.body) as typeof fn.body;
  return true;
}

/** The labels `e` itself names as a branch target (not its operands'). */
function branchTargetList(e: Expression): string[] {
  switch (e.kind) {
    case ExpressionKind.Break:
    case ExpressionKind.BrOn:
    case ExpressionKind.Rethrow:
      return [labelName(e.target)];
    case ExpressionKind.Switch:
      return [...e.targets, e.defaultTarget].map(labelName);
    case ExpressionKind.TryTable:
      return e.catches.map((c) => labelName(c.target));
    case ExpressionKind.Try:
      return e.delegate === undefined ? [] : [labelName(e.delegate)];
    default:
      return [];
  }
}
