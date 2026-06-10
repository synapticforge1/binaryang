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

function rewriteExprVars(e: Expr, ctx: ApplyContext): Expr {
  const { names } = ctx;
  switch (e.kind) {
    case 'local.get':
      // Locals are NOT in the function-name space. The previous code rewrote
      // the local index through `funcNames`, so a local index that collided
      // with a named function index was silently renamed to that function.
      // Local names would require a per-function local-name map (not currently
      // populated by the name-section reader), so leave the index as-is —
      // consistent with local.set / local.tee, which don't rewrite their var.
      return e;
    case 'local.set':
      return { ...e, value: rewriteExprVars(e.value, ctx) };
    case 'local.tee':
      return { ...e, value: rewriteExprVars(e.value, ctx) };
    case 'global.get':
      return { ...e, var: rewriteVar(e.var, names.globalNames) };
    case 'global.set':
      return {
        ...e,
        var: rewriteVar(e.var, names.globalNames),
        value: rewriteExprVars(e.value, ctx),
      };
    case 'call':
      return {
        ...e,
        func: rewriteVar(e.func, names.funcNames),
        args: e.args.map((a) => rewriteExprVars(a, ctx)),
      };
    case 'return_call':
      return {
        ...e,
        func: rewriteVar(e.func, names.funcNames),
        args: e.args.map((a) => rewriteExprVars(a, ctx)),
      };
    case 'call_indirect':
    case 'return_call_indirect':
      return {
        ...e,
        table: rewriteVar(e.table, names.tableNames),
        // typeVar is name-bearing too (mirror of the resolveNames Bug-G fix);
        // without this a named type prints as a numeric index in wasm2wat.
        typeVar: rewriteVar(e.typeVar, names.typeNames),
        args: e.args.map((a) => rewriteExprVars(a, ctx)),
        callee: rewriteExprVars(e.callee, ctx),
      };
    case 'ref.func':
      return { ...e, func: rewriteVar(e.func, names.funcNames) };
    case 'memory.size':
      return { ...e, memidx: rewriteVar(e.memidx, names.memoryNames) };
    case 'memory.grow':
      return {
        ...e,
        memidx: rewriteVar(e.memidx, names.memoryNames),
        delta: rewriteExprVars(e.delta, ctx),
      };
    case 'load':
    case 'atomic_load':
    case 'load_splat':
    case 'load_zero':
      return {
        ...e,
        memidx: rewriteVar(e.memidx, names.memoryNames),
        address: rewriteExprVars(e.address, ctx),
      };
    case 'store':
    case 'atomic_store':
    case 'atomic_rmw':
      return {
        ...e,
        memidx: rewriteVar(e.memidx, names.memoryNames),
        address: rewriteExprVars(e.address, ctx),
        value: rewriteExprVars(e.value, ctx),
      };
    case 'throw':
      return {
        ...e,
        tag: rewriteVar(e.tag, names.tagNames),
        args: e.args.map((a) => rewriteExprVars(a, ctx)),
      };
    case 'data.drop':
      return { ...e, segment: rewriteVar(e.segment, names.dataSegmentNames) };
    case 'elem.drop':
      return { ...e, segment: rewriteVar(e.segment, names.elemSegmentNames) };
    case 'table.get':
      return {
        ...e,
        table: rewriteVar(e.table, names.tableNames),
        index: rewriteExprVars(e.index, ctx),
      };
    case 'table.set':
      return {
        ...e,
        table: rewriteVar(e.table, names.tableNames),
        index: rewriteExprVars(e.index, ctx),
        value: rewriteExprVars(e.value, ctx),
      };
    case 'table.size':
      return { ...e, table: rewriteVar(e.table, names.tableNames) };
    case 'table.grow':
      return {
        ...e,
        table: rewriteVar(e.table, names.tableNames),
        initValue: rewriteExprVars(e.initValue, ctx),
        delta: rewriteExprVars(e.delta, ctx),
      };
    case 'table.fill':
      return {
        ...e,
        table: rewriteVar(e.table, names.tableNames),
        start: rewriteExprVars(e.start, ctx),
        value: rewriteExprVars(e.value, ctx),
        size: rewriteExprVars(e.size, ctx),
      };
    case 'block':
    case 'loop':
      return { ...e, body: e.body.map((c) => rewriteExprVars(c, ctx)) };
    case 'if':
      return {
        ...e,
        cond: rewriteExprVars(e.cond, ctx),
        then_: e.then_.map((c) => rewriteExprVars(c, ctx)),
        else_: e.else_.map((c) => rewriteExprVars(c, ctx)),
      };
    case 'return':
      return e.values.length === 0
        ? e
        : { ...e, values: e.values.map((v) => rewriteExprVars(v, ctx)) };
    case 'drop':
      return { ...e, value: rewriteExprVars(e.value, ctx) };
    case 'select':
      return {
        ...e,
        val1: rewriteExprVars(e.val1, ctx),
        val2: rewriteExprVars(e.val2, ctx),
        cond: rewriteExprVars(e.cond, ctx),
      };
    case 'unary':
      return { ...e, operand: rewriteExprVars(e.operand, ctx) };
    case 'binary':
      return { ...e, left: rewriteExprVars(e.left, ctx), right: rewriteExprVars(e.right, ctx) };
    case 'compare':
      return { ...e, left: rewriteExprVars(e.left, ctx), right: rewriteExprVars(e.right, ctx) };
    case 'convert':
      return { ...e, operand: rewriteExprVars(e.operand, ctx) };
    default:
      return e;
  }
}

function rewriteVar(v: Var, names: NameMap): Var {
  if (v.kind !== 'index') return v;
  return lookupName(names, v.value);
}
