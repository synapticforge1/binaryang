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
import type { Module, Func, Expr } from './ir.ts';

// ---------------------------------------------------------------------------
// NameOpts
// ---------------------------------------------------------------------------

export enum NameOpts {
  None       = 0,
  AlphaNames = 1 << 0,
}

// ---------------------------------------------------------------------------
// generateNames — entry point
// ---------------------------------------------------------------------------

export function generateNames(module: Module, opts: NameOpts = NameOpts.None): Result {
  const namer = new NameGenerator(module, opts);
  namer.run();
  return Result.Ok;
}

// ---------------------------------------------------------------------------
// indexToAlphaName — bijective base-26 (matches C++ IndexToAlphaName)
// ---------------------------------------------------------------------------

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

    // Types
    for (const [i, t] of m.types.entries()) {
      if (!t.name) t.name = this.make('t', i);
    }

    // Funcs (imports first, then defined — unified index space)
    let funcIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Func) {
        if (!imp.func.name) imp.func.name = this.make('f', funcIdx);
        funcIdx++;
      }
    }
    for (const [i, func] of m.funcs.entries()) {
      if (!func.name) func.name = this.make('f', m.numFuncImports + i);
    }

    // Globals
    let globalIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Global) {
        if (!imp.global.name) imp.global.name = this.make('g', globalIdx);
        globalIdx++;
      }
    }
    for (const [i, g] of m.globals.entries()) {
      if (!g.name) g.name = this.make('g', m.numGlobalImports + i);
    }

    // Tables
    let tableIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Table) {
        if (!imp.table.name) imp.table.name = this.make('T', tableIdx);
        tableIdx++;
      }
    }
    for (const [i, t] of m.tables.entries()) {
      if (!t.name) t.name = this.make('T', m.numTableImports + i);
    }

    // Memories
    let memIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Memory) {
        if (!imp.memory.name) imp.memory.name = this.make('M', memIdx);
        memIdx++;
      }
    }
    for (const [i, mem] of m.memories.entries()) {
      if (!mem.name) mem.name = this.make('M', m.numMemoryImports + i);
    }

    // Tags
    let tagIdx = 0;
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Tag) {
        if (!imp.tag.name) imp.tag.name = this.make('e', tagIdx);
        tagIdx++;
      }
    }
    for (const [i, tag] of m.tags.entries()) {
      if (!tag.name) tag.name = this.make('e', m.numTagImports + i);
    }

    // Segments
    for (const [i, seg] of m.elemSegments.entries()) {
      if (!seg.name) seg.name = this.make('e', i);
    }
    for (const [i, seg] of m.dataSegments.entries()) {
      if (!seg.name) seg.name = this.make('d', i);
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

  private make(prefix: string, index: number): string {
    if (this.opts & NameOpts.AlphaNames) return indexToAlphaName(index);
    return `${prefix}${index}`;
  }
}
