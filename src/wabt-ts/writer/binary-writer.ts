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
  BrOnExpr,
  BrTableExpr,
  CallExpr,
  CallIndirectExpr,
  CallRefExpr,
  Catch,
  CodeMetadataExpr,
  ConstExpr,
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
  RegionExpr,
  RethrowExpr,
  ReturnExpr,
  SelectExpr,
  SimdExtractExpr,
  SimdLoadLaneExpr,
  SimdReplaceExpr,
  SimdShuffleOpExpr,
  StoreExpr,
  StructGetExpr,
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
import type { FidelityTable } from '../ir/fidelity.ts';
import {
  isRefValueType,
  recGroups,
  requireIndex,
  valueTypeEquals,
  valueTypeName,
} from '../ir/ir.ts';
import type { Custom, HeapTypeRef, StorageType, TableCatch, TypeEntry } from '../ir/ir.ts';
import { type AbstractHeap, heapTypeNameToType, Type } from '../core/types.ts';
import { Result } from '../core/result.ts';
import {
  GcOpcode,
  Opcode,
  OPCODE_I8X16_SHUFFLE,
  PREFIX_GC,
  PREFIX_MISC,
  PREFIX_SIMD,
  PREFIX_THREADS,
} from '../core/opcode.ts';
import {
  BinarySection,
  CUSTOM_SECTION_NAME_NAME,
  ExternalKind,
  LIMITS_HAS_CUSTOM_PAGE_SIZE_FLAG,
  LIMITS_HAS_MAX_FLAG,
  LIMITS_IS_64_FLAG,
  LIMITS_IS_SHARED_FLAG,
  NameSectionSubsection,
  WASM_MAGIC,
  WASM_VERSION,
} from '../core/binary.ts';
import { MemoryStream } from './stream.ts';
import { ExprVisitor } from '../ir/expr-visitor.ts';
import type { ExprVisitorDelegate } from '../ir/expr-visitor.ts';
import { blockTypeOf, BrOnOp, localNameEntries } from '../ir/ir.ts';

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
 * Can this element type hold plain function indices? True for `funcref` and
 * for `(ref [null] func)` — the funcidx element-segment form always yields
 * non-null function references, which are a subtype of all three.
 */
function isNonNullFuncRef(t: ValueType): boolean {
  return isRefValueType(t) && !t.nullable && t.heapType.kind === 'abstract' &&
    t.heapType.name === 'func';
}

function writeHeapType(s: MemoryStream, h: HeapTypeRef): void {
  switch (h.kind) {
    case 'index':
      // Positive type index. The field is a signed LEB128: an unsigned write is
      // identical only while the index stays below 64 — at 64 the unsigned form
      // is the single byte 0x40, which a decoder reads back as an abstract heap
      // type (the sign bit is set), not as index 64.
      s.writeS32Leb(h.value);
      return;
    case 'abstract': {
      // The keyword table is now only an ENCODER — it no longer has to decide
      // whether the string was a keyword at all, because the arm already said
      // so. A missing entry here is a table gap, not a caller error.
      const byte = abstractHeapTypeByteForName(h.name);
      if (byte === null) {
        throw new Error(
          `writeHeapType: abstract heap type "${h.name}" has no binary encoding — ` +
            `extend ABSTRACT_HEAP_TYPES in core/types.ts`,
        );
      }
      s.writeU8(byte);
      return;
    }
    case 'name':
      throw new Error(
        `writeHeapType: type "$${h.name}" is not resolved — run resolveNames before writing.`,
      );
  }
}

/**
 * Map an abstract heap type to its single-byte binary encoding. Thin alias over
 * the canonical table in `core/types.ts` — the `Type` enum values ARE the
 * heap-type byte encodings.
 *
 * Takes an {@link AbstractHeap}, not a `string`: the caller's arm has already
 * established that this IS a keyword, so `null` here means the table is missing
 * an entry rather than that the caller passed something else.
 */
function abstractHeapTypeByteForName(name: AbstractHeap): number | null {
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
/** A value type — or a field's storage type: a packed `i8` / `i16` is its byte too. */
function writeValueType(s: MemoryStream, vt: StorageType): void {
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
    // Through `writeValueType`, not a raw `writeU8`: a block result may be a
    // TYPED REFERENCE, which is a tag byte plus a heap type. `bt.type as number`
    // on such a value wrote garbage — it only ever worked because the reader
    // could not produce one in the first place, so the two halves of the same
    // gap concealed each other.
    writeValueType(s, bt.type);
  } else {
    // A negative index would encode as a VALUE-type byte (-1 is `0x7f`, i32):
    // a valid block of the wrong type. Only an unindexed implicit type can be
    // negative (`UNASSIGNED_TYPE_INDEX`), and the parser indexes them all.
    if (bt.typeIdx < 0) {
      throw new Error(
        `block type has no type index yet (${bt.typeIdx}) — implicit types unassigned`,
      );
    }
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
  // wabt-ts IR stores align in BYTES (e.g. 4 for i32); the binary spec
  // encodes it as a log2 exponent, so 4 bytes → exponent 2.
  //
  // The parser resolves an absent `align=` to the opcode's natural
  // alignment, so every producer hands over a real power of two. (It used
  // to store 0 for "absent" and this function resolved it; the WAT writer
  // and the validator read the same 0 literally — `align=0`, and
  // "alignment (0) must be a power of 2" on a valid module.) Anything else
  // is a producer bug: log2 of it is not an exponent, and the LEB would
  // silently encode the wrong alignment.
  // (Math.log2 is exact on powers of two; a bitwise test would wrap past
  // 2^31.)
  const alignLog2 = Math.log2(alignBytes);
  if (!Number.isInteger(alignLog2) || alignLog2 < 0) {
    throw new Error(
      `memarg alignment must be a power-of-two byte count, got ${alignBytes} ` +
        `(opcode 0x${opcode.toString(16)})`,
    );
  }
  const idx = requireIndex(memidx, 'memarg memory index');
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

/**
 * A name as the name section holds it: the IR keeps the text format's `$`
 * (quoted ids already decoded — `$"a b"` is `$a b`), the binary does not.
 */
function bareName(name: string): string {
  return name.startsWith('$') ? name.slice(1) : name;
}

/** The entries that HAVE a name, in index order — what every name map lists. */
function namedEntries(entries: readonly (readonly [number, string])[]): [number, string][] {
  return entries.filter(([, n]) => n !== '').map(([i, n]) => [i, n] as [number, string])
    .sort(([a], [b]) => a - b);
}

/** `vec(index, name)`. */
function writeNameEntries(s: MemoryStream, entries: readonly [number, string][]): void {
  s.writeU32Leb(entries.length);
  for (const [i, n] of entries) {
    s.writeU32Leb(i);
    s.writeName(bareName(n));
  }
}

/** catch 0x00, catch_ref 0x01, catch_all 0x02, catch_all_ref 0x03. */
function catchKindByte(c: TableCatch): number {
  return (c.tag !== undefined ? 0x00 : 0x02) | (c.isRef ? 0x01 : 0x00);
}

// ---------------------------------------------------------------------------
// BodyWriter — ExprVisitorDelegate that emits opcodes into a MemoryStream
// ---------------------------------------------------------------------------

class BodyWriter implements ExprVisitorDelegate {
  private readonly s: MemoryStream;
  private readonly fidelity: FidelityTable;

  /**
   * The current function's named labels, as `[labelIndex, name]` — for the
   * name section's label subsection (N1 P2, a FEATURE beyond upstream: N2).
   *
   * A label's INDEX is the count of label-introducing instructions (`block`,
   * `loop`, `if`, `try`, `try_table`) written before it in this body, named or
   * not. Counted HERE, as the opcodes go out, because binary order is not tree
   * order: a folded `(if (block …) (then …))` writes the condition's `block`
   * BEFORE the `if`.
   */
  labelNames: [number, string][] = [];
  private labelCount = 0;

  constructor(s: MemoryStream, fidelity: FidelityTable) {
    this.s = s;
    this.fidelity = fidelity;
  }

  /** Start a function body: label indices count from 0 in each one. */
  beginFunctionBody(): void {
    this.labelNames = [];
    this.labelCount = 0;
    // The scope stack is balanced by construction — every carrier pushes in its
    // `begin` and pops in its `end`. A leftover frame would silently shift every
    // depth in the NEXT function, so say so rather than resetting: a silent
    // reset would hide the imbalance, and wrong depths are exactly the kind of
    // valid-but-different output this codebase fails loud on.
    if (this.labelScope.length !== 0) {
      throw new Error(
        `binary writer: label scope not balanced at end of function ` +
          `(${this.labelScope.length} left: ${this.labelScope.join(', ')})`,
      );
    }
  }

  private noteLabel(label: string): void {
    const index = this.labelCount++;
    if (label !== '') this.labelNames.push([index, label]);
    this.labelScope.push(label);
  }

  /**
   * The labels currently in scope, innermost LAST — what a name-form branch
   * target is resolved against.
   *
   * 🔑 The writer resolves label names ITSELF rather than requiring
   * `resolveNames` to have rewritten them to depths. A depth is positional, so
   * rewriting destroys which spelling the source used: `br 1` and `br $b` both
   * become `{kind:'index'}` and no later reader can tell an authored number
   * from a resolved name (the same ambiguity `TypeUse` exists to break for type
   * references). Resolving here keeps the as-written form on the node all the
   * way to the bytes.
   *
   * ⚠️ Two scopes are NOT the obvious one, and both are in the spec:
   * - a `try`'s own label is not in scope for its `delegate`, so the label is
   *   popped BEFORE the delegate target is written;
   * - a `try_table`'s own label is not in scope for its catch targets, so its
   *   catches are written BEFORE its label is pushed.
   */
  private labelScope: string[] = [];

  private popLabel(): void {
    this.labelScope.pop();
  }

  /** A label reference: an index as written, or a name resolved to its depth. */
  private writeLabelVar(v: Var): void {
    if (v.kind === 'index') {
      this.s.writeU32Leb(v.value);
      return;
    }
    // Innermost first: a nearer label with the same name shadows an outer one,
    // which is what `(block $b (block $b (br $b)))` means.
    const at = this.labelScope.lastIndexOf(v.name);
    if (at < 0) {
      throw new Error(
        `binary writer: undefined label ${JSON.stringify(v.name)} — ` +
          `no enclosing block, loop, if, try or try_table carries that name`,
      );
    }
    this.s.writeU32Leb(this.labelScope.length - 1 - at);
  }

  /**
   * The header this carrier WRITES — {@link blockTypeOf}, from the node.
   *
   * 🔧 It read the fidelity table's `blockType`, falling back to the node's. The
   * declared results and the index the header named are both on the node now
   * (S6 step 5, stage (c2)), so there is no second place to consult: the
   * declaration may differ from what the contents derive (a94154e21), and it
   * has two spellings, an inline type and an index — the node holds both facts.
   */
  private declaredBlockType(e: Parameters<typeof blockTypeOf>[0]): BlockType {
    return blockTypeOf(e);
  }

  onNopExpr(_e: NopExpr): Result {
    // Every `nop` reaching here is one the source really wrote. A
    // synthesized slot-filler is a `pop` node and never arrives here at
    // all, which is the point of giving it its own kind (T10.8).
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
    const resultType = this.fidelity.get(e.nodeId)?.selectResultType ?? e.resultType;
    if (resultType.length === 0) {
      this.s.writeU8(Opcode.Select);
    } else {
      this.s.writeU8(Opcode.SelectT);
      this.s.writeU32Leb(resultType.length);
      // `writeValueType`, not a raw `writeU8(t as number)` — a cast the T7.4
      // ValueType refactor left behind. A `(ref $t)` annotation is an OBJECT,
      // so the cast wrote 0x00 and `select (result (ref $t))` came back out
      // as an invalid value type. Same class as the type-key stringification
      // in T10.7.
      for (const t of resultType) writeValueType(this.s, t);
    }
    return Result.Ok;
  }

  // --- Block structures ---
  beginBlockExpr(e: BlockExpr): Result {
    this.noteLabel(e.label);
    this.s.writeU8(Opcode.Block);
    writeBlockType(this.s, this.declaredBlockType(e));
    return Result.Ok;
  }
  endBlockExpr(_e: BlockExpr): Result {
    this.popLabel();
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }
  beginLoopExpr(e: LoopExpr): Result {
    this.noteLabel(e.label);
    this.s.writeU8(Opcode.Loop);
    writeBlockType(this.s, this.declaredBlockType(e));
    return Result.Ok;
  }
  endLoopExpr(_e: LoopExpr): Result {
    this.popLabel();
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }
  beginIfExpr(e: IfExpr): Result {
    this.noteLabel(e.label);
    this.s.writeU8(Opcode.If);
    writeBlockType(this.s, this.declaredBlockType(e));
    return Result.Ok;
  }
  afterIfTrueExpr(e: IfExpr): Result {
    // `null` is NO else; an empty region is an explicit empty one, and its byte
    // is written back (S6 step 5 (d2): as a list the two were both `[]`).
    if (e.ifFalse !== null) this.s.writeU8(Opcode.Else);
    return Result.Ok;
  }
  endIfExpr(_e: IfExpr): Result {
    this.popLabel();
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }

  // --- try/catch (legacy exception handling) ---
  beginTryExpr(e: TryExpr): Result {
    this.noteLabel(e.label);
    this.s.writeU8(Opcode.Try);
    writeBlockType(this.s, this.declaredBlockType(e));
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
    // The try's own label is NOT in scope for its delegate target — and it
    // leaves scope for good here: `delegate` REPLACES `end`, so `ExprVisitor`
    // fires this INSTEAD of `endTryExpr`. Pushing the label back for an end that
    // never comes leaked it, and every later named branch in the function was
    // written one frame too deep (`delegate_label_scope.test.ts`).
    this.popLabel();
    this.writeLabelVar(e.delegate!);
    return Result.Ok;
  }
  endTryExpr(_e: TryExpr): Result {
    this.popLabel();
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }

  // --- try_table (new exception handling) ---
  beginTryTableExpr(e: TryTableExpr): Result {
    this.noteLabel(e.label);
    this.s.writeU8(Opcode.TryTable);
    writeBlockType(this.s, this.declaredBlockType(e));
    this.s.writeU32Leb(e.catches.length);
    // A catch target names a label OUTSIDE this try_table, so resolve them
    // with its own label off the scope stack.
    this.popLabel();
    for (const c of e.catches) {
      this.s.writeU8(catchKindByte(c));
      if (c.tag !== undefined) writeVar(this.s, c.tag);
      this.writeLabelVar(c.target);
    }
    this.labelScope.push(e.label);
    return Result.Ok;
  }
  endTryTableExpr(_e: TryTableExpr): Result {
    this.popLabel();
    this.s.writeU8(Opcode.End);
    return Result.Ok;
  }

  // --- Branches ---
  onBrExpr(e: BrExpr): Result {
    this.s.writeU8(e.condition !== undefined ? Opcode.BrIf : Opcode.Br);
    this.writeLabelVar(e.target);
    return Result.Ok;
  }
  onBrTableExpr(e: BrTableExpr): Result {
    this.s.writeU8(Opcode.BrTable);
    this.s.writeU32Leb(e.targets.length);
    for (const t of e.targets) this.writeLabelVar(t);
    this.writeLabelVar(e.defaultTarget);
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
    this.s.writeU8(e.isReturn ? Opcode.ReturnCall : Opcode.Call);
    writeVar(this.s, e.func);
    return Result.Ok;
  }
  onCallIndirectExpr(e: CallIndirectExpr): Result {
    this.s.writeU8(e.isReturn ? Opcode.ReturnCallIndirect : Opcode.CallIndirect);
    // Refused rather than guessed: deriving it structurally picks the FIRST of
    // several identical types (T1). `synthesizeTypes` assigns an inline one.
    if (e.typeVar === undefined) {
      throw new Error('call_indirect has no type index yet — run synthesizeTypes');
    }
    writeVar(this.s, e.typeVar);
    writeVar(this.s, e.table);
    return Result.Ok;
  }
  onCallRefExpr(e: CallRefExpr): Result {
    this.s.writeU8(e.isReturn ? Opcode.ReturnCallRef : Opcode.CallRef);
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
    this.s.writeU32Leb(e.defaultInit ? GcOpcode.StructNewDefault : GcOpcode.StructNew);
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
    this.s.writeU32Leb(e.init === undefined ? GcOpcode.ArrayNewDefault : GcOpcode.ArrayNew);
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
  onBrOnExpr(e: BrOnExpr): Result {
    // The null pair are single-byte opcodes; the cast pair are GC-prefixed
    // and carry both heap types. The sub-op says which.
    if (e.opcode === BrOnOp.Null || e.opcode === BrOnOp.NonNull) {
      this.s.writeU8(e.opcode === BrOnOp.Null ? Opcode.BrOnNull : Opcode.BrOnNonNull);
      this.writeLabelVar(e.target);
      return Result.Ok;
    }
    this.s.writeU8(PREFIX_GC);
    this.s.writeU32Leb(e.opcode === BrOnOp.CastFail ? GcOpcode.BrOnCastFail : GcOpcode.BrOnCast);
    // Nullability of BOTH reference types travels in one flags byte rather
    // than in the heap types themselves: bit 0 = rt1 nullable, bit 1 = rt2.
    this.s.writeU8((e.from!.nullable ? 1 : 0) | (e.to!.nullable ? 2 : 0));
    this.writeLabelVar(e.target);
    writeHeapType(this.s, e.from!.heapType);
    writeHeapType(this.s, e.to!.heapType);
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
    writeVar(this.s, e.destTable);
    writeVar(this.s, e.sourceTable);
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
    // `rethrow $l` names a CATCH label like a branch does, so it resolves the
    // same way (legacy EH). Missing it here was the one site the label-name
    // tests caught.
    this.writeLabelVar(e.target);
    return Result.Ok;
  }

  // --- SIMD ---
  onSimdExtractExpr(e: SimdExtractExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    this.s.writeU8(e.lane);
    return Result.Ok;
  }
  onSimdReplaceExpr(e: SimdReplaceExpr): Result {
    writeOpcode(this.s, e.opcode as number);
    this.s.writeU8(e.lane);
    return Result.Ok;
  }
  onSimdShuffleOpExpr(e: SimdShuffleOpExpr): Result {
    writeOpcode(this.s, OPCODE_I8X16_SHUFFLE as number);
    this.s.writeBytes(e.lanes);
    return Result.Ok;
  }
  onSimdLoadLaneExpr(e: SimdLoadLaneExpr): Result {
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

/**
 * Finds an instruction that names a DATA SEGMENT — the ones that make the
 * DataCount section required (`memory.init`, `data.drop`, and GC's
 * `array.new_data` / `array.init_data`).
 */
class DataIndexUse implements ExprVisitorDelegate {
  found = false;
  onMemoryInitExpr(): Result {
    this.found = true;
    return Result.Ok;
  }
  onDataDropExpr(): Result {
    this.found = true;
    return Result.Ok;
  }
  onArrayNewDataExpr(): Result {
    this.found = true;
    return Result.Ok;
  }
  onArrayInitSegmentExpr(e: { kind: string }): Result {
    if (e.kind === 'array.init_data') this.found = true;
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

  private readonly m: Module;
  private readonly writeDebugNames: boolean;

  /** Named labels by FUNCTION INDEX, collected as the code section is written. */
  private readonly labelNames = new Map<number, [number, string][]>();

  constructor(m: Module, writeDebugNames: boolean) {
    this.m = m;
    this.writeDebugNames = writeDebugNames;
    this.s = new MemoryStream(4096);
    this.bodyWriter = new BodyWriter(this.s, m.fidelity);
    this.visitor = new ExprVisitor(this.bodyWriter);
  }

  // Emit a constant-expression sequence (init expr) followed by End.
  /**
   * A constant expression: its instructions, then `end` — exactly the region
   * read, however many (S6 step 5 item 6 (M2)). `what` names the slot when one
   * the format REQUIRES is missing, which is refused: writing a bare `end`
   * would invent an empty expression nobody wrote.
   */
  private writeInitExpr(r: RegionExpr | undefined, what: string): void {
    if (r === undefined) throw new Error(`binary writer: ${what} has no constant expression`);
    this.visitor.visitExprList(r.children);
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
        // PRESENT, not non-empty (M2): an empty initializer is written as one.
        if (t.init !== undefined) {
          // table-with-initializer form (reference-types proposal):
          // 0x40 0x00 reftype limits init_expr. The binary reader decodes
          // this shape (readTableSection); emitting only `reftype limits`
          // here silently dropped the initializer and desynced the round-trip.
          s.writeU8(0x40);
          s.writeU8(0x00);
          writeValueType(s, t.elemType);
          writeLimits(s, t.limits);
          this.writeInitExpr(t.init, 'a table initializer');
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
        this.writeInitExpr(g.init, `global ${g.name || '(unnamed)'}'s initializer`);
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
        // for all five candidate encodings; see tests/wabt-ts/writer/elem_form.test.ts.
        // Only when the declared type IS the funcidx form's own type. An
        // explicitly-written `funcref` elemlist is NULLABLE and must keep the
        // expression form, or the encoding silently widens — and a module the
        // spec calls invalid (a `funcref` segment against a `(ref func)`
        // table) comes back out looking valid.
        const useFuncIdx = isNonNullFuncRef(seg.elemType) &&
          seg.elemExprs.every((xs) =>
            xs.children.length === 1 && xs.children[0]!.kind === 'ref.func'
          );

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
        if (seg.kind === 'active') {
          this.writeInitExpr(seg.offset, 'an active element segment offset');
        }
        if (useFuncIdx) {
          if (flags !== 0) s.writeU8(0x00); // elemkind: funcref
        } else if (flags !== 4) {
          writeValueType(s, seg.elemType); // reftype
        }

        s.writeU32Leb(seg.elemExprs.length);
        for (const elemExpr of seg.elemExprs) {
          if (useFuncIdx) writeVar(s, (elemExpr.children[0] as RefFuncExpr).func);
          else this.writeInitExpr(elemExpr, 'an element entry');
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // DataCount section
  // ---------------------------------------------------------------------------

  /** Whether any function body names a data segment. */
  private usesDataIndex(): boolean {
    const seen = new DataIndexUse();
    const visitor = new ExprVisitor(seen);
    for (const f of this.m.funcs) {
      visitor.visitExprList(f.body.children);
      if (seen.found) return true;
    }
    return false;
  }

  /**
   * The DataCount section (id 12), when a function body names a data segment —
   * the format REQUIRES it then, since the code is decoded before the data
   * section — or when the module was read with one.
   *
   * 🔧 W6: this was written whenever a data segment existed. Upstream
   * `wat2wasm` and `wasm-tools` write it only when code uses a data index; 242
   * corpus modules differed from upstream in this section alone. A module READ
   * with one it did not need keeps it (`Module.hasDataCountSection`), so a
   * binary round trip changes nothing.
   */
  private writeDataCountSection(): void {
    const { m, s } = this;
    if (!m.hasDataCountSection && !this.usesDataIndex()) return;
    s.writeSection(BinarySection.DataCount, () => {
      s.writeU32Leb(m.dataSegments.length);
    });
  }

  // ---------------------------------------------------------------------------
  // Code section
  // ---------------------------------------------------------------------------

  private writeFuncBody(func: Func, funcIndex: number): void {
    const { s } = this;
    const sizePos = s.reserveU32Leb();
    const start = s.offset;

    // Local declarations, genuinely run-length encoded.
    //
    // The format is `vec(count, valtype)`, so N consecutive locals of one type
    // may be written as a single `(N, type)` group. This used to emit
    // `func.localDecls` verbatim, and the decoder produces one entry per local,
    // so three i32 locals went out as `3 | (1,i32) (1,i32) (1,i32)` -- 7 bytes
    // where `1 | (3,i32)` needs 3. The comment already claimed run-length
    // encoding; only the loop did not do it.
    //
    // Found by tracking down a 0.90% size gap against binaryen-ts, which does
    // coalesce. Measured over 149 corpus modules, the code sections differed by
    // 3,073 bytes and this was the whole of it.
    //
    // Semantically identical: the locals are the sum of the counts, in order, so
    // coalescing ADJACENT entries of the same type changes neither the number of
    // locals nor their indices. Entries of different types are never merged --
    // `i32, i64, i32` stays three groups, which is why that shape already agreed
    // between the two writers.
    const coalesced: { type: ValueType; count: number }[] = [];
    // The DECLARED locals: the first `sig.params.length` slots are the params,
    // which the type section already gave (M6c).
    for (const local of func.locals.slice(func.sig.params.length)) {
      const last = coalesced[coalesced.length - 1];
      if (last !== undefined && last.type === local.type) last.count += 1;
      else coalesced.push({ type: local.type, count: 1 });
    }
    s.writeU32Leb(coalesced.length);
    for (const decl of coalesced) {
      s.writeU32Leb(decl.count);
      writeValueType(s, decl.type);
    }

    // Body
    this.bodyWriter.beginFunctionBody();
    this.visitor.visitExprList(func.body.children);
    if (this.bodyWriter.labelNames.length > 0) {
      this.labelNames.set(funcIndex, this.bodyWriter.labelNames);
    }

    // End
    s.writeU8(Opcode.End);

    s.patchU32Leb(sizePos, s.offset - start);
  }

  private writeCodeSection(): void {
    const { m, s } = this;
    if (m.funcs.length === 0) return;
    const firstDefined = m.imports.filter((i) => i.kind === ExternalKind.Func).length;
    s.writeSection(BinarySection.Code, () => {
      s.writeU32Leb(m.funcs.length);
      m.funcs.forEach((f, i) => this.writeFuncBody(f, firstDefined + i));
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
          this.writeInitExpr(seg.offset, 'an active data segment offset');
        } else if (seg.kind === 'passive') {
          s.writeU32Leb(1); // flags = 1: passive
        } else if (seg.kind === 'active') {
          s.writeU32Leb(2); // flags = 2: active, explicit memory
          writeVar(s, seg.memoryVar);
          this.writeInitExpr(seg.offset, 'an active data segment offset');
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
    const data = c.data;
    if (data === null) {
      // The `name` section's place (M2f): generated here, under the same
      // condition as the one `write` appends when no place was recorded.
      if (c.name !== CUSTOM_SECTION_NAME_NAME) {
        throw new Error(`binary writer: custom section "${c.name}" has no payload`);
      }
      if (this.writeDebugNames && (this.m.hasNameSection || this.namesAnything())) {
        this.writeNameSection();
      }
      return;
    }
    s.writeSection(BinarySection.Custom, () => {
      s.writeName(c.name);
      s.writeBytes(data);
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
  // Name section — N1 P2 (cmem/names.md)
  // ---------------------------------------------------------------------------

  /**
   * The `name` custom section, generated from the IR's names.
   *
   * 🔧 This writer used to write none — `writeDebugNames` was declared and
   * ignored — so WAT → `wat2wasm` → `wasm2wat` lost every name. The owner's
   * rule: wabt-ts is the fidelity half and ALWAYS keeps names.
   *
   * For the ten kinds upstream writes, the bytes are upstream
   * `wat2wasm --debug-names`'s, measured: subsections in id order; each flat
   * map lists only NAMED entries and is omitted when there are none; the local
   * subsection is ALWAYS written and has an entry for EVERY function, imports
   * included, even an empty one — so even `(module)` gets a 10-byte section.
   * Names are written without the text format's `$`.
   *
   * LABELS (3) and GC FIELDS (10) go beyond upstream, which writes neither
   * (FEATURE N2 in cmem/divergences.md). They follow the flat maps' rule —
   * named entries only, omitted when there are none — so a module without
   * named labels or fields stays byte-identical to upstream.
   */
  /** Whether anything in the module has a name — labels as collected by the code section. */
  private namesAnything(): boolean {
    const { m } = this;
    const named = (x: { name: string }) => x.name !== '';
    const importNamed = m.imports.some((imp) => {
      switch (imp.kind) {
        case ExternalKind.Func:
          return named(imp.func) || imp.func.locals.some((l) => l.name !== undefined);
        case ExternalKind.Table:
          return named(imp.table);
        case ExternalKind.Memory:
          return named(imp.memory);
        case ExternalKind.Global:
          return named(imp.global);
        case ExternalKind.Tag:
          return named(imp.tag);
      }
    });
    return m.name !== '' || importNamed || this.labelNames.size > 0 ||
      m.funcs.some((f) => named(f) || f.locals.some((l) => l.name !== undefined)) ||
      m.types.some((t) =>
        named(t) ||
        (t.kind === 'struct' && t.fields.some(named)) ||
        (t.kind === 'array' && named(t.field))
      ) ||
      [m.tables, m.memories, m.globals, m.tags, m.elemSegments, m.dataSegments]
        .some((items: readonly { name: string }[]) => items.some(named));
  }

  private writeNameSection(): void {
    const { m, s } = this;
    const funcs: Func[] = [];
    const tables: { name: string }[] = [];
    const memories: { name: string }[] = [];
    const globals: { name: string }[] = [];
    const tags: { name: string }[] = [];
    for (const imp of m.imports) {
      switch (imp.kind) {
        case ExternalKind.Func:
          funcs.push(imp.func);
          break;
        case ExternalKind.Table:
          tables.push(imp.table);
          break;
        case ExternalKind.Memory:
          memories.push(imp.memory);
          break;
        case ExternalKind.Global:
          globals.push(imp.global);
          break;
        case ExternalKind.Tag:
          tags.push(imp.tag);
          break;
      }
    }
    funcs.push(...m.funcs);
    tables.push(...m.tables);
    memories.push(...m.memories);
    globals.push(...m.globals);
    tags.push(...m.tags);

    /** A flat name map: `vec(index, name)` over the named entries only. */
    const nameMap = (id: NameSectionSubsection, items: readonly { name: string }[]): void => {
      const named = namedEntries(items.map((it, i) => [i, it.name]));
      if (named.length === 0) return;
      s.writeSection(id, () => writeNameEntries(s, named));
    };
    /** An indirect name map: `vec(outer, vec(inner, name))`, outers with a name only. */
    const indirectMap = (
      id: NameSectionSubsection,
      outer: [number, [number, string][]][],
    ): void => {
      const kept = outer.map(([i, inner]) => [i, namedEntries(inner)] as const)
        .filter(([, inner]) => inner.length > 0);
      if (kept.length === 0) return;
      s.writeSection(id, () => {
        s.writeU32Leb(kept.length);
        for (const [i, inner] of kept) {
          s.writeU32Leb(i);
          writeNameEntries(s, inner);
        }
      });
    };

    s.writeSection(BinarySection.Custom, () => {
      s.writeName(CUSTOM_SECTION_NAME_NAME);
      if (m.name !== '') {
        s.writeSection(NameSectionSubsection.Module, () => s.writeName(bareName(m.name)));
      }
      nameMap(NameSectionSubsection.Function, funcs);
      // Which functions the subsection lists: every one, which is upstream
      // `wat2wasm --debug-names`'s shape — unless the module was READ from a
      // section that listed only some, as every producer's does (N6).
      const listed = m.localNamesListed;
      if (listed !== null) {
        const entries = funcs.map((f, i) => [i, f] as const)
          .filter(([i]) => listed === undefined || listed.has(i));
        s.writeSection(NameSectionSubsection.Local, () => {
          s.writeU32Leb(entries.length);
          for (const [i, f] of entries) {
            s.writeU32Leb(i);
            writeNameEntries(s, namedEntries(localNameEntries(f.locals)));
          }
        });
      }
      indirectMap(
        NameSectionSubsection.Label,
        [...this.labelNames].sort(([a], [b]) => a - b),
      );
      nameMap(NameSectionSubsection.Type, m.types);
      nameMap(NameSectionSubsection.Table, tables);
      nameMap(NameSectionSubsection.Memory, memories);
      nameMap(NameSectionSubsection.Global, globals);
      nameMap(NameSectionSubsection.ElemSegment, m.elemSegments);
      nameMap(NameSectionSubsection.DataSegment, m.dataSegments);
      indirectMap(
        NameSectionSubsection.Field,
        m.types.map((t, i) => [
          i,
          t.kind === 'struct'
            ? t.fields.map((f, j) => [j, f.name] as [number, string])
            : t.kind === 'array'
            ? [[0, t.field.name]]
            : [],
        ]),
      );
      nameMap(NameSectionSubsection.Tag, tags);
    });
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
    // A `name` section already among the customs is one the reader kept as raw
    // bytes — it was written verbatim above, so generating another would put a
    // second name section beside it — or its PLACE, where it was generated (M2f). Otherwise one is generated when the
    // module had one or names anything (`Module.hasNameSection`): a binary
    // read WITHOUT names must not gain a section on the way back out, but one
    // the caller has since named must not lose the names.
    if (
      this.writeDebugNames &&
      !this.m.customs.some((c) => c.name === CUSTOM_SECTION_NAME_NAME) &&
      (this.m.hasNameSection || this.namesAnything())
    ) {
      this.writeNameSection();
    }

    return s.toUint8Array();
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Options for {@link writeBinaryIr}. */
export interface WriteBinaryOptions {
  /**
   * Write the `name` custom section from the IR's names. Default: **`true`**.
   *
   * wabt-ts keeps names: `wat2wasm` output must disassemble back to the names
   * it was written with (N1, cmem/names.md). That is why the default is `true`
   * where upstream's `--debug-names` is off. `false` is for REMOVING names —
   * it is what `wasm-strip` passes — and is not an option any wabt-ts tool
   * offers for ordinary output.
   *
   * A `name` section held as a raw custom section (read with
   * `readDebugNames: false`) is written verbatim either way, and suppresses
   * the generated one.
   */
  writeDebugNames?: boolean;
}

/**
 * Encode a {@link Module} IR as a wasm binary. Returns the bytes; the
 * encoder doesn't accumulate errors (any IR shape it can't encode throws).
 */
export function writeBinaryIr(m: Module, opts: WriteBinaryOptions = {}): Uint8Array {
  return new BinaryWriter(m, opts.writeDebugNames ?? true).write();
}
