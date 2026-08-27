// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/binary-writer.h, src/binary-writer.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

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
  BlockType,
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
  ExternConvertExpr,
  Func,
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
  ValueType,
  Var,
} from '../ir/ir.ts';
import { isRefValueType, recGroups, valueTypeEquals, valueTypeName } from '../ir/ir.ts';
import type { Custom, TypeEntry } from '../ir/ir.ts';
import { CatchKind } from '../ir/ir.ts';
import { heapTypeNameToType, Type } from '../core/types.ts';
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

/**
 * Write a func/global/table/type/tag/etc. index immediate. Index-form vars
 * encode as their unsigned LEB value; a name-form var means `resolveNames`
 * was skipped (or missed this immediate), so throw rather than silently emit
 * index 0 — the root of the Bug-G family (a name-var quietly encoded as 0
 * produces valid-but-wrong wasm that targets the wrong entity). Mirrors
 * {@link writeHeapType}'s fail-loud policy.
 */
function writeVar(s: MemoryStream, v: Var): void {
  s.writeU32Leb(varIndexValue(v, 'var'));
}

/**
 * Return a var's numeric index, throwing on a name-form var (same fail-loud
 * policy as {@link writeVar}). Use where the index value is needed directly
 * (e.g. to choose a segment's flag encoding) rather than just streamed — those
 * call sites used to fall back to `0`, silently retargeting the segment.
 */
function varIndexValue(v: Var, label: string): number {
  if (v.kind !== 'index') {
    throw new Error(
      `binary writer: unresolved name-var "${v.name}" for ${label} — run resolveNames before encoding`,
    );
  }
  return v.value;
}

/**
 * Write a GC-proposal heap-type immediate. Index-form vars encode as a
 * positive signed-LEB128 type index; name-form vars matching an
 * abstract-heap-type keyword encode as a single negative byte (already
 * stored in {@link Type} enum entries — `Type.AnyRef` is 0x6e, etc.).
 * Name-form vars referencing a user-defined type indicate `resolveNames`
 * was skipped; throws for symmetry with {@link writeVar}'s name fallback
 * that quietly emitted 0 (Bug G).
 */
/**
 * Can this element type hold plain function indices? True for `funcref` and
 * for `(ref [null] func)` — the funcidx element-segment form always yields
 * non-null function references, which are a subtype of all three.
 */
function isNonNullFuncRef(t: ValueType): boolean {
  return isRefValueType(t) && !t.nullable && t.heapType.kind === 'name' &&
    t.heapType.name === 'func';
}

function writeHeapType(s: MemoryStream, v: Var): void {
  if (v.kind === 'index') {
    // Positive type index. The field is a signed LEB128: an unsigned write is
    // identical only while the index stays below 64 — at 64 the unsigned form
    // is the single byte 0x40, which a decoder reads back as an abstract heap
    // type (the sign bit is set), not as index 64.
    s.writeS32Leb(v.value);
    return;
  }
  const byte = abstractHeapTypeByteForName(v.name);
  if (byte !== null) {
    s.writeU8(byte);
    return;
  }
  throw new Error(`writeHeapType: var "${v.name}" not resolved — run resolveNames first`);
}

/**
 * Map an abstract-heap-type keyword name (`"any"` / `"i31"` / `"struct"` /
 * `"func"` / etc.) to the single-byte binary encoding. Returns null for
 * unrecognized names. Thin alias over the canonical table in `core/types.ts`
 * — the `Type` enum values ARE the heap-type byte encodings.
 */
function abstractHeapTypeByteForName(name: string): number | null {
  return heapTypeNameToType(name);
}

/**
 * Write a value type.
 *
 * An abstract {@link Type} is a single byte — its enum value IS the encoding.
 * A CONCRETE typed reference is two parts: the `0x64` / `0x63` marker for
 * `(ref H)` / `(ref null H)` followed by the heap type. Every site used to do
 * `writeU8(t as number)`, which silenced the type system and would have
 * written garbage once typed refs became representable.
 */
function writeValueType(s: MemoryStream, vt: ValueType): void {
  if (isRefValueType(vt)) {
    s.writeU8(vt.nullable ? Type.RefNull : Type.Ref);
    writeHeapType(s, vt.heapType);
    return;
  }
  s.writeU8(vt as number);
}

/**
 * Write one subtype: the `(sub final? $super*)` wrapper when present, then the
 * comptype.
 *
 * A bare comptype is the spec's shorthand for `sub final` with NO supertypes,
 * so an absent `sub` field must emit no wrapper at all — emitting
 * `0x4f` with an empty supertype list would be a different (longer, but
 * equivalent) encoding, and emitting `0x50` would wrongly mark it non-final.
 */
function writeSubType(s: MemoryStream, t: TypeEntry): void {
  if (t.sub !== undefined) {
    s.writeU8(t.sub.final ? 0x4f : 0x50);
    s.writeU32Leb(t.sub.supertypes.length);
    for (const sup of t.sub.supertypes) writeVar(s, sup);
  }
  writeCompType(s, t);
}

/** Write the composite part of a type entry: func (0x60), struct (0x5f), or array (0x5e). */
function writeCompType(s: MemoryStream, t: TypeEntry): void {
  if (t.kind === 'func') {
    s.writeU8(0x60);
    s.writeU32Leb(t.sig.params.length);
    for (const p of t.sig.params) writeValueType(s, p);
    s.writeU32Leb(t.sig.results.length);
    for (const r of t.sig.results) writeValueType(s, r);
    return;
  }
  if (t.kind === 'struct') {
    s.writeU8(Type.Struct as number); // 0x5f
    s.writeU32Leb(t.fields.length);
    for (const f of t.fields) {
      writeValueType(s, f.type);
      s.writeU8(f.mutable ? 1 : 0);
    }
    return;
  }
  // GC array: 0x5e, then (valtype, mut) for the single element type.
  s.writeU8(Type.Array as number); // 0x5e
  writeValueType(s, t.field.type);
  s.writeU8(t.field.mutable ? 1 : 0);
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
  // Sub-opcodes occupy the LOW 16 bits. 8 was not enough: the relaxed-SIMD
  // set lives at 0x100-0x113, and `(0xfd << 8) | 0x100` is 0xfd00 — bit 8 is
  // already set by the prefix, so the sub-opcode ALIASED onto a low SIMD
  // opcode (0x100 -> v128.load, 0x111 -> i32x4.splat) rather than overflowing
  // into the next prefix.
  const prefix = (op >>> 16) & 0xff;
  if (prefix === 0) {
    s.writeU8(op & 0xffff);
  } else {
    s.writeU8(prefix);
    s.writeU32Leb(op & 0xffff);
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
  return op ?? ((PREFIX_THREADS << 16) | 0x00);
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

/**
 * Narrow a limits value to the `number` the u32 LEB encoder takes.
 *
 * Anything at or below 2^32-1 is exact in a JS number. Anything above it does
 * not fit the field at all, and is refused HERE rather than after a lossy
 * `Number()` — so the message names the value the source actually wrote.
 */
function u32Limit(v: bigint): number {
  if (v > 0xffff_ffffn) throw new RangeError(`u32 LEB128 out of range: ${v}`);
  return Number(v);
}

function writeLimits(
  s: MemoryStream,
  lim: { initial: bigint; max?: bigint; isShared: boolean; is64: boolean; pageSizeLog2?: number },
): void {
  let flags = 0;
  if (lim.max !== undefined) flags |= LIMITS_HAS_MAX_FLAG;
  if (lim.isShared) flags |= LIMITS_IS_SHARED_FLAG;
  if (lim.is64) flags |= LIMITS_IS_64_FLAG;
  // PRESENCE, not `!== 16`: the flag bit is observable, and an explicitly
  // encoded `pagesize 65536` must come back out as one. Collapsing it into the
  // default is what a runtime can afford — the memory type is identical — but
  // it changes the bytes, and round-trip fidelity is a metric here. (The old
  // test was `!== 65536`, comparing a log2 against a byte count, so it was true
  // for every decoded memory.)
  if (lim.pageSizeLog2 !== undefined) flags |= LIMITS_HAS_CUSTOM_PAGE_SIZE_FLAG;
  s.writeU32Leb(flags);
  // The field's WIDTH follows the index type: u64 for a 64-bit memory or
  // table, u32 for a 32-bit one. Writing a 64-bit limit as u32 truncated every
  // size above 2^32, so the validator's page bound never saw the value it
  // exists to reject (T13.2). Both LEB encoders are fail-loud on a value too
  // large for their field, so a 32-bit limit of 2^32 is REFUSED rather than
  // wrapped to 0.
  if (lim.is64) {
    s.writeU64Leb(lim.initial);
    if (lim.max !== undefined) s.writeU64Leb(lim.max);
  } else {
    s.writeU32Leb(u32Limit(lim.initial));
    if (lim.max !== undefined) s.writeU32Leb(u32Limit(lim.max));
  }
  // Trails min/max, and carries the LOG2 — the wire field is the exponent.
  if ((flags & LIMITS_HAS_CUSTOM_PAGE_SIZE_FLAG) !== 0 && lim.pageSizeLog2 !== undefined) {
    s.writeU32Leb(lim.pageSizeLog2);
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

  onNopExpr(e: NopExpr): Result {
    // A synthesized operand slot-filler is not an instruction; see
    // NopExpr.placeholder. Writing one is inert but grows the encoding on
    // every round trip (T10.8).
    if (e.placeholder) return Result.Ok;
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
      // `writeValueType`, not a raw `writeU8(t as number)` — a cast the T7.4
      // ValueType refactor left behind. A `(ref $t)` annotation is an OBJECT,
      // so the cast wrote 0x00 and `select (result (ref $t))` came back out
      // as an invalid value type. Same class as the type-key stringification
      // in T10.7.
      for (const t of e.resultType) writeValueType(this.s, t);
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
    // The immediate is a heap type (signed LEB / single negative byte), not a
    // plain index — writeVar would emit an unsigned index and reject the
    // abstract-keyword name-vars the parser produces.
    writeHeapType(this.s, e.refType);
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
  onExternConvertExpr(e: ExternConvertExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(
      e.kind === 'any.convert_extern' ? GcOpcode.AnyConvertExtern : GcOpcode.ExternConvertAny,
    );
    return Result.Ok;
  }
  onI31GetExpr(e: I31GetExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(e.signed ? GcOpcode.I31GetS : GcOpcode.I31GetU);
    return Result.Ok;
  }
  onStructNewExpr(e: StructNewExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.StructNew);
    writeVar(this.s, e.typeVar);
    return Result.Ok;
  }
  onStructNewDefaultExpr(e: StructNewDefaultExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.StructNewDefault);
    writeVar(this.s, e.typeVar);
    return Result.Ok;
  }
  onStructGetExpr(e: StructGetExpr): Result {
    this.s.writeU8(PREFIX_GC);
    const sub = e.signed === true
      ? GcOpcode.StructGetS
      : e.signed === false
      ? GcOpcode.StructGetU
      : GcOpcode.StructGet;
    this.s.writeU32Leb(sub);
    writeVar(this.s, e.typeVar);
    writeVar(this.s, e.fieldVar);
    return Result.Ok;
  }
  onStructSetExpr(e: StructSetExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.StructSet);
    writeVar(this.s, e.typeVar);
    writeVar(this.s, e.fieldVar);
    return Result.Ok;
  }
  onArrayNewExpr(e: ArrayNewExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArrayNew);
    writeVar(this.s, e.typeVar);
    return Result.Ok;
  }
  onArrayNewDefaultExpr(e: ArrayNewDefaultExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArrayNewDefault);
    writeVar(this.s, e.typeVar);
    return Result.Ok;
  }
  onArrayNewFixedExpr(e: ArrayNewFixedExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArrayNewFixed);
    writeVar(this.s, e.typeVar);
    this.s.writeU32Leb(e.operands.length);
    return Result.Ok;
  }
  onArrayNewDataExpr(e: ArrayNewDataExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArrayNewData);
    writeVar(this.s, e.typeVar);
    writeVar(this.s, e.dataVar);
    return Result.Ok;
  }
  onArrayNewElemExpr(e: ArrayNewElemExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArrayNewElem);
    writeVar(this.s, e.typeVar);
    writeVar(this.s, e.elemVar);
    return Result.Ok;
  }
  onArrayGetExpr(e: ArrayGetExpr): Result {
    this.s.writeU8(PREFIX_GC);
    const sub = e.signed === true
      ? GcOpcode.ArrayGetS
      : e.signed === false
      ? GcOpcode.ArrayGetU
      : GcOpcode.ArrayGet;
    this.s.writeU32Leb(sub);
    writeVar(this.s, e.typeVar);
    return Result.Ok;
  }
  onArraySetExpr(e: ArraySetExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArraySet);
    writeVar(this.s, e.typeVar);
    return Result.Ok;
  }
  onArrayFillExpr(e: ArrayFillExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArrayFill);
    writeVar(this.s, e.typeVar);
    return Result.Ok;
  }
  onArrayCopyExpr(e: ArrayCopyExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArrayCopy);
    // Destination type index first, then source — same order as the text form.
    writeVar(this.s, e.destTypeVar);
    writeVar(this.s, e.srcTypeVar);
    return Result.Ok;
  }
  onArrayInitSegmentExpr(e: ArrayInitSegmentExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(
      e.kind === 'array.init_data' ? GcOpcode.ArrayInitData : GcOpcode.ArrayInitElem,
    );
    writeVar(this.s, e.typeVar);
    writeVar(this.s, e.segment);
    return Result.Ok;
  }
  onArrayLenExpr(_e: ArrayLenExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(GcOpcode.ArrayLen);
    return Result.Ok;
  }
  onRefTestExpr(e: RefTestExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(e.nullable ? GcOpcode.RefTestNullable : GcOpcode.RefTest);
    writeHeapType(this.s, e.heapType);
    return Result.Ok;
  }
  onRefCastExpr(e: RefCastExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(e.nullable ? GcOpcode.RefCastNullable : GcOpcode.RefCast);
    writeHeapType(this.s, e.heapType);
    return Result.Ok;
  }
  onBrOnCastExpr(e: BrOnCastExpr): Result {
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(e.onFail ? GcOpcode.BrOnCastFail : GcOpcode.BrOnCast);
    // Nullability of BOTH reference types travels in one flags byte rather
    // than in the heap types themselves: bit 0 = rt1 nullable, bit 1 = rt2.
    this.s.writeU8((e.from.nullable ? 1 : 0) | (e.to.nullable ? 2 : 0));
    writeVar(this.s, e.target);
    writeHeapType(this.s, e.from.heapType);
    writeHeapType(this.s, e.to.heapType);
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
      // The section is a vector of REC GROUPS, not of types: an explicit
      // `(rec …)` spanning N types occupies ONE vector slot while consuming N
      // type indices. Writing m.types.length was right only while every type
      // was its own singleton group.
      const groups = recGroups(m.types);
      s.writeU32Leb(groups.length);
      for (const g of groups) {
        if (g.explicit) {
          s.writeU8(0x4e); // rectype
          s.writeU32Leb(g.count);
        }
        for (let i = g.start; i < g.start + g.count; i++) writeSubType(s, m.types[i]!);
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
            writeValueType(s, imp.table.elemType);
            writeLimits(s, imp.table.limits);
            break;
          case ExternalKind.Memory:
            writeLimits(s, imp.memory.limits);
            break;
          case ExternalKind.Global:
            writeValueType(s, imp.global.type);
            s.writeU8(imp.global.mutable ? 1 : 0);
            break;
          case ExternalKind.Tag:
            s.writeU8(0x00); // attribute = exception (only valid value)
            s.writeU32Leb(this.tagTypeIndex(imp.tag.sig.params));
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
        if (t.init.length > 0) {
          // table-with-initializer form (reference-types proposal):
          // 0x40 0x00 reftype limits init_expr. The binary reader decodes
          // this shape (readTableSection); emitting only `reftype limits`
          // here silently dropped the initializer and desynced the round-trip.
          s.writeU8(0x40);
          s.writeU8(0x00);
          writeValueType(s, t.elemType);
          writeLimits(s, t.limits);
          this.writeInitExpr(t.init);
        } else {
          writeValueType(s, t.elemType);
          writeLimits(s, t.limits);
        }
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
        s.writeU32Leb(this.tagTypeIndex(tag.sig.params));
      }
    });
  }

  /**
   * Resolve the type-section index whose `(func (param …) (result))` signature
   * matches a tag's signature. Tags always have zero results in the exception
   * model, so a tag's type is the func type with the same params and no
   * results.
   *
   * Throws (fail-loud) when no matching type exists rather than silently
   * emitting index 0 — an unresolved tag type index corrupts the binary
   * (a decoder reads the wrong/short signature). The `synthesizeTypes` pass
   * (run by `wat2wasm`/`compat`) and binary-read modules both guarantee a
   * matching entry; a module reaching the writer without one is malformed.
   */
  private tagTypeIndex(params: readonly ValueType[]): number {
    const idx = this.m.types.findIndex(
      (t) =>
        t.kind === 'func' &&
        t.sig.params.length === params.length &&
        // `valueTypeEquals`, not `===`. A ValueType is an abstract `Type`
        // (a number, where identity is equality) OR a typed reference, which
        // is an OBJECT — so two structurally identical `(ref $t)` params
        // compared unequal, no type matched, and a tag with a typed-ref param
        // made the whole encode THROW. Another site the T7.4 ValueType
        // refactor did not reach, like the `select` annotation cast (T10.7).
        t.sig.params.every((p, i) => valueTypeEquals(p, params[i]!)) &&
        t.sig.results.length === 0,
    );
    if (idx < 0) {
      throw new Error(
        `binary writer: no (type (func (param ${
          // valueTypeName, not `(p as number).toString(16)` — that cast
          // rendered every typed reference as "[object Object]", so the one
          // diagnostic that could have identified the cause named nothing.
          params.map(valueTypeName).join(' ')}))) in the type section matches the tag signature; ` +
          `cannot encode tag type index (run synthesizeTypes first)`,
      );
    }
    return idx;
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
        writeValueType(s, g.type);
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
        const tableIdx = varIndexValue(seg.tableVar, 'elem segment table');

        // Prefer the FUNCIDX form (flags 0-3) whenever every element is a
        // single `ref.func`. It is not just shorter — it types the segment as
        // the NON-NULL `(ref func)`, while the expression form declares
        // whatever reftype is written and `funcref` is not a subtype of a
        // `(ref func)` table. Emitting expressions unconditionally made every
        // `(table 10 (ref func) …)` module fail with "Element segment of type
        // funcref is not a subtype of referenced table 0". Verified against V8
        // for all five candidate encodings; see tests/writer/elem_form.test.ts.
        // Only when the declared type IS the funcidx form's own type. An
        // explicitly-written `funcref` elemlist is NULLABLE and must keep the
        // expression form, or the encoding silently widens — and a module the
        // spec calls invalid (a `funcref` segment against a `(ref func)`
        // table) comes back out looking valid.
        const useFuncIdx = isNonNullFuncRef(seg.elemType) &&
          seg.elemExprs.every((xs) => xs.length === 1 && xs[0]!.kind === 'ref.func');

        let flags: number;
        if (useFuncIdx) {
          // 0 = active/table 0, 1 = passive, 2 = active/explicit table,
          // 3 = declared. Only flags 0 omits the elemkind byte.
          if (seg.kind === 'passive') flags = 1;
          else if (seg.kind === 'declared') flags = 3;
          else flags = tableIdx === 0 ? 0 : 2;
        } else if (seg.kind === 'active' && tableIdx === 0 && seg.elemType === Type.FuncRef) {
          // flags 4 (active, table 0, expr-based) carries NO reftype byte —
          // funcref is implied. Only use it when the element type is funcref;
          // a non-funcref table-0 segment must use flags 6, which writes the
          // reftype, or its element type is silently lost.
          flags = 4;
        } else if (seg.kind === 'active') {
          flags = 6; // active, explicit table, expr-based (writes reftype)
        } else if (seg.kind === 'passive') {
          flags = 5;
        } else {
          flags = 7; // declared
        }

        s.writeU32Leb(flags);
        if (flags === 2 || flags === 6) writeVar(s, seg.tableVar);
        if (seg.kind === 'active') this.writeInitExpr(seg.offset);
        if (useFuncIdx) {
          if (flags !== 0) s.writeU8(0x00); // elemkind: funcref
        } else if (flags !== 4) {
          writeValueType(s, seg.elemType); // reftype
        }

        s.writeU32Leb(seg.elemExprs.length);
        for (const elemExpr of seg.elemExprs) {
          if (useFuncIdx) writeVar(s, (elemExpr[0] as RefFuncExpr).func);
          else this.writeInitExpr(elemExpr);
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
      writeValueType(s, decl.type);
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
        const memIdx = varIndexValue(seg.memoryVar, 'data segment memory');
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
          // 'declared' is an elem-segment-only kind; it is meaningless for
          // data. Fail loud rather than silently re-encoding it as passive.
          throw new Error(`binary writer: invalid data segment kind "${seg.kind}"`);
        }
        s.writeU32Leb(seg.data.length);
        s.writeBytes(seg.data);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Custom sections
  // ---------------------------------------------------------------------------

  private emitCustom(c: Custom): void {
    const { s } = this;
    s.writeSection(BinarySection.Custom, () => {
      s.writeName(c.name);
      s.writeBytes(c.data);
    });
  }

  /**
   * Emit the custom sections anchored to `after` -- `null` for those that came
   * before any known section. Relative order among them is preserved.
   *
   * A custom whose `precedingSection` is `undefined` has no recorded position
   * and is left for `writeTrailingCustomSections`, which keeps the old
   * append-at-the-end behaviour for hand-built IR.
   */
  private writeCustomSectionsAfter(after: BinarySection | null): void {
    for (const c of this.m.customs) {
      if (c.precedingSection === undefined) continue;
      if (c.precedingSection === after) this.emitCustom(c);
    }
  }

  /** Customs with no recorded position, appended last. */
  private writeTrailingCustomSections(): void {
    for (const c of this.m.customs) {
      if (c.precedingSection === undefined) this.emitCustom(c);
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

    // Sections in standard order, with each custom section emitted back at
    // the position it held in the source binary (see `Custom.precedingSection`
    // -- moving them is not merely cosmetic, `dylink.0` must come first).
    this.writeCustomSectionsAfter(null);
    const ORDER: [BinarySection, () => void][] = [
      [BinarySection.Type, () => this.writeTypeSection()],
      [BinarySection.Import, () => this.writeImportSection()],
      [BinarySection.Function, () => this.writeFunctionSection()],
      [BinarySection.Table, () => this.writeTableSection()],
      [BinarySection.Memory, () => this.writeMemorySection()],
      [BinarySection.Tag, () => this.writeTagSection()],
      [BinarySection.Global, () => this.writeGlobalSection()],
      [BinarySection.Export, () => this.writeExportSection()],
      [BinarySection.Start, () => this.writeStartSection()],
      [BinarySection.Elem, () => this.writeElemSection()],
      [BinarySection.DataCount, () => this.writeDataCountSection()],
      [BinarySection.Code, () => this.writeCodeSection()],
      [BinarySection.Data, () => this.writeDataSection()],
    ];
    for (const [id, write] of ORDER) {
      write();
      this.writeCustomSectionsAfter(id);
    }
    this.writeTrailingCustomSections();

    return s.toUint8Array();
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Options for {@link writeBinaryIr}. */
export interface WriteBinaryOptions {
  /** Write debug names (name custom section). Default: `false`. */
  writeDebugNames?: boolean;
}

/**
 * Encode a {@link Module} IR as a wasm binary. Returns the bytes; the
 * encoder doesn't accumulate errors (any IR shape it can't encode throws).
 */
export function writeBinaryIr(m: Module, _opts: WriteBinaryOptions = {}): Uint8Array {
  return new BinaryWriter(m).write();
}
