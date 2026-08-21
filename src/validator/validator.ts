// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/validator.cc / include/wabt/validator.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import { isRefValueType } from '../ir/ir.ts';
import type { Field, TypeEntry, ValueType } from '../ir/ir.ts';
import { combineResults, Result } from '../core/result.ts';
import { heapTypeNameToType, Type } from '../core/types.ts';
import { ExternalKind } from '../core/binary.ts';
import { PREFIX_THREADS } from '../core/opcode.ts';
import type { ErrorList } from '../core/error.ts';
import type {
  ArrayCopyExpr,
  ArrayFillExpr,
  ArrayGetExpr,
  ArrayInitSegmentExpr,
  ArrayLenExpr,
  ArrayNewDataExpr,
  ArrayNewDefaultExpr,
  ArrayNewElemExpr,
  ArrayNewExpr,
  ArrayNewFixedExpr,
  ArraySetExpr,
  AtomicFenceExpr,
  AtomicLoadExpr,
  AtomicNotifyExpr,
  AtomicRmwCmpxchgExpr,
  AtomicRmwExpr,
  AtomicStoreExpr,
  AtomicWaitExpr,
  BinaryExpr,
  BlockExpr,
  BrExpr,
  BrIfExpr,
  BrOnCastExpr,
  BrOnNonNullExpr,
  BrOnNullExpr,
  BrTableExpr,
  CallExpr,
  CallIndirectExpr,
  CallRefExpr,
  Catch,
  CodeMetadataExpr,
  CompareExpr,
  ConstExpr,
  ConvertExpr,
  DataDropExpr,
  DropExpr,
  ElemDropExpr,
  Expr,
  ExternConvertExpr,
  GlobalGetExpr,
  GlobalSetExpr,
  I31GetExpr,
  IfExpr,
  LoadExpr,
  LoadSplatExpr,
  LoadZeroExpr,
  LocalGetExpr,
  LocalSetExpr,
  LocalTeeExpr,
  LoopExpr,
  MemoryCopyExpr,
  MemoryFillExpr,
  MemoryGrowExpr,
  MemoryInitExpr,
  MemorySizeExpr,
  Module,
  NopExpr,
  QuaternaryExpr,
  RefAsNonNullExpr,
  RefCastExpr,
  RefEqExpr,
  RefFuncExpr,
  RefI31Expr,
  RefIsNullExpr,
  RefNullExpr,
  RefTestExpr,
  RethrowExpr,
  ReturnCallExpr,
  ReturnCallIndirectExpr,
  ReturnCallRefExpr,
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
  TableCopyExpr,
  TableFillExpr,
  TableGetExpr,
  TableGrowExpr,
  TableInitExpr,
  TableSetExpr,
  TableSizeExpr,
  TernaryExpr,
  ThrowExpr,
  ThrowRefExpr,
  TryExpr,
  TryTableExpr,
  UnaryExpr,
  UnreachableExpr,
  Var,
} from '../ir/ir.ts';
import { ExprVisitor } from '../ir/expr-visitor.ts';
import type { ExprVisitorDelegate } from '../ir/expr-visitor.ts';
import { SharedValidator } from './shared-validator.ts';
import type { ValidateOptions } from './shared-validator.ts';

/**
 * Canonical structural keys for every type-section entry.
 *
 * WebAssembly type identity is STRUCTURAL, not by index: two `(type (func))`
 * declarations are one type, and a `(ref $a)` is accepted where a `(ref $b)`
 * is wanted when their definitions match. Comparing indices alone rejected
 * every module in type-equivalence.wast.
 *
 * Recursion is handled the way the spec does it — a reference to a member of
 * the SAME rec group is written as its position within the group, so two
 * groups that are shaped alike key alike no matter what indices they occupy.
 * References out of the group name the target's own key, which terminates
 * because a group can only reference itself or an EARLIER group.
 */
function canonicalTypeKeys(types: readonly TypeEntry[]): string[] {
  // Which rec group each index belongs to. `recGroupSize` is set on the first
  // entry of an explicit `(rec …)`; anything else is a group of one.
  const groupStart = new Array<number>(types.length).fill(0);
  const groupSize = new Array<number>(types.length).fill(1);
  for (let i = 0; i < types.length;) {
    const size = types[i]?.recGroupSize ?? 1;
    for (let k = 0; k < size && i + k < types.length; k++) {
      groupStart[i + k] = i;
      groupSize[i + k] = size;
    }
    i += Math.max(1, size);
  }

  const memo = new Array<string | undefined>(types.length).fill(undefined);
  const inProgress = new Set<number>();

  const keyOf = (i: number): string => {
    const cached = memo[i];
    if (cached !== undefined) return cached;
    // A malformed module can point a group at itself through a path this
    // walk did not expect; fall back to the index rather than recurse.
    if (inProgress.has(i)) return `?${i}`;
    inProgress.add(i);
    const start = groupStart[i]!;
    const size = groupSize[i]!;
    const members: string[] = [];
    for (let k = 0; k < size && start + k < types.length; k++) {
      members.push(structKey(types[start + k]!, start, size));
    }
    const groupKey = members.join('|');
    for (let k = 0; k < size && start + k < types.length; k++) {
      memo[start + k] = `${groupKey}#${k}`;
    }
    inProgress.delete(i);
    return memo[i] ?? `?${i}`;
  };

  const vtKey = (vt: ValueType, start: number, size: number): string => {
    if (!isRefValueType(vt)) return `t${vt.toString(16)}`;
    const h = vt.heapType;
    const n = vt.nullable ? '?' : '!';
    if (h.kind !== 'index') return `${n}a:${h.name}`;
    if (h.value >= start && h.value < start + size) return `${n}r:${h.value - start}`;
    return `${n}k:${keyOf(h.value)}`;
  };

  const fieldKey = (f: Field, start: number, size: number): string =>
    `${f.mutable ? 'm' : 'c'}${vtKey(f.type, start, size)}`;

  function structKey(te: TypeEntry, start: number, size: number): string {
    // A supertype inside the SAME rec group has to be keyed by position too,
    // exactly like a field reference. Keying it by `keyOf` recurses into the
    // group being built, hits the in-progress guard, and bakes a raw index
    // into the key — which made two structurally identical rec groups
    // (type-subtyping.wast) come out with different keys.
    const superKey = (sv: Var): string => {
      if (sv.kind !== 'index') return sv.name;
      return sv.value >= start && sv.value < start + size
        ? `r:${sv.value - start}`
        : `k:${keyOf(sv.value)}`;
    };
    const sub = te.sub === undefined
      ? 'F'
      : `${te.sub.final ? 'F' : 'N'}[${te.sub.supertypes.map(superKey).join(',')}]`;
    if (te.kind === 'func') {
      return `${sub}func(${te.sig.params.map((p) => vtKey(p, start, size)).join(',')})->(${
        te.sig.results.map((r) => vtKey(r, start, size)).join(',')
      })`;
    }
    if (te.kind === 'struct') {
      return `${sub}struct(${te.fields.map((f) => fieldKey(f, start, size)).join(',')})`;
    }
    return `${sub}array(${te.field ? fieldKey(te.field, start, size) : ''})`;
  }

  return types.map((_, i) => keyOf(i));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Validates a decoded WebAssembly module, appending errors to {@link errors}.
 *  Returns Result.Ok if valid, Result.Error otherwise. */
export function validateModule(
  module: Module,
  errors: ErrorList,
  options?: ValidateOptions,
): Result {
  const v = new ModuleValidator(module, errors, options);
  return v.checkModule();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function varIdx(v: Var): number {
  return v.kind === 'index' ? v.value : 0;
}

// ---------------------------------------------------------------------------
// ModuleValidator — walks the IR and calls SharedValidator
// ---------------------------------------------------------------------------

class ModuleValidator implements ExprVisitorDelegate {
  private sv: SharedValidator;
  private module: Module;
  private result: Result = Result.Ok;

  constructor(module: Module, errors: ErrorList, options?: ValidateOptions) {
    this.module = module;
    this.sv = new SharedValidator(errors, options);
  }

  // -------------------------------------------------------------------------
  // Module-level traversal
  // -------------------------------------------------------------------------

  checkModule(): Result {
    const m = this.module;
    const loc = m.loc;

    // Types. The declared `(sub $Super …)` list travels with each entry so the
    // TypeChecker can answer `$A <: $B` for DEFINED types (T9.3); it used to
    // be dropped here, and every concrete ref was coarsened anyway.
    const canon = canonicalTypeKeys(m.types);
    for (const [i, te] of m.types.entries()) {
      const supers = (te.sub?.supertypes ?? [])
        .map((v) => (v.kind === 'index' ? v.value : -1))
        .filter((n) => n >= 0);
      const c = canon[i] ?? '';
      if (te.kind === 'func') {
        this.acc(this.sv.onFuncType(te.loc, te.sig.params, te.sig.results, i, supers, c));
      } else if (te.kind === 'struct') {
        this.acc(this.sv.onStructType(te.loc, te.fields, supers, c));
      } else {
        this.acc(this.sv.onArrayType(te.loc, te.field, supers, c));
      }
    }

    // Imports
    let funcImportIdx = 0;
    for (const imp of m.imports) {
      switch (imp.kind) {
        case ExternalKind.Func: {
          const sigIdx = varIdx(imp.func.typeVar);
          this.acc(this.sv.onFunction(imp.func.loc, sigIdx));
          funcImportIdx++;
          break;
        }
        case ExternalKind.Table:
          this.acc(this.sv.onTable(imp.table.loc, imp.table.elemType, imp.table.limits));
          break;
        case ExternalKind.Memory:
          this.acc(this.sv.onMemory(imp.memory.loc, imp.memory.limits));
          break;
        case ExternalKind.Global:
          this.acc(this.sv.onGlobalImport(imp.global.loc, imp.global.type, imp.global.mutable));
          break;
        case ExternalKind.Tag:
          // A tag's type is the func type with the same params and no results.
          // Resolve it the same way as a defined tag rather than assuming
          // index 0 (which silently mis-typed any non-first tag signature).
          this.acc(
            this.sv.onTag(
              imp.tag.loc,
              this.resolveTagSig(imp.tag.sig.params, imp.tag.sig.results),
            ),
          );
          break;
      }
    }

    // Defined functions (type registration only; bodies come later)
    for (const func of m.funcs) {
      this.acc(this.sv.onFunction(func.loc, varIdx(func.typeVar)));
    }

    // Tables
    for (const table of m.tables) {
      this.acc(this.sv.onTable(table.loc, table.elemType, table.limits));
      if (table.init.length > 0) {
        this.acc(this.sv.beginInitExpr(table.loc, table.elemType));
        this.visitExprList(table.init);
        this.acc(this.sv.endInitExpr());
      }
    }

    // Memories
    for (const mem of m.memories) {
      this.acc(this.sv.onMemory(mem.loc, mem.limits));
    }

    // Globals
    for (const global of m.globals) {
      this.acc(this.sv.onGlobal(global.loc, global.type, global.mutable));
      this.acc(this.sv.beginInitExpr(global.loc, global.type));
      this.visitExprList(global.init);
      this.acc(this.sv.endInitExpr());
    }

    // Tags
    for (const tag of m.tags) {
      const sigIdx = this.resolveTagSig(tag.sig.params, tag.sig.results);
      this.acc(this.sv.onTag(tag.loc, sigIdx));
    }

    // Exports
    for (const exp of m.exports) {
      this.acc(this.sv.onExport(loc, exp.kind, varIdx(exp.var), exp.name));
    }

    // Start
    if (m.start !== undefined) {
      this.acc(this.sv.onStart(loc, varIdx(m.start)));
    }

    // Elem segments
    for (const elem of m.elemSegments) {
      this.acc(this.sv.onElemSegment(elem.loc, varIdx(elem.tableVar), elem.kind));
      this.acc(this.sv.onElemSegmentElemType(elem.loc, elem.elemType));
      if (elem.kind === 'active') {
        // An active segment's offset is indexed in the TABLE's index type —
        // i64 for a table64 table. Hard-coding i32 rejected every 64-bit
        // active segment with "type mismatch in function".
        const offsetType = this.sv.tableIndexType(varIdx(elem.tableVar));
        this.acc(this.sv.beginInitExpr(elem.loc, offsetType));
        this.visitExprList(elem.offset);
        this.acc(this.sv.endInitExpr());
      }
      for (const elemExpr of elem.elemExprs) {
        this.acc(this.sv.beginInitExpr(elem.loc, elem.elemType));
        this.visitExprList(elemExpr);
        this.acc(this.sv.endInitExpr());
      }
    }

    // Data count
    this.sv.onDataCount(m.dataSegments.length);

    // Function bodies
    const visitor = new ExprVisitor(this);
    let globalFuncIdx = m.numFuncImports;
    for (const func of m.funcs) {
      this.acc(this.sv.beginFunctionBody(func.loc, globalFuncIdx++));
      for (const decl of func.localDecls) {
        this.acc(this.sv.onLocalDecl(func.loc, decl.count, decl.type));
      }
      this.acc(visitor.visitExprList(func.body));
      this.acc(this.sv.endFunctionBody(func.loc));
    }

    // Data segments (init offsets)
    for (const seg of m.dataSegments) {
      this.acc(this.sv.onDataSegment(seg.loc, varIdx(seg.memoryVar), seg.kind));
      if (seg.kind === 'active') {
        // Same for data: the offset is in the MEMORY's index type.
        this.acc(this.sv.beginInitExpr(seg.loc, this.sv.memoryIndexType(varIdx(seg.memoryVar))));
        this.visitExprList(seg.offset);
        this.acc(this.sv.endInitExpr());
      }
    }

    this.acc(this.sv.endModule());
    return this.result;
  }

  private acc(r: Result): void {
    this.result = combineResults(this.result, r);
  }

  private visitExprList(exprs: Expr[]): void {
    const visitor = new ExprVisitor(this);
    this.acc(visitor.visitExprList(exprs));
  }

  private resolveTagSig(params: ValueType[], results: ValueType[]): number {
    for (const [i, te] of this.module.types.entries()) {
      if (
        te.kind === 'func' &&
        te.sig.params.length === params.length &&
        te.sig.results.length === results.length &&
        te.sig.params.every((t, j) => t === params[j]) &&
        te.sig.results.every((t, j) => t === results[j])
      ) {
        return i;
      }
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // ExprVisitorDelegate — one method per expression kind
  // -------------------------------------------------------------------------

  onNopExpr(e: NopExpr): Result {
    return this.sv.onNop(e.loc);
  }
  onUnreachableExpr(e: UnreachableExpr): Result {
    return this.sv.onUnreachable(e.loc);
  }

  onReturnExpr(e: ReturnExpr): Result {
    return this.sv.onReturn(e.loc);
  }
  onDropExpr(e: DropExpr): Result {
    return this.sv.onDrop(e.loc);
  }

  onSelectExpr(e: SelectExpr): Result {
    return this.sv.onSelect(e.loc, e.resultType);
  }

  beginBlockExpr(e: BlockExpr): Result {
    return this.sv.onBlock(e.loc, e.blockType);
  }
  endBlockExpr(e: BlockExpr): Result {
    return this.sv.onEnd(e.loc);
  }
  beginLoopExpr(e: LoopExpr): Result {
    return this.sv.onLoop(e.loc, e.blockType);
  }
  endLoopExpr(e: LoopExpr): Result {
    return this.sv.onEnd(e.loc);
  }
  beginIfExpr(e: IfExpr): Result {
    return this.sv.onIf(e.loc, e.blockType);
  }
  afterIfTrueExpr(e: IfExpr): Result {
    return e.else_.length > 0 ? this.sv.onElse(e.loc) : Result.Ok;
  }
  endIfExpr(e: IfExpr): Result {
    return this.sv.onEnd(e.loc);
  }

  onBrExpr(e: BrExpr): Result {
    return this.sv.onBr(e.loc, varIdx(e.target));
  }
  onBrIfExpr(e: BrIfExpr): Result {
    return this.sv.onBrIf(e.loc, varIdx(e.target));
  }
  onBrOnNullExpr(e: BrOnNullExpr): Result {
    return this.sv.onBrOnNull(e.loc, varIdx(e.target));
  }
  onBrOnCastExpr(e: BrOnCastExpr): Result {
    return this.sv.onBrOnCast(
      e.loc,
      varIdx(e.target),
      e.onFail,
      { kind: 'ref', heapType: e.from.heapType, nullable: e.from.nullable },
      { kind: 'ref', heapType: e.to.heapType, nullable: e.to.nullable },
    );
  }
  onBrOnNonNullExpr(e: BrOnNonNullExpr): Result {
    return this.sv.onBrOnNonNull(e.loc, varIdx(e.target));
  }

  onBrTableExpr(e: BrTableExpr): Result {
    let r = this.sv.beginBrTable(e.loc);
    for (const t of e.targets) {
      r = combineResults(r, this.sv.onBrTableTarget(e.loc, varIdx(t)));
    }
    r = combineResults(r, this.sv.onBrTableTarget(e.loc, varIdx(e.defaultTarget)));
    r = combineResults(r, this.sv.endBrTable(e.loc));
    return r;
  }

  onConstExpr(e: ConstExpr): Result {
    return this.sv.onConst(e.loc, e.value.type);
  }

  onLocalGetExpr(e: LocalGetExpr): Result {
    return this.sv.onLocalGet(e.loc, varIdx(e.var));
  }
  onLocalSetExpr(e: LocalSetExpr): Result {
    return this.sv.onLocalSet(e.loc, varIdx(e.var));
  }
  onLocalTeeExpr(e: LocalTeeExpr): Result {
    return this.sv.onLocalTee(e.loc, varIdx(e.var));
  }
  onGlobalGetExpr(e: GlobalGetExpr): Result {
    return this.sv.onGlobalGet(e.loc, varIdx(e.var));
  }
  onGlobalSetExpr(e: GlobalSetExpr): Result {
    return this.sv.onGlobalSet(e.loc, varIdx(e.var));
  }

  onUnaryExpr(e: UnaryExpr): Result {
    return this.sv.onUnary(e.loc, e.opcode);
  }
  onBinaryExpr(e: BinaryExpr): Result {
    return this.sv.onBinary(e.loc, e.opcode);
  }
  onCompareExpr(e: CompareExpr): Result {
    return this.sv.onCompare(e.loc, e.opcode);
  }
  onConvertExpr(e: ConvertExpr): Result {
    return this.sv.onConvert(e.loc, e.opcode);
  }
  onTernaryExpr(e: TernaryExpr): Result {
    return this.sv.onTernary(e.loc, e.opcode);
  }
  onQuaternaryExpr(e: QuaternaryExpr): Result {
    return this.sv.onQuaternary(e.loc, e.opcode);
  }

  onLoadExpr(e: LoadExpr): Result {
    return this.sv.onLoad(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onStoreExpr(e: StoreExpr): Result {
    return this.sv.onStore(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }

  onMemorySizeExpr(e: MemorySizeExpr): Result {
    return this.sv.onMemorySize(e.loc, varIdx(e.memidx));
  }
  onMemoryGrowExpr(e: MemoryGrowExpr): Result {
    return this.sv.onMemoryGrow(e.loc, varIdx(e.memidx));
  }
  onMemoryCopyExpr(e: MemoryCopyExpr): Result {
    return this.sv.onMemoryCopy(e.loc, varIdx(e.destMemidx), varIdx(e.srcMemidx));
  }
  onMemoryFillExpr(e: MemoryFillExpr): Result {
    return this.sv.onMemoryFill(e.loc, varIdx(e.memidx));
  }
  onMemoryInitExpr(e: MemoryInitExpr): Result {
    return this.sv.onMemoryInit(e.loc, varIdx(e.segment), varIdx(e.memidx));
  }
  onDataDropExpr(e: DataDropExpr): Result {
    return this.sv.onDataDrop(e.loc, varIdx(e.segment));
  }

  onCallExpr(e: CallExpr): Result {
    return this.sv.onCall(e.loc, varIdx(e.func));
  }
  onCallIndirectExpr(e: CallIndirectExpr): Result {
    return this.sv.onCallIndirect(e.loc, varIdx(e.typeVar), varIdx(e.table));
  }
  onCallRefExpr(e: CallRefExpr): Result {
    return this.sv.onCallRef(e.loc, varIdx(e.sigType));
  }
  onReturnCallExpr(e: ReturnCallExpr): Result {
    return this.sv.onReturnCall(e.loc, varIdx(e.func));
  }
  onReturnCallIndirectExpr(e: ReturnCallIndirectExpr): Result {
    return this.sv.onReturnCallIndirect(e.loc, varIdx(e.typeVar), varIdx(e.table));
  }
  onReturnCallRefExpr(e: ReturnCallRefExpr): Result {
    return this.sv.onReturnCallRef(e.loc, varIdx(e.sigType));
  }

  onRefNullExpr(e: RefNullExpr): Result {
    // `refType` is a HEAP type, and `ref.null H` produces `(ref null H)`.
    // A user-defined `$T` used to coarsen to the abstract supertype of its
    // entry, which lost which type it was; it now travels as an index.
    return this.sv.onRefNull(e.loc, { kind: 'ref', heapType: e.refType, nullable: true });
  }

  /** Resolve a `ref.null` heap-type var to the value type it pushes. */
  private refNullType(v: Var): Type {
    if (v.kind === 'name') {
      const t = heapTypeNameToType(v.name);
      if (t !== null) return t;
      // Unresolved `$T` — resolveNames wasn't run. Fall back to the top of
      // the GC hierarchy rather than silently claiming funcref.
      return Type.AnyRef;
    }
    const te = this.module.types[v.value];
    if (te === undefined) return Type.AnyRef;
    switch (te.kind) {
      case 'func':
        return Type.FuncRef;
      case 'struct':
        return Type.StructRef;
      case 'array':
        return Type.ArrayRef;
      default:
        return Type.AnyRef;
    }
  }
  onRefIsNullExpr(e: RefIsNullExpr): Result {
    return this.sv.onRefIsNull(e.loc);
  }
  onRefFuncExpr(e: RefFuncExpr): Result {
    return this.sv.onRefFunc(e.loc, varIdx(e.func));
  }
  onRefAsNonNullExpr(e: RefAsNonNullExpr): Result {
    return this.sv.onRefAsNonNull(e.loc);
  }
  onRefEqExpr(e: RefEqExpr): Result {
    return this.sv.onRefEq(e.loc);
  }
  onRefI31Expr(e: RefI31Expr): Result {
    return this.sv.onRefI31(e.loc);
  }
  onExternConvertExpr(e: ExternConvertExpr): Result {
    return this.sv.onExternConvert(e.loc, e.kind === 'any.convert_extern');
  }
  onI31GetExpr(e: I31GetExpr): Result {
    return this.sv.onI31Get(e.loc);
  }
  onStructNewExpr(e: StructNewExpr): Result {
    return this.sv.onStructNew(e.loc, varIdx(e.typeVar));
  }
  onStructNewDefaultExpr(e: StructNewDefaultExpr): Result {
    return this.sv.onStructNewDefault(e.loc, varIdx(e.typeVar));
  }
  onStructGetExpr(e: StructGetExpr): Result {
    return this.sv.onStructGet(e.loc, varIdx(e.typeVar), varIdx(e.fieldVar), e.signed);
  }
  onStructSetExpr(e: StructSetExpr): Result {
    return this.sv.onStructSet(e.loc, varIdx(e.typeVar), varIdx(e.fieldVar));
  }
  onArrayNewExpr(e: ArrayNewExpr): Result {
    return this.sv.onArrayNew(e.loc, varIdx(e.typeVar));
  }
  onArrayNewDefaultExpr(e: ArrayNewDefaultExpr): Result {
    return this.sv.onArrayNewDefault(e.loc, varIdx(e.typeVar));
  }
  onArrayNewFixedExpr(e: ArrayNewFixedExpr): Result {
    return this.sv.onArrayNewFixed(e.loc, varIdx(e.typeVar), e.operands.length);
  }
  onArrayNewDataExpr(e: ArrayNewDataExpr): Result {
    return this.sv.onArrayNewData(e.loc, varIdx(e.typeVar), varIdx(e.dataVar));
  }
  onArrayNewElemExpr(e: ArrayNewElemExpr): Result {
    return this.sv.onArrayNewElem(e.loc, varIdx(e.typeVar), varIdx(e.elemVar));
  }
  onArrayGetExpr(e: ArrayGetExpr): Result {
    return this.sv.onArrayGet(e.loc, varIdx(e.typeVar));
  }
  onArraySetExpr(e: ArraySetExpr): Result {
    return this.sv.onArraySet(e.loc, varIdx(e.typeVar));
  }
  onArrayFillExpr(e: ArrayFillExpr): Result {
    return this.sv.onArrayFill(e.loc, varIdx(e.typeVar));
  }
  onArrayCopyExpr(e: ArrayCopyExpr): Result {
    return this.sv.onArrayCopy(e.loc, varIdx(e.destTypeVar), varIdx(e.srcTypeVar));
  }
  onArrayInitSegmentExpr(e: ArrayInitSegmentExpr): Result {
    return this.sv.onArrayInitSegment(e.loc, varIdx(e.typeVar));
  }
  onArrayLenExpr(e: ArrayLenExpr): Result {
    return this.sv.onArrayLen(e.loc);
  }
  onRefTestExpr(e: RefTestExpr): Result {
    return this.sv.onRefTest(e.loc);
  }
  onRefCastExpr(e: RefCastExpr): Result {
    // Hand over the type being cast TO — `(ref [null] H)` — so the result on
    // the stack is that type rather than an anonymous reference.
    return this.sv.onRefCast(e.loc, {
      kind: 'ref',
      heapType: e.heapType,
      nullable: e.nullable,
    });
  }

  onTableGetExpr(e: TableGetExpr): Result {
    return this.sv.onTableGet(e.loc, varIdx(e.table));
  }
  onTableSetExpr(e: TableSetExpr): Result {
    return this.sv.onTableSet(e.loc, varIdx(e.table));
  }
  onTableGrowExpr(e: TableGrowExpr): Result {
    return this.sv.onTableGrow(e.loc, varIdx(e.table));
  }
  onTableSizeExpr(e: TableSizeExpr): Result {
    return this.sv.onTableSize(e.loc, varIdx(e.table));
  }
  onTableFillExpr(e: TableFillExpr): Result {
    return this.sv.onTableFill(e.loc, varIdx(e.table));
  }
  onTableCopyExpr(e: TableCopyExpr): Result {
    return this.sv.onTableCopy(e.loc, varIdx(e.dst), varIdx(e.src));
  }
  onTableInitExpr(e: TableInitExpr): Result {
    return this.sv.onTableInit(e.loc, varIdx(e.segment), varIdx(e.table));
  }
  onElemDropExpr(e: ElemDropExpr): Result {
    return this.sv.onElemDrop(e.loc, varIdx(e.segment));
  }

  onThrowExpr(e: ThrowExpr): Result {
    return this.sv.onThrow(e.loc, varIdx(e.tag));
  }
  onThrowRefExpr(e: ThrowRefExpr): Result {
    return this.sv.onThrowRef(e.loc);
  }
  onRethrowExpr(e: RethrowExpr): Result {
    return this.sv.onRethrow(e.loc, varIdx(e.depth));
  }

  beginTryExpr(e: TryExpr): Result {
    return this.sv.onTry(e.loc, e.blockType);
  }
  onCatchExpr(_e: TryExpr, c: Catch, _i: number): Result {
    const isCatchAll = c.tag === undefined;
    return this.sv.onCatch(c.loc, c.tag ? varIdx(c.tag) : 0, isCatchAll);
  }
  onDelegateExpr(e: TryExpr): Result {
    return this.sv.onDelegate(e.loc, e.delegate ? varIdx(e.delegate) : 0);
  }
  endTryExpr(e: TryExpr): Result {
    return this.sv.onEnd(e.loc);
  }

  beginTryTableExpr(e: TryTableExpr): Result {
    let r = this.sv.beginTryTable(e.loc, e.blockType);
    // Bounds-check each catch clause's tag immediate (was previously never
    // validated — an out-of-range tag in a try_table catch validated clean).
    for (const c of e.catches) {
      r = combineResults(
        r,
        this.sv.onTryTableCatch(e.loc, c.kind, c.tag !== undefined ? varIdx(c.tag) : undefined),
      );
    }
    return r;
  }
  endTryTableExpr(e: TryTableExpr): Result {
    return this.sv.onEnd(e.loc);
  }

  onSimdLaneOpExpr(e: SimdLaneOpExpr): Result {
    return this.sv.onSimdLaneOp(e.loc, e.opcode, e.lane);
  }
  onSimdShuffleOpExpr(e: SimdShuffleOpExpr): Result {
    return this.sv.onSimdShuffleOp(e.loc, e.opcode);
  }
  onSimdLoadLaneExpr(e: SimdLoadLaneExpr): Result {
    return this.sv.onSimdLoadLane(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset, e.lane);
  }
  onSimdStoreLaneExpr(e: SimdStoreLaneExpr): Result {
    return this.sv.onSimdStoreLane(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset, e.lane);
  }
  onLoadSplatExpr(e: LoadSplatExpr): Result {
    return this.sv.onLoadSplat(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onLoadZeroExpr(e: LoadZeroExpr): Result {
    return this.sv.onLoadZero(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }

  onAtomicLoadExpr(e: AtomicLoadExpr): Result {
    return this.sv.onAtomicLoad(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicStoreExpr(e: AtomicStoreExpr): Result {
    return this.sv.onAtomicStore(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicRmwExpr(e: AtomicRmwExpr): Result {
    return this.sv.onAtomicRmw(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicRmwCmpxchgExpr(e: AtomicRmwCmpxchgExpr): Result {
    return this.sv.onAtomicRmwCmpxchg(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicWaitExpr(e: AtomicWaitExpr): Result {
    return this.sv.onAtomicWait(e.loc, e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicNotifyExpr(e: AtomicNotifyExpr): Result {
    // memory.atomic.notify is a single fixed opcode: prefix 0xfe, secondary 0x00
    // `(0xfe << 8) | 0x00` was the pre-T7.7 packing; opcodes are `<< 16` now,
    // so this key matched nothing and memory.atomic.notify went unchecked.
    const ATOMIC_NOTIFY_OPCODE = (PREFIX_THREADS << 16) | 0x00;
    return this.sv.onAtomicNotify(e.loc, ATOMIC_NOTIFY_OPCODE, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicFenceExpr(e: AtomicFenceExpr): Result {
    return this.sv.onAtomicFence(e.loc, e.consistencyModel);
  }

  onCodeMetadataExpr(_e: CodeMetadataExpr): Result {
    return Result.Ok;
  }
}
