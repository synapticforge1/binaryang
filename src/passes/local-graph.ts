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
 * feed: upstream's LocalGraph, over {@link buildCFG} (open-work 31). Shared by Local2Stack
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
 * Reaching definitions per `local.get` (the sets, or the entry, whose value it may read) and the
 * readers of each `local.set` / `local.tee`: upstream's LocalGraph, over {@link buildCFG}.
 * Given `locals`, only those are followed: the gets and sets of the others are not in the result
 * (MergeLocals asks about the few locals its copies touch, on functions with hundreds).
 */
export function localGraph(fn: WasmFunction, locals?: ReadonlySet<number>): {
  reaching: Map<Expression, Set<Def>>;
  readers: Map<Expression, Set<Expression>>;
} {
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
  const bit = (bits: Uint32Array, id: number) => (bits[id >>> 5]! >>> (id & 31)) & 1;
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

  const reaching = new Map<Expression, Set<Def>>();
  const readers = new Map<Expression, Set<Expression>>();
  for (const b of cfg.blocks) {
    if (reached[b.id] === 0) continue; // no path reaches it
    const s = ins[b.id]!.slice();
    for (const a of b.actions) {
      if (!followed(a.index)) continue;
      if (a.kind === 'set') {
        const m = masks.get(a.index)!, id = idOf.get(a.origin)!;
        for (let w = 0; w < W; w++) s[w]! &= ~m[w]!;
        s[id >>> 5]! |= 1 << (id & 31);
        if (!readers.has(a.origin)) readers.set(a.origin, new Set());
        continue;
      }
      const set = new Set<Def>();
      for (const id of ofLocal.get(a.index) ?? []) if (bit(s, id) === 1) set.add(defs[id]!);
      reaching.set(a.origin, set);
      for (const d of set) {
        if (d === ENTRY) continue;
        const r = readers.get(d) ?? new Set<Expression>();
        r.add(a.origin);
        readers.set(d, r);
      }
    }
  }
  return { reaching, readers };
}
