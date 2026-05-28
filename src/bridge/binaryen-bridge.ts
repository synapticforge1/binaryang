// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Phase 7 — wabt IR → binaryen-ts IR bridge.
 *
 * `bridgeToBinaryen(module)` walks a wabt-ts {@link Module} post-order and
 * builds an equivalent binaryen-ts {@link WasmModule} via the constructor API
 * in `@jrmarcum/binaryen-ts/ir`. The output can then be optimized via
 * binaryen-ts passes or emitted as a wasm binary via
 * `encodeWasm(...)` from `@jrmarcum/binaryen-ts/encoder`.
 *
 * **Scope as of this commit (MVP, expanded as expression families come up):**
 * - Imports: func, global, memory, table (no tag).
 * - Module items: defined memories, globals, functions, exports of funcs +
 *   globals.
 * - Expression kinds inside functions and constant init exprs:
 *   `const` (i32 / i64 / f32 / f64), `local.get`, `binary`. Anything else
 *   throws — extend `bridgeExpr` as needed; the throw points to the missing
 *   case.
 *
 * **Out of scope (will throw):** element segments, exports of tag,
 * multi-memory, GC instructions, start function, custom sections.
 *
 * Direct recursion is the natural shape here: binaryen-ts constructors are
 * bottom-up (leaves passed into composite constructors), and wabt-ts's IR is
 * already a tree with no upward references — so a single recursive walk
 * suffices. An `ExprVisitorDelegate`-driven version would need an operand
 * stack and is strictly more complex with no benefit.
 */

import { ExternalKind } from '../core/binary.ts';
import { Type } from '../core/types.ts';
import { anyOpcodeName, naturalAlignForOpcode } from '../core/opcode.ts';
import { CatchKind } from '../ir/ir.ts';
import type {
  BinaryExpr,
  BlockExpr,
  BlockType,
  BrExpr,
  BrIfExpr,
  BrTableExpr,
  CallExpr,
  CallIndirectExpr,
  CompareExpr,
  Const,
  ConstExpr,
  ConvertExpr,
  DropExpr,
  Export as WabtExport,
  Expr,
  Func as WabtFunc,
  FuncSignature,
  Global as WabtGlobal,
  GlobalGetExpr,
  GlobalSetExpr,
  IfExpr,
  Import as WabtImport,
  LoadExpr,
  LoadSplatExpr,
  LoadZeroExpr,
  LocalGetExpr,
  LocalSetExpr,
  LocalTeeExpr,
  LoopExpr,
  MemoryGrowExpr,
  I31GetExpr,
  MemorySizeExpr,
  Module as WabtModule,
  RefEqExpr,
  RefFuncExpr,
  RefI31Expr,
  RefIsNullExpr,
  RefNullExpr,
  ReturnExpr,
  SelectExpr,
  SimdLaneOpExpr,
  SimdLoadLaneExpr,
  SimdShuffleOpExpr,
  SimdStoreLaneExpr,
  StoreExpr,
  StructGetExpr,
  StructNewDefaultExpr,
  StructNewExpr,
  StructSetExpr,
  Tag as WabtTag,
  ThrowExpr,
  ThrowRefExpr,
  TryTableExpr,
  UnaryExpr,
  Var,
} from '../ir/ir.ts';
import { Opcode } from '../core/opcode.ts';

import {
  BinaryOp,
  makeBinary,
  makeBlock,
  makeBreak,
  makeCall,
  makeCallIndirect,
  makeDrop,
  makeF32Const,
  makeF64Const,
  makeGlobalGet,
  makeGlobalSet,
  makeI32Const,
  makeI64Const,
  makeIf,
  makeLoad,
  makeLocalGet,
  makeLocalSet,
  makeLocalTee,
  makeLoop,
  makeMemoryGrow,
  makeMemorySize,
  makeNop,
  makeI31Get,
  makeRefEq,
  makeRefFunc,
  makeRefI31,
  makeRefIsNull,
  makeRefNull,
  makeReturn,
  makeSelect,
  makeSIMDExtract,
  makeSIMDLoad,
  makeSIMDLoadStoreLane,
  makeSIMDReplace,
  makeSIMDShuffle,
  makeStore,
  makeStructGet,
  makeStructNew,
  makeStructNewDefault,
  makeStructSet,
  makeSwitch,
  makeThrow,
  makeThrowRef,
  makeTryTable,
  makeUnary,
  makeUnreachable,
  makeV128Const,
  ModuleBuilder,
  None,
  SIMDExtractOp,
  SIMDLoadOp,
  SIMDLoadStoreLaneOp,
  SIMDReplaceOp,
  UnaryOp,
  ValType,
} from '@jrmarcum/binaryen-ts/ir';
import type {
  CatchClause,
  Expression,
  Local,
  Type as BType,
  WasmModule,
} from '@jrmarcum/binaryen-ts/ir';

import { wabtTypeToValType } from './type-map.ts';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build a binaryen-ts {@link WasmModule} from a wabt-ts {@link WabtModule}.
 *
 * Pre-conditions:
 * - Names in cross-references (exports, calls, etc.) must already be
 *   resolved or carry valid names; pass the wabt module through
 *   `resolveNames` if it came from a name-bearing source (WAT parser).
 */
export function bridgeToBinaryen(module: WabtModule): WasmModule {
  const b = new ModuleBuilder();
  const ctx = makeRootCtx(module);

  // GC: register every struct/array type with binaryen-ts up-front. The
  // returned heap-type indices may not match wabt's type-section indices
  // (binaryen-ts indices skip `func` entries; wabt's include them). Record
  // the mapping in ctx so struct/array instructions can resolve it.
  for (let i = 0; i < module.types.length; i++) {
    const t = module.types[i]!;
    if (t.kind === 'struct') {
      const heapIdx = b.addHeapType({
        kind: 'struct',
        fields: t.fields.map((f) => ({
          type: wabtFieldTypeToValType(f.type),
          mutable: f.mutable,
        })),
      });
      ctx.heapTypeIdx[i] = heapIdx;
    } else if (t.kind === 'array') {
      const heapIdx = b.addHeapType({
        kind: 'array',
        element: {
          type: wabtFieldTypeToValType(t.field.type),
          mutable: t.field.mutable,
        },
      });
      ctx.heapTypeIdx[i] = heapIdx;
    }
  }

  // Imports: walk module.imports in order, using the canonical names from
  // ctx (which already substituted synthetic names for any anonymous items).
  // Tracking per-kind cursors keeps the import → ctx name lookup aligned.
  let funcCursor = 0;
  let globalCursor = 0;
  let tableCursor = 0;
  let memoryCursor = 0;
  let tagCursor = 0;
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) bridgeImport(b, imp, ctx.funcNames[funcCursor++]!);
    else if (imp.kind === ExternalKind.Global) {
      bridgeImport(b, imp, ctx.globalNames[globalCursor++]!);
    } else if (imp.kind === ExternalKind.Table) {
      bridgeImport(b, imp, ctx.tableNames[tableCursor++]!);
    } else if (imp.kind === ExternalKind.Memory) {
      bridgeImport(b, imp, ctx.memoryNames[memoryCursor++]!);
    } else if (imp.kind === ExternalKind.Tag) {
      bridgeImport(b, imp, ctx.tagNames[tagCursor++]!);
    } else bridgeImport(b, imp, '');
  }

  for (let i = 0; i < module.memories.length; i++) {
    const m = module.memories[i]!;
    b.addMemory(
      ctx.memoryNames[memoryCursor + i]!,
      m.limits.initial,
      m.limits.max ?? null,
      m.limits.isShared,
      m.limits.is64,
    );
  }

  for (let i = 0; i < module.globals.length; i++) {
    bridgeGlobal(b, module.globals[i]!, ctx, ctx.globalNames[globalCursor + i]!);
  }

  for (let i = 0; i < module.tables.length; i++) {
    bridgeTable(b, module.tables[i]!, ctx.tableNames[tableCursor + i]!);
  }

  for (let i = 0; i < module.tags.length; i++) {
    bridgeTag(b, module.tags[i]!, ctx.tagNames[tagCursor + i]!);
  }

  for (let i = 0; i < module.funcs.length; i++) {
    bridgeFunc(b, module.funcs[i]!, ctx, ctx.funcNames[funcCursor + i]!);
  }

  for (const seg of module.dataSegments) bridgeDataSegment(b, seg, ctx);

  for (const exp of module.exports) bridgeExport(b, exp, ctx);

  return b.build();
}

function bridgeTable(b: ModuleBuilder, t: WabtModule['tables'][number], name: string): void {
  b.addTable(name, wabtTypeToValType(t.elemType), t.limits.initial, t.limits.max ?? null);
}

function bridgeTag(b: ModuleBuilder, tag: WabtTag, name: string): void {
  b.addTag(name, tag.sig.params.map(wabtTypeToValType));
}

// ---------------------------------------------------------------------------
// Context — name tables + current function frame
// ---------------------------------------------------------------------------

interface BridgeCtx {
  /** Func names indexed by the absolute func index (imports first). */
  funcNames: string[];
  /** Func signatures parallel to `funcNames`. Used by `call` to learn the result type. */
  funcSigs: FuncSignature[];
  /** Global names indexed by the absolute global index (imports first). */
  globalNames: string[];
  /** Global value types, parallel to `globalNames`. Used by global.get / global.set. */
  globalTypes: Type[];
  /** Table names indexed by the absolute table index (imports first). Used by `call_indirect`. */
  tableNames: string[];
  /** Memory names indexed by the absolute memory index (imports first). Used by memory exports + data segments. */
  memoryNames: string[];
  /** Tag names indexed by the absolute tag index (imports first). Used by `throw` / `try_table`. */
  tagNames: string[];
  /**
   * Map from wabt type-section index → binaryen-ts heap-type index.
   * Populated by `bridgeToBinaryen` from `module.types`. Indices for `func`
   * type entries are left unset; only struct/array entries register heap
   * types with binaryen-ts.
   */
  heapTypeIdx: Record<number, number>;
  /** Direct reference to the original `module.types` for field-type lookups. */
  types: WabtModule['types'];
  /** Current function param types (set inside bridgeFunc). */
  currentParams: Type[];
  /** Current function local types, in slot order after params. */
  currentLocals: Type[];
  /**
   * Active label names, outermost first. Block / loop / labeled-if push;
   * `br` / `br_if` / `br_table` resolve a depth by indexing from the end.
   * binaryen-ts identifies break targets by string name, while wabt-ts uses
   * depths — this stack bridges the two.
   */
  labelStack: string[];
  /** Monotonic counter for synthetic label names on anonymous blocks. */
  nextLabelId: { value: number };
}

function makeRootCtx(module: WabtModule): BridgeCtx {
  const funcNames: string[] = [];
  const funcSigs: FuncSignature[] = [];
  const globalNames: string[] = [];
  const globalTypes: Type[] = [];
  const tableNames: string[] = [];
  const memoryNames: string[] = [];
  const tagNames: string[] = [];
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) {
      funcNames.push(imp.func.name);
      funcSigs.push(imp.func.sig);
    } else if (imp.kind === ExternalKind.Global) {
      globalNames.push(imp.global.name);
      globalTypes.push(imp.global.type);
    } else if (imp.kind === ExternalKind.Table) {
      tableNames.push(imp.table.name);
    } else if (imp.kind === ExternalKind.Memory) {
      memoryNames.push(imp.memory.name);
    } else if (imp.kind === ExternalKind.Tag) {
      tagNames.push(imp.tag.name);
    }
  }
  for (const f of module.funcs) {
    funcNames.push(f.name);
    funcSigs.push(f.sig);
  }
  for (const g of module.globals) {
    globalNames.push(g.name);
    globalTypes.push(g.type);
  }
  for (const t of module.tables) tableNames.push(t.name);
  for (const m of module.memories) memoryNames.push(m.name);
  for (const tag of module.tags) tagNames.push(tag.name);

  // binaryen-ts identifies items by string name across the whole module, so
  // any anonymous wabt item (empty `name` string) needs a synthetic one
  // before we call addFunction / addTable / addExport. The synthetic name
  // is generated once per item and reused everywhere — addImport, the
  // defined-item builder, and cross-references like exports + call.
  synthesizeAnonymousNames(funcNames, '$F');
  synthesizeAnonymousNames(globalNames, '$G');
  synthesizeAnonymousNames(tableNames, '$T');
  synthesizeAnonymousNames(memoryNames, '$M');
  synthesizeAnonymousNames(tagNames, '$E');

  return {
    funcNames,
    funcSigs,
    globalNames,
    globalTypes,
    tableNames,
    memoryNames,
    tagNames,
    heapTypeIdx: {},
    types: module.types,
    currentParams: [],
    currentLocals: [],
    labelStack: [],
    nextLabelId: { value: 0 },
  };
}

function synthesizeAnonymousNames(names: string[], prefix: string): void {
  const used = new Set(names);
  for (let i = 0; i < names.length; i++) {
    if (names[i] === '') {
      let n = `${prefix}${i}`;
      while (used.has(n)) n = `${prefix}${i}_${Math.random().toString(36).slice(2, 6)}`;
      names[i] = n;
      used.add(n);
    }
  }
}

function resolveLabel(ctx: BridgeCtx, v: Var): string {
  // After resolveNames, br targets are depth indices into the label stack.
  // Name-bearing targets are resolved here too, in case the caller skipped
  // resolveNames.
  if (v.kind === 'name') {
    for (let i = ctx.labelStack.length - 1; i >= 0; i--) {
      if (ctx.labelStack[i] === v.name) return v.name;
    }
    throw new Error(`Bridge: label "${v.name}" not in scope`);
  }
  const idx = ctx.labelStack.length - 1 - v.value;
  if (idx < 0 || idx >= ctx.labelStack.length) {
    throw new Error(
      `Bridge: br depth ${v.value} out of range (stack size ${ctx.labelStack.length})`,
    );
  }
  return ctx.labelStack[idx]!;
}

/** Resolve a block/loop/if label, generating a synthetic name if empty. */
function nameForLabel(ctx: BridgeCtx, label: string): string {
  if (label !== '') return label;
  const n = `$L${ctx.nextLabelId.value++}`;
  return n;
}

/** Map a wabt BlockType to a binaryen-ts result Type. */
function bridgeBlockType(bt: BlockType): BType {
  switch (bt.kind) {
    case 'void':
      return None;
    case 'value':
      return wabtTypeToValType(bt.type);
    case 'func_type':
      throw new Error('Bridge: multi-value blocks (func_type BlockType) not yet supported');
  }
}

function varName(v: Var, names: ReadonlyArray<string>): string {
  if (v.kind === 'name') return v.name;
  const n = names[v.value];
  if (n === undefined || n === '') {
    throw new Error(`Bridge: no name for index ${v.value}; binaryen-ts needs string names`);
  }
  return n;
}

/**
 * Unwrap an index-kind {@link Var} to its numeric value. Name-kind vars
 * indicate a `resolveNames` step was skipped before bridging; throw rather
 * than silently emit index 0 (the historical writeVar fallback that hid
 * Bug G for so long).
 */
function varIdx(v: Var): number {
  if (v.kind === 'name') {
    throw new Error(`Bridge: var "${v.name}" not resolved — run resolveNames before bridgeToBinaryen`);
  }
  return v.value;
}

/**
 * Resolve a wabt type-section index to a binaryen-ts heap-type index.
 * The two index spaces diverge — wabt includes `func` entries, binaryen-ts
 * only assigns heap-type indices to struct/array. The mapping is populated
 * up-front by {@link bridgeToBinaryen} from `module.types`.
 */
function resolveHeapTypeIdx(typeVar: Var, ctx: BridgeCtx): number {
  const wabtIdx = varIdx(typeVar);
  const heapIdx = ctx.heapTypeIdx[wabtIdx];
  if (heapIdx === undefined) {
    throw new Error(
      `Bridge: type index ${wabtIdx} is not a heap type (must be struct or array)`,
    );
  }
  return heapIdx;
}

/**
 * Look up the binaryen-ts ValType to return from `struct.get $type $field`.
 * Packed i8/i16 fields stack-promote to i32; everything else passes through.
 */
function lookupStructFieldType(typeVar: Var, fieldVar: Var, ctx: BridgeCtx): ValType {
  const wabtIdx = varIdx(typeVar);
  const fieldIdx = varIdx(fieldVar);
  const entry = ctx.types[wabtIdx];
  if (entry === undefined || entry.kind !== 'struct') {
    throw new Error(`Bridge: type ${wabtIdx} is not a struct`);
  }
  const field = entry.fields[fieldIdx];
  if (field === undefined) {
    throw new Error(`Bridge: field ${fieldIdx} out of range for struct type ${wabtIdx}`);
  }
  // Packed types promote to i32 on the stack.
  if (field.type === Type.I8 || field.type === Type.I16) return ValType.I32;
  return wabtTypeToValType(field.type);
}

/**
 * Map a struct/array field type to a binaryen-ts StorageType for use in
 * `addHeapType`. Packed i8/i16 are encoded as their own storage variants;
 * other types map to their ValType counterparts.
 */
function wabtFieldTypeToValType(t: Type): ValType | 'i8' | 'i16' {
  if (t === Type.I8) return 'i8';
  if (t === Type.I16) return 'i16';
  return wabtTypeToValType(t);
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function bridgeImport(b: ModuleBuilder, imp: WabtImport, internalName: string): void {
  switch (imp.kind) {
    case ExternalKind.Func:
      b.addFunctionImport(
        internalName,
        imp.module,
        imp.field,
        imp.func.sig.params.map(wabtTypeToValType),
        imp.func.sig.results.map(wabtTypeToValType),
      );
      return;
    case ExternalKind.Global:
      b.addGlobalImport(
        internalName,
        imp.module,
        imp.field,
        wabtTypeToValType(imp.global.type),
        imp.global.mutable,
      );
      return;
    case ExternalKind.Memory:
      b.addMemoryImport(
        internalName,
        imp.module,
        imp.field,
        imp.memory.limits.initial,
        imp.memory.limits.max ?? null,
        imp.memory.limits.isShared,
        imp.memory.limits.is64,
      );
      return;
    case ExternalKind.Table:
      b.addTableImport(
        internalName,
        imp.module,
        imp.field,
        wabtTypeToValType(imp.table.elemType),
        imp.table.limits.initial,
        imp.table.limits.max ?? null,
      );
      return;
    case ExternalKind.Tag:
      // binaryen-ts has no dedicated `addTagImport` factory in v1.0.9. Tag
      // imports are uncommon outside wasic-style modules; surface a clear
      // error rather than silently dropping them.
      throw new Error(
        'Bridge: tag imports not yet supported ' +
          '(binaryen-ts v1.0.9 has no addTagImport factory)',
      );
  }
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

function bridgeGlobal(b: ModuleBuilder, g: WabtGlobal, ctx: BridgeCtx, name: string): void {
  if (g.init.length !== 1) {
    throw new Error(`Bridge: global ${name} has ${g.init.length} init exprs; expected 1`);
  }
  b.addGlobal(name, wabtTypeToValType(g.type), g.mutable, bridgeExpr(g.init[0]!, ctx));
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

function bridgeFunc(b: ModuleBuilder, f: WabtFunc, baseCtx: BridgeCtx, name: string): void {
  // Flatten localDecls (each is `{ type, count }`) into per-slot arrays for
  // both wabt-side type lookup (local.get → operand type) and the binaryen-ts
  // Local[] surface.
  const locals: Type[] = [];
  const binaryenLocals: Local[] = [];
  for (const decl of f.localDecls) {
    for (let i = 0; i < decl.count; i++) {
      locals.push(decl.type);
      binaryenLocals.push({ type: wabtTypeToValType(decl.type) });
    }
  }

  const ctx: BridgeCtx = {
    ...baseCtx,
    currentParams: f.sig.params,
    currentLocals: locals,
  };

  const body = bridgeFuncBody(f.body, ctx);

  b.addFunction(
    name,
    f.sig.params.map(wabtTypeToValType),
    f.sig.results.map(wabtTypeToValType),
    body,
    binaryenLocals,
  );
}

function bridgeFuncBody(body: Expr[], ctx: BridgeCtx): Expression {
  if (body.length === 1) return bridgeExpr(body[0]!, ctx);
  // Multi-statement: wrap in an unnamed block. binaryen-ts infers the block's
  // result type from the last child.
  return makeBlock(body.map((e) => bridgeExpr(e, ctx)));
}

// ---------------------------------------------------------------------------
// Expressions (post-order recursion)
// ---------------------------------------------------------------------------

function bridgeExpr(e: Expr, ctx: BridgeCtx): Expression {
  switch (e.kind) {
    // --- Leaves -----------------------------------------------------------
    case 'const':
      return bridgeConst((e as ConstExpr).value);
    case 'nop':
      return makeNop();
    case 'unreachable':
      return makeUnreachable();

    // --- Locals / globals --------------------------------------------------
    case 'local.get': {
      const lg = e as LocalGetExpr;
      const idx = requireIndex(lg.var, 'local.get');
      return makeLocalGet(idx, wabtTypeToValType(localType(ctx, idx)));
    }
    case 'local.set': {
      const ls = e as LocalSetExpr;
      const idx = requireIndex(ls.var, 'local.set');
      return makeLocalSet(idx, bridgeExpr(ls.value, ctx));
    }
    case 'local.tee': {
      const lt = e as LocalTeeExpr;
      const idx = requireIndex(lt.var, 'local.tee');
      return makeLocalTee(idx, bridgeExpr(lt.value, ctx), wabtTypeToValType(localType(ctx, idx)));
    }
    case 'global.get': {
      const gg = e as GlobalGetExpr;
      const idx = gg.var.kind === 'index' ? gg.var.value : ctx.globalNames.indexOf(gg.var.name);
      const t = ctx.globalTypes[idx];
      if (t === undefined) {
        throw new Error(
          `Bridge: global.get references unknown global (var=${JSON.stringify(gg.var)})`,
        );
      }
      return makeGlobalGet(varName(gg.var, ctx.globalNames), wabtTypeToValType(t));
    }
    case 'global.set': {
      const gs = e as GlobalSetExpr;
      const name = varName(gs.var, ctx.globalNames);
      return makeGlobalSet(name, bridgeExpr(gs.value, ctx));
    }

    // --- Arithmetic / compare / convert -----------------------------------
    case 'unary': {
      const u = e as UnaryExpr;
      return makeUnary(anyOpcodeName(u.opcode) as UnaryOp, bridgeExpr(u.operand, ctx));
    }
    case 'binary': {
      const be = e as BinaryExpr;
      return makeBinary(
        anyOpcodeName(be.opcode) as BinaryOp,
        bridgeExpr(be.left, ctx),
        bridgeExpr(be.right, ctx),
      );
    }
    case 'compare': {
      // binaryen-ts collapses compare into binary (same shape, opcode name carries the semantics).
      const cmp = e as CompareExpr;
      return makeBinary(
        anyOpcodeName(cmp.opcode) as BinaryOp,
        bridgeExpr(cmp.left, ctx),
        bridgeExpr(cmp.right, ctx),
      );
    }
    case 'convert': {
      // binaryen-ts collapses convert into unary.
      const cv = e as ConvertExpr;
      return makeUnary(anyOpcodeName(cv.opcode) as UnaryOp, bridgeExpr(cv.operand, ctx));
    }

    // --- Stack / value flow -----------------------------------------------
    case 'drop': {
      const d = e as DropExpr;
      return makeDrop(bridgeExpr(d.value, ctx));
    }
    case 'return': {
      const r = e as ReturnExpr;
      if (r.values.length === 0) return makeReturn(null);
      if (r.values.length === 1) return makeReturn(bridgeExpr(r.values[0]!, ctx));
      // Multi-value return needs binaryen's tuple.make wrapper, which
      // binaryen-ts exposes as an ExpressionKind but has no factory in
      // v1.0.9. Wire this up once binaryen-ts grows makeTupleMake.
      throw new Error(
        `Bridge: multi-value return (${r.values.length} values) not yet supported ` +
          `(needs binaryen-ts makeTupleMake)`,
      );
    }

    // --- Block-like -------------------------------------------------------
    case 'block': {
      const blk = e as BlockExpr;
      const name = nameForLabel(ctx, blk.label);
      ctx.labelStack.push(name);
      try {
        const children = blk.body.map((c) => bridgeExpr(c, ctx));
        // makeBlock infers type from the last child. For early-exit blocks
        // (last child is br / return / unreachable) that comes out as
        // "unreachable", which loses the block's declared signature.
        // Override with the declared blockType.
        return withDeclaredType(makeBlock(children, name), bridgeBlockType(blk.blockType));
      } finally {
        ctx.labelStack.pop();
      }
    }
    case 'loop': {
      const lp = e as LoopExpr;
      const name = nameForLabel(ctx, lp.label);
      const resultType = bridgeBlockType(lp.blockType);
      ctx.labelStack.push(name);
      try {
        const body = lp.body.length === 1
          ? bridgeExpr(lp.body[0]!, ctx)
          : makeBlock(lp.body.map((c) => bridgeExpr(c, ctx)));
        return makeLoop(name, body, resultType);
      } finally {
        ctx.labelStack.pop();
      }
    }
    case 'if': {
      const ife = e as IfExpr;
      // binaryen-ts's makeIf has no label slot. If a wabt module references
      // a labeled `if` via `br`, the encoded binary would silently lose the
      // name. Reject conservatively.
      if (ife.label !== '') {
        throw new Error(
          'Bridge: labeled `if` not yet supported (binaryen-ts has no if label slot)',
        );
      }
      const condition = bridgeExpr(ife.cond, ctx);
      const ifTrue = ife.then_.length === 1
        ? bridgeExpr(ife.then_[0]!, ctx)
        : makeBlock(ife.then_.map((c) => bridgeExpr(c, ctx)));
      const ifFalse = ife.else_.length === 0
        ? null
        : ife.else_.length === 1
        ? bridgeExpr(ife.else_[0]!, ctx)
        : makeBlock(ife.else_.map((c) => bridgeExpr(c, ctx)));
      return withDeclaredType(makeIf(condition, ifTrue, ifFalse), bridgeBlockType(ife.blockType));
    }

    // --- Branches ---------------------------------------------------------
    case 'br': {
      const br = e as BrExpr;
      const target = resolveLabel(ctx, br.target);
      return makeBreak(target, null, br.value ? bridgeExpr(br.value, ctx) : null);
    }
    case 'br_if': {
      const brIf = e as BrIfExpr;
      const target = resolveLabel(ctx, brIf.target);
      return makeBreak(
        target,
        bridgeExpr(brIf.cond, ctx),
        brIf.value ? bridgeExpr(brIf.value, ctx) : null,
      );
    }
    case 'br_table': {
      const brT = e as BrTableExpr;
      const targets = brT.targets.map((t) => resolveLabel(ctx, t));
      const defaultTarget = resolveLabel(ctx, brT.defaultTarget);
      return makeSwitch(targets, defaultTarget, bridgeExpr(brT.value, ctx), null);
    }

    // --- Calls ------------------------------------------------------------
    case 'call': {
      const c = e as CallExpr;
      const idx = c.func.kind === 'index' ? c.func.value : ctx.funcNames.indexOf(c.func.name);
      const sig = ctx.funcSigs[idx];
      const target = varName(c.func, ctx.funcNames);
      if (sig === undefined) {
        throw new Error(`Bridge: call references unknown function "${target}"`);
      }
      return makeCall(target, c.args.map((a) => bridgeExpr(a, ctx)), resultTypeForCall(sig));
    }
    case 'call_indirect': {
      const ci = e as CallIndirectExpr;
      const tableName = varName(ci.table, ctx.tableNames);
      const target = bridgeExpr(ci.callee, ctx);
      const operands = ci.args.map((a) => bridgeExpr(a, ctx));
      // binaryen-ts's makeCallIndirect surface accepts ValType[] (single-result
      // result list). Multi-result calls fall through to the multi-value check
      // below.
      if (ci.sig.results.length > 1) {
        throw new Error('Bridge: multi-value call_indirect not yet supported');
      }
      return makeCallIndirect(
        tableName,
        target,
        operands,
        ci.sig.params.map(wabtTypeToValType),
        ci.sig.results.map(wabtTypeToValType),
      );
    }

    // --- Select -----------------------------------------------------------
    case 'select': {
      const s = e as SelectExpr;
      return makeSelect(
        bridgeExpr(s.val1, ctx),
        bridgeExpr(s.val2, ctx),
        bridgeExpr(s.cond, ctx),
      );
    }

    // --- Memory load / store ---------------------------------------------
    case 'load': {
      const ld = e as LoadExpr;
      requireDefaultMemory(ld.memidx, 'load');
      // The WAT lexer maps every `v128.load*_splat` / `v128.load*_zero` /
      // `v128.load*x*_s|u` / plain `v128.load` to TokenType.Load, so a
      // parser-sourced module sends them all through here as LoadExpr.
      // (The binary reader's IR path uses LoadSplatExpr / LoadZeroExpr —
      // those have their own cases below.) Route SIMD-prefix opcodes to
      // makeSIMDLoad; plain v128.load is a 16-byte makeLoad.
      const simdOp = simdLoadOpForOpcode(ld.opcode);
      if (simdOp !== null) {
        return makeSIMDLoad(
          simdOp,
          bridgeExpr(ld.address, ctx),
          bigintOffsetToNumber(ld.offset, 'load'),
          alignBytesToExponent(ld.align, naturalAlignForOpcode(ld.opcode), 'load'),
        );
      }
      const info = loadInfo(ld.opcode);
      return makeLoad(
        info.bytes,
        info.signed,
        bigintOffsetToNumber(ld.offset, 'load'),
        alignBytesToExponent(ld.align, info.bytes, 'load'),
        bridgeExpr(ld.address, ctx),
        info.resultType,
      );
    }
    case 'load_splat': {
      // Binary-reader IR path; the WAT-parser path produces LoadExpr.
      const ls = e as LoadSplatExpr;
      requireDefaultMemory(ls.memidx, 'load_splat');
      return makeSIMDLoad(
        anyOpcodeName(ls.opcode) as SIMDLoadOp,
        bridgeExpr(ls.address, ctx),
        bigintOffsetToNumber(ls.offset, 'load_splat'),
        alignBytesToExponent(ls.align, naturalAlignForOpcode(ls.opcode), 'load_splat'),
      );
    }
    case 'load_zero': {
      const lz = e as LoadZeroExpr;
      requireDefaultMemory(lz.memidx, 'load_zero');
      return makeSIMDLoad(
        anyOpcodeName(lz.opcode) as SIMDLoadOp,
        bridgeExpr(lz.address, ctx),
        bigintOffsetToNumber(lz.offset, 'load_zero'),
        alignBytesToExponent(lz.align, naturalAlignForOpcode(lz.opcode), 'load_zero'),
      );
    }
    case 'simd_load_lane': {
      const sll = e as SimdLoadLaneExpr;
      requireDefaultMemory(sll.memidx, 'simd_load_lane');
      return makeSIMDLoadStoreLane(
        anyOpcodeName(sll.opcode) as SIMDLoadStoreLaneOp,
        bridgeExpr(sll.address, ctx),
        bridgeExpr(sll.vec, ctx),
        bigintOffsetToNumber(sll.offset, 'simd_load_lane'),
        alignBytesToExponent(sll.align, naturalAlignForOpcode(sll.opcode), 'simd_load_lane'),
        sll.lane,
      );
    }
    case 'simd_store_lane': {
      const sls = e as SimdStoreLaneExpr;
      requireDefaultMemory(sls.memidx, 'simd_store_lane');
      return makeSIMDLoadStoreLane(
        anyOpcodeName(sls.opcode) as SIMDLoadStoreLaneOp,
        bridgeExpr(sls.address, ctx),
        bridgeExpr(sls.vec, ctx),
        bigintOffsetToNumber(sls.offset, 'simd_store_lane'),
        alignBytesToExponent(sls.align, naturalAlignForOpcode(sls.opcode), 'simd_store_lane'),
        sls.lane,
      );
    }
    case 'store': {
      const st = e as StoreExpr;
      requireDefaultMemory(st.memidx, 'store');
      const bytes = storeBytes(st.opcode);
      return makeStore(
        bytes,
        bigintOffsetToNumber(st.offset, 'store'),
        alignBytesToExponent(st.align, bytes, 'store'),
        bridgeExpr(st.address, ctx),
        bridgeExpr(st.value, ctx),
      );
    }
    case 'memory.size': {
      const ms = e as MemorySizeExpr;
      requireDefaultMemory(ms.memidx, 'memory.size');
      return makeMemorySize();
    }
    case 'memory.grow': {
      const mg = e as MemoryGrowExpr;
      requireDefaultMemory(mg.memidx, 'memory.grow');
      return makeMemoryGrow(bridgeExpr(mg.delta, ctx));
    }

    // --- Reference types (Tier C) ----------------------------------------
    case 'ref.null': {
      const rn = e as RefNullExpr;
      return makeRefNull(refTypeVarToValType(rn.refType));
    }
    case 'ref.func': {
      const rf = e as RefFuncExpr;
      return makeRefFunc(varName(rf.func, ctx.funcNames), ValType.FuncRef);
    }
    case 'ref.is_null': {
      const rin = e as RefIsNullExpr;
      return makeRefIsNull(bridgeExpr(rin.value, ctx));
    }
    case 'ref.as_non_null':
      // binaryen-ts v1.0.9 has no makeRefAsNonNull factory; emit a clear
      // error rather than silently producing wrong output. Revisit when
      // binaryen-ts gains the factory.
      throw new Error('Bridge: ref.as_non_null not supported (binaryen-ts has no factory)');

    // --- GC Tier 1: i31 + ref.eq ----------------------------------------
    case 'ref.eq': {
      const re = e as RefEqExpr;
      return makeRefEq(bridgeExpr(re.left, ctx), bridgeExpr(re.right, ctx));
    }
    case 'ref.i31': {
      const ri = e as RefI31Expr;
      // binaryen-ts's makeRefI31 takes a `resultType` argument; i31ref is
      // the only valid result type for ref.i31.
      return makeRefI31(bridgeExpr(ri.value, ctx), ValType.I31Ref);
    }
    case 'i31.get': {
      const ig = e as I31GetExpr;
      return makeI31Get(bridgeExpr(ig.i31, ctx), ig.signed);
    }

    // --- GC Tier 2: struct -------------------------------------------------
    case 'struct.new': {
      const sn = e as StructNewExpr;
      const heapIdx = resolveHeapTypeIdx(sn.typeVar, ctx);
      return makeStructNew(
        heapIdx,
        sn.operands.map((o) => bridgeExpr(o, ctx)),
        { heap: heapIdx, nullable: false },
      );
    }
    case 'struct.new_default': {
      const snd = e as StructNewDefaultExpr;
      const heapIdx = resolveHeapTypeIdx(snd.typeVar, ctx);
      return makeStructNewDefault(heapIdx, { heap: heapIdx, nullable: false });
    }
    case 'struct.get': {
      const sg = e as StructGetExpr;
      const heapIdx = resolveHeapTypeIdx(sg.typeVar, ctx);
      const fieldType = lookupStructFieldType(sg.typeVar, sg.fieldVar, ctx);
      return makeStructGet(
        heapIdx,
        varIdx(sg.fieldVar),
        bridgeExpr(sg.ref, ctx),
        fieldType,
        sg.signed === true,
      );
    }
    case 'struct.set': {
      const ss = e as StructSetExpr;
      const heapIdx = resolveHeapTypeIdx(ss.typeVar, ctx);
      return makeStructSet(
        heapIdx,
        varIdx(ss.fieldVar),
        bridgeExpr(ss.ref, ctx),
        bridgeExpr(ss.value, ctx),
      );
    }

    // --- SIMD (Tier C) ---------------------------------------------------
    //
    // Note: `i*x*.splat` opcodes flow through the `unary` case above —
    // wabt-ts classifies them as UnaryExpr, and the WAT-string opcode name
    // happens to match binaryen-ts's `UnaryOp` enum value directly. Same
    // for SIMD lane-wise arithmetic (`i8x16.add`, `f32x4.mul`, …) via the
    // `binary` case.
    case 'simd_lane_op': {
      const slo = e as SimdLaneOpExpr;
      const opName = anyOpcodeName(slo.opcode);
      if (opName.includes('extract_lane')) {
        return makeSIMDExtract(
          opName as SIMDExtractOp,
          bridgeExpr(slo.operand, ctx),
          slo.lane,
        );
      }
      if (opName.includes('replace_lane')) {
        // SimdLaneOpExpr.value is populated for replace_lane (parser now
        // captures the scalar half); fall back to nop only as a defensive
        // guard for hand-constructed IR.
        const replacement = slo.value !== undefined
          ? bridgeExpr(slo.value, ctx)
          : bridgeExpr({ kind: 'nop', loc: slo.loc }, ctx);
        return makeSIMDReplace(
          opName as SIMDReplaceOp,
          bridgeExpr(slo.operand, ctx),
          slo.lane,
          replacement,
        );
      }
      throw new Error(`Bridge: simd_lane_op opcode ${opName} not yet supported`);
    }
    case 'simd_shuffle': {
      const ss = e as SimdShuffleOpExpr;
      return makeSIMDShuffle(
        bridgeExpr(ss.left, ctx),
        bridgeExpr(ss.right, ctx),
        ss.lanes,
      );
    }

    // --- Exception handling (Tier C) -------------------------------------
    case 'throw': {
      const th = e as ThrowExpr;
      return makeThrow(
        varName(th.tag, ctx.tagNames),
        th.args.map((a) => bridgeExpr(a, ctx)),
      );
    }
    case 'throw_ref': {
      const tr = e as ThrowRefExpr;
      return makeThrowRef(bridgeExpr(tr.exnref, ctx));
    }
    case 'try_table': {
      const tt = e as TryTableExpr;
      const name = nameForLabel(ctx, tt.label);
      ctx.labelStack.push(name);
      try {
        const body = tt.body.length === 1
          ? bridgeExpr(tt.body[0]!, ctx)
          : makeBlock(tt.body.map((c) => bridgeExpr(c, ctx)));
        const catches: CatchClause[] = tt.catches.map((c) => buildCatchClause(c, ctx));
        return withDeclaredType(
          makeTryTable(name, body, catches, bridgeBlockType(tt.blockType)),
          bridgeBlockType(tt.blockType),
        );
      } finally {
        ctx.labelStack.pop();
      }
    }

    default:
      throw new Error(`Bridge: expression kind not yet supported: ${e.kind}`);
  }
}

/** Translate a wabt try_table catch into a binaryen-ts CatchClause. */
function buildCatchClause(
  c: { kind: CatchKind; tag?: Var; target: Var },
  ctx: BridgeCtx,
): CatchClause {
  const dest = resolveLabel(ctx, c.target);
  switch (c.kind) {
    case CatchKind.Catch:
      return { tag: varName(c.tag!, ctx.tagNames), dest, isRef: false };
    case CatchKind.CatchRef:
      return { tag: varName(c.tag!, ctx.tagNames), dest, isRef: true };
    case CatchKind.CatchAll:
      return { tag: null, dest, isRef: false };
    case CatchKind.CatchAllRef:
      return { tag: null, dest, isRef: true };
  }
}

/**
 * Map a wabt-ts `refType: Var` (used by `ref.null`) to a binaryen-ts
 * `ValType`. The WAT parser produces a name-var with `name = "funcref"` /
 * `"externref"` / etc. Index-vars are unusual here but supported.
 */
function refTypeVarToValType(v: Var): ValType {
  if (v.kind === 'name') {
    switch (v.name) {
      case 'funcref':
        return ValType.FuncRef;
      case 'externref':
        return ValType.ExternRef;
      case 'func':
        return ValType.FuncRef; // `(ref.null func)`
      case 'extern':
        return ValType.ExternRef; // `(ref.null extern)`
    }
    throw new Error(`Bridge: unsupported ref.null type "${v.name}"`);
  }
  // Index-form refType targets a user-defined type — GC proposal territory.
  throw new Error('Bridge: ref.null with index-form type (GC) not yet supported');
}

// --- Small helpers used inside bridgeExpr ---

function requireIndex(v: Var, label: string): number {
  if (v.kind !== 'index') {
    throw new Error(`Bridge: ${label} with name var — run resolveNames first`);
  }
  return v.value;
}

function localType(ctx: BridgeCtx, idx: number): Type {
  return idx < ctx.currentParams.length
    ? ctx.currentParams[idx]!
    : ctx.currentLocals[idx - ctx.currentParams.length]!;
}

/**
 * Override the inferred `type` field on a binaryen-ts block / if expression
 * to match its WAT-declared block signature. binaryen-ts infers the type
 * from the last child, but for early-exit forms (br / return / unreachable
 * as the last child) that loses the declared signature. The encoder writes
 * `e.type` directly into the binary block_type slot, so we have to fix it
 * here before the value escapes the bridge.
 */
function withDeclaredType<T extends { type: BType }>(expr: T, declared: BType): T {
  return declared === expr.type ? expr : { ...expr, type: declared };
}

/** Map a wabt function signature's results to the single `Type` makeCall wants. */
function resultTypeForCall(sig: FuncSignature): BType {
  if (sig.results.length === 0) return None;
  if (sig.results.length === 1) return wabtTypeToValType(sig.results[0]!);
  throw new Error('Bridge: multi-value `call` not yet supported');
}

/** Reject any non-default-memory reference until the bridge handles multi-memory. */
function requireDefaultMemory(memidx: Var, opLabel: string): void {
  if (memidx.kind === 'index' && memidx.value !== 0) {
    throw new Error(`Bridge: ${opLabel} with non-zero memidx (${memidx.value}) not yet supported`);
  }
  if (memidx.kind === 'name') {
    // Name-based references only make sense in multi-memory; treat as unsupported.
    throw new Error(`Bridge: ${opLabel} with named memory not yet supported`);
  }
}

/**
 * wabt-ts represents load/store offsets as `bigint` (to accommodate the
 * memory64 proposal). binaryen-ts's encoder writes the offset as a u32 LEB,
 * so it expects a `number`. Convert with a safety check.
 */
function bigintOffsetToNumber(off: bigint, opLabel: string): number {
  if (off > 0xffffffffn || off < 0n) {
    throw new Error(
      `Bridge: ${opLabel} offset ${off} out of u32 range (memory64 not supported yet)`,
    );
  }
  return Number(off);
}

/**
 * Convert wabt-ts's byte-valued alignment into the wasm `memarg.align`
 * exponent that binaryen-ts's encoder writes to the binary. wabt-ts's WAT
 * parser stores the literal byte count (`align=4` → `4`) and uses `0` for
 * "no explicit align" — which the spec interprets as the opcode's natural
 * alignment, NOT exponent 0. Treating 0 as exponent 0 silently produced
 * binaries with 1-byte alignment on every default-aligned memory op,
 * which defeated binaryen's optimizer (it reads the field and treats it
 * as a hard constraint). Use the caller-supplied natural byte count when
 * align is unspecified.
 */
function alignBytesToExponent(
  wabtAlign: number,
  naturalBytes: number,
  opLabel: string,
): number {
  const bytes = wabtAlign === 0 ? naturalBytes : wabtAlign;
  // Must be a power of two; the wasm spec requires this.
  if (bytes <= 0 || (bytes & (bytes - 1)) !== 0) {
    throw new Error(`Bridge: ${opLabel} align ${bytes} is not a positive power of two`);
  }
  return Math.log2(bytes);
}

interface LoadInfo {
  bytes: 1 | 2 | 4 | 8 | 16;
  signed: boolean;
  resultType: ValType;
}

/**
 * Decode a load opcode into the (bytes, signed, resultType) triple binaryen-ts
 * wants. Centralized here because binaryen-ts's `makeLoad` is signature-driven
 * while wabt-ts's opcode encodes all three.
 */
function loadInfo(opcode: number): LoadInfo {
  switch (opcode) {
    case Opcode.I32Load:
      return { bytes: 4, signed: false, resultType: ValType.I32 };
    case Opcode.I64Load:
      return { bytes: 8, signed: false, resultType: ValType.I64 };
    case Opcode.F32Load:
      return { bytes: 4, signed: false, resultType: ValType.F32 };
    case Opcode.F64Load:
      return { bytes: 8, signed: false, resultType: ValType.F64 };
    case Opcode.I32Load8S:
      return { bytes: 1, signed: true, resultType: ValType.I32 };
    case Opcode.I32Load8U:
      return { bytes: 1, signed: false, resultType: ValType.I32 };
    case Opcode.I32Load16S:
      return { bytes: 2, signed: true, resultType: ValType.I32 };
    case Opcode.I32Load16U:
      return { bytes: 2, signed: false, resultType: ValType.I32 };
    case Opcode.I64Load8S:
      return { bytes: 1, signed: true, resultType: ValType.I64 };
    case Opcode.I64Load8U:
      return { bytes: 1, signed: false, resultType: ValType.I64 };
    case Opcode.I64Load16S:
      return { bytes: 2, signed: true, resultType: ValType.I64 };
    case Opcode.I64Load16U:
      return { bytes: 2, signed: false, resultType: ValType.I64 };
    case Opcode.I64Load32S:
      return { bytes: 4, signed: true, resultType: ValType.I64 };
    case Opcode.I64Load32U:
      return { bytes: 4, signed: false, resultType: ValType.I64 };
    // Plain `v128.load` (0xfd 0x00) is not handled here. binaryen-ts v1.0.9's
    // encoder loadOpcode() has no ValType.V128 branch, so makeLoad(16, …, V128)
    // silently emits i64.load. Reroute via a dedicated factory once binaryen-ts
    // grows one (or extend the bridge to write the SIMD prefix directly).
    default:
      throw new Error(`Bridge: unsupported load opcode 0x${opcode.toString(16)}`);
  }
}

/**
 * Classify a 0xfd-prefixed SIMD load opcode against binaryen-ts's
 * `SIMDLoadOp` enum. Returns `null` for any non-SIMD-load opcode
 * (including plain `v128.load`, which is a regular 16-byte makeLoad).
 *
 * Routing matters because the WAT lexer maps every SIMD load to
 * TokenType.Load — so a parser-sourced module sends splat/zero/extend
 * opcodes through the `load` case as plain `LoadExpr`. Binaryen-ts uses
 * a different factory (`makeSIMDLoad`) for those, so the bridge dispatches
 * here on the opcode byte rather than the IR kind.
 */
function simdLoadOpForOpcode(opcode: number): SIMDLoadOp | null {
  if ((opcode >> 8) !== 0xfd) return null;
  switch (opcode & 0xff) {
    case 0x01:
      return SIMDLoadOp.Load8x8SVec128;
    case 0x02:
      return SIMDLoadOp.Load8x8UVec128;
    case 0x03:
      return SIMDLoadOp.Load16x4SVec128;
    case 0x04:
      return SIMDLoadOp.Load16x4UVec128;
    case 0x05:
      return SIMDLoadOp.Load32x2SVec128;
    case 0x06:
      return SIMDLoadOp.Load32x2UVec128;
    case 0x07:
      return SIMDLoadOp.Load8SplatVec128;
    case 0x08:
      return SIMDLoadOp.Load16SplatVec128;
    case 0x09:
      return SIMDLoadOp.Load32SplatVec128;
    case 0x0a:
      return SIMDLoadOp.Load64SplatVec128;
    case 0x5c:
      return SIMDLoadOp.Load32ZeroVec128;
    case 0x5d:
      return SIMDLoadOp.Load64ZeroVec128;
    default:
      return null; // includes plain v128.load (0x00) → caller uses makeLoad
  }
}

function storeBytes(opcode: number): 1 | 2 | 4 | 8 {
  switch (opcode) {
    case Opcode.I32Store8:
    case Opcode.I64Store8:
      return 1;
    case Opcode.I32Store16:
    case Opcode.I64Store16:
      return 2;
    case Opcode.I32Store:
    case Opcode.F32Store:
    case Opcode.I64Store32:
      return 4;
    case Opcode.I64Store:
    case Opcode.F64Store:
      return 8;
    default:
      throw new Error(`Bridge: unsupported store opcode 0x${opcode.toString(16)}`);
  }
}

function bridgeConst(c: Const): Expression {
  switch (c.type) {
    case Type.I32:
      return makeI32Const(c.value);
    case Type.I64:
      return makeI64Const(c.value);
    case Type.F32: {
      // wabt-ts stores f32 as raw uint32 bit pattern; binaryen-ts wants the
      // actual float. Reinterpret via a tiny shared buffer.
      const u32 = new Uint32Array([c.bits >>> 0]);
      const f32 = new Float32Array(u32.buffer);
      return makeF32Const(f32[0]!);
    }
    case Type.F64: {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setBigUint64(0, c.bits, true);
      return makeF64Const(new Float64Array(buf)[0]!);
    }
    case Type.V128:
      // wabt-ts stores v128 as 16 raw bytes; binaryen-ts wants the same.
      return makeV128Const(c.bytes);
    default:
      throw new Error(
        `Bridge: const type not yet supported: 0x${(c as { type: number }).type.toString(16)}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function bridgeExport(b: ModuleBuilder, exp: WabtExport, ctx: BridgeCtx): void {
  switch (exp.kind) {
    case ExternalKind.Func:
      b.addExport(exp.name, varName(exp.var, ctx.funcNames), 'function');
      return;
    case ExternalKind.Global:
      b.addExport(exp.name, varName(exp.var, ctx.globalNames), 'global');
      return;
    case ExternalKind.Memory:
      b.addExport(exp.name, varName(exp.var, ctx.memoryNames), 'memory');
      return;
    case ExternalKind.Table:
      b.addExport(exp.name, varName(exp.var, ctx.tableNames), 'table');
      return;
    case ExternalKind.Tag:
      // binaryen-ts v1.0.9 WasmExport.kind is "function" | "global" |
      // "table" | "memory" — no "tag" variant. Tag exports survive the
      // wabt-ts WAT pipeline (wat2wasm) but cannot round-trip through the
      // bridge until binaryen-ts widens its export kinds.
      throw new Error(
        'Bridge: tag exports not yet supported ' +
          '(binaryen-ts v1.0.9 has no "tag" export kind)',
      );
  }
}

// ---------------------------------------------------------------------------
// Data segments
// ---------------------------------------------------------------------------

function bridgeDataSegment(
  b: ModuleBuilder,
  seg: WabtModule['dataSegments'][number],
  ctx: BridgeCtx,
): void {
  if (seg.kind === 'passive') {
    b.addPassiveDataSegment(seg.name, seg.data);
    return;
  }
  if (seg.kind === 'declared') {
    // The 'declared' segment kind exists in wabt's IR for symmetry with
    // element segments but is meaningless for data — no data section
    // entry, no offset, no initialization. Skip silently.
    return;
  }
  // Active segment: must have a single-expression constant offset.
  if (seg.offset.length !== 1) {
    throw new Error(
      `Bridge: data segment ${seg.name} has ${seg.offset.length} offset exprs; expected 1`,
    );
  }
  // wabt's IR allows a per-segment memoryVar; binaryen-ts's addDataSegment
  // is single-memory under MVP. Verify the target is memory 0.
  if (seg.memoryVar.kind === 'index' && seg.memoryVar.value !== 0) {
    throw new Error(
      `Bridge: data segment ${seg.name} targets non-zero memory ${seg.memoryVar.value} (multi-memory not yet supported)`,
    );
  }
  b.addDataSegment(seg.name, bridgeExpr(seg.offset[0]!, ctx), seg.data);
}
