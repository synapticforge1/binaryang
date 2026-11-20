// Based on WebAssembly/binaryen (https://github.com/WebAssembly/binaryen)
// Original source: src/ir/local-graph.h, src/ir/LocalGraph.cpp
// Copyright 2017 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/local-graph
 *
 * Which writes each `local.get` may read, and which reads each `local.set` / `local.tee` may
 * feed: upstream's LocalGraph, over {@link buildCFG} (open-work 31), kept as COUNTS
 * ({@link localGraphSummary}), not as a Set of definitions per read: that was quadratic in memory
 * (2.6 GB on 3,000 sequential `if`s). Shared by SSANoMerge, MergeLocals and Local2Stack
 * (`stack-ir.ts`).
 *
 * @license MIT
 */

import type { Expression } from '../ir/expressions.ts';
import type { WasmFunction } from '../ir/module.ts';
import { buildCFG } from './cfg.ts';

/** The value a local holds on entry: a parameter's argument, or a declared local's zero. */
export const ENTRY = Symbol('entry');
/** A definition: a set / tee node, or the entry. */
export type Def = Expression | typeof ENTRY;

/**
 * The most 32-bit words the reaching-definitions bitsets of one function may hold: 2^25 words,
 * 128 MB, which a function of some 11,000 sets and branches stays under. They are quadratic in the
 * function (blocks × definitions / 32), so a hostile function could make them gigabytes. A client
 * of {@link localGraphSummary} that gets `undefined` leaves the function as it is.
 */
export const LOCAL_GRAPH_MAX_WORDS = 1 << 25;

/** What SSANoMerge, MergeLocals and Local2Stack need from the graph, as counts. */
export interface LocalGraphSummary {
  /** Per reached `local.get`: how many definitions reach it, the one if exactly one, whether the entry is among them. */
  reads: Map<Expression, { count: number; only: Def | undefined; entry: boolean }>;
  /** The sets / tees that a read reached by more than one definition may read. */
  merged: Set<Expression>;
  /** Per set / tee: how many reads have it as their ONLY reaching definition. */
  sole: Map<Expression, number>;
}

/** Population count of a 32-bit word. */
function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/**
 * What upstream's LocalGraph tells its clients, kept as counts: a read reached by n definitions
 * costs O(1) memory, not a Set of n. (A flat run of n `if (c) x = i;` each followed by a read of
 * x gives n reads of up to n definitions: n² Set entries, 2.6 GB at n = 3,000.) Work is n² / 32
 * word operations on that shape. `undefined` when the bitsets would hold more than `maxWords`
 * words (see {@link LOCAL_GRAPH_MAX_WORDS}): the caller gives that function up. Given `locals`,
 * only those are followed: the gets and sets of the others are not in the result (MergeLocals asks
 * about the few locals its copies touch, on functions with hundreds).
 */
export function localGraphSummary(
  fn: WasmFunction,
  maxWords: number,
  locals?: ReadonlySet<number>,
): LocalGraphSummary | undefined {
  const g = solve(fn, locals, maxWords);
  if (g === undefined) return undefined;
  const { cfg, defs, ofLocal, masks, idOf, ins, reached, W, followed } = g;
  const sole = new Map<Expression, number>();
  const reads: LocalGraphSummary['reads'] = new Map();
  const mergedBits = new Uint32Array(W); // every definition some merging read may see
  for (const b of cfg.blocks) {
    if (reached[b.id] === 0) continue;
    const s = ins[b.id]!.slice();
    for (const a of b.actions) {
      if (!followed(a.index)) continue;
      const m = masks.get(a.index)!;
      if (a.kind === 'set') {
        const id = idOf.get(a.origin)!;
        for (let w = 0; w < W; w++) s[w]! &= ~m[w]!;
        s[id >>> 5]! |= 1 << (id & 31);
        continue;
      }
      let count = 0;
      let first = -1;
      for (let w = 0; w < W; w++) {
        const v = (s[w]! & m[w]!) >>> 0;
        if (v === 0) continue;
        if (first < 0) first = (w << 5) + 31 - Math.clz32(v & -v);
        count += popcount(v);
      }
      const e = ofLocal.get(a.index)![0]!; // each local's entry is its first definition
      const only = count === 1 ? defs[first] : undefined;
      if (only !== undefined && only !== ENTRY) sole.set(only, (sole.get(only) ?? 0) + 1);
      reads.set(a.origin, {
        count,
        only,
        entry: ((s[e >>> 5]! >>> (e & 31)) & 1) === 1,
      });
      if (count > 1) { for (let w = 0; w < W; w++) mergedBits[w]! |= s[w]! & m[w]!; }
    }
  }
  const merged = new Set<Expression>();
  for (const [set, id] of idOf) {
    if (((mergedBits[id >>> 5]! >>> (id & 31)) & 1) === 1) merged.add(set);
  }
  return { reads, merged, sole };
}

/** The solved dataflow: each block's in-state over the numbered definitions. */
interface Solved {
  cfg: ReturnType<typeof buildCFG>;
  defs: Def[];
  ofLocal: Map<number, number[]>;
  masks: Map<number, Uint32Array>;
  idOf: Map<Expression, number>;
  ins: Uint32Array[];
  reached: Uint8Array;
  W: number;
  followed: (i: number) => boolean;
}

/**
 * The reaching-definitions fixed point. `undefined` when (blocks × 4 + locals) × words per
 * bitset would pass `maxWords`: the bitsets are quadratic in the function's size (blocks ×
 * definitions / 32), and a hostile function can make them gigabytes.
 */
function solve(
  fn: WasmFunction,
  locals: ReadonlySet<number> | undefined,
  maxWords: number,
): Solved | undefined {
  const cfg = buildCFG(fn.body, fn.bodyFrameLabel);
  const followed = (i: number) => locals === undefined || locals.has(i);

  // Every definition numbered — each followed local's entry, then each set — so a block's state
  // is a bitset over them, and a block's effect is gen / kill (open-work 31, step 15: a Map of
  // Sets per block took MergeLocals 1.7 s on zig-debug).
  const defs: Def[] = [];
  const ofLocal = new Map<number, number[]>(); // local → its definitions' numbers
  const define = (d: Def, local: number): number => {
    const ids = ofLocal.get(local) ?? [];
    ids.push(defs.length);
    ofLocal.set(local, ids);
    defs.push(d);
    return defs.length - 1;
  };
  for (let i = 0; i < fn.locals.length; i++) if (followed(i)) define(ENTRY, i);
  const entryBits = defs.length;
  const idOf = new Map<Expression, number>();
  for (const b of cfg.blocks) {
    for (const a of b.actions) {
      if (a.kind === 'set' && followed(a.index)) idOf.set(a.origin, define(a.origin, a.index));
    }
  }
  const W = (defs.length + 31) >>> 5;
  if ((cfg.blocks.length * 4 + ofLocal.size) * W > maxWords) return undefined;
  const masks = new Map<number, Uint32Array>(); // local → all its definitions
  for (const [local, ids] of ofLocal) {
    const m = new Uint32Array(W);
    for (const id of ids) m[id >>> 5]! |= 1 << (id & 31);
    masks.set(local, m);
  }
  const gen = cfg.blocks.map(() => new Uint32Array(W));
  const kill = cfg.blocks.map(() => new Uint32Array(W));
  for (const b of cfg.blocks) {
    const last = new Map<number, number>();
    for (const a of b.actions) {
      if (a.kind === 'set' && followed(a.index)) last.set(a.index, idOf.get(a.origin)!);
    }
    const g = gen[b.id]!, k = kill[b.id]!;
    for (const [local, id] of last) {
      const m = masks.get(local)!;
      for (let w = 0; w < W; w++) k[w]! |= m[w]!;
      g[id >>> 5]! |= 1 << (id & 31);
    }
  }

  const ins = cfg.blocks.map(() => new Uint32Array(W));
  const outs = cfg.blocks.map(() => new Uint32Array(W));
  const reached = new Uint8Array(cfg.blocks.length); // a path reaches it
  const done = new Uint8Array(cfg.blocks.length); // its out has been computed once
  const queued = new Uint8Array(cfg.blocks.length);
  for (let id = 0; id < entryBits; id++) ins[cfg.entry.id]![id >>> 5]! |= 1 << (id & 31);
  reached[cfg.entry.id] = 1;
  const work = [cfg.entry];
  queued[cfg.entry.id] = 1;
  for (let head = 0; head < work.length; head++) {
    const b = work[head]!;
    queued[b.id] = 0;
    const inn = ins[b.id]!, out = outs[b.id]!, g = gen[b.id]!, k = kill[b.id]!;
    let changed = done[b.id] === 0;
    for (let w = 0; w < W; w++) {
      // `>>> 0`: a bitwise result is signed, the array's element is not; bit 31 never compared
      // equal, and the worklist never ended.
      const v = ((inn[w]! & ~k[w]!) | g[w]!) >>> 0;
      if (v !== out[w]) {
        out[w] = v;
        changed = true;
      }
    }
    done[b.id] = 1;
    if (!changed) continue;
    for (const succ of b.out) {
      const si = ins[succ.id]!;
      let grew = reached[succ.id] === 0;
      reached[succ.id] = 1;
      for (let w = 0; w < W; w++) {
        const v = (si[w]! | out[w]!) >>> 0;
        if (v !== si[w]) {
          si[w] = v;
          grew = true;
        }
      }
      if (grew && queued[succ.id] === 0) {
        queued[succ.id] = 1;
        work.push(succ);
      }
    }
  }

  return { cfg, defs, ofLocal, masks, idOf, ins, reached, W, followed };
}
