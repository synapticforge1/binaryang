// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module wabt-ts/ir/made-up-names
 *
 * Names a READER makes up, and the one question every writer asks of a name —
 * is it real? Owner decision 4 (cmem/names.md): in the one module every entity
 * is named — by its `name` section where it gave one, made up where it did not
 * — and {@link ExplicitNames} records which are real. Only real names are
 * written, to a name section or to text.
 *
 * Shared by both readers (M7c3b b1b): binaryen-ts's decoder made these names up
 * first (`$func3`, `mem0`, …); wabt-ts's reader now makes up the same ones,
 * from this one scheme rather than a copy of it.
 */

import { ExternalKind } from '../core/binary.ts';
import { Result } from '../core/result.ts';
import { ExprVisitor, type ExprVisitorDelegate } from './expr-visitor.ts';
import type { ExplicitNames, Func, Module } from './ir.ts';

/** The made-up name of entity `i` in each namespace — binaryen-ts's decoder's, since N1 P4. */
export const MADE_UP = {
  func: (i: number) => `$func${i}`,
  table: (i: number) => `$table${i}`,
  // No `$`: the name binaryen-ts's decoder always gave a memory. It is never
  // written — only real names are — so its spelling is the decoder's history.
  memory: (i: number) => `mem${i}`,
  global: (i: number) => `$global${i}`,
  tag: (i: number) => `$tag${i}`,
  elem: (i: number) => `$elem${i}`,
  data: (i: number) => `$data${i}`,
  type: (i: number) => `$type${i}`,
  field: (i: number) => `$field${i}`,
  /** Label `i` of function `funcIdx` — per function, so a label never collides across two. */
  label: (funcIdx: number, i: number) => `$l${funcIdx}_${i}`,
} as const;

/** `name`, or `name.1`, `name.2`, … — the first not in `used`; recorded there. */
export function unique(used: Set<string>, name: string): string {
  let u = name;
  for (let n = 1; used.has(u); n++) u = `${name}.${n}`;
  used.add(u);
  return u;
}

/**
 * Whether `name` is REAL in a module whose record is `record`: listed in
 * `set` — or, with no record, simply non-empty, since nothing was made up.
 * `''` is never real.
 */
export function isRealName(
  record: ExplicitNames | undefined,
  set: ReadonlySet<string> | undefined,
  name: string,
): boolean {
  if (name === '') return false;
  return record === undefined || set?.has(name) === true;
}

/**
 * Give every UNNAMED item in one namespace a made-up name, clear of every name
 * the namespace already holds. Returns nothing: the items are named in place.
 */
export function makeUpNames(
  items: readonly { name: string }[],
  scheme: (i: number) => string,
): void {
  const used = new Set(items.map((it) => it.name).filter((n) => n !== ''));
  items.forEach((it, i) => {
    if (it.name === '') it.name = unique(used, scheme(i));
  });
}

/** Collects the non-empty labels of one function's carriers. */
class LabelCollector implements ExprVisitorDelegate {
  readonly found = new Set<string>();
  private take(e: { label: string }): Result {
    if (e.label !== '') this.found.add(e.label);
    return Result.Ok;
  }
  beginBlockExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginLoopExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginIfExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginTryExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginTryTableExpr(e: { label: string }): Result {
    return this.take(e);
  }
}

/**
 * Names every UNNAMED carrier of one function with a made-up label, clear of
 * the labels it already has (M7c3c). Labels may repeat in a function — a
 * nested `$b` shadows an outer one — so only a made-up label is kept unique.
 */
class LabelMaker implements ExprVisitorDelegate {
  private count = 0;
  constructor(private readonly funcIdx: number, private readonly used: Set<string>) {}
  private take(e: { label: string }): Result {
    if (e.label === '') e.label = unique(this.used, MADE_UP.label(this.funcIdx, this.count));
    this.count++;
    return Result.Ok;
  }
  beginBlockExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginLoopExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginIfExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginTryExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginTryTableExpr(e: { label: string }): Result {
    return this.take(e);
  }
}

/** Clears every label of one function that `keep` does not accept. */
class LabelClearer implements ExprVisitorDelegate {
  constructor(private readonly keep: (label: string) => boolean) {}
  private take(e: { label: string }): Result {
    if (!this.keep(e.label)) e.label = '';
    return Result.Ok;
  }
  beginBlockExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginLoopExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginIfExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginTryExpr(e: { label: string }): Result {
    return this.take(e);
  }
  beginTryTableExpr(e: { label: string }): Result {
    return this.take(e);
  }
}

/** The non-empty labels of one function. */
function labelsOf(f: Func): Set<string> {
  const c = new LabelCollector();
  new ExprVisitor(c).visitFunc(f);
  return c.found;
}

/** One index space, imports first — as the binary numbers it. */
function space<K extends ExternalKind>(
  m: Module,
  kind: K,
  pick: (imp: Extract<Module['imports'][number], { kind: K }>) => { name: string },
  defined: readonly { name: string }[],
): { name: string }[] {
  const out: { name: string }[] = [];
  for (const imp of m.imports) {
    if (imp.kind === kind) out.push(pick(imp as Extract<Module['imports'][number], { kind: K }>));
  }
  out.push(...defined);
  return out;
}

/**
 * What a READER does once the name section has been applied (M7c3b b1b): the
 * names it holds now are the REAL ones — recorded in `m.explicitNames` — and
 * every entity without one is given a made-up name, never written.
 *
 * `localsListed` is the local subsection's shape by function INDEX (`null`:
 * the section had none); the record keys it by NAME, once every function has
 * one, so a pass that removes a function cannot shift an entry onto another.
 * Locals are not made up — a reference to one is an index; labels are (M7c3c).
 */
export function nameEveryEntity(m: Module, localsListed: ReadonlySet<number> | null): void {
  const funcs = space(m, ExternalKind.Func, (i) => i.func, m.functions) as Func[];
  const tables = space(m, ExternalKind.Table, (i) => i.table, m.tables);
  const memories = space(m, ExternalKind.Memory, (i) => i.memory, m.memories);
  const globals = space(m, ExternalKind.Global, (i) => i.global, m.globals);
  const tags = space(m, ExternalKind.Tag, (i) => i.tag, m.tags);
  const real = (items: readonly { name: string }[]) =>
    new Set(items.map((it) => it.name).filter((n) => n !== ''));
  const fieldsOf = (t: Module['types'][number]): { name: string }[] =>
    t.kind === 'struct' ? t.fields : t.kind === 'array' ? [t.field] : [];

  // The real names — BEFORE anything is made up.
  const record = {
    functions: real(funcs),
    tables: real(tables),
    memories: real(memories),
    globals: real(globals),
    tags: real(tags),
    elements: real(m.elements),
    dataSegments: real(m.dataSegments),
    types: real(m.types),
  };
  const realFields = m.types.map((t) => real(fieldsOf(t)));
  const realLabels = m.functions.map(labelsOf);

  makeUpNames(funcs, MADE_UP.func);
  makeUpNames(tables, MADE_UP.table);
  makeUpNames(memories, MADE_UP.memory);
  makeUpNames(globals, MADE_UP.global);
  makeUpNames(tags, MADE_UP.tag);
  makeUpNames(m.elements, MADE_UP.elem);
  makeUpNames(m.dataSegments, MADE_UP.data);
  makeUpNames(m.types, MADE_UP.type);
  for (const t of m.types) makeUpNames(fieldsOf(t), MADE_UP.field);
  // Labels too (M7c3c) — numbered per function by the binary's label order.
  const importedFuncs = funcs.length - m.functions.length;
  m.functions.forEach((f, i) => {
    new ExprVisitor(new LabelMaker(importedFuncs + i, new Set(realLabels[i]!))).visitFunc(f);
  });

  // Keyed by the FINAL names: a type or function the section did not name is
  // known here by its made-up one.
  const fields = new Map<string, ReadonlySet<string>>();
  m.types.forEach((t, i) => {
    if (realFields[i]!.size > 0) fields.set(t.name, realFields[i]!);
  });
  const labels = new Map<string, ReadonlySet<string>>();
  m.functions.forEach((f, i) => {
    if (realLabels[i]!.size > 0) labels.set(f.name, realLabels[i]!);
  });
  m.explicitNames = {
    ...record,
    fields,
    labels,
    localsListed: localsListed === null
      ? null
      : new Set([...localsListed].flatMap((i) => funcs[i] === undefined ? [] : [funcs[i]!.name])),
  };
}

/** Every flat namespace's items, with the record set that says which names in it are real. */
function flatSpaces(m: Module): [items: { name: string }[], set: keyof ExplicitNames][] {
  return [
    [space(m, ExternalKind.Func, (i) => i.func, m.functions), 'functions'],
    [space(m, ExternalKind.Table, (i) => i.table, m.tables), 'tables'],
    [space(m, ExternalKind.Memory, (i) => i.memory, m.memories), 'memories'],
    [space(m, ExternalKind.Global, (i) => i.global, m.globals), 'globals'],
    [space(m, ExternalKind.Tag, (i) => i.tag, m.tags), 'tags'],
    [m.elements, 'elements'],
    [m.dataSegments, 'dataSegments'],
    [m.types, 'types'],
  ];
}

/**
 * Before `generateNames` (upstream's `--generate-names`): a made-up name is NOT
 * a name, so it must not stop one being generated — clear every name the
 * record does not list. Reader references are indices, so nothing refers to a
 * cleared name. Returns the local listing by function INDEX, since the names
 * it is keyed by are about to change (see {@link recordEveryNameReal}).
 */
export function forgetMadeUpNames(m: Module): ReadonlySet<number> | null | undefined {
  const r = m.explicitNames;
  if (r === undefined) return undefined;
  const funcs = flatSpaces(m)[0]![0];
  const listed = r.localsListed === null
    ? null
    : new Set(funcs.flatMap((f, i) => (r.localsListed!.has(f.name) ? [i] : [])));
  // Labels and fields FIRST: the record keys them by their function's / type's
  // NAME, and a made-up one of those is about to be cleared.
  for (const f of m.functions) {
    const real = r.labels.get(f.name);
    new ExprVisitor(new LabelClearer((l) => isRealName(r, real, l))).visitFunc(f);
  }
  // Fields likewise: keyed by their TYPE's name.
  for (const t of m.types) {
    const real = r.fields.get(t.name);
    const fields = t.kind === 'struct' ? t.fields : t.kind === 'array' ? [t.field] : [];
    for (const f of fields) if (!isRealName(r, real, f.name)) f.name = '';
  }
  for (const [items, set] of flatSpaces(m)) {
    for (const it of items) {
      if (!isRealName(r, r[set] as ReadonlySet<string>, it.name)) it.name = '';
    }
  }
  return listed;
}

/**
 * After `generateNames`: every name the module holds is now one the output
 * should show, so the record lists them all. `listed` is what
 * {@link forgetMadeUpNames} returned; `undefined` leaves the module with no
 * record, as it came.
 */
export function recordEveryNameReal(
  m: Module,
  listed: ReadonlySet<number> | null | undefined,
): void {
  if (listed === undefined) return;
  const r = m.explicitNames!;
  const all = (items: readonly { name: string }[]) =>
    new Set(items.map((it) => it.name).filter((n) => n !== ''));
  const spaces = flatSpaces(m);
  const funcs = spaces[0]![0];
  const fields = new Map<string, ReadonlySet<string>>();
  for (const t of m.types) {
    const fs = t.kind === 'struct' ? t.fields : t.kind === 'array' ? [t.field] : [];
    const set = all(fs);
    if (set.size > 0) fields.set(t.name, set);
  }
  m.explicitNames = {
    ...r,
    ...Object.fromEntries(spaces.map(([items, set]) => [set, all(items)])),
    fields,
    labels: new Map(m.functions.flatMap((f) => {
      const set = labelsOf(f);
      return set.size > 0 ? [[f.name, set] as const] : [];
    })),
    localsListed: listed === null
      ? null
      : new Set([...listed].flatMap((i) => funcs[i] === undefined ? [] : [funcs[i]!.name])),
  };
}
