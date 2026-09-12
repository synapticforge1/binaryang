// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Read the `name` custom section, and give its names to the module's
 * definitions. N1 step P3 (cmem/names.md).
 *
 * 🔧 The reader had never read a name. It handed the section to its parser
 * from BEFORE the section's own name, so the string `"name"` was parsed as
 * subsections, and it knew only subsections 0 and 1, defined functions only.
 * This reads all twelve.
 *
 * Two halves, so each can be tested on its own: {@link parseNameSection}
 * decodes the bytes into {@link ModuleNames} and touches nothing;
 * {@link applyNameSection} writes the names onto the module's definitions and
 * reports whether the module now holds EXACTLY what the section said — the
 * reader keeps the raw section when it does not (see `binary-reader.ts`).
 */

import { decodeU32Leb128 } from '../core/leb128.ts';
import { ExternalKind, NameSectionSubsection } from '../core/binary.ts';
import { ExprVisitor } from '../ir/expr-visitor.ts';
import type { ExprVisitorDelegate } from '../ir/expr-visitor.ts';
import { Result } from '../core/result.ts';
import type { Func, Module } from '../ir/ir.ts';
import { makeModuleNames } from '../ir/apply-names.ts';
import type { ModuleNames, NameMap } from '../ir/apply-names.ts';

/** A name section's content, and whether all of it had a place in {@link ModuleNames}. */
export interface ParsedNameSection {
  names: ModuleNames;
  /**
   * False when the section held something `ModuleNames` cannot: a subsection
   * id beyond the twelve, a subsection repeated, or an index named twice in
   * one map. The names that fit are still in {@link names}.
   */
  complete: boolean;
  /**
   * The subsection ids the section actually held, in no order — an EMPTY map in
   * {@link names} cannot say whether its subsection was absent or listed
   * nothing, and the two are different bytes (N6).
   */
  subsections: ReadonlySet<NameSectionSubsection>;
}

/** Names must be valid UTF-8; a decoder that substitutes U+FFFD would change them. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Decode a name section's payload (the bytes AFTER the section's own name).
 * `null` when it is malformed: truncated, a subsection whose contents do not
 * fill exactly its declared size, a bad LEB, or a name that is not UTF-8.
 */
export function parseNameSection(payload: Uint8Array): ParsedNameSection | null {
  const names = makeModuleNames();
  let complete = true;
  let pos = 0;

  const u32 = (): number => {
    const [v, n] = decodeU32Leb128(payload, pos);
    pos += n;
    return v;
  };
  const name = (end: number): string => {
    const len = u32();
    if (pos + len > end) throw new RangeError('name runs past its subsection');
    const s = UTF8.decode(payload.subarray(pos, pos + len));
    pos += len;
    return s;
  };
  const nameMap = (end: number): NameMap => {
    const map: NameMap = new Map();
    for (let n = u32(); n > 0; n--) {
      const index = u32();
      const s = name(end);
      if (map.has(index)) complete = false;
      else map.set(index, s);
    }
    return map;
  };
  const indirectMap = (end: number): Map<number, NameMap> => {
    const outer = new Map<number, NameMap>();
    for (let n = u32(); n > 0; n--) {
      const index = u32();
      const inner = nameMap(end);
      if (outer.has(index)) complete = false;
      else outer.set(index, inner);
    }
    return outer;
  };

  const seen = new Set<number>();
  try {
    while (pos < payload.length) {
      const id = payload[pos++]!;
      const size = u32();
      const end = pos + size;
      if (end > payload.length) return null;
      if (seen.has(id)) complete = false;
      seen.add(id);
      switch (id) {
        case NameSectionSubsection.Module:
          names.moduleName = name(end);
          break;
        case NameSectionSubsection.Function:
          names.funcNames = nameMap(end);
          break;
        case NameSectionSubsection.Local:
          names.localNames = indirectMap(end);
          break;
        case NameSectionSubsection.Label:
          names.labelNames = indirectMap(end);
          break;
        case NameSectionSubsection.Type:
          names.typeNames = nameMap(end);
          break;
        case NameSectionSubsection.Table:
          names.tableNames = nameMap(end);
          break;
        case NameSectionSubsection.Memory:
          names.memoryNames = nameMap(end);
          break;
        case NameSectionSubsection.Global:
          names.globalNames = nameMap(end);
          break;
        case NameSectionSubsection.ElemSegment:
          names.elemSegmentNames = nameMap(end);
          break;
        case NameSectionSubsection.DataSegment:
          names.dataSegmentNames = nameMap(end);
          break;
        case NameSectionSubsection.Field:
          names.fieldNames = indirectMap(end);
          break;
        case NameSectionSubsection.Tag:
          names.tagNames = nameMap(end);
          break;
        default:
          // A subsection from beyond the twelve: skipped, and the section is
          // kept raw so it is not lost.
          complete = false;
          pos = end;
      }
      if (pos !== end) return null;
    }
  } catch {
    return null;
  }
  return { names, complete, subsections: seen };
}

/**
 * `name`, or `name.1`, `name.2`, … — the first not already in `used` — as
 * upstream wabt's reader disambiguates. A duplicate name cannot be written as
 * text (two `$dup` bindings), and the owner does not treat one as a fidelity
 * target (names.md decision 2). Records the result in `used`.
 */
function uniqueName(used: Set<string>, name: string): string {
  let unique = name;
  for (let n = 1; used.has(unique); n++) unique = `${name}.${n}`;
  used.add(unique);
  return unique;
}

/** Counts label-introducing instructions in the order the binary writer writes them. */
class LabelNamer implements ExprVisitorDelegate {
  count = 0;
  private readonly names: NameMap;
  constructor(names: NameMap) {
    this.names = names;
  }
  private next(e: { label: string }): Result {
    const name = this.names.get(this.count++);
    if (name !== undefined && name !== '') (e as { label: string }).label = '$' + name;
    return Result.Ok;
  }
  beginBlockExpr(e: { label: string }): Result {
    return this.next(e);
  }
  beginLoopExpr(e: { label: string }): Result {
    return this.next(e);
  }
  beginIfExpr(e: { label: string }): Result {
    return this.next(e);
  }
  beginTryExpr(e: { label: string }): Result {
    return this.next(e);
  }
  beginTryTableExpr(e: { label: string }): Result {
    return this.next(e);
  }
}

/**
 * Give the section's names to the module's definitions, `$`-prefixed like
 * every name in the IR. Returns whether the module now holds EXACTLY what the
 * section said — false when a name had nowhere to go (an index past the end of
 * its space, a label in an imported function), was empty (the IR cannot tell
 * an empty name from none), or had to be disambiguated.
 *
 * A LABEL's index counts every label-introducing instruction in its function,
 * in binary order — the same {@link ExprVisitor} walk the binary writer uses
 * to number them, so the two cannot disagree.
 */
export function applyNameSection(m: Module, names: ModuleNames): boolean {
  let exact = true;

  const funcs: Func[] = [];
  const tables: { name: string }[] = [];
  const memories: { name: string }[] = [];
  const globals: { name: string }[] = [];
  const tags: { name: string }[] = [];
  for (const imp of m.imports) {
    if (imp.kind === ExternalKind.Func) funcs.push(imp.func);
    else if (imp.kind === ExternalKind.Table) tables.push(imp.table);
    else if (imp.kind === ExternalKind.Memory) memories.push(imp.memory);
    else if (imp.kind === ExternalKind.Global) globals.push(imp.global);
    else if (imp.kind === ExternalKind.Tag) tags.push(imp.tag);
  }
  funcs.push(...m.funcs);
  tables.push(...m.tables);
  memories.push(...m.memories);
  globals.push(...m.globals);
  tags.push(...m.tags);

  /** Name `items` from `map`, unique among themselves. */
  const give = (items: readonly { name: string }[], map: NameMap): void => {
    const used = new Set<string>();
    for (const [i, n] of map) {
      const item = items[i];
      if (item === undefined || n === '') {
        exact = false;
        continue;
      }
      const unique = uniqueName(used, '$' + n);
      if (unique !== '$' + n) exact = false;
      item.name = unique;
    }
  };

  if (names.moduleName !== undefined) {
    if (names.moduleName === '') exact = false;
    else m.name = '$' + names.moduleName;
  }
  give(funcs, names.funcNames);
  give(m.types, names.typeNames);
  give(tables, names.tableNames);
  give(memories, names.memoryNames);
  give(globals, names.globalNames);
  give(m.elemSegments, names.elemSegmentNames);
  give(m.dataSegments, names.dataSegmentNames);
  give(tags, names.tagNames);

  for (const [fi, map] of names.localNames) {
    const f = funcs[fi];
    if (f === undefined) {
      exact = false;
      continue;
    }
    const count = f.sig.params.length + f.localDecls.reduce((n, d) => n + d.count, 0);
    const slots = Array.from({ length: count }, () => ({ name: '' }));
    give(slots, map);
    const localNames = new Map<number, string>();
    slots.forEach((s, i) => {
      if (s.name !== '') localNames.set(i, s.name);
    });
    if (localNames.size > 0) f.localNames = localNames;
  }

  for (const [ti, map] of names.fieldNames) {
    const t = m.types[ti];
    const fields = t === undefined
      ? []
      : t.kind === 'struct'
      ? t.fields
      : t.kind === 'array'
      ? [t.field]
      : [];
    if (fields.length === 0 && map.size > 0) {
      exact = false;
      continue;
    }
    give(fields, map);
  }

  for (const [fi, map] of names.labelNames) {
    const f = funcs[fi];
    // An imported function has no body, so no labels to name.
    if (f === undefined || fi < funcs.length - m.funcs.length) {
      if (map.size > 0) exact = false;
      continue;
    }
    const namer = new LabelNamer(map);
    new ExprVisitor(namer).visitExprList(f.body);
    for (const [li, n] of map) if (li >= namer.count || n === '') exact = false;
  }

  return exact;
}
