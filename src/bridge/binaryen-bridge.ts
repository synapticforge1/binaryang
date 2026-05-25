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
 * **Out of scope (will throw):** tags, element segments, data segments,
 * exports of memory / table / tag, multi-memory, GC / EH / SIMD instructions,
 * start function, custom sections.
 *
 * Direct recursion is the natural shape here: binaryen-ts constructors are
 * bottom-up (leaves passed into composite constructors), and wabt-ts's IR is
 * already a tree with no upward references — so a single recursive walk
 * suffices. An `ExprVisitorDelegate`-driven version would need an operand
 * stack and is strictly more complex with no benefit.
 */

import { ExternalKind } from '../core/binary.ts';
import { Type } from '../core/types.ts';
import { anyOpcodeName } from '../core/opcode.ts';
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
  LocalGetExpr,
  LocalSetExpr,
  LocalTeeExpr,
  LoopExpr,
  MemoryGrowExpr,
  MemorySizeExpr,
  Module as WabtModule,
  RefFuncExpr,
  RefIsNullExpr,
  RefNullExpr,
  ReturnExpr,
  SelectExpr,
  SimdLaneOpExpr,
  SimdShuffleOpExpr,
  StoreExpr,
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
  makeRefFunc,
  makeRefIsNull,
  makeRefNull,
  makeReturn,
  makeSelect,
  makeSIMDExtract,
  makeSIMDShuffle,
  makeStore,
  makeSwitch,
  makeUnary,
  makeUnreachable,
  makeV128Const,
  ModuleBuilder,
  None,
  SIMDExtractOp,
  UnaryOp,
  ValType,
} from '@jrmarcum/binaryen-ts/ir';
import type { Expression, Local, Type as BType, WasmModule } from '@jrmarcum/binaryen-ts/ir';

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

  // Imports: walk module.imports in order, using the canonical names from
  // ctx (which already substituted synthetic names for any anonymous items).
  // Tracking per-kind cursors keeps the import → ctx name lookup aligned.
  let funcCursor = 0;
  let globalCursor = 0;
  let tableCursor = 0;
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) bridgeImport(b, imp, ctx.funcNames[funcCursor++]!);
    else if (imp.kind === ExternalKind.Global) {
      bridgeImport(b, imp, ctx.globalNames[globalCursor++]!);
    } else if (imp.kind === ExternalKind.Table) {
      bridgeImport(b, imp, ctx.tableNames[tableCursor++]!);
    } else bridgeImport(b, imp, '');
  }

  for (const m of module.memories) {
    b.addMemory(
      m.name,
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

  for (let i = 0; i < module.funcs.length; i++) {
    bridgeFunc(b, module.funcs[i]!, ctx, ctx.funcNames[funcCursor + i]!);
  }

  for (const exp of module.exports) bridgeExport(b, exp, ctx);

  return b.build();
}

function bridgeTable(b: ModuleBuilder, t: WabtModule['tables'][number], name: string): void {
  b.addTable(name, wabtTypeToValType(t.elemType), t.limits.initial, t.limits.max ?? null);
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
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) {
      funcNames.push(imp.func.name);
      funcSigs.push(imp.func.sig);
    } else if (imp.kind === ExternalKind.Global) {
      globalNames.push(imp.global.name);
      globalTypes.push(imp.global.type);
    } else if (imp.kind === ExternalKind.Table) {
      tableNames.push(imp.table.name);
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

  // binaryen-ts identifies items by string name across the whole module, so
  // any anonymous wabt item (empty `name` string) needs a synthetic one
  // before we call addFunction / addTable / addExport. The synthetic name
  // is generated once per item and reused everywhere — addImport, the
  // defined-item builder, and cross-references like exports + call.
  synthesizeAnonymousNames(funcNames, '$F');
  synthesizeAnonymousNames(globalNames, '$G');
  synthesizeAnonymousNames(tableNames, '$T');

  return {
    funcNames,
    funcSigs,
    globalNames,
    globalTypes,
    tableNames,
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
      // wabt currently has no module.memories shadowing for imports, so we
      // pass through the raw name (empty if anonymous). binaryen-ts accepts
      // that for memory because there can only be one memory (under MVP).
      b.addMemoryImport(
        imp.memory.name,
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
      throw new Error('Bridge: tag imports not yet supported');
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
      return makeReturn(r.value ? bridgeExpr(r.value, ctx) : null);
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
      // Extract-lane variants go through makeSIMDExtract. Replace-lane
      // needs two operands (vec + scalar) but wabt-ts's SimdLaneOpExpr
      // only carries one (`operand`) — the parser drops the second.
      // Throw with a clear message until the upstream IR + parser grow
      // a second-operand slot.
      if (opName.includes('extract_lane')) {
        return makeSIMDExtract(
          opName as SIMDExtractOp,
          bridgeExpr(slo.operand, ctx),
          slo.lane,
        );
      }
      if (opName.includes('replace_lane')) {
        throw new Error(
          'Bridge: SIMD replace_lane not yet supported (wabt parser ' +
          'drops the second operand into SimdLaneOpExpr)',
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

    default:
      throw new Error(`Bridge: expression kind not yet supported: ${e.kind}`);
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
      case 'funcref':   return ValType.FuncRef;
      case 'externref': return ValType.ExternRef;
      case 'func':      return ValType.FuncRef;     // `(ref.null func)`
      case 'extern':    return ValType.ExternRef;   // `(ref.null extern)`
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
 * "no explicit align" — which the wasm spec interprets as exponent 0 (i.e.
 * 1-byte alignment). We preserve that "min alignment when unset" behavior,
 * but log2-encode any explicit byte value so the encoded binary matches
 * the WAT-declared alignment.
 */
function alignBytesToExponent(
  wabtAlign: number,
  _naturalBytes: 1 | 2 | 4 | 8 | 16,
  opLabel: string,
): number {
  if (wabtAlign === 0) return 0; // wabt convention: unset → exponent 0
  // Must be a power of two; the wasm spec requires this.
  if (wabtAlign <= 0 || (wabtAlign & (wabtAlign - 1)) !== 0) {
    throw new Error(`Bridge: ${opLabel} align ${wabtAlign} is not a positive power of two`);
  }
  return Math.log2(wabtAlign);
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
    default:
      throw new Error(`Bridge: unsupported load opcode 0x${opcode.toString(16)}`);
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
    case ExternalKind.Table:
    case ExternalKind.Tag:
      throw new Error(`Bridge: export kind ${exp.kind} not yet supported`);
  }
}
