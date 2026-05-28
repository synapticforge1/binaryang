// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/binary-writer.h, src/binary-writer.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

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
  BlockType,
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
  Module,
  NopExpr,
  QuaternaryExpr,
  I31GetExpr,
  RefAsNonNullExpr,
  RefEqExpr,
  RefFuncExpr,
  RefI31Expr,
  RefIsNullExpr,
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
import { CatchKind } from '../ir/ir.ts';
import { Type } from '../core/types.ts';
import { Result } from '../core/result.ts';
import {
  GcOpcode,
  naturalAlignForOpcode,
  Opcode,
  PREFIX_GC,
  PREFIX_MISC,
  PREFIX_SIMD,
  PREFIX_THREADS,
} from '../core/opcode.ts';
import {
  BinarySection,
  ExternalKind,
  LIMITS_HAS_CUSTOM_PAGE_SIZE_FLAG,
  LIMITS_HAS_MAX_FLAG,
  LIMITS_IS_64_FLAG,
  LIMITS_IS_SHARED_FLAG,
  WASM_MAGIC,
  WASM_VERSION,
} from '../core/binary.ts';
import { MemoryStream } from './stream.ts';
import { ExprVisitor } from '../ir/expr-visitor.ts';
import type { ExprVisitorDelegate } from '../ir/expr-visitor.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeVar(s: MemoryStream, v: Var): void {
  s.writeU32Leb(v.kind === 'index' ? v.value : 0);
}

function writeBlockType(s: MemoryStream, bt: BlockType): void {
  if (bt.kind === 'void') {
    s.writeU8(0x40);
  } else if (bt.kind === 'value') {
    s.writeU8(bt.type as number);
  } else {
    s.writeS32Leb(bt.typeIdx);
  }
}

function writeOpcode(s: MemoryStream, op: number): void {
  const prefix = (op >>> 8) & 0xff;
  if (prefix === 0) {
    s.writeU8(op & 0xff);
  } else {
    s.writeU8(prefix);
    s.writeU32Leb(op & 0xff);
  }
}

/**
 * Combined opcode value (prefix << 8 | subop, or the bare core opcode) for
 * the load/store-family IR node passed in. All such nodes carry an `opcode`
 * field except `AtomicNotifyExpr`, where the opcode is implicit because
 * `memory.atomic.notify` is a single fixed instruction with no encoding
 * variants. Centralizing the lookup keeps the writeMemArg call sites
 * uniform.
 */
function opcodeOf(e: unknown): number {
  const op = (e as { opcode?: number }).opcode;
  return op ?? ((PREFIX_THREADS << 8) | 0x00);
}

function writeMemArg(
  s: MemoryStream,
  alignBytes: number,
  offset: bigint,
  memidx: Var,
  opcode: number,
): void {
  // wabt-ts IR stores align in BYTES (e.g. 4 for i32) with 0 meaning
  // "no explicit `align=N` keyword in WAT — use the opcode's natural
  // alignment". The binary spec encodes align as a log2 exponent, so
  // 4 bytes → exponent 2. Previously this function wrote the raw byte
  // value, which produced binaries where:
  //   - default-aligned ops emitted align=0 (1-byte alignment); accepted
  //     by V8 but defeated binaryen's optimizer because the field signals
  //     a tighter alignment constraint than the user intended.
  //   - explicit-aligned ops (rare) emitted byte value 4 = 2^4 = 16-byte
  //     alignment, which V8 rejects as larger than natural.
  // Fix: resolve natural when align=0, then log2-encode.
  const bytes = alignBytes === 0 ? naturalAlignForOpcode(opcode) : alignBytes;
  const alignLog2 = Math.log2(bytes);
  const idx = memidx.kind === 'index' ? memidx.value : 0;
  if (idx !== 0) {
    s.writeU32Leb(alignLog2 | 0x40); // bit 6 set = explicit memidx follows
    s.writeU32Leb(idx);
  } else {
    s.writeU32Leb(alignLog2);
  }
  s.writeU64Leb(offset);
}

function writeLimits(
  s: MemoryStream,
  lim: { initial: number; max?: number; isShared: boolean; is64: boolean; pageSize?: number },
): void {
  let flags = 0;
  if (lim.max !== undefined) flags |= LIMITS_HAS_MAX_FLAG;
  if (lim.isShared) flags |= LIMITS_IS_SHARED_FLAG;
  if (lim.is64) flags |= LIMITS_IS_64_FLAG;
  if (lim.pageSize !== undefined && lim.pageSize !== 65536) {
    flags |= LIMITS_HAS_CUSTOM_PAGE_SIZE_FLAG;
  }
  s.writeU32Leb(flags);
  s.writeU32Leb(lim.initial);
  if (lim.max !== undefined) s.writeU32Leb(lim.max);
  if ((flags & LIMITS_HAS_CUSTOM_PAGE_SIZE_FLAG) !== 0 && lim.pageSize !== undefined) {
    s.writeU32Leb(lim.pageSize);
  }
}

function catchKindByte(k: CatchKind): number {
  switch (k) {
    case CatchKind.Catch:
      return 0x00;
    case CatchKind.CatchRef:
      return 0x01;
    case CatchKind.CatchAll:
      return 0x02;
    case CatchKind.CatchAllRef:
      return 0x03;
  }
}

// ---------------------------------------------------------------------------
// BodyWriter — ExprVisitorDelegate that emits opcodes into a MemoryStream
// ---------------------------------------------------------------------------

class BodyWriter implements ExprVisitorDelegate {
  constructor(private readonly s: MemoryStream) {}

  onNopExpr(_e: NopExpr): Result {
    this.s.writeU8(Opcode.Nop);
    return Result.Ok;
  }
  onUnreachableExpr(_e: UnreachableExpr): Result {
    this.s.writeU8(Opcode.Unreachable);
    return Result.Ok;
  }
  onReturnExpr(_e: ReturnExpr): Result {
    this.s.writeU8(Opcode.Return);
    return Result.Ok;
  }
  onDropExpr(_e: DropExpr): Result {
    this.s.writeU8(Opcode.Drop);
    return Result.Ok;
  }
  onSelectExpr(e: SelectExpr): Result {
    if (e.resultType.length === 0) {
      this.s.writeU8(Opcode.Select);
    } else {
      this.s.writeU8(Opcode.SelectT);
      this.s.writeU32Leb(e.resultType.length);
      for (const t of e.resultType) this.s.writeU8(t as number);
    }
    return Result.Ok;
  }

  // --- Block structures ---
  beginBlockExpr(e: BlockExpr): Result {
    this.s.writeU8(Opcode.Block);
    writeBlockType(this.s, e.blockType);
    return Result.Ok;
  }
  endBlockExpr(_e: BlockExpr): Result {
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }
  beginLoopExpr(e: LoopExpr): Result {
    this.s.writeU8(Opcode.Loop);
    writeBlockType(this.s, e.blockType);
    return Result.Ok;
  }
  endLoopExpr(_e: LoopExpr): Result {
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }
  beginIfExpr(e: IfExpr): Result {
    this.s.writeU8(Opcode.If);
    writeBlockType(this.s, e.blockType);
    return Result.Ok;
  }
  afterIfTrueExpr(e: IfExpr): Result {
    if (e.else_.length > 0) this.s.writeU8(Opcode.Else);
    return Result.Ok;
  }
  endIfExpr(_e: IfExpr): Result {
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }

  // --- try/catch (legacy exception handling) ---
  beginTryExpr(e: TryExpr): Result {
    this.s.writeU8(Opcode.Try);
    writeBlockType(this.s, e.blockType);
    return Result.Ok;
  }
  onCatchExpr(_e: TryExpr, c: Catch, _i: number): Result {
    if (c.tag !== undefined) {
      this.s.writeU8(c.isRef ? 0x08 : Opcode.Catch); // catch_ref = 0x08, catch = 0x07
      writeVar(this.s, c.tag);
    } else {
      this.s.writeU8(c.isRef ? 0x18 : Opcode.CatchAll); // catch_all_ref = 0x18, catch_all = 0x19
    }
    return Result.Ok;
  }
  onDelegateExpr(e: TryExpr): Result {
    this.s.writeU8(Opcode.Delegate);
    writeVar(this.s, e.delegate!);
    return Result.Ok;
  }
  endTryExpr(_e: TryExpr): Result {
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }

  // --- try_table (new exception handling) ---
  beginTryTableExpr(e: TryTableExpr): Result {
    this.s.writeU8(Opcode.TryTable);
    writeBlockType(this.s, e.blockType);
    this.s.writeU32Leb(e.catches.length);
    for (const c of e.catches) {
      this.s.writeU8(catchKindByte(c.kind));
      if (c.tag !== undefined) writeVar(this.s, c.tag);
      writeVar(this.s, c.target);
    }
    return Result.Ok;
  }
  endTryTableExpr(_e: TryTableExpr): Result {
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }

  // --- Branches ---
  onBrExpr(e: BrExpr): Result {
    this.s.writeU8(Opcode.Br);
    writeVar(this.s, e.target);
    return Result.Ok;
  }
  onBrIfExpr(e: BrIfExpr): Result {
    this.s.writeU8(Opcode.BrIf);
    writeVar(this.s, e.target);
    return Result.Ok;
  }
  onBrTableExpr(e: BrTableExpr): Result {
    this.s.writeU8(Opcode.BrTable);
    this.s.writeU32Leb(e.targets.length);
    for (const t of e.targets) writeVar(this.s, t);
    writeVar(this.s, e.defaultTarget);
    return Result.Ok;
  }
  onBrOnNullExpr(e: BrOnNullExpr): Result {
    this.s.writeU8(Opcode.BrOnNull);
    writeVar(this.s, e.target);
    return Result.Ok;
  }
  onBrOnNonNullExpr(e: BrOnNonNullExpr): Result {
    this.s.writeU8(Opcode.BrOnNonNull);
    writeVar(this.s, e.target);
    return Result.Ok;
  }

  // --- Constants ---
  onConstExpr(e: ConstExpr): Result {
    const v = e.value;
    if (v.type === Type.I32) {
      this.s.writeU8(Opcode.I32Const);
      this.s.writeS32Leb(v.value);
    } else if (v.type === Type.I64) {
      this.s.writeU8(Opcode.I64Const);
      this.s.writeS64Leb(v.value);
    } else if (v.type === Type.F32) {
      this.s.writeU8(Opcode.F32Const);
      this.s.writeF32Bits(v.bits);
    } else if (v.type === Type.F64) {
      this.s.writeU8(Opcode.F64Const);
      this.s.writeF64Bits(v.bits);
    } else if (v.type === Type.V128) {
      this.s.writeU8(PREFIX_SIMD);
      this.s.writeU32Leb(0x0c);
      this.s.writeV128(v.bytes);
    }
    return Result.Ok;
  }

  // --- Locals & globals ---
  onLocalGetExpr(e: LocalGetExpr): Result {
    this.s.writeU8(Opcode.LocalGet);
    writeVar(this.s, e.var);
    return Result.Ok;
  }
  onLocalSetExpr(e: LocalSetExpr): Result {
    this.s.writeU8(Opcode.LocalSet);
    writeVar(this.s, e.var);
    return Result.Ok;
  }
  onLocalTeeExpr(e: LocalTeeExpr): Result {
    this.s.writeU8(Opcode.LocalTee);
    writeVar(this.s, e.var);
    return Result.Ok;
  }
  onGlobalGetExpr(e: GlobalGetExpr): Result {
    this.s.writeU8(Opcode.GlobalGet);
    writeVar(this.s, e.var);
    return Result.Ok;
  }
  onGlobalSetExpr(e: GlobalSetExpr): Result {
    this.s.writeU8(Opcode.GlobalSet);
    writeVar(this.s, e.var);
    return Result.Ok;
  }

  // --- Arithmetic (opcode already encodes prefix for extended groups) ---
  onUnaryExpr(e: UnaryExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    return Result.Ok;
  }
  onBinaryExpr(e: BinaryExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    return Result.Ok;
  }
  onCompareExpr(e: CompareExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    return Result.Ok;
  }
  onConvertExpr(e: ConvertExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    return Result.Ok;
  }
  onTernaryExpr(e: TernaryExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    return Result.Ok;
  }
  onQuaternaryExpr(e: QuaternaryExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    return Result.Ok;
  }

  // --- Loads & stores ---
  onLoadExpr(e: LoadExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }
  onStoreExpr(e: StoreExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }

  // --- Memory misc ---
  onMemorySizeExpr(e: MemorySizeExpr): Result {
    this.s.writeU8(Opcode.MemorySize);
    writeVar(this.s, e.memidx);
    return Result.Ok;
  }
  onMemoryGrowExpr(e: MemoryGrowExpr): Result {
    this.s.writeU8(Opcode.MemoryGrow);
    writeVar(this.s, e.memidx);
    return Result.Ok;
  }
  onMemoryCopyExpr(e: MemoryCopyExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x0a); // memory.copy
    writeVar(this.s, e.destMemidx);
    writeVar(this.s, e.srcMemidx);
    return Result.Ok;
  }
  onMemoryFillExpr(e: MemoryFillExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x0b); // memory.fill
    writeVar(this.s, e.memidx);
    return Result.Ok;
  }
  onMemoryInitExpr(e: MemoryInitExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x08); // memory.init
    writeVar(this.s, e.segment);
    writeVar(this.s, e.memidx);
    return Result.Ok;
  }
  onDataDropExpr(e: DataDropExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x09); // data.drop
    writeVar(this.s, e.segment);
    return Result.Ok;
  }

  // --- Calls ---
  onCallExpr(e: CallExpr): Result {
    this.s.writeU8(Opcode.Call);
    writeVar(this.s, e.func);
    return Result.Ok;
  }
  onCallIndirectExpr(e: CallIndirectExpr): Result {
    this.s.writeU8(Opcode.CallIndirect);
    writeVar(this.s, e.typeVar);
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onCallRefExpr(e: CallRefExpr): Result {
    this.s.writeU8(Opcode.CallRef);
    writeVar(this.s, e.sigType);
    return Result.Ok;
  }
  onReturnCallExpr(e: ReturnCallExpr): Result {
    this.s.writeU8(Opcode.ReturnCall);
    writeVar(this.s, e.func);
    return Result.Ok;
  }
  onReturnCallIndirectExpr(e: ReturnCallIndirectExpr): Result {
    this.s.writeU8(Opcode.ReturnCallIndirect);
    writeVar(this.s, e.typeVar);
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onReturnCallRefExpr(e: ReturnCallRefExpr): Result {
    this.s.writeU8(Opcode.ReturnCallRef);
    writeVar(this.s, e.sigType);
    return Result.Ok;
  }

  // --- Ref types ---
  onRefNullExpr(e: RefNullExpr): Result {
    this.s.writeU8(Opcode.RefNull);
    writeVar(this.s, e.refType);
    return Result.Ok;
  }
  onRefIsNullExpr(_e: RefIsNullExpr): Result {
    this.s.writeU8(Opcode.RefIsNull);
    return Result.Ok;
  }
  onRefFuncExpr(e: RefFuncExpr): Result {
    this.s.writeU8(Opcode.RefFunc);
    writeVar(this.s, e.func);
    return Result.Ok;
  }
  onRefAsNonNullExpr(_e: RefAsNonNullExpr): Result {
    this.s.writeU8(Opcode.RefAsNonNull);
    return Result.Ok;
  }
  onRefEqExpr(_e: RefEqExpr): Result {
    // ref.eq is a single-byte opcode (0xd3), not 0xfb-prefixed.
    this.s.writeU8(Opcode.RefEq);
    return Result.Ok;
  }
  onRefI31Expr(_e: RefI31Expr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.RefI31);
    return Result.Ok;
  }
  onI31GetExpr(e: I31GetExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(e.signed ? GcOpcode.I31GetS : GcOpcode.I31GetU);
    return Result.Ok;
  }

  // --- Tables ---
  onTableGetExpr(e: TableGetExpr): Result {
    this.s.writeU8(Opcode.TableGet);
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onTableSetExpr(e: TableSetExpr): Result {
    this.s.writeU8(Opcode.TableSet);
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onTableGrowExpr(e: TableGrowExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x0f); // table.grow
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onTableSizeExpr(e: TableSizeExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x10); // table.size
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onTableFillExpr(e: TableFillExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x11); // table.fill
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onTableCopyExpr(e: TableCopyExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x0e); // table.copy
    writeVar(this.s, e.dst);
    writeVar(this.s, e.src);
    return Result.Ok;
  }
  onTableInitExpr(e: TableInitExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x0c); // table.init
    writeVar(this.s, e.segment);
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onElemDropExpr(e: ElemDropExpr): Result {
    this.s.writeU8(PREFIX_MISC);
    this.s.writeU32Leb(0x0d); // elem.drop
    writeVar(this.s, e.segment);
    return Result.Ok;
  }

  // --- Exceptions ---
  onThrowExpr(e: ThrowExpr): Result {
    this.s.writeU8(Opcode.Throw);
    writeVar(this.s, e.tag);
    return Result.Ok;
  }
  onThrowRefExpr(_e: ThrowRefExpr): Result {
    this.s.writeU8(Opcode.ThrowRef);
    return Result.Ok;
  }
  onRethrowExpr(e: RethrowExpr): Result {
    this.s.writeU8(Opcode.Rethrow);
    writeVar(this.s, e.depth);
    return Result.Ok;
  }

  // --- SIMD ---
  onSimdLaneOpExpr(e: SimdLaneOpExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    this.s.writeU8(e.lane);
    return Result.Ok;
  }
  onSimdShuffleOpExpr(e: SimdShuffleOpExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    this.s.writeBytes(e.lanes);
    return Result.Ok;
  }
  onSimdLoadLaneExpr(e: SimdLoadLaneExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    this.s.writeU8(e.lane);
    return Result.Ok;
  }
  onSimdStoreLaneExpr(e: SimdStoreLaneExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    this.s.writeU8(e.lane);
    return Result.Ok;
  }
  onLoadSplatExpr(e: LoadSplatExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }
  onLoadZeroExpr(e: LoadZeroExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }

  // --- Atomics ---
  onAtomicLoadExpr(e: AtomicLoadExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }
  onAtomicStoreExpr(e: AtomicStoreExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }
  onAtomicRmwExpr(e: AtomicRmwExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }
  onAtomicRmwCmpxchgExpr(e: AtomicRmwCmpxchgExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }
  onAtomicWaitExpr(e: AtomicWaitExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }
  onAtomicNotifyExpr(e: AtomicNotifyExpr): Result {
    this.s.writeU8(PREFIX_THREADS);
    this.s.writeU32Leb(0x00); // memory.atomic.notify
    writeMemArg(this.s, e.align, e.offset, e.memidx, opcodeOf(e));
    return Result.Ok;
  }
  onAtomicFenceExpr(e: AtomicFenceExpr): Result {
    this.s.writeU8(PREFIX_THREADS);
    this.s.writeU32Leb(0x03); // atomic.fence
    this.s.writeU8(e.consistencyModel);
    return Result.Ok;
  }

  // --- Metadata (skip — no binary representation) ---
  onCodeMetadataExpr(_e: CodeMetadataExpr): Result {
    return Result.Ok;
  }
}

// ---------------------------------------------------------------------------
// BinaryWriter
// ---------------------------------------------------------------------------

class BinaryWriter {
  private readonly s: MemoryStream;
  private readonly bodyWriter: BodyWriter;
  private readonly visitor: ExprVisitor;

  constructor(private readonly m: Module) {
    this.s = new MemoryStream(4096);
    this.bodyWriter = new BodyWriter(this.s);
    this.visitor = new ExprVisitor(this.bodyWriter);
  }

  // Emit a constant-expression sequence (init expr) followed by End.
  private writeInitExpr(exprs: import('../ir/ir.ts').Expr[]): void {
    this.visitor.visitExprList(exprs);
    this.s.writeU8(Opcode.End);
  }

  // ---------------------------------------------------------------------------
  // Type section
  // ---------------------------------------------------------------------------

  private writeTypeSection(): void {
    const { m, s } = this;
    if (m.types.length === 0) return;
    s.writeSection(BinarySection.Type, () => {
      s.writeU32Leb(m.types.length);
      for (const t of m.types) {
        if (t.kind === 'func') {
          s.writeU8(0x60);
          s.writeU32Leb(t.sig.params.length);
          for (const p of t.sig.params) s.writeU8(p as number);
          s.writeU32Leb(t.sig.results.length);
          for (const r of t.sig.results) s.writeU8(r as number);
        }
        // struct/array GC types omitted for now (Phase 3 focus)
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Import section
  // ---------------------------------------------------------------------------

  private writeImportSection(): void {
    const { m, s } = this;
    if (m.imports.length === 0) return;
    s.writeSection(BinarySection.Import, () => {
      s.writeU32Leb(m.imports.length);
      for (const imp of m.imports) {
        s.writeName(imp.module);
        s.writeName(imp.field);
        s.writeU8(imp.kind as number);
        switch (imp.kind) {
          case ExternalKind.Func:
            writeVar(s, imp.func.typeVar);
            break;
          case ExternalKind.Table:
            s.writeU8(imp.table.elemType as number);
            writeLimits(s, imp.table.limits);
            break;
          case ExternalKind.Memory:
            writeLimits(s, imp.memory.limits);
            break;
          case ExternalKind.Global:
            s.writeU8(imp.global.type as number);
            s.writeU8(imp.global.mutable ? 1 : 0);
            break;
          case ExternalKind.Tag:
            s.writeU8(0x00); // attribute = exception (only valid value)
            writeVar(
              s,
              imp.tag.sig.params.length > 0
                ? { kind: 'index', value: 0 } // TODO: look up type index from sig
                : { kind: 'index', value: 0 },
            );
            break;
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Function section
  // ---------------------------------------------------------------------------

  private writeFunctionSection(): void {
    const { m, s } = this;
    if (m.funcs.length === 0) return;
    s.writeSection(BinarySection.Function, () => {
      s.writeU32Leb(m.funcs.length);
      for (const f of m.funcs) writeVar(s, f.typeVar);
    });
  }

  // ---------------------------------------------------------------------------
  // Table section
  // ---------------------------------------------------------------------------

  private writeTableSection(): void {
    const { m, s } = this;
    if (m.tables.length === 0) return;
    s.writeSection(BinarySection.Table, () => {
      s.writeU32Leb(m.tables.length);
      for (const t of m.tables) {
        s.writeU8(t.elemType as number);
        writeLimits(s, t.limits);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Memory section
  // ---------------------------------------------------------------------------

  private writeMemorySection(): void {
    const { m, s } = this;
    if (m.memories.length === 0) return;
    s.writeSection(BinarySection.Memory, () => {
      s.writeU32Leb(m.memories.length);
      for (const mem of m.memories) writeLimits(s, mem.limits);
    });
  }

  // ---------------------------------------------------------------------------
  // Tag section
  // ---------------------------------------------------------------------------

  private writeTagSection(): void {
    const { m, s } = this;
    if (m.tags.length === 0) return;
    s.writeSection(BinarySection.Tag, () => {
      s.writeU32Leb(m.tags.length);
      for (const tag of m.tags) {
        s.writeU8(0x00); // attribute = exception
        // Find the type index that matches this tag's sig
        const idx = m.types.findIndex(
          (t) =>
            t.kind === 'func' &&
            t.sig.params.length === tag.sig.params.length &&
            t.sig.params.every((p, i) => p === tag.sig.params[i]) &&
            t.sig.results.length === 0,
        );
        s.writeU32Leb(idx >= 0 ? idx : 0);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Global section
  // ---------------------------------------------------------------------------

  private writeGlobalSection(): void {
    const { m, s } = this;
    if (m.globals.length === 0) return;
    s.writeSection(BinarySection.Global, () => {
      s.writeU32Leb(m.globals.length);
      for (const g of m.globals) {
        s.writeU8(g.type as number);
        s.writeU8(g.mutable ? 1 : 0);
        this.writeInitExpr(g.init);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Export section
  // ---------------------------------------------------------------------------

  private writeExportSection(): void {
    const { m, s } = this;
    if (m.exports.length === 0) return;
    s.writeSection(BinarySection.Export, () => {
      s.writeU32Leb(m.exports.length);
      for (const e of m.exports) {
        s.writeName(e.name);
        s.writeU8(e.kind as number);
        writeVar(s, e.var);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Start section
  // ---------------------------------------------------------------------------

  private writeStartSection(): void {
    const { m, s } = this;
    if (m.start === undefined) return;
    s.writeSection(BinarySection.Start, () => {
      writeVar(s, m.start!);
    });
  }

  // ---------------------------------------------------------------------------
  // Element section
  // ---------------------------------------------------------------------------

  private writeElemSection(): void {
    const { m, s } = this;
    if (m.elemSegments.length === 0) return;
    s.writeSection(BinarySection.Elem, () => {
      s.writeU32Leb(m.elemSegments.length);
      for (const seg of m.elemSegments) {
        const tableIdx = seg.tableVar.kind === 'index' ? seg.tableVar.value : 0;
        let flags: number;
        if (seg.kind === 'active' && tableIdx === 0) {
          flags = 4; // active, table 0, expr-based
        } else if (seg.kind === 'active') {
          flags = 6; // active, explicit table, expr-based
        } else if (seg.kind === 'passive') {
          flags = 5;
        } else {
          flags = 7; // declared
        }
        s.writeU32Leb(flags);
        if (flags === 6) {
          writeVar(s, seg.tableVar);
        }
        if (flags === 4 || flags === 6) {
          this.writeInitExpr(seg.offset);
        }
        if (flags !== 4) {
          s.writeU8(seg.elemType as number); // reftype
        }
        s.writeU32Leb(seg.elemExprs.length);
        for (const elemExpr of seg.elemExprs) {
          this.writeInitExpr(elemExpr);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // DataCount section
  // ---------------------------------------------------------------------------

  private writeDataCountSection(): void {
    const { m, s } = this;
    if (m.dataSegments.length === 0) return;
    s.writeSection(BinarySection.DataCount, () => {
      s.writeU32Leb(m.dataSegments.length);
    });
  }

  // ---------------------------------------------------------------------------
  // Code section
  // ---------------------------------------------------------------------------

  private writeFuncBody(func: Func): void {
    const { s } = this;
    const sizePos = s.reserveU32Leb();
    const start = s.offset;

    // Local declarations (run-length encoded)
    s.writeU32Leb(func.localDecls.length);
    for (const decl of func.localDecls) {
      s.writeU32Leb(decl.count);
      s.writeU8(decl.type as number);
    }

    // Body
    this.visitor.visitExprList(func.body);

    // End
    s.writeU8(Opcode.End);

    s.patchU32Leb(sizePos, s.offset - start);
  }

  private writeCodeSection(): void {
    const { m, s } = this;
    if (m.funcs.length === 0) return;
    s.writeSection(BinarySection.Code, () => {
      s.writeU32Leb(m.funcs.length);
      for (const f of m.funcs) this.writeFuncBody(f);
    });
  }

  // ---------------------------------------------------------------------------
  // Data section
  // ---------------------------------------------------------------------------

  private writeDataSection(): void {
    const { m, s } = this;
    if (m.dataSegments.length === 0) return;
    s.writeSection(BinarySection.Data, () => {
      s.writeU32Leb(m.dataSegments.length);
      for (const seg of m.dataSegments) {
        const memIdx = seg.memoryVar.kind === 'index' ? seg.memoryVar.value : 0;
        if (seg.kind === 'active' && memIdx === 0) {
          s.writeU32Leb(0); // flags = 0: active, memory 0
          this.writeInitExpr(seg.offset);
        } else if (seg.kind === 'passive') {
          s.writeU32Leb(1); // flags = 1: passive
        } else if (seg.kind === 'active') {
          s.writeU32Leb(2); // flags = 2: active, explicit memory
          writeVar(s, seg.memoryVar);
          this.writeInitExpr(seg.offset);
        } else {
          s.writeU32Leb(1); // declared → encode as passive fallback
        }
        s.writeU32Leb(seg.data.length);
        s.writeBytes(seg.data);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Custom sections
  // ---------------------------------------------------------------------------

  private writeCustomSections(): void {
    const { m, s } = this;
    for (const c of m.customs) {
      s.writeSection(BinarySection.Custom, () => {
        s.writeName(c.name);
        s.writeBytes(c.data);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Top-level module write
  // ---------------------------------------------------------------------------

  write(): Uint8Array {
    const { s } = this;

    // Magic + version
    s.writeU32Le(WASM_MAGIC);
    s.writeU32Le(WASM_VERSION);

    // Sections in standard order
    this.writeTypeSection();
    this.writeImportSection();
    this.writeFunctionSection();
    this.writeTableSection();
    this.writeMemorySection();
    this.writeTagSection();
    this.writeGlobalSection();
    this.writeExportSection();
    this.writeStartSection();
    this.writeElemSection();
    this.writeDataCountSection();
    this.writeCodeSection();
    this.writeDataSection();
    this.writeCustomSections();

    return s.toUint8Array();
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface WriteBinaryOptions {
  /** Write debug names (name custom section). Default: false. */
  writeDebugNames?: boolean;
}

export function writeBinaryIr(m: Module, _opts: WriteBinaryOptions = {}): Uint8Array {
  return new BinaryWriter(m).write();
}
