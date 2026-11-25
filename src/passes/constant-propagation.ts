// Based on WebAssembly/binaryen (https://github.com/WebAssembly/binaryen)
// Original source: src/passes/Precompute.cpp
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module passes/constant-propagation
 *
 * ConstantPropagation pass — a `local.get` whose only reaching value is one
 * constant becomes that constant.
 *
 * A forward analysis over {@link buildCFG}'s blocks, one lattice value per
 * local: not reached yet, ONE constant, or not a constant. A `local.set` /
 * `local.tee` of a `*.const` assigns that constant; of a `local.get` or a
 * `local.tee`, whatever that copy held at the time, so a chain of copies of a
 * constant is followed in one run; of anything else, not a constant. At a merge
 * two different constants are not a constant. A parameter is not a constant at
 * entry; a declared local holds its zero, as wasm initialises it.
 *
 * This is PROPAGATION only. Nothing is evaluated: `x - 132 + 8` becoming
 * `x - 124` is folding, which stays with OptimizeInstructions, and evaluating
 * an expression to a constant is Precompute proper (open-work 23; owner,
 * 2026-10-06: "Constant propagation may go into item 2 now."). Upstream does the
 * propagation inside `precompute-propagate`; it has no pass that does only it,
 * so this one does not take an upstream name.
 *
 * Only numeric and `v128` locals are propagated. A reference local's value has
 * an identity and a type that may be narrower than the local's, so it is left
 * alone. A read in code no path reaches records no action in the CFG and is
 * left alone too. The sets that no read needs any more are CoalesceLocals'
 * and SimplifyLocals' to remove.
 *
 * Reference: `WebAssembly/binaryen/src/passes/Precompute.cpp` (`propagateLocals`)
 *
 * @license MIT
 */

import {
  type Expression,
  ExpressionKind,
  type Literal,
  makeConst,
  makeNop,
  type RegionExpr,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { mapChildrenShallow } from '../ir/walk.ts';
import { type BasicBlock, buildCFG } from './cfg.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Replaces each `local.get` whose only reaching value is one constant with that constant. */
export class ConstantPropagationPass implements Pass {
  readonly name = 'ConstantPropagation';
  readonly description =
    'Replace each local.get whose only reaching value is one constant with that constant.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) propagateFunction(fn);
  }
}

registerPass(ConstantPropagationPass);

// ---------------------------------------------------------------------------
// The lattice
// ---------------------------------------------------------------------------

/** Not a constant: two different constants met, or a value nothing here knows. */
const VARIES = Symbol('varies');
/** `undefined`: no path has reached this point yet. */
type Value = Literal | typeof VARIES | undefined;
type State = Value[];

function sameLiteral(a: Literal, b: Literal): boolean {
  if (a === b) return true;
  switch (a.type) {
    case ValType.I32:
    case ValType.I64:
      return a.type === b.type && a.value === (b as typeof a).value;
    case ValType.F32:
    case ValType.F64:
      // Bits, not numbers: two NaNs with different payloads are different
      // constants, and +0 is not -0.
      return a.type === b.type && a.bits === (b as typeof a).bits;
    case ValType.V128: {
      if (b.type !== ValType.V128) return false;
      for (let i = 0; i < 16; i++) if (a.bytes[i] !== b.bytes[i]) return false;
      return true;
    }
  }
}

function meet(a: Value, b: Value): Value {
  if (a === undefined) return b;
  if (b === undefined || a === b) return a;
  if (a === VARIES || b === VARIES) return VARIES;
  return sameLiteral(a, b) ? a : VARIES;
}

function sameValue(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === VARIES || b === VARIES) return false;
  return sameLiteral(a, b);
}

/** The zero a declared local of `type` starts with, or VARIES for a type not propagated. */
function zeroOf(type: unknown): Value {
  switch (type) {
    case ValType.I32:
      return { type: ValType.I32, value: 0 };
    case ValType.I64:
      return { type: ValType.I64, value: 0n };
    case ValType.F32:
      return { type: ValType.F32, bits: 0 };
    case ValType.F64:
      return { type: ValType.F64, bits: 0n };
    case ValType.V128:
      return { type: ValType.V128, bytes: new Uint8Array(16) };
    default:
      return VARIES;
  }
}

function isPropagated(type: unknown): boolean {
  return zeroOf(type) !== VARIES;
}

/** Each reachable block's place in reverse postorder (entry 0); -1 for an unreachable one. */
function reversePostorder(entry: BasicBlock, count: number): Int32Array {
  const rpo = new Int32Array(count).fill(-1);
  const seen = new Uint8Array(count);
  const order: BasicBlock[] = []; // postorder
  const stack: { b: BasicBlock; next: number }[] = [{ b: entry, next: 0 }];
  seen[entry.id] = 1;
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.next < top.b.out.length) {
      const s = top.b.out[top.next++]!;
      if (seen[s.id] === 0) {
        seen[s.id] = 1;
        stack.push({ b: s, next: 0 });
      }
    } else {
      order.push(top.b);
      stack.pop();
    }
  }
  for (let i = 0; i < order.length; i++) rpo[order[i]!.id] = order.length - 1 - i;
  return rpo;
}

// ---------------------------------------------------------------------------
// Per-function implementation
// ---------------------------------------------------------------------------

/**
 * The most lattice cells (blocks plus one, times the locals the function sets) one function may
 * hold at once. Past it the function is left as it is (still correct): the analysis keeps one
 * dense state per block, so it is blocks × tracked locals in memory and time (upstream has no
 * such bound).
 */
export const CONSTANT_PROPAGATION_MAX_CELLS = 1 << 25;

/**
 * Predecessor states met, summed over every run in this process: the work the tests bound, since
 * time is no measure on a loaded machine (round 6: the CPU time of the same run grew from 4 s
 * alone to 15.8 s beside a gate). The quadratic was here, not in the blocks taken: the FIFO order
 * took a flat chain's merge block once per predecessor, and each time met all n of them;
 * reversed postorder takes it once per round.
 */
export const propagationWork = { meets: 0 };

/** Propagates in one function; whether anything changed (`PrecomputePropagate` iterates on it). */
export function propagateFunction(fn: WasmFunction): boolean {
  const numLocals = fn.locals.length;
  if (numLocals === 0) return false;
  const numParams = fn.sig.params.length;
  const propagated = fn.locals.map((l) => isPropagated(l.type));
  if (!propagated.some((p) => p)) return false;

  const cfg = buildCFG(fn.body, fn.bodyFrameLabel);
  // Only a local some block SETS can change along a path: that is the state. Every other local
  // holds its starting value (a parameter: varies; a declared local: its zero) wherever a path
  // reaches, so it needs no cell: `slot` maps a set local to its cell, -1 for the rest.
  const slot = new Int32Array(numLocals).fill(-1);
  const tracked: number[] = [];
  for (const b of cfg.blocks) {
    for (const a of b.actions) {
      if (a.kind !== 'get' && propagated[a.index] && slot[a.index]! < 0) {
        slot[a.index] = tracked.length;
        tracked.push(a.index);
      }
    }
  }
  const numTracked = tracked.length;
  if ((cfg.blocks.length + 1) * numTracked > CONSTANT_PROPAGATION_MAX_CELLS) return false;
  const start = (i: number): Value => i < numParams ? VARIES : zeroOf(fn.locals[i]!.type);
  const initial: State = tracked.map(start);

  // What each read saw, and what each set / tee assigned — and what the local held just before
  // it — in the latest scan.
  const seen = new Map<Expression, Value>();
  const assigned = new Map<Expression, Value>();
  const held = new Map<Expression, Value>();

  const valueOfExpr = (e: Expression, type: unknown): Value => {
    switch (e.kind) {
      case ExpressionKind.Const:
        return e.value.type === type ? e.value : VARIES;
      case ExpressionKind.LocalGet:
        return seen.get(e) ?? VARIES;
      case ExpressionKind.LocalTee:
        return assigned.get(e) ?? VARIES;
      default:
        return VARIES;
    }
  };

  // `reached`: some path gets to the block, so a local nothing sets holds its starting value there.
  const scan = (b: BasicBlock, state: State, reached: boolean): State => {
    const s = state.slice();
    for (const a of b.actions) {
      if (!propagated[a.index]) continue;
      const k = slot[a.index]!;
      if (a.kind === 'get') {
        seen.set(a.origin, k >= 0 ? s[k] : reached ? start(a.index) : undefined);
      } else {
        const origin = a.origin as Extract<Expression, { kind: typeof ExpressionKind.LocalSet }>;
        const v = s[k] === undefined
          ? undefined // a path no one has reached yet assigns nothing yet
          : valueOfExpr(origin.value, fn.locals[a.index]!.type);
        held.set(a.origin, s[k]);
        s[k] = v;
        assigned.set(a.origin, v);
      }
    }
    return s;
  };

  // Forward worklist to a fixed point. A block's out-state only rises in the
  // lattice (unreached → one constant → varies), so this terminates.
  const empty: State = new Array<Value>(numTracked).fill(undefined);
  const outs = cfg.blocks.map(() => empty);
  const inOf = (b: BasicBlock): State => {
    const s = b === cfg.entry ? initial.slice() : empty.slice();
    for (const p of b.in) {
      propagationWork.meets++;
      const o = outs[p.id]!;
      for (let i = 0; i < numTracked; i++) s[i] = meet(s[i], o[i]);
    }
    return s;
  };
  // The worklist takes the block earliest in reverse postorder first, so a merge with many
  // predecessors is met once all of them have run, not once per predecessor (a FIFO queue ran a
  // block with n predecessors up to n times, each pass over all n: quadratic, 26 s on 3,000
  // `if (…) br`s in one block, upstream 0.7 s). The fixed point is the same in any order.
  const rpo = reversePostorder(cfg.entry, cfg.blocks.length);
  const heap: number[] = []; // the rpo numbers of the queued blocks, a binary min-heap
  const byRpo: BasicBlock[] = new Array<BasicBlock>(cfg.blocks.length);
  const queued = new Uint8Array(cfg.blocks.length);
  for (const bl of cfg.blocks) if (rpo[bl.id]! >= 0) byRpo[rpo[bl.id]!] = bl;
  const push = (bl: BasicBlock): void => {
    queued[bl.id] = 1;
    let i = heap.length;
    heap.push(rpo[bl.id]!);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up]! <= heap[i]!) break;
      [heap[up], heap[i]] = [heap[i]!, heap[up]!];
      i = up;
    }
  };
  const pop = (): BasicBlock => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]! < heap[m]!) m = l;
        if (r < heap.length && heap[r]! < heap[m]!) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return byRpo[top]!;
  };
  push(cfg.entry);
  while (heap.length > 0) {
    const b = pop();
    queued[b.id] = 0;
    const out = scan(b, inOf(b), true);
    const prev = outs[b.id]!;
    let changed = false;
    for (let i = 0; i < numTracked && !changed; i++) changed = !sameValue(prev[i], out[i]);
    if (!changed && prev !== empty) continue;
    outs[b.id] = out;
    for (const s of b.out) if (queued[s.id] === 0) push(s);
  }

  // One last scan of every block with its converged in-state: what each read
  // sees at the fixed point.
  seen.clear();
  assigned.clear();
  held.clear();
  for (const b of cfg.blocks) {
    scan(b, inOf(b), b === cfg.entry || b.in.some((p) => outs[p.id] !== empty));
  }

  const replace = new Map<Expression, Literal>();
  for (const [get, v] of seen) {
    if (v !== undefined && v !== VARIES) replace.set(get, v);
  }
  // A write of the constant the local already holds on every path that reaches it changes
  // nothing (open-work 31; upstream's RedundantSetElimination, for constants): a set goes, a tee
  // is its constant.
  // A node the CFG met more than once is shared by two places in the tree: what one place held
  // says nothing about the other. Left alone. (Defence: no input seen yet shares a SET node — its
  // mutant is equivalent on the fuzz, 2026-10-15 — but constants are shared, below.)
  const met = new Map<Expression, number>();
  for (const b of cfg.blocks) {
    for (const a of b.actions) met.set(a.origin, (met.get(a.origin) ?? 0) + 1);
  }
  const redundant = new Set<Expression>();
  for (const [set, before] of held) {
    const value = (set as { value: Expression }).value;
    if (
      met.get(set) === 1 && value.kind === ExpressionKind.Const && before !== undefined &&
      before !== VARIES && sameLiteral(before, value.value)
    ) redundant.add(set);
  }
  if (replace.size === 0 && redundant.size === 0) return false;
  // Top-down on the nodes the CFG saw, so each set is recognized as ITSELF before anything is
  // rebuilt. 🔧 The first version rewrote bottom-up (`mapExpression`, whose callback gets a
  // rebuilt parent) and keyed the set by its constant instead — a constant node can sit in two
  // places, and a needed write went with a redundant one (the -Oz fuzz, seed 163).
  const rewrite = (e: Expression): Expression => {
    if (redundant.has(e)) {
      return e.kind === ExpressionKind.LocalTee ? e.value : makeNop();
    }
    const lit = replace.get(e);
    if (lit !== undefined) return makeConst(lit);
    return mapChildrenShallow(e, rewrite);
  };
  fn.body = rewrite(fn.body) as RegionExpr;
  return true;
}
