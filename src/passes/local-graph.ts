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
 */
export function localGraph(fn: WasmFunction): {
  reaching: Map<Expression, Set<Def>>;
  readers: Map<Expression, Set<Expression>>;
} {
  const cfg = buildCFG(fn.body, fn.bodyFrameLabel);
  type State = Map<number, Set<Def>>;
  const nLocals = fn.locals.length;
  const entryState = (): State => {
    const s: State = new Map();
    for (let i = 0; i < nLocals; i++) s.set(i, new Set<Def>([ENTRY]));
    return s;
  };
  const copy = (s: State): State => new Map([...s].map(([k, v]) => [k, new Set(v)]));
  const transfer = (b: (typeof cfg.blocks)[number], s: State): State => {
    const out = copy(s);
    for (const a of b.actions) if (a.kind === 'set') out.set(a.index, new Set<Def>([a.origin]));
    return out;
  };
  const ins = new Map<number, State>();
  const outs = new Map<number, State>();
  ins.set(cfg.entry.id, entryState());
  const work = [cfg.entry];
  const queued = new Set([cfg.entry.id]);
  while (work.length > 0) {
    const b = work.shift()!;
    queued.delete(b.id);
    const out = transfer(b, ins.get(b.id)!);
    const prev = outs.get(b.id);
    const same = prev !== undefined && [...out].every(([k, v]) => {
      const p = prev.get(k);
      return p !== undefined && p.size === v.size && [...v].every((d) => p.has(d));
    });
    if (same) continue;
    outs.set(b.id, out);
    for (const succ of b.out) {
      const cur = ins.get(succ.id) ?? new Map<number, Set<Def>>();
      for (const [k, v] of out) {
        const set = cur.get(k) ?? new Set<Def>();
        for (const d of v) set.add(d);
        cur.set(k, set);
      }
      ins.set(succ.id, cur);
      if (!queued.has(succ.id)) {
        queued.add(succ.id);
        work.push(succ);
      }
    }
  }
  const reaching = new Map<Expression, Set<Def>>();
  const readers = new Map<Expression, Set<Expression>>();
  for (const b of cfg.blocks) {
    const state = ins.get(b.id);
    if (state === undefined) continue; // no path reaches it
    const s = copy(state);
    for (const a of b.actions) {
      if (a.kind === 'set') {
        s.set(a.index, new Set<Def>([a.origin]));
        if (!readers.has(a.origin)) readers.set(a.origin, new Set());
        continue;
      }
      const defs = new Set(s.get(a.index) ?? []);
      reaching.set(a.origin, defs);
      for (const d of defs) {
        if (d === ENTRY) continue;
        const r = readers.get(d) ?? new Set<Expression>();
        r.add(a.origin);
        readers.set(d, r);
      }
    }
  }
  return { reaching, readers };
}
