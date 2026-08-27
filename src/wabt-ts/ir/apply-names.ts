// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/apply-names.h, src/apply-names.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Apply named entities from the name section back to index-based Var
 * references in the IR.
 *
 * After the binary reader builds an index-based IR and the name-section
 * reader populates names on Func/Local/Global/etc, `applyNames` replaces
 * `{ kind: 'index' }` refs with `{ kind: 'name' }` refs where a name is
 * available, so WAT pretty-printing can emit `$foo` identifiers.
 *
 * NOTE: the expression-level rewriter (`rewriteExprVars`) currently handles
 * only the common name-bearing nodes (call/global/etc.) and its `default`
 * does not recurse into every composite node, so a name-bearing var nested
 * under an unhandled node stays index-form. This is a fidelity gap only
 * (output stays valid — unconverted refs print as numeric indices), and
 * `applyNames` is not wired into any tool pipeline (`wasm2wat` uses
 * `generateNames`). Folding it onto `ExprVisitor` (as upstream does) to walk
 * every child is a tracked follow-up.
 */

import { Result } from '../core/result.ts';
import { ExternalKind } from '../core/binary.ts';
import type { Expr, Func, Module, Var } from './ir.ts';
import { varIndex, varName } from './ir.ts';

// ---------------------------------------------------------------------------
// Name maps — populated by the name-section reader
// ---------------------------------------------------------------------------

/** A map from index → human-readable name. */
export type NameMap = Map<number, string>;

/** All name maps for a module (name section output). */
export interface ModuleNames {
  moduleName?: string;
  funcNames: NameMap;
  localNames: Map<number, NameMap>; // funcIdx → (localIdx → name)
  labelNames: Map<number, NameMap>; // funcIdx → (labelIdx → name)
  typeNames: NameMap;
  tableNames: NameMap;
  memoryNames: NameMap;
  globalNames: NameMap;
  elemSegmentNames: NameMap;
  dataSegmentNames: NameMap;
  fieldNames: Map<number, NameMap>; // typeIdx → (fieldIdx → name)
  tagNames: NameMap;
}

/** Construct an empty {@link ModuleNames} with all name maps initialized. */
export function makeModuleNames(): ModuleNames {
  return {
    funcNames: new Map(),
    localNames: new Map(),
    labelNames: new Map(),
    typeNames: new Map(),
    tableNames: new Map(),
    memoryNames: new Map(),
    globalNames: new Map(),
    elemSegmentNames: new Map(),
    dataSegmentNames: new Map(),
    fieldNames: new Map(),
    tagNames: new Map(),
  };
}

// ---------------------------------------------------------------------------
// applyNames — walk the IR and replace index Vars with named Vars
// ---------------------------------------------------------------------------

/**
 * Applies {@link names} to every Var in {@link module}.
 *
 * Modifies the module in place by rewriting names on functions, globals,
 * tables, memories, tags, and all expression nodes.
 */
export function applyNames(module: Module, names: ModuleNames): Result {
  if (names.moduleName !== undefined) module.name = names.moduleName;

  // Walk imports once and apply names to each kind using running indices
  let funcIdx = 0, globalIdx = 0, tableIdx = 0, memIdx = 0, tagIdx = 0;
  for (const imp of module.imports) {
    switch (imp.kind) {
      case ExternalKind.Func: {
        const n = names.funcNames.get(funcIdx);
        if (n) imp.func.name = n;
        funcIdx++;
        break;
      }
      case ExternalKind.Global: {
        const n = names.globalNames.get(globalIdx);
        if (n) imp.global.name = n;
        globalIdx++;
        break;
      }
      case ExternalKind.Table: {
        const n = names.tableNames.get(tableIdx);
        if (n) imp.table.name = n;
        tableIdx++;
        break;
      }
      case ExternalKind.Memory: {
        const n = names.memoryNames.get(memIdx);
        if (n) imp.memory.name = n;
        memIdx++;
        break;
      }
      case ExternalKind.Tag: {
        const n = names.tagNames.get(tagIdx);
        if (n) imp.tag.name = n;
        tagIdx++;
        break;
      }
    }
  }

  // Defined funcs
  for (const [i, func] of module.funcs.entries()) {
    const n = names.funcNames.get(module.numFuncImports + i);
    if (n) func.name = n;
  }

  // Defined globals
  for (const [i, global] of module.globals.entries()) {
    const n = names.globalNames.get(module.numGlobalImports + i);
    if (n) global.name = n;
  }

  // Defined tables
  for (const [i, table] of module.tables.entries()) {
    const n = names.tableNames.get(module.numTableImports + i);
    if (n) table.name = n;
  }

  // Defined memories
  for (const [i, memory] of module.memories.entries()) {
    const n = names.memoryNames.get(module.numMemoryImports + i);
    if (n) memory.name = n;
  }

  // Defined tags
  for (const [i, tag] of module.tags.entries()) {
    const n = names.tagNames.get(module.numTagImports + i);
    if (n) tag.name = n;
  }

  // Types
  for (const [i, type] of module.types.entries()) {
    const n = names.typeNames.get(i);
    if (n) type.name = n;
  }

  // Segments
  for (const [i, seg] of module.elemSegments.entries()) {
    const n = names.elemSegmentNames.get(i);
    if (n) seg.name = n;
  }
  for (const [i, seg] of module.dataSegments.entries()) {
    const n = names.dataSegmentNames.get(i);
    if (n) seg.name = n;
  }

  // Rewrite Var references in expression trees for all functions
  const ctx: ApplyContext = { module, names };

  // Import func bodies (usually empty but included for completeness)
  let applyFuncIdx = 0;
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) {
      rewriteFuncVars(imp.func, applyFuncIdx, ctx);
      applyFuncIdx++;
    }
  }
  for (const [i, func] of module.funcs.entries()) {
    rewriteFuncVars(func, module.numFuncImports + i, ctx);
  }

  // Global init exprs
  for (const global of module.globals) {
    rewriteExprListVars(global.init, ctx);
  }

  // Segment offsets
  for (const seg of module.elemSegments) {
    rewriteExprListVars(seg.offset, ctx);
    for (const elemExpr of seg.elemExprs) rewriteExprListVars(elemExpr, ctx);
  }
  for (const seg of module.dataSegments) {
    rewriteExprListVars(seg.offset, ctx);
  }

  return Result.Ok;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ApplyContext {
  module: Module;
  names: ModuleNames;
}

function lookupName(map: NameMap, idx: number): Var {
  const n = map.get(idx);
  return n !== undefined ? varName(n) : varIndex(idx);
}

function rewriteFuncVars(func: Func, _funcIdx: number, ctx: ApplyContext): void {
  rewriteExprListVars(func.body, ctx);
}

function rewriteExprListVars(exprs: Expr[], ctx: ApplyContext): void {
  for (let i = 0; i < exprs.length; i++) {
    const e = exprs[i];
    if (e !== undefined) exprs[i] = rewriteExprVars(e, ctx);
  }
}

// INTENT: this pass must be TOTAL over the IR on two axes, exactly like its
// sibling `resolveNames` (which goes the other direction, name -> index):
//
//   1. every `Expr`-typed field is RECURSED into;
//   2. every `Var`-typed field naming a module-level entity is rewritten.
//
// Axis 1 is generic below and therefore cannot miss a kind. Axis 2 is an
// explicit table, because which NAME SPACE a var belongs to is per-kind
// knowledge that cannot be inferred from the field name alone (`segment` is a
// data index on `memory.init` and an elem index on `table.init`), and guessing
// wrong silently renames a reference to a different entity — Bug G's failure
// mode. `tests/ir/apply_names_total.test.ts` gates both axes.
//
// Before T13.20 this was a single hand-written switch covering 37 of 87 kinds;
// the other 50 fell to `default: return e`, so a `global.get` nested inside
// (say) `memory.fill` kept its numeric index while the identical reference at
// statement position was named. The output was silently INCONSISTENT rather
// than wrong, which is why nothing caught it.

/** Is this a `Var` (`{kind:'index'|'name'}`) rather than an `Expr`? */
function isVar(v: unknown): v is Var {
  if (typeof v !== 'object' || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  return k === 'index' || k === 'name';
}

/** Is this an `Expr` node? Every Expr carries a `kind` that is not a Var kind. */
function isExpr(v: unknown): v is Expr {
  if (typeof v !== 'object' || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  return typeof k === 'string' && k !== 'index' && k !== 'name';
}

function hasExprBody(c: unknown): c is { body: Expr[] } {
  return typeof c === 'object' && c !== null && Array.isArray((c as { body?: unknown }).body);
}

/**
 * Axis 1 — recurse into every `Expr`-typed field of `e`, whatever its kind.
 *
 * Generic on purpose: a per-kind list is exactly what let 50 kinds go
 * unwalked. The only structural case needing help is the catch-clause
 * container on `try` / `try_table`, whose bodies sit one level deeper than a
 * plain field.
 */
function rewriteChildren(e: Expr, ctx: ApplyContext): Expr {
  const out: Record<string, unknown> = { ...(e as unknown as Record<string, unknown>) };
  let changed = false;
  for (const [key, value] of Object.entries(out)) {
    if (isVar(value)) continue; // axis 2 owns these, never a child
    if (isExpr(value)) {
      out[key] = rewriteExprVars(value, ctx);
      changed = true;
      continue;
    }
    if (!Array.isArray(value) || value.length === 0) continue;
    if (value.every(isExpr)) {
      out[key] = (value as Expr[]).map((x) => rewriteExprVars(x, ctx));
      changed = true;
      continue;
    }
    if (value.every(hasExprBody)) {
      out[key] = (value as { body: Expr[] }[]).map((c) => ({
        ...c,
        body: c.body.map((x) => rewriteExprVars(x, ctx)),
      }));
      changed = true;
    }
  }
  return changed ? (out as unknown as Expr) : e;
}

/**
 * Axis 2 — rewrite this node's own `Var` immediates through the right name
 * space. A kind absent from this switch has no module-level var to rewrite.
 *
 * LABEL vars (`target`, `defaultTarget`, `depth`, `delegate`) are deliberately
 * NOT rewritten: `ModuleNames.labelNames` is per-function and this pass has no
 * function context, so renaming them here would be a guess. `local.*` vars are
 * left alone for the same reason — and because rewriting a local index through
 * `funcNames` is a bug this pass has already had once.
 */
function rewriteOwnVars(e: Expr, ctx: ApplyContext): Expr {
  const n = ctx.names;
  switch (e.kind) {
    case 'global.get':
    case 'global.set':
      return { ...e, var: rewriteVar(e.var, n.globalNames) };
    case 'call':
    case 'return_call':
    case 'ref.func':
      return { ...e, func: rewriteVar(e.func, n.funcNames) };
    case 'call_indirect':
    case 'return_call_indirect':
      return {
        ...e,
        table: rewriteVar(e.table, n.tableNames),
        typeVar: rewriteVar(e.typeVar, n.typeNames),
      };
    case 'call_ref':
    case 'return_call_ref':
      return { ...e, sigType: rewriteVar(e.sigType, n.typeNames) };
    case 'memory.size':
    case 'memory.grow':
    case 'memory.fill':
    case 'load':
    case 'store':
    case 'load_splat':
    case 'load_zero':
    case 'simd_load_lane':
    case 'simd_store_lane':
    case 'atomic_load':
    case 'atomic_store':
    case 'atomic_rmw':
    case 'atomic_rmw_cmpxchg':
    case 'atomic_wait':
    case 'atomic_notify':
      return { ...e, memidx: rewriteVar(e.memidx, n.memoryNames) };
    case 'memory.copy':
      return {
        ...e,
        destMemidx: rewriteVar(e.destMemidx, n.memoryNames),
        srcMemidx: rewriteVar(e.srcMemidx, n.memoryNames),
      };
    case 'memory.init':
      // `segment` is a DATA index here and an ELEM index on `table.init`.
      return {
        ...e,
        memidx: rewriteVar(e.memidx, n.memoryNames),
        segment: rewriteVar(e.segment, n.dataSegmentNames),
      };
    case 'data.drop':
      return { ...e, segment: rewriteVar(e.segment, n.dataSegmentNames) };
    case 'elem.drop':
      return { ...e, segment: rewriteVar(e.segment, n.elemSegmentNames) };
    case 'table.get':
    case 'table.set':
    case 'table.grow':
    case 'table.size':
    case 'table.fill':
      return { ...e, table: rewriteVar(e.table, n.tableNames) };
    case 'table.copy':
      return {
        ...e,
        dst: rewriteVar(e.dst, n.tableNames),
        src: rewriteVar(e.src, n.tableNames),
      };
    case 'table.init':
      return {
        ...e,
        table: rewriteVar(e.table, n.tableNames),
        segment: rewriteVar(e.segment, n.elemSegmentNames),
      };
    case 'throw':
      return { ...e, tag: rewriteVar(e.tag, n.tagNames) };
    case 'struct.new':
    case 'struct.new_default':
    case 'array.new':
    case 'array.new_default':
    case 'array.new_fixed':
    case 'array.get':
    case 'array.set':
    case 'array.fill':
      return { ...e, typeVar: rewriteVar(e.typeVar, n.typeNames) };
    case 'struct.get':
    case 'struct.set': {
      // A field name lives under its OWN type, so the field map is selected by
      // the type INDEX — before that var is rewritten to a name.
      const typeIdx = e.typeVar.kind === 'index' ? e.typeVar.value : undefined;
      const fieldMap = typeIdx === undefined ? undefined : n.fieldNames.get(typeIdx);
      return {
        ...e,
        typeVar: rewriteVar(e.typeVar, n.typeNames),
        fieldVar: fieldMap ? rewriteVar(e.fieldVar, fieldMap) : e.fieldVar,
      };
    }
    case 'array.new_data':
      return {
        ...e,
        typeVar: rewriteVar(e.typeVar, n.typeNames),
        dataVar: rewriteVar(e.dataVar, n.dataSegmentNames),
      };
    case 'array.new_elem':
      return {
        ...e,
        typeVar: rewriteVar(e.typeVar, n.typeNames),
        elemVar: rewriteVar(e.elemVar, n.elemSegmentNames),
      };
    case 'array.copy':
      return {
        ...e,
        destTypeVar: rewriteVar(e.destTypeVar, n.typeNames),
        srcTypeVar: rewriteVar(e.srcTypeVar, n.typeNames),
      };
    case 'array.init_data':
      return {
        ...e,
        typeVar: rewriteVar(e.typeVar, n.typeNames),
        segment: rewriteVar(e.segment, n.dataSegmentNames),
      };
    case 'array.init_elem':
      return {
        ...e,
        typeVar: rewriteVar(e.typeVar, n.typeNames),
        segment: rewriteVar(e.segment, n.elemSegmentNames),
      };
    case 'ref.null':
      // A heap type is a TYPE index only in its index form; the name form is
      // an abstract keyword (`func` / `any` / …) and rewriteVar leaves it be.
      return { ...e, refType: rewriteVar(e.refType, n.typeNames) };
    case 'ref.test':
    case 'ref.cast':
      return { ...e, heapType: rewriteVar(e.heapType, n.typeNames) };
    case 'br_on_cast':
      return {
        ...e,
        from: { ...e.from, heapType: rewriteVar(e.from.heapType, n.typeNames) },
        to: { ...e.to, heapType: rewriteVar(e.to.heapType, n.typeNames) },
      };
    default:
      // INTENT: reached only by nodes with no module-level Var immediate.
      // Children are still walked — `rewriteExprVars` applies axis 1 to every
      // node regardless of whether it appears in this switch.
      return e;
  }
}

function rewriteExprVars(e: Expr, ctx: ApplyContext): Expr {
  return rewriteChildren(rewriteOwnVars(e, ctx), ctx);
}

function rewriteVar(v: Var, names: NameMap): Var {
  if (v.kind !== 'index') return v;
  return lookupName(names, v.value);
}
