// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module ir/unshare
 *
 * Give every use of a reused object its own, IN PLACE, before a stage that rewrites in place.
 *
 * A module built through the API may reuse an object — binaryen.js code does `add(x, x)`; a
 * caller may hand two functions one `locals` list, or one `Var` to a type use and a `local.get`.
 * The passes rewrite what they reach, once per path: SimplifyLocals sank a call into a
 * `local.get` used twice, so the call ran twice; RemoveUnusedTypes renumbered a `Var` that was
 * also a local's index, so the function read the wrong local; Flatten pushed every function's new
 * locals into a list they all held (security review round 3, class 1, eighth and ninth retests,
 * 2026-11-15). The passes take a tree; this makes one.
 *
 * IN PLACE, and only where an object is reached a SECOND time: everything reached once keeps its
 * identity, so a caller's handle to a function, a global or the module stays the live one (🔧 a
 * whole-module copy left every binaryen.js handle stale: the ninth retest). Only byte payloads
 * and the fidelity table stay shared ({@link isValue}).
 *
 * A module OWNS its objects: one shared with ANOTHER module is not seen here, and optimizing
 * either changes it for both (as in binaryen, where an expression belongs to one module).
 *
 * Its cost is what `moduleShape` measured and bounded first (twice what the module holds, plus
 * the slack, and data at most `MAX_DATA_DEPTH` deep, so the copy's recursion is shallow), so it
 * runs only after that check.
 *
 * @license MIT
 */

import { FidelityTable } from './fidelity.ts';
import type { Module } from './ir.ts';

/**
 * An object shared as a VALUE: byte payloads (nothing rewrites one in place) and the fidelity
 * table (the module's one, by its class). Nothing is a value by its SHAPE: 🔧 a reference type
 * kept shared as one held a `Var` that RemoveUnusedTypes renumbered in place, and a node given a
 * location's keys was kept shared and rewritten twice (class 1's tenth retest, 2026-11-15).
 */
function isValue(v: object): boolean {
  return ArrayBuffer.isView(v) || v instanceof FidelityTable;
}

/** A copy of `v` for one more use: every object in it new, values shared. */
function freshCopy(v: unknown): unknown {
  if (v === null || typeof v !== 'object' || isValue(v)) return v;
  if (Array.isArray(v)) return v.map(freshCopy);
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, freshCopy(x)]));
  if (v instanceof Set) return new Set([...v].map(freshCopy));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = freshCopy(x);
  return out;
}

/**
 * Make `m` a tree, in place: each object reached again (not a value) is replaced, at that use,
 * by a copy of its own. Without recursion: the module's own shape, not the stack, bounds it.
 */
export function unshareInPlace(m: Module): void {
  const seen = new Set<object>([m]);
  const stack: object[] = [m];
  const take = (c: unknown, put: (fresh: unknown) => void): void => {
    if (c === null || typeof c !== 'object') return;
    if (!seen.has(c)) {
      seen.add(c);
      if (!isValue(c)) stack.push(c);
      return;
    }
    if (isValue(c)) return;
    put(freshCopy(c)); // new objects throughout: nothing in it is reached from elsewhere
  };
  while (stack.length > 0) {
    const v = stack.pop()!;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) take(v[i], (x) => (v[i] = x));
    } else if (v instanceof Map) {
      for (const [k, x] of v) take(x, (y) => v.set(k, y));
    } else if (v instanceof Set) {
      for (const x of [...v]) {
        take(x, (y) => {
          v.delete(x);
          v.add(y);
        });
      }
    } else {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) take(o[k], (x) => (o[k] = x));
    }
  }
}
