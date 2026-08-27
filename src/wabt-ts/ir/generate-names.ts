// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/generate-names.h, src/generate-names.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Generate synthetic names for unnamed WebAssembly entities.
 *
 * The WAT pretty-printer needs names for all functions, globals, locals, etc.
 * When the module has no name section (or a partial one), `generateNames`
 * fills in generated names so the output is readable.
 *
 * Default scheme: `$f0`, `$f1`, … for functions; `$g0`, `$g1`, … for globals;
 * etc. With {@link NameOpts.AlphaNames}, names use the bijective-base-26
 * scheme from the C++ source: `a`, `b`, …, `z`, `aa`, `ba`, …
 */

import { Result } from '../core/result.ts';
import { ExternalKind } from '../core/binary.ts';
import type { Expr, Func, Module } from './ir.ts';

// ---------------------------------------------------------------------------
// NameOpts
// ---------------------------------------------------------------------------

/** Bit flags for {@link generateNames}. */
export enum NameOpts {
  /** Default: synthesize numeric names like `$f0` / `$g0`. */
  None = 0,
  /** Use bijective base-26 names (`a`, `b`, …, `z`, `aa`, `ab`, …) instead of numeric. */
  AlphaNames = 1 << 0,
}

// ---------------------------------------------------------------------------
// generateNames — entry point
// ---------------------------------------------------------------------------

/**
 * Walk a {@link Module} and fill every unnamed entity (func, global, table,
 * memory, tag, local, type, segment) with a synthetic name like `$f0`,
 * `$g0`, `$l0`, … so the WAT writer can emit human-readable text.
 */
export function generateNames(module: Module, opts: NameOpts = NameOpts.None): Result {
  const namer = new NameGenerator(module, opts);
  namer.run();
  return Result.Ok;
}

// ---------------------------------------------------------------------------
// indexToAlphaName — bijective base-26 (matches C++ IndexToAlphaName)
// ---------------------------------------------------------------------------

/**
 * Encode a non-negative integer as a bijective base-26 string (`0 → a`,
 * `25 → z`, `26 → aa`, `27 → ab`, …). Matches upstream wabt's
 * `IndexToAlphaName`.
 */
export function indexToAlphaName(index: number): string {
  let s = '';
  do {
    s += String.fromCharCode(97 + (index % 26));
    index = Math.floor(index / 26);
  } while (index-- > 0);
  return s;
}

// ---------------------------------------------------------------------------
// NameGenerator
// ---------------------------------------------------------------------------

class NameGenerator {
  private readonly module: Module;
  private readonly opts: NameOpts;

  constructor(module: Module, opts: NameOpts) {
    this.module = module;
    this.opts = opts;
  }

  run(): void {
    const m = this.module;

    // Per-namespace sets of names already in use, so a synthetic name never
    // collides with a user-supplied one (e.g. user named func 1 `$f0` while
    // func 0 is unnamed — both would otherwise become `$f0`, a duplicate
    // binding / invalid WAT). Each WAT namespace is independent.
    const used = {
      type: new Set<string>(),
      func: new Set<string>(),
      global: new Set<string>(),
      table: new Set<string>(),
      memory: new Set<string>(),
      tag: new Set<string>(),
      elem: new Set<string>(),
      data: new Set<string>(),
    };
    const seed = (set: Set<string>, name: string | undefined) => {
      if (name) set.add(name);
    };
    for (const t of m.types) seed(used.type, t.name);
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Func) seed(used.func, imp.func.name);
      else if (imp.kind === ExternalKind.Global) seed(used.global, imp.global.name);
      else if (imp.kind === ExternalKind.Table) seed(used.table, imp.table.name);
      else if (imp.kind === ExternalKind.Memory) seed(used.memory, imp.memory.name);
      else if (imp.kind === ExternalKind.Tag) seed(used.tag, imp.tag.name);
    }
    for (const f of m.funcs) seed(used.func, f.name);
    for (const g of m.globals) seed(used.global, g.name);
    for (const t of m.tables) seed(used.table, t.name);
    for (const mem of m.memories) seed(used.memory, mem.name);
    for (const tag of m.tags) seed(used.tag, tag.name);
    for (const seg of m.elemSegments) seed(used.elem, seg.name);
    for (const seg of m.dataSegments) seed(used.data, seg.name);

    // Types
    for (const [i, t] of m.types.entries()) {
      if (!t.name) t.name = this.uniqueName(used.type, 't', i);
    }

    // Funcs (imports first, then defined — unified index space)
    let funcIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Func) {
        if (!imp.func.name) imp.func.name = this.uniqueName(used.func, 'f', funcIdx);
        funcIdx++;
      }
    }
    for (const [i, func] of m.funcs.entries()) {
      if (!func.name) func.name = this.uniqueName(used.func, 'f', m.numFuncImports + i);
    }

    // Globals
    let globalIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Global) {
        if (!imp.global.name) imp.global.name = this.uniqueName(used.global, 'g', globalIdx);
        globalIdx++;
      }
    }
    for (const [i, g] of m.globals.entries()) {
      if (!g.name) g.name = this.uniqueName(used.global, 'g', m.numGlobalImports + i);
    }

    // Tables
    let tableIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Table) {
        if (!imp.table.name) imp.table.name = this.uniqueName(used.table, 'T', tableIdx);
        tableIdx++;
      }
    }
    for (const [i, t] of m.tables.entries()) {
      if (!t.name) t.name = this.uniqueName(used.table, 'T', m.numTableImports + i);
    }

    // Memories
    let memIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Memory) {
        if (!imp.memory.name) imp.memory.name = this.uniqueName(used.memory, 'M', memIdx);
        memIdx++;
      }
    }
    for (const [i, mem] of m.memories.entries()) {
      if (!mem.name) mem.name = this.uniqueName(used.memory, 'M', m.numMemoryImports + i);
    }

    // Tags
    let tagIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Tag) {
        if (!imp.tag.name) imp.tag.name = this.uniqueName(used.tag, 'e', tagIdx);
        tagIdx++;
      }
    }
    for (const [i, tag] of m.tags.entries()) {
      if (!tag.name) tag.name = this.uniqueName(used.tag, 'e', m.numTagImports + i);
    }

    // Segments
    for (const [i, seg] of m.elemSegments.entries()) {
      if (!seg.name) seg.name = this.uniqueName(used.elem, 'e', i);
    }
    for (const [i, seg] of m.dataSegments.entries()) {
      if (!seg.name) seg.name = this.uniqueName(used.data, 'd', i);
    }

    // Labels within function bodies
    const allFuncs: Func[] = [];
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Func) allFuncs.push(imp.func);
    }
    for (const func of m.funcs) allFuncs.push(func);

    for (const func of allFuncs) {
      this.generateLabelNames(func.body, { count: 0 });
    }
  }

  private generateLabelNames(exprs: Expr[], counter: { count: number }): void {
    for (const e of exprs) {
      switch (e.kind) {
        case 'block':
        case 'loop': {
          if (!e.label) (e as { label: string }).label = this.make('B', counter.count++);
          this.generateLabelNames(e.body, counter);
          break;
        }
        case 'if': {
          if (!e.label) (e as { label: string }).label = this.make('B', counter.count++);
          this.generateLabelNames(e.then_, counter);
          this.generateLabelNames(e.else_, counter);
          break;
        }
        case 'try':
        case 'try_table': {
          if (!e.label) (e as { label: string }).label = this.make('B', counter.count++);
          this.generateLabelNames(e.body, counter);
          break;
        }
      }
    }
  }

  /**
   * Generate a synthetic name and disambiguate it against `used` (names already
   * taken in that namespace), appending `_1`, `_2`, … until unique. Records the
   * result in `used`.
   */
  private uniqueName(used: Set<string>, prefix: string, index: number): string {
    const base = this.make(prefix, index);
    let name = base;
    let n = 1;
    while (used.has(name)) name = `${base}_${n++}`;
    used.add(name);
    return name;
  }

  private make(prefix: string, index: number): string {
    // Synthetic names MUST carry the leading `$`: the binary reader and WAT
    // parser store names WITH it, and the WAT writer emits them verbatim
    // ("s must begin with '$'"). Emitting `f0` instead of `$f0` produced
    // invalid WAT that failed to round-trip through wat2wasm. Include the
    // per-namespace `prefix` in alpha mode too, so a func and a global at the
    // same index don't both collapse to `$a`.
    const suffix = this.opts & NameOpts.AlphaNames ? indexToAlphaName(index) : String(index);
    return `$${prefix}${suffix}`;
  }
}
