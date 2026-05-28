// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/validator.cc / include/wabt/validator.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import { combineResults, Result } from '../core/result.ts';
import { Type } from '../core/types.ts';
import { ExternalKind } from '../core/binary.ts';
import type { ErrorList } from '../core/error.ts';
import type {
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
  GlobalGetExpr,
  GlobalSetExpr,
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
  I31GetExpr,
  RefAsNonNullExpr,
  RefEqExpr,
  RefFuncExpr,
  RefI31Expr,
  RefIsNullExpr,
  ArrayGetExpr,
  ArrayLenExpr,
  ArrayNewDataExpr,
  ArrayNewDefaultExpr,
  ArrayNewElemExpr,
  ArrayNewExpr,
  ArrayNewFixedExpr,
  ArraySetExpr,
  RefCastExpr,
  RefTestExpr,
  StructGetExpr,
  StructNewDefaultExpr,
  StructNewExpr,
  StructSetExpr,
  RefNullExpr,
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

    // Types
    for (const [i, te] of m.types.entries()) {
      if (te.kind === 'func') {
        this.acc(this.sv.onFuncType(te.loc, te.sig.params, te.sig.results, i));
      } else if (te.kind === 'struct') {
        this.acc(this.sv.onStructType(te.loc, te.fields));
      } else {
        this.acc(this.sv.onArrayType(te.loc, te.field));
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
          this.acc(
            this.sv.onTag(
              imp.tag.loc,
              varIdx(
                imp.tag.sig.params.length > 0
                  ? { kind: 'index', value: 0 }
                  : { kind: 'index', value: 0 },
              ),
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
        const offsetType = Type.I32;
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
        this.acc(this.sv.beginInitExpr(seg.loc, Type.I32));
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

  private resolveTagSig(params: Type[], results: Type[]): number {
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
    const refType = e.refType.kind === 'index' ? e.refType.value as Type : Type.FuncRef;
    return this.sv.onRefNull(e.loc, refType);
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
  onArrayLenExpr(e: ArrayLenExpr): Result {
    return this.sv.onArrayLen(e.loc);
  }
  onRefTestExpr(e: RefTestExpr): Result {
    return this.sv.onRefTest(e.loc);
  }
  onRefCastExpr(e: RefCastExpr): Result {
    return this.sv.onRefCast(e.loc);
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
    return this.sv.beginTryTable(e.loc, e.blockType);
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
    const ATOMIC_NOTIFY_OPCODE = (0xfe << 8) | 0x00;
    return this.sv.onAtomicNotify(e.loc, ATOMIC_NOTIFY_OPCODE, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicFenceExpr(e: AtomicFenceExpr): Result {
    return this.sv.onAtomicFence(e.loc, e.consistencyModel);
  }

  onCodeMetadataExpr(_e: CodeMetadataExpr): Result {
    return Result.Ok;
  }
}
