// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/expr-visitor.h, src/expr-visitor.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Post-order expression visitor for the wabt-ts IR.
 *
 * The visitor walks a tree of {@link Expr} nodes depth-first (post-order):
 * children are visited before their parent. This matches the bottom-up
 * construction order required by the binaryen-ts bridge.
 *
 * Callers implement {@link ExprVisitorDelegate} (or extend {@link NopDelegate})
 * and pass it to {@link ExprVisitor}. Each delegate method returns
 * `Result.Ok` to continue or `Result.Error` to abort the walk early.
 *
 * Block-like expressions (`block`, `loop`, `if`, `try`, `try_table`) receive
 * Begin/End callbacks that bracket their body traversal.
 */

import { Result } from '../core/result.ts';
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
  Func,
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
} from './ir.ts';

// ---------------------------------------------------------------------------
// Delegate interface
// ---------------------------------------------------------------------------

/**
 * Callback interface for {@link ExprVisitor}.
 *
 * Each method returns `Result.Ok` to continue or `Result.Error` to abort
 * the walk. Methods may be omitted — the visitor treats absent methods as
 * returning `Result.Ok`.
 */
export interface ExprVisitorDelegate {
  onNopExpr?(e: NopExpr): Result;
  onUnreachableExpr?(e: UnreachableExpr): Result;
  onReturnExpr?(e: ReturnExpr): Result;
  onDropExpr?(e: DropExpr): Result;
  onSelectExpr?(e: SelectExpr): Result;

  beginBlockExpr?(e: BlockExpr): Result;
  endBlockExpr?(e: BlockExpr): Result;
  beginLoopExpr?(e: LoopExpr): Result;
  endLoopExpr?(e: LoopExpr): Result;
  beginIfExpr?(e: IfExpr): Result;
  afterIfTrueExpr?(e: IfExpr): Result;
  endIfExpr?(e: IfExpr): Result;

  onBrExpr?(e: BrExpr): Result;
  onBrIfExpr?(e: BrIfExpr): Result;
  onBrTableExpr?(e: BrTableExpr): Result;
  onBrOnNullExpr?(e: BrOnNullExpr): Result;
  onBrOnNonNullExpr?(e: BrOnNonNullExpr): Result;

  onConstExpr?(e: ConstExpr): Result;

  onLocalGetExpr?(e: LocalGetExpr): Result;
  onLocalSetExpr?(e: LocalSetExpr): Result;
  onLocalTeeExpr?(e: LocalTeeExpr): Result;
  onGlobalGetExpr?(e: GlobalGetExpr): Result;
  onGlobalSetExpr?(e: GlobalSetExpr): Result;

  onUnaryExpr?(e: UnaryExpr): Result;
  onBinaryExpr?(e: BinaryExpr): Result;
  onCompareExpr?(e: CompareExpr): Result;
  onConvertExpr?(e: ConvertExpr): Result;
  onTernaryExpr?(e: TernaryExpr): Result;
  onQuaternaryExpr?(e: QuaternaryExpr): Result;

  onLoadExpr?(e: LoadExpr): Result;
  onStoreExpr?(e: StoreExpr): Result;
  onMemorySizeExpr?(e: MemorySizeExpr): Result;
  onMemoryGrowExpr?(e: MemoryGrowExpr): Result;
  onMemoryCopyExpr?(e: MemoryCopyExpr): Result;
  onMemoryFillExpr?(e: MemoryFillExpr): Result;
  onMemoryInitExpr?(e: MemoryInitExpr): Result;
  onDataDropExpr?(e: DataDropExpr): Result;

  onCallExpr?(e: CallExpr): Result;
  onCallIndirectExpr?(e: CallIndirectExpr): Result;
  onCallRefExpr?(e: CallRefExpr): Result;
  onReturnCallExpr?(e: ReturnCallExpr): Result;
  onReturnCallIndirectExpr?(e: ReturnCallIndirectExpr): Result;
  onReturnCallRefExpr?(e: ReturnCallRefExpr): Result;

  onRefNullExpr?(e: RefNullExpr): Result;
  onRefIsNullExpr?(e: RefIsNullExpr): Result;
  onRefFuncExpr?(e: RefFuncExpr): Result;
  onRefAsNonNullExpr?(e: RefAsNonNullExpr): Result;
  onRefEqExpr?(e: RefEqExpr): Result;
  onRefI31Expr?(e: RefI31Expr): Result;
  onI31GetExpr?(e: I31GetExpr): Result;
  onStructNewExpr?(e: StructNewExpr): Result;
  onStructNewDefaultExpr?(e: StructNewDefaultExpr): Result;
  onStructGetExpr?(e: StructGetExpr): Result;
  onStructSetExpr?(e: StructSetExpr): Result;
  onArrayNewExpr?(e: ArrayNewExpr): Result;
  onArrayNewDefaultExpr?(e: ArrayNewDefaultExpr): Result;
  onArrayNewFixedExpr?(e: ArrayNewFixedExpr): Result;
  onArrayNewDataExpr?(e: ArrayNewDataExpr): Result;
  onArrayNewElemExpr?(e: ArrayNewElemExpr): Result;
  onArrayGetExpr?(e: ArrayGetExpr): Result;
  onArraySetExpr?(e: ArraySetExpr): Result;
  onArrayLenExpr?(e: ArrayLenExpr): Result;

  onTableGetExpr?(e: TableGetExpr): Result;
  onTableSetExpr?(e: TableSetExpr): Result;
  onTableGrowExpr?(e: TableGrowExpr): Result;
  onTableSizeExpr?(e: TableSizeExpr): Result;
  onTableFillExpr?(e: TableFillExpr): Result;
  onTableCopyExpr?(e: TableCopyExpr): Result;
  onTableInitExpr?(e: TableInitExpr): Result;
  onElemDropExpr?(e: ElemDropExpr): Result;

  onThrowExpr?(e: ThrowExpr): Result;
  onThrowRefExpr?(e: ThrowRefExpr): Result;
  onRethrowExpr?(e: RethrowExpr): Result;
  beginTryExpr?(e: TryExpr): Result;
  onCatchExpr?(e: TryExpr, c: Catch, catchIndex: number): Result;
  onDelegateExpr?(e: TryExpr): Result;
  endTryExpr?(e: TryExpr): Result;
  beginTryTableExpr?(e: TryTableExpr): Result;
  endTryTableExpr?(e: TryTableExpr): Result;

  onSimdLaneOpExpr?(e: SimdLaneOpExpr): Result;
  onSimdShuffleOpExpr?(e: SimdShuffleOpExpr): Result;
  onSimdLoadLaneExpr?(e: SimdLoadLaneExpr): Result;
  onSimdStoreLaneExpr?(e: SimdStoreLaneExpr): Result;
  onLoadSplatExpr?(e: LoadSplatExpr): Result;
  onLoadZeroExpr?(e: LoadZeroExpr): Result;

  onAtomicLoadExpr?(e: AtomicLoadExpr): Result;
  onAtomicStoreExpr?(e: AtomicStoreExpr): Result;
  onAtomicRmwExpr?(e: AtomicRmwExpr): Result;
  onAtomicRmwCmpxchgExpr?(e: AtomicRmwCmpxchgExpr): Result;
  onAtomicWaitExpr?(e: AtomicWaitExpr): Result;
  onAtomicNotifyExpr?(e: AtomicNotifyExpr): Result;
  onAtomicFenceExpr?(e: AtomicFenceExpr): Result;

  onCodeMetadataExpr?(e: CodeMetadataExpr): Result;
}

// ---------------------------------------------------------------------------
// NopDelegate — base class with all callbacks omitted (treated as Ok)
// ---------------------------------------------------------------------------

/** Extend this class and override only the methods you need. */
export class NopDelegate implements ExprVisitorDelegate {}

// ---------------------------------------------------------------------------
// ExprVisitor
// ---------------------------------------------------------------------------

export class ExprVisitor {
  private readonly d: ExprVisitorDelegate;

  constructor(delegate: ExprVisitorDelegate) {
    this.d = delegate;
  }

  visitExprList(exprs: Expr[]): Result {
    for (const expr of exprs) {
      const r = this.visitExpr(expr);
      if (r === Result.Error) return Result.Error;
    }
    return Result.Ok;
  }

  visitFunc(func: Func): Result {
    return this.visitExprList(func.body);
  }

  visitExpr(expr: Expr): Result {
    return this.dispatch(expr);
  }

  // ---------------------------------------------------------------------------
  // Internal dispatch — post-order: children first, then callback on parent
  // ---------------------------------------------------------------------------

  private dispatch(e: Expr): Result {
    switch (e.kind) {
      // --- No children, single callback ---
      case 'nop':
        return this.d.onNopExpr?.(e) ?? Result.Ok;
      case 'unreachable':
        return this.d.onUnreachableExpr?.(e) ?? Result.Ok;
      case 'const':
        return this.d.onConstExpr?.(e) ?? Result.Ok;
      case 'local.get':
        return this.d.onLocalGetExpr?.(e) ?? Result.Ok;
      case 'global.get':
        return this.d.onGlobalGetExpr?.(e) ?? Result.Ok;
      case 'memory.size':
        return this.d.onMemorySizeExpr?.(e) ?? Result.Ok;
      case 'table.size':
        return this.d.onTableSizeExpr?.(e) ?? Result.Ok;
      case 'ref.null':
        return this.d.onRefNullExpr?.(e) ?? Result.Ok;
      case 'ref.func':
        return this.d.onRefFuncExpr?.(e) ?? Result.Ok;
      case 'atomic_fence':
        return this.d.onAtomicFenceExpr?.(e) ?? Result.Ok;
      case 'data.drop':
        return this.d.onDataDropExpr?.(e) ?? Result.Ok;
      case 'elem.drop':
        return this.d.onElemDropExpr?.(e) ?? Result.Ok;
      case 'rethrow':
        return this.d.onRethrowExpr?.(e) ?? Result.Ok;
      case 'code_metadata':
        return this.d.onCodeMetadataExpr?.(e) ?? Result.Ok;

      // --- N children then callback ---
      case 'return': {
        for (const v of e.values) {
          const r = this.dispatch(v);
          if (r === Result.Error) return r;
        }
        return this.d.onReturnExpr?.(e) ?? Result.Ok;
      }
      case 'drop': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onDropExpr?.(e) ?? Result.Ok;
      }
      case 'local.set': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onLocalSetExpr?.(e) ?? Result.Ok;
      }
      case 'local.tee': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onLocalTeeExpr?.(e) ?? Result.Ok;
      }
      case 'global.set': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onGlobalSetExpr?.(e) ?? Result.Ok;
      }
      case 'unary': {
        const r = this.dispatch(e.operand);
        if (r === Result.Error) return r;
        return this.d.onUnaryExpr?.(e) ?? Result.Ok;
      }
      case 'convert': {
        const r = this.dispatch(e.operand);
        if (r === Result.Error) return r;
        return this.d.onConvertExpr?.(e) ?? Result.Ok;
      }
      case 'ref.is_null': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onRefIsNullExpr?.(e) ?? Result.Ok;
      }
      case 'ref.as_non_null': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onRefAsNonNullExpr?.(e) ?? Result.Ok;
      }
      case 'ref.eq': {
        let r = this.dispatch(e.left);
        if (r === Result.Error) return r;
        r = this.dispatch(e.right);
        if (r === Result.Error) return r;
        return this.d.onRefEqExpr?.(e) ?? Result.Ok;
      }
      case 'ref.i31': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onRefI31Expr?.(e) ?? Result.Ok;
      }
      case 'i31.get': {
        const r = this.dispatch(e.i31);
        if (r === Result.Error) return r;
        return this.d.onI31GetExpr?.(e) ?? Result.Ok;
      }
      case 'struct.new': {
        for (const op of e.operands) {
          const r = this.dispatch(op);
          if (r === Result.Error) return r;
        }
        return this.d.onStructNewExpr?.(e) ?? Result.Ok;
      }
      case 'struct.new_default':
        return this.d.onStructNewDefaultExpr?.(e) ?? Result.Ok;
      case 'struct.get': {
        const r = this.dispatch(e.ref);
        if (r === Result.Error) return r;
        return this.d.onStructGetExpr?.(e) ?? Result.Ok;
      }
      case 'struct.set': {
        let r = this.dispatch(e.ref);
        if (r === Result.Error) return r;
        r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onStructSetExpr?.(e) ?? Result.Ok;
      }
      case 'array.new': {
        let r = this.dispatch(e.init);
        if (r === Result.Error) return r;
        r = this.dispatch(e.length);
        if (r === Result.Error) return r;
        return this.d.onArrayNewExpr?.(e) ?? Result.Ok;
      }
      case 'array.new_default': {
        const r = this.dispatch(e.length);
        if (r === Result.Error) return r;
        return this.d.onArrayNewDefaultExpr?.(e) ?? Result.Ok;
      }
      case 'array.new_fixed': {
        for (const op of e.operands) {
          const r = this.dispatch(op);
          if (r === Result.Error) return r;
        }
        return this.d.onArrayNewFixedExpr?.(e) ?? Result.Ok;
      }
      case 'array.new_data': {
        let r = this.dispatch(e.offset);
        if (r === Result.Error) return r;
        r = this.dispatch(e.length);
        if (r === Result.Error) return r;
        return this.d.onArrayNewDataExpr?.(e) ?? Result.Ok;
      }
      case 'array.new_elem': {
        let r = this.dispatch(e.offset);
        if (r === Result.Error) return r;
        r = this.dispatch(e.length);
        if (r === Result.Error) return r;
        return this.d.onArrayNewElemExpr?.(e) ?? Result.Ok;
      }
      case 'array.get': {
        let r = this.dispatch(e.ref);
        if (r === Result.Error) return r;
        r = this.dispatch(e.index);
        if (r === Result.Error) return r;
        return this.d.onArrayGetExpr?.(e) ?? Result.Ok;
      }
      case 'array.set': {
        let r = this.dispatch(e.ref);
        if (r === Result.Error) return r;
        r = this.dispatch(e.index);
        if (r === Result.Error) return r;
        r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onArraySetExpr?.(e) ?? Result.Ok;
      }
      case 'array.len': {
        const r = this.dispatch(e.ref);
        if (r === Result.Error) return r;
        return this.d.onArrayLenExpr?.(e) ?? Result.Ok;
      }
      case 'memory.grow': {
        const r = this.dispatch(e.delta);
        if (r === Result.Error) return r;
        return this.d.onMemoryGrowExpr?.(e) ?? Result.Ok;
      }
      case 'table.get': {
        const r = this.dispatch(e.index);
        if (r === Result.Error) return r;
        return this.d.onTableGetExpr?.(e) ?? Result.Ok;
      }
      case 'load': {
        const r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        return this.d.onLoadExpr?.(e) ?? Result.Ok;
      }
      case 'atomic_load': {
        const r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        return this.d.onAtomicLoadExpr?.(e) ?? Result.Ok;
      }
      case 'load_splat': {
        const r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        return this.d.onLoadSplatExpr?.(e) ?? Result.Ok;
      }
      case 'load_zero': {
        const r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        return this.d.onLoadZeroExpr?.(e) ?? Result.Ok;
      }
      case 'simd_lane_op': {
        const r1 = this.dispatch(e.operand);
        if (r1 === Result.Error) return r1;
        // replace_lane carries a second operand (the scalar replacement);
        // extract_lane variants leave `value` undefined.
        if (e.value !== undefined) {
          const r2 = this.dispatch(e.value);
          if (r2 === Result.Error) return r2;
        }
        return this.d.onSimdLaneOpExpr?.(e) ?? Result.Ok;
      }
      case 'throw_ref': {
        const r = this.dispatch(e.exnref);
        if (r === Result.Error) return r;
        return this.d.onThrowRefExpr?.(e) ?? Result.Ok;
      }

      // --- Two children then callback ---
      case 'binary': {
        let r = this.dispatch(e.left);
        if (r === Result.Error) return r;
        r = this.dispatch(e.right);
        if (r === Result.Error) return r;
        return this.d.onBinaryExpr?.(e) ?? Result.Ok;
      }
      case 'compare': {
        let r = this.dispatch(e.left);
        if (r === Result.Error) return r;
        r = this.dispatch(e.right);
        if (r === Result.Error) return r;
        return this.d.onCompareExpr?.(e) ?? Result.Ok;
      }
      case 'store': {
        let r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onStoreExpr?.(e) ?? Result.Ok;
      }
      case 'atomic_store': {
        let r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onAtomicStoreExpr?.(e) ?? Result.Ok;
      }
      case 'atomic_rmw': {
        let r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onAtomicRmwExpr?.(e) ?? Result.Ok;
      }
      case 'atomic_notify': {
        let r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        r = this.dispatch(e.count);
        if (r === Result.Error) return r;
        return this.d.onAtomicNotifyExpr?.(e) ?? Result.Ok;
      }
      case 'table.set': {
        let r = this.dispatch(e.index);
        if (r === Result.Error) return r;
        r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onTableSetExpr?.(e) ?? Result.Ok;
      }
      case 'table.grow': {
        let r = this.dispatch(e.initValue);
        if (r === Result.Error) return r;
        r = this.dispatch(e.delta);
        if (r === Result.Error) return r;
        return this.d.onTableGrowExpr?.(e) ?? Result.Ok;
      }
      case 'simd_shuffle': {
        let r = this.dispatch(e.left);
        if (r === Result.Error) return r;
        r = this.dispatch(e.right);
        if (r === Result.Error) return r;
        return this.d.onSimdShuffleOpExpr?.(e) ?? Result.Ok;
      }
      case 'simd_load_lane': {
        let r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        r = this.dispatch(e.vec);
        if (r === Result.Error) return r;
        return this.d.onSimdLoadLaneExpr?.(e) ?? Result.Ok;
      }
      case 'simd_store_lane': {
        let r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        r = this.dispatch(e.vec);
        if (r === Result.Error) return r;
        return this.d.onSimdStoreLaneExpr?.(e) ?? Result.Ok;
      }

      // --- Branches with optional values ---
      case 'br': {
        if (e.value !== undefined) {
          const r = this.dispatch(e.value);
          if (r === Result.Error) return r;
        }
        return this.d.onBrExpr?.(e) ?? Result.Ok;
      }
      case 'br_if': {
        if (e.value !== undefined) {
          const r = this.dispatch(e.value);
          if (r === Result.Error) return r;
        }
        const rc = this.dispatch(e.cond);
        if (rc === Result.Error) return rc;
        return this.d.onBrIfExpr?.(e) ?? Result.Ok;
      }
      case 'br_table': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onBrTableExpr?.(e) ?? Result.Ok;
      }
      case 'br_on_null': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onBrOnNullExpr?.(e) ?? Result.Ok;
      }
      case 'br_on_non_null': {
        const r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        return this.d.onBrOnNonNullExpr?.(e) ?? Result.Ok;
      }

      // --- Three children ---
      case 'select': {
        let r = this.dispatch(e.val1);
        if (r === Result.Error) return r;
        r = this.dispatch(e.val2);
        if (r === Result.Error) return r;
        r = this.dispatch(e.cond);
        if (r === Result.Error) return r;
        return this.d.onSelectExpr?.(e) ?? Result.Ok;
      }
      case 'memory.copy': {
        let r = this.dispatch(e.dest);
        if (r === Result.Error) return r;
        r = this.dispatch(e.src);
        if (r === Result.Error) return r;
        r = this.dispatch(e.size);
        if (r === Result.Error) return r;
        return this.d.onMemoryCopyExpr?.(e) ?? Result.Ok;
      }
      case 'memory.fill': {
        let r = this.dispatch(e.dest);
        if (r === Result.Error) return r;
        r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        r = this.dispatch(e.size);
        if (r === Result.Error) return r;
        return this.d.onMemoryFillExpr?.(e) ?? Result.Ok;
      }
      case 'memory.init': {
        let r = this.dispatch(e.dest);
        if (r === Result.Error) return r;
        r = this.dispatch(e.src);
        if (r === Result.Error) return r;
        r = this.dispatch(e.size);
        if (r === Result.Error) return r;
        return this.d.onMemoryInitExpr?.(e) ?? Result.Ok;
      }
      case 'table.copy': {
        let r = this.dispatch(e.dest);
        if (r === Result.Error) return r;
        r = this.dispatch(e.srcOffset);
        if (r === Result.Error) return r;
        r = this.dispatch(e.size);
        if (r === Result.Error) return r;
        return this.d.onTableCopyExpr?.(e) ?? Result.Ok;
      }
      case 'table.fill': {
        let r = this.dispatch(e.start);
        if (r === Result.Error) return r;
        r = this.dispatch(e.value);
        if (r === Result.Error) return r;
        r = this.dispatch(e.size);
        if (r === Result.Error) return r;
        return this.d.onTableFillExpr?.(e) ?? Result.Ok;
      }
      case 'table.init': {
        let r = this.dispatch(e.dest);
        if (r === Result.Error) return r;
        r = this.dispatch(e.src);
        if (r === Result.Error) return r;
        r = this.dispatch(e.size);
        if (r === Result.Error) return r;
        return this.d.onTableInitExpr?.(e) ?? Result.Ok;
      }
      case 'atomic_rmw_cmpxchg': {
        let r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        r = this.dispatch(e.expected);
        if (r === Result.Error) return r;
        r = this.dispatch(e.replacement);
        if (r === Result.Error) return r;
        return this.d.onAtomicRmwCmpxchgExpr?.(e) ?? Result.Ok;
      }
      case 'atomic_wait': {
        let r = this.dispatch(e.address);
        if (r === Result.Error) return r;
        r = this.dispatch(e.expected);
        if (r === Result.Error) return r;
        r = this.dispatch(e.timeout);
        if (r === Result.Error) return r;
        return this.d.onAtomicWaitExpr?.(e) ?? Result.Ok;
      }
      case 'ternary': {
        let r = this.dispatch(e.a);
        if (r === Result.Error) return r;
        r = this.dispatch(e.b);
        if (r === Result.Error) return r;
        r = this.dispatch(e.c);
        if (r === Result.Error) return r;
        return this.d.onTernaryExpr?.(e) ?? Result.Ok;
      }

      // --- Four children ---
      case 'quaternary': {
        let r = this.dispatch(e.a);
        if (r === Result.Error) return r;
        r = this.dispatch(e.b);
        if (r === Result.Error) return r;
        r = this.dispatch(e.c);
        if (r === Result.Error) return r;
        r = this.dispatch(e.d);
        if (r === Result.Error) return r;
        return this.d.onQuaternaryExpr?.(e) ?? Result.Ok;
      }

      // --- Calls: visit args in order, then callback ---
      case 'call': {
        for (const arg of e.args) {
          const r = this.dispatch(arg);
          if (r === Result.Error) return r;
        }
        return this.d.onCallExpr?.(e) ?? Result.Ok;
      }
      case 'call_indirect': {
        for (const arg of e.args) {
          const r = this.dispatch(arg);
          if (r === Result.Error) return r;
        }
        const r = this.dispatch(e.callee);
        if (r === Result.Error) return r;
        return this.d.onCallIndirectExpr?.(e) ?? Result.Ok;
      }
      case 'call_ref': {
        for (const arg of e.args) {
          const r = this.dispatch(arg);
          if (r === Result.Error) return r;
        }
        const r = this.dispatch(e.callee);
        if (r === Result.Error) return r;
        return this.d.onCallRefExpr?.(e) ?? Result.Ok;
      }
      case 'return_call': {
        for (const arg of e.args) {
          const r = this.dispatch(arg);
          if (r === Result.Error) return r;
        }
        return this.d.onReturnCallExpr?.(e) ?? Result.Ok;
      }
      case 'return_call_indirect': {
        for (const arg of e.args) {
          const r = this.dispatch(arg);
          if (r === Result.Error) return r;
        }
        const r = this.dispatch(e.callee);
        if (r === Result.Error) return r;
        return this.d.onReturnCallIndirectExpr?.(e) ?? Result.Ok;
      }
      case 'return_call_ref': {
        for (const arg of e.args) {
          const r = this.dispatch(arg);
          if (r === Result.Error) return r;
        }
        const r = this.dispatch(e.callee);
        if (r === Result.Error) return r;
        return this.d.onReturnCallRefExpr?.(e) ?? Result.Ok;
      }

      // --- Throw: visit args ---
      case 'throw': {
        for (const arg of e.args) {
          const r = this.dispatch(arg);
          if (r === Result.Error) return r;
        }
        return this.d.onThrowExpr?.(e) ?? Result.Ok;
      }

      // --- Block-like: Begin / body / End ---
      case 'block': {
        let r = this.d.beginBlockExpr?.(e) ?? Result.Ok;
        if (r === Result.Error) return r;
        r = this.visitExprList(e.body);
        if (r === Result.Error) return r;
        return this.d.endBlockExpr?.(e) ?? Result.Ok;
      }
      case 'loop': {
        let r = this.d.beginLoopExpr?.(e) ?? Result.Ok;
        if (r === Result.Error) return r;
        r = this.visitExprList(e.body);
        if (r === Result.Error) return r;
        return this.d.endLoopExpr?.(e) ?? Result.Ok;
      }
      case 'if': {
        let r = this.dispatch(e.cond);
        if (r === Result.Error) return r;
        r = this.d.beginIfExpr?.(e) ?? Result.Ok;
        if (r === Result.Error) return r;
        r = this.visitExprList(e.then_);
        if (r === Result.Error) return r;
        r = this.d.afterIfTrueExpr?.(e) ?? Result.Ok;
        if (r === Result.Error) return r;
        r = this.visitExprList(e.else_);
        if (r === Result.Error) return r;
        return this.d.endIfExpr?.(e) ?? Result.Ok;
      }
      case 'try': {
        let r = this.d.beginTryExpr?.(e) ?? Result.Ok;
        if (r === Result.Error) return r;
        r = this.visitExprList(e.body);
        if (r === Result.Error) return r;
        if (e.delegate !== undefined) {
          return this.d.onDelegateExpr?.(e) ?? Result.Ok;
        }
        for (const [i, c] of e.catches.entries()) {
          r = this.d.onCatchExpr?.(e, c, i) ?? Result.Ok;
          if (r === Result.Error) return r;
          r = this.visitExprList(c.body);
          if (r === Result.Error) return r;
        }
        return this.d.endTryExpr?.(e) ?? Result.Ok;
      }
      case 'try_table': {
        let r = this.d.beginTryTableExpr?.(e) ?? Result.Ok;
        if (r === Result.Error) return r;
        r = this.visitExprList(e.body);
        if (r === Result.Error) return r;
        return this.d.endTryTableExpr?.(e) ?? Result.Ok;
      }

      default: {
        const _exhaust: never = e;
        return Result.Ok;
      }
    }
  }
}
