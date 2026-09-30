// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/passes/remove-unused-types
 *
 * Removes type-section entries nothing refers to, and renumbers every
 * reference to the ones that stay. Open-work 6 / 2, step 2.
 *
 * Upstream's binary writer emits only the types a module uses (its types are
 * structural, so an unused one has nowhere to live); ours writes the type
 * section as held, so every type an optimization made unused — a function's
 * signature once inlining or dead-code removal took the function — stayed. On
 * the corpus at -Oz that was the ONE section where our encoding was larger than
 * upstream's re-encoding of the same module: +9,973 bytes (2026-09-30).
 *
 * Run only by the optimizer's pipelines: a plain read and write keeps the type
 * section byte for byte, used or not.
 *
 * ## What counts as a use
 *
 * Every place the IR holds a type reference, found by FIELD, over the whole
 * module (functions, imports, globals, tables, tags, elements, …):
 *
 * - a type `Var` in `typeVar`, `srcTypeVar`, `destTypeVar`, `sigType`, and — in
 *   a type entry — `describes`, `descriptor` and `sub.supertypes`;
 * - a heap type (`heapType`, `refType`) that is a type `Var`, or `(exact $t)`;
 * - a numeric `typeIndex` (a multi-value block's type).
 *
 * The set is then CLOSED: a used type's own references (its fields, its
 * signature, its supertypes and descriptors) are uses, and a type in a rec
 * group keeps its whole group — type identity is the group's, and removing a
 * member would make every other member a different type.
 */

import type { WasmModule } from '../ir/module.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { recGroups } from '../../wabt-ts/ir/ir.ts';

const VAR_KEYS = new Set([
  'typeVar',
  'srcTypeVar',
  'destTypeVar',
  'sigType',
  'describes',
  'descriptor',
]);
const HEAP_KEYS = new Set(['heapType', 'refType']);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj =>
  x !== null && typeof x === 'object' && !ArrayBuffer.isView(x);
const isVar = (
  x: unknown,
): x is { kind: 'index'; value: number } | { kind: 'name'; name: string } =>
  isObj(x) && (x.kind === 'index' || x.kind === 'name');

/**
 * Visits every type reference reachable from `root`: `onVar` for a type `Var`
 * (or an exact heap type's `Var`), `onIndex` for a numeric `typeIndex` on
 * `holder`. Each object is visited once, so a shared node is handled once.
 */
function eachTypeRef(
  root: unknown,
  onVar: (v: { kind: 'index'; value: number } | { kind: 'name'; name: string }) => void,
  onIndex: (holder: Obj, index: number) => void,
  skip: ReadonlySet<unknown> = new Set(),
): void {
  const seen = new Set<unknown>();
  const heap = (h: unknown) => {
    if (isVar(h)) onVar(h);
    else if (isObj(h) && h.kind === 'exact' && isVar(h.type)) onVar(h.type);
  };
  const visit = (x: unknown): void => {
    if (!isObj(x) && !Array.isArray(x)) return;
    if (seen.has(x) || skip.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      for (const e of x) visit(e);
      return;
    }
    for (const [k, v] of Object.entries(x)) {
      if (VAR_KEYS.has(k) && isVar(v)) onVar(v);
      else if (HEAP_KEYS.has(k)) heap(v);
      else if (k === 'typeIndex' && typeof v === 'number') onIndex(x, v);
      else if (k === 'supertypes' && Array.isArray(v)) {
        for (const s of v) if (isVar(s)) onVar(s);
      }
      if (typeof v === 'object') visit(v);
    }
  };
  visit(root);
}

export class RemoveUnusedTypesPass implements Pass {
  readonly name = 'RemoveUnusedTypes';
  readonly description =
    'Removes type-section entries nothing refers to and renumbers the references to the rest.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    const types = module.types;
    if (types.length === 0) return;
    const byName = new Map(types.map((t, i) => [t.name, i]));
    const indexOf = (v: { kind: 'index'; value: number } | { kind: 'name'; name: string }) =>
      v.kind === 'index' ? v.value : byName.get(v.name);

    // The rec group of every type, so a use keeps its whole group.
    const groupOf = new Array<{ start: number; count: number }>(types.length);
    for (const g of recGroups(types)) {
      for (let i = g.start; i < g.start + Math.max(g.count, 1); i++) groupOf[i] = g;
    }

    const used = new Set<number>();
    const work: number[] = [];
    const use = (i: number | undefined) => {
      if (i === undefined || i < 0 || i >= types.length) return;
      const g = groupOf[i]!;
      for (let j = g.start; j < g.start + Math.max(g.count, 1); j++) {
        if (!used.has(j)) {
          used.add(j);
          work.push(j);
        }
      }
    };

    // Uses from everything but the type section itself …
    eachTypeRef(module, (v) => use(indexOf(v)), (_, i) => use(i), new Set([types]));
    // … then what the used types refer to, to a fixed point.
    while (work.length > 0) {
      const t = work.pop()!;
      eachTypeRef(types[t], (v) => use(indexOf(v)), (_, i) => use(i));
    }
    if (used.size === types.length) return;

    const remap = new Map<number, number>();
    [...used].sort((a, b) => a - b).forEach((old, now) => remap.set(old, now));

    // Renumber every index reference — the kept entries' own included — then
    // drop the unused entries. A name reference needs nothing: names travel
    // with their entries.
    const renumbered = new Set<object>();
    // The entries going away are not renumbered: their references may name
    // other entries going away.
    const dropped = new Set<unknown>(types.filter((_, i) => !used.has(i)));
    eachTypeRef(
      module,
      (v) => {
        if (v.kind !== 'index' || renumbered.has(v)) return;
        const now = remap.get(v.value);
        if (now === undefined) {
          throw new Error(`RemoveUnusedTypes: a reference to type ${v.value}, which was not kept`);
        }
        renumbered.add(v);
        (v as { value: number }).value = now;
      },
      (holder, i) => {
        if (renumbered.has(holder)) return;
        const now = remap.get(i);
        if (now === undefined) {
          throw new Error(`RemoveUnusedTypes: a block type ${i}, which was not kept`);
        }
        renumbered.add(holder);
        holder.typeIndex = now;
      },
      dropped,
    );
    module.types = types.filter((_, i) => used.has(i));
  }
}

registerPass(RemoveUnusedTypesPass);
