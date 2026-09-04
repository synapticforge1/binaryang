// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/binary-reader.h, src/binary-reader.cc,
//                  include/wabt/binary-reader-ir.h, src/binary-reader-ir.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import type { Location } from '../core/error.ts';
import { unknownLocation } from '../core/error.ts';
import { addError, type ErrorList } from '../core/error.ts';
import { isReferenceType, Type, typeToHeapTypeName } from '../core/types.ts';
import {
  BinarySection,
  ExternalKind,
  sectionOrderRank,
  WASM_MAGIC,
  WASM_VERSION,
} from '../core/binary.ts';
import {
  GcOpcode,
  MiscOpcode,
  Opcode,
  PREFIX_GC,
  PREFIX_MISC,
  PREFIX_SIMD,
  PREFIX_THREADS,
} from '../core/opcode.ts';
import {
  decodeS32Leb128,
  decodeS64Leb128,
  decodeU32Leb128,
  decodeU64Leb128,
} from '../core/leb128.ts';

// UTF-8 decoder reused across every name read. TextDecoder is stateless when
// called via .decode(); a single module-level instance avoids reallocating
// per call in the hot path.
// `ignoreBOM: true` keeps U+FEFF as an ordinary character instead of treating
// a leading EF BB BF as a byte-order mark. Names in the binary are byte
// strings and one of them may legitimately BE the BOM (names.wast exports it);
// stripping it silently renames the export to "".
const TEXT_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * Strict decoder for NAMES. A wasm name must be valid UTF-8, so an invalid
 * sequence is a malformed MODULE, not a character to be repaired.
 *
 * The lenient decoder above silently substitutes U+FFFD, which turned an
 * invalid import/export name into a DIFFERENT, valid-looking name — and a
 * name is the module's public contract. `fatal: true` makes `decode` throw
 * instead (T12.5).
 */
const STRICT_NAME_DECODER = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
import {
  type ArrayGetExpr,
  type ArrayLenExpr,
  type ArrayNewDataExpr,
  type ArrayNewDefaultExpr,
  type ArrayNewElemExpr,
  type ArrayNewExpr,
  type ArrayNewFixedExpr,
  type ArraySetExpr,
  type AtomicFenceExpr,
  type BinaryExpr,
  BLOCK_TYPE_VOID,
  type BlockType,
  blockTypeFuncType,
  blockTypeValue,
  type BrOnCastExpr,
  type Catch,
  CatchKind,
  type ConstExpr,
  constF32,
  constF64,
  constI32,
  constI64,
  constV128,
  type DataDropExpr,
  type ElemDropExpr,
  type Expr,
  type Field,
  type Func,
  type FuncSignature,
  type Global,
  type GlobalGetExpr,
  type I31GetExpr,
  type Limits,
  type LocalGetExpr,
  makeModule,
  type Memory,
  type MemorySizeExpr,
  type Module,
  type NopExpr,
  operandPlaceholder,
  type QuaternaryExpr,
  type RefCastExpr,
  type RefEqExpr,
  type RefFuncExpr,
  type RefI31Expr,
  type RefNullExpr,
  type RefTestExpr,
  type RethrowExpr,
  type SectionMeta,
  type StructGetExpr,
  type StructNewDefaultExpr,
  type StructNewExpr,
  type StructSetExpr,
  type Table,
  type TableCatch,
  type TableSizeExpr,
  type Tag,
  type UnreachableExpr,
  type ValueType,
  type Var,
  varIndex,
  varName,
} from '../ir/ir.ts';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link readBinaryIr}. */
export interface ReadBinaryOptions {
  /** Source filename used in error messages. Default: `'<input>'`. */
  filename?: string;
  /**
   * If true (default), the `name` custom section is parsed and the names
   * land on `func.name`, `global.name`, etc. If false, the section stays
   * in `module.customs` unparsed (used by `wasm-strip`).
   */
  readDebugNames?: boolean;
  /** If true, the reader aborts on the first error rather than continuing. */
  stopOnFirstError?: boolean;
}

// ---------------------------------------------------------------------------
// Internal decode frame (label stack entry for function body decoding)
// ---------------------------------------------------------------------------

type FrameKind =
  | 'root' // function body or init expression
  | 'block'
  | 'loop'
  | 'if_then'
  | 'if_else'
  | 'try'
  | 'try_table';

class Frame {
  kind: FrameKind;
  blockType: BlockType;
  label: string;
  stack: Expr[]; // pending value operands
  stmts: Expr[]; // completed statement-level expressions
  loc: Location;

  // if / if_else
  cond: Expr | undefined = undefined;
  then_: Expr[] | undefined = undefined;

  // try
  catches: Catch[] | undefined = undefined;
  tryBody: Expr[] | undefined = undefined;

  // try_table
  tableCatches: TableCatch[] | undefined = undefined;

  constructor(kind: FrameKind, blockType: BlockType, label: string, loc: Location) {
    this.kind = kind;
    this.blockType = blockType;
    this.label = label;
    this.stack = [];
    this.stmts = [];
    this.loc = loc;
  }

  flush(): Expr[] {
    const result = [...this.stmts, ...this.stack];
    this.stmts = [];
    this.stack = [];
    return result;
  }
}

/**
 * Commit `expr` as a statement, flushing any pending operand values first.
 *
 * The decoder keeps two per-frame lists: `stack` holds values a following
 * instruction might still consume, `stmts` holds committed statements. At
 * `end`, {@link Frame.flush} concatenates them as `[...stmts, ...stack]` —
 * so a value that nobody ends up consuming is emitted AFTER every statement
 * that followed it in the original code.
 *
 * That reordering is silent and it changes what the module means. The case
 * that exposed it:
 *
 *   (block (result i32) (global.get $g) (global.set $g (i32.const 9)))
 *
 * `global.get` goes on the stack, `global.set` is a statement, and the block
 * came back out of `wasm2wat` as `global.set; global.get` — reading the NEW
 * value of the global instead of the old one. No error, just a different
 * program.
 *
 * A pending value is NOT necessarily dead — `global.get; i32.const 10;
 * i32.const 9; global.set; i32.add` consumes both pending values after the
 * statement. Draining commits them anyway, and the later `i32.add` then gets
 * `Nop` operands. That is an inaccurate TREE but a correct BINARY: emitting
 * the drained values in order leaves them on the runtime operand stack, and
 * the Nop operands encode to nothing that disturbs it, so `i32.add` still
 * finds its arguments. (Same mechanism the legacy-EH handler bodies rely on,
 * v1.2.9.) Ordering, by contrast, is not recoverable once lost — which is
 * why draining is the right trade.
 *
 * This mirrors the parser's `pushStmt`, which exists for the identical reason
 * on the other side of the round-trip (v1.3.0).
 */
function pushStmt(stack: Expr[], stmts: Expr[], expr: Expr): void {
  for (const pending of stack) stmts.push(pending);
  stack.length = 0;
  stmts.push(expr);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blockResultCount(bt: BlockType, m: Module): number {
  if (bt.kind === 'void') return 0;
  if (bt.kind === 'value') return 1;
  const entry = m.types[bt.typeIdx];
  if (!entry || entry.kind !== 'func') return 0;
  return entry.sig.results.length;
}

function blockParamCount(bt: BlockType, m: Module): number {
  if (bt.kind !== 'func_type') return 0;
  const entry = m.types[bt.typeIdx];
  if (!entry || entry.kind !== 'func') return 0;
  return entry.sig.params.length;
}

function brTargetResultCount(labelStack: Frame[], depth: number, m: Module): number {
  const idx = labelStack.length - 1 - depth;
  if (idx < 0) return 0;
  const frame = labelStack[idx]!;
  if (frame.kind === 'loop') return blockParamCount(frame.blockType, m);
  return blockResultCount(frame.blockType, m);
}

function getFuncSig(m: Module, funcIdx: number): FuncSignature {
  const totalImports = m.numFuncImports;
  if (funcIdx < totalImports) {
    const imp = m.imports[funcIdx];
    if (imp && imp.kind === ExternalKind.Func) return imp.func.sig;
    return { params: [], results: [] };
  }
  const def = m.funcs[funcIdx - totalImports];
  return def ? def.sig : { params: [], results: [] };
}

function getTypeSig(m: Module, typeIdx: number): FuncSignature {
  const entry = m.types[typeIdx];
  if (!entry || entry.kind !== 'func') return { params: [], results: [] };
  return entry.sig;
}

function getTagSig(m: Module, tagIdx: number): FuncSignature {
  const totalImports = m.numTagImports;
  if (tagIdx < totalImports) {
    const imp = m.imports[tagIdx];
    if (imp && imp.kind === ExternalKind.Tag) return imp.tag.sig;
    return { params: [], results: [] };
  }
  const def = m.tags[tagIdx - totalImports];
  return def ? def.sig : { params: [], results: [] };
}

function popN(stack: Expr[], n: number): Expr[] {
  const result: Expr[] = [];
  for (let i = 0; i < n; i++) {
    result.unshift(
      stack.pop() ??
        operandPlaceholder({ filename: '', line: 0, column: 0, offset: 0 }),
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// BinaryReader class
// ---------------------------------------------------------------------------

/**
 * Single-class wasm binary decoder. Reads a `.wasm` byte buffer and
 * produces a {@link Module} IR by inlining every section decoder and
 * maintaining a per-frame operand stack during function-body decoding
 * (the stack-to-tree conversion that turns linear bytecode into the
 * IR's nested {@link Expr} shape).
 *
 * Prefer the higher-level {@link readBinaryIr} entry point in most
 * cases; instantiate `BinaryReader` directly only if you need fine-
 * grained control over partial section reads.
 */

/**
 * SIMD arith/convert sub-opcodes (the `0xfd` group) that pop ONE operand.
 * Everything else in the arith/convert space is binary (pop 2); the lone
 * non-relaxed ternary is `v128.bitselect` (0x52), handled separately. Derived
 * from the canonical names in `core/opcode.ts`. Used by `decodeSimdOp` — the
 * earlier code assumed every op in this space was binary, so it mis-popped a
 * second operand for every unary op (abs/neg/sqrt/ceil/floor/trunc/nearest/
 * popcnt/all_true/bitmask/extend/extadd_pairwise/trunc_sat/convert/not/
 * any_true/demote/promote), corrupting the operand-stack reconstruction.
 */
const SIMD_UNARY_OPS: ReadonlySet<number> = new Set([
  // Relaxed SIMD (sub-opcodes >= 0x100). Without these the decoder fell
  // through to its binary default and popped two operands for a one-operand
  // instruction, so wasm2wat emitted `nop`.
  0x101,
  0x102,
  0x103,
  0x104, // i32x4.relaxed_trunc_{f32x4_s,f32x4_u,f64x2_s_zero,f64x2_u_zero}
  0x4d,
  0x53, // v128.not, v128.any_true
  0x5e,
  0x5f, // f32x4.demote_f64x2_zero, f64x2.promote_low_f32x4
  0x60,
  0x61,
  0x62,
  0x63,
  0x64, // i8x16 abs/neg/popcnt/all_true/bitmask
  0x67,
  0x68,
  0x69,
  0x6a, // f32x4 ceil/floor/trunc/nearest
  0x74,
  0x75,
  0x7a, // f64x2 ceil/floor/trunc
  0x7c,
  0x7d,
  0x7e,
  0x7f, // extadd_pairwise (i16x8 x2, i32x4 x2)
  0x80,
  0x81,
  0x83,
  0x84, // i16x8 abs/neg/all_true/bitmask
  0x87,
  0x88,
  0x89,
  0x8a, // i16x8 extend_low/high s/u
  0x94, // f64x2.nearest
  0xa0,
  0xa1,
  0xa3,
  0xa4, // i32x4 abs/neg/all_true/bitmask
  0xa7,
  0xa8,
  0xa9,
  0xaa, // i32x4 extend_low/high s/u
  0xc0,
  0xc1,
  0xc3,
  0xc4, // i64x2 abs/neg/all_true/bitmask
  0xc7,
  0xc8,
  0xc9,
  0xca, // i64x2 extend_low/high s/u
  0xe0,
  0xe1,
  0xe3, // f32x4 abs/neg/sqrt
  0xec,
  0xed,
  0xef, // f64x2 abs/neg/sqrt
  0xf8,
  0xf9,
  0xfa,
  0xfb, // i32x4.trunc_sat_f32x4_s/u, f32x4.convert_i32x4_s/u
  0xfc,
  0xfd,
  0xfe,
  0xff, // i32x4.trunc_sat_f64x2_*_zero, f64x2.convert_low_*
]);

export class BinaryReader {
  private data: Uint8Array;
  private pos = 0;
  private errors: ErrorList;
  private filename: string;
  private hadError = false;
  private opts: ReadBinaryOptions;

  constructor(data: Uint8Array, errors: ErrorList, opts: ReadBinaryOptions = {}) {
    this.data = data;
    this.errors = errors;
    this.filename = opts.filename ?? '';
    this.opts = opts;
  }

  private loc(): Location {
    return { filename: this.filename, line: 0, column: 0, offset: this.pos };
  }

  private err(msg: string): void {
    addError(this.errors, this.loc(), msg);
    this.hadError = true;
  }

  private ok(): boolean {
    return !this.hadError || !this.opts.stopOnFirstError;
  }

  // ---------------------------------------------------------------------------
  // Low-level readers
  // ---------------------------------------------------------------------------

  private readU8(): number {
    if (this.pos >= this.data.length) {
      this.err('unexpected end of binary');
      return 0;
    }
    return this.data[this.pos++]!;
  }

  private peekU8(): number {
    if (this.pos >= this.data.length) return 0;
    return this.data[this.pos]!;
  }

  private readU32Le(): number {
    if (this.pos + 4 > this.data.length) {
      this.err('unexpected end of binary');
      return 0;
    }
    const v = (this.data[this.pos]! |
      (this.data[this.pos + 1]! << 8) |
      (this.data[this.pos + 2]! << 16) |
      (this.data[this.pos + 3]! << 24)) >>> 0;
    this.pos += 4;
    return v;
  }

  // INTENT OF THE FOUR HELPERS BELOW: the `decode*Leb128` functions in
  // `core/leb128.ts` THROW a RangeError on a truncated or over-long encoding,
  // which is right for a pure decoder — but this reader answers to a
  // Result-based contract, and every published binary tool
  // (`wasm2wat`, `wasm-validate`, `wasm-objdump`, `wasm-strip`) sits on top of
  // it. Letting the throw escape turned malformed INPUT into an uncaught
  // exception in a caller that was correctly checking `result`: ~102 of 585
  // truncated / single-byte-corrupted modules crashed each tool (T13.29).
  //
  // So each one converts the throw into a positioned diagnostic and returns a
  // safe zero; `this.hadError` then halts decoding through the existing
  // `ok()` guard. This mirrors T7.1's "never throw, never hang" rule, which was
  // applied to the WAT parser and never to the binary path.
  //
  // Do NOT make `core/leb128.ts` stop throwing to fix this — its callers
  // include the WAT parser and the bridge, where a throw is the right signal.
  // The conversion belongs at THIS boundary.
  private lebError(e: unknown): void {
    this.err(e instanceof Error ? e.message : String(e));
    // Park the cursor at the end so a caller that ignores `hadError` cannot
    // spin on the same malformed bytes.
    this.pos = this.data.length;
  }

  private readU32Leb(): number {
    try {
      const [v, n] = decodeU32Leb128(this.data, this.pos);
      this.pos += n;
      return v;
    } catch (e) {
      this.lebError(e);
      return 0;
    }
  }

  private readS32Leb(): number {
    try {
      const [v, n] = decodeS32Leb128(this.data, this.pos);
      this.pos += n;
      return v;
    } catch (e) {
      this.lebError(e);
      return 0;
    }
  }

  private readS64Leb(): bigint {
    try {
      const [v, n] = decodeS64Leb128(this.data, this.pos);
      this.pos += n;
      return v;
    } catch (e) {
      this.lebError(e);
      return 0n;
    }
  }

  private readU64Leb(): bigint {
    try {
      const [v, n] = decodeU64Leb128(this.data, this.pos);
      this.pos += n;
      return v;
    } catch (e) {
      this.lebError(e);
      return 0n;
    }
  }

  private readF32Bits(): number {
    const v = this.readU32Le();
    return v;
  }

  private readF64Bits(): bigint {
    if (this.pos + 8 > this.data.length) {
      this.err('unexpected end of binary');
      return 0n;
    }
    let v = 0n;
    for (let i = 0; i < 8; i++) {
      v |= BigInt(this.data[this.pos++]!) << BigInt(i * 8);
    }
    return v;
  }

  private readBytes(n: number): Uint8Array {
    if (this.pos + n > this.data.length) {
      this.err('unexpected end of binary');
      return new Uint8Array(0);
    }
    const bytes = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return bytes;
  }

  private readName(): string {
    const len = this.readU32Leb();
    const bytes = this.readBytes(len);
    try {
      return STRICT_NAME_DECODER.decode(bytes);
    } catch {
      this.err('malformed UTF-8 encoding');
      // Fall back to the lenient decode so the rest of the section still
      // parses and one bad name does not cascade into a wall of noise.
      return TEXT_DECODER.decode(bytes);
    }
  }

  // ---------------------------------------------------------------------------
  // Type helpers
  // ---------------------------------------------------------------------------

  private readValType(): ValueType {
    const b = this.readU8();
    // `0x64` / `0x63` introduce a CONCRETE typed reference — `(ref H)` /
    // `(ref null H)` — whose heap type follows as a signed LEB. Reading them
    // as a plain one-byte type left the heap type in the stream, desyncing
    // every subsequent field.
    if (b === Type.Ref || b === Type.RefNull) {
      return { kind: 'ref', heapType: this.readHeapTypeVar(), nullable: b === Type.RefNull };
    }
    return b as Type;
  }

  /**
   * Read a GC-proposal heap type immediate (signed LEB128). Negative values
   * are single-byte encodings of abstract heap types (matching the wabt-ts
   * `Type.AnyRef` / `EqRef` / … enum entries); non-negative values are
   * indices into the type section. Returns a `Var` in the same shape the
   * WAT parser produces.
   */
  private readHeapTypeVar(): Var {
    const b = this.peekU8();
    if ((b & 0x80) === 0) {
      // Single-byte form: either an abstract heap type (high bit set in the
      // signed sense, so unsigned byte ≥ 0x40) or a tiny non-negative index.
      this.pos++;
      if (b >= 0x40) {
        const name = abstractHeapTypeNameForByte(b);
        if (name !== null) return varName(name);
        return varName(`<heaptype:0x${b.toString(16)}>`);
      }
      return varIndex(b);
    }
    // Multi-byte LEB. May be a large positive index or a negative abstract
    // heap type that didn't fit in one byte (none of the GC spec entries
    // require this, but the decoder must round-trip what writers emit).
    const [v, n] = decodeS32Leb128(this.data, this.pos);
    this.pos += n;
    if (v < 0) {
      const code = (-v) & 0x7f;
      const name = abstractHeapTypeNameForByte(code);
      if (name !== null) return varName(name);
      return varName(`<heaptype:0x${code.toString(16)}>`);
    }
    return varIndex(v);
  }

  private readBlockType(): BlockType {
    const b = this.peekU8();
    if ((b & 0x80) === 0) {
      this.pos++;
      if (b === 0x40) return BLOCK_TYPE_VOID;
      // ⚠️ `0x63` / `0x64` are `(ref null ht)` / `(ref ht)` — the tag byte is
      // FOLLOWED BY a heap type, exactly as in `readValueType`.
      //
      // Reading only the tag left that heap-type byte in the instruction
      // stream, where the next decode step consumed it as an OPCODE. A
      // `(block (result (ref 0)))` decoded as a block with a phantom
      // `unreachable` inside it and a block type missing its heap index — and
      // the module still round-tripped BYTE-IDENTICALLY, because the writer
      // emitted that phantom instruction as the very byte it was mis-read from.
      //
      // Byte equality hid it completely. What did not hide it: the spec suite,
      // where the same gap let two INVALID modules through (`ref.wast:65,69`)
      // because a heap index that was never stored could never be range-checked.
      if (b === Type.Ref || b === Type.RefNull) {
        return blockTypeValue({
          kind: 'ref',
          heapType: this.readHeapTypeVar(),
          nullable: b === Type.RefNull,
        });
      }
      if (b >= 0x40) return blockTypeValue(b as Type);
      return blockTypeFuncType(b);
    }
    // Multi-byte: read as s33 for type index
    const [v, n] = decodeS32Leb128(this.data, this.pos);
    this.pos += n;
    if (v < 0) return blockTypeValue((-v & 0x7f) as Type);
    return blockTypeFuncType(v);
  }

  /**
   * `allowPageSize` says whether the custom-page-sizes flag bit is legal here:
   * true for a memory, false for a TABLE, which is counted in elements and has
   * no page size. It is a parameter rather than a check on the decoded value
   * because those are different questions — a table carrying the bit is
   * malformed however plausible the value after it looks.
   */
  /**
   * Read a tag's ATTRIBUTE byte, which the spec defines as 0x00 (exception).
   *
   * Both tag paths read it into nowhere, so `0x01` and `0xff` decoded to
   * exactly the same tag as `0x00` — a malformed module accepted silently, and
   * the same "we consume it and ignore it" shape as the element kind byte and
   * the mutability byte (T12.8). Our own binary writer emits 0x00 with the
   * comment "only valid value"; this is the reader half of a rule the producer
   * already knew.
   *
   * Returns false when the caller should stop.
   */
  private readTagAttribute(): boolean {
    const attr = this.readU8();
    if (attr !== 0x00) {
      this.err(`malformed tag attribute: 0x${attr.toString(16)}`);
      return false;
    }
    return true;
  }

  private readLimits(allowPageSize = true): Limits {
    const flags = this.readU8();
    // Only four flag bits are defined (max / shared / 64-bit / custom page
    // size). Masking each one out individually meant an undefined bit was
    // silently IGNORED: `0x10` decoded as a plain `(memory 0)`.
    if ((flags & ~0x0f) !== 0) this.err(`malformed limits flags: 0x${flags.toString(16)}`);
    const hasMax = (flags & 0x01) !== 0;
    const isShared = (flags & 0x02) !== 0;
    const is64 = (flags & 0x04) !== 0;
    const hasCustomPageSize = (flags & 0x08) !== 0;
    // Matching the writer: 64-bit limits are u64 on the wire. Reading them as
    // u32 threw "LEB128 u32 overflow" on any 64-bit memory above 2^32.
    const readSize = (): bigint => (is64 ? this.readU64Leb() : BigInt(this.readU32Leb()));
    const initial = readSize();
    const max = hasMax ? readSize() : undefined;
    const limits: Limits = { initial, isShared, is64 };
    if (max !== undefined) limits.max = max;
    // ORDER: the page-size field TRAILS min/max, so it is read last — reading
    // it with the flag byte would mis-frame every following field. The VALUE is
    // not checked here; `validateModule` owns "is this a legal page size", so a
    // bad one is an invalid module with a named error rather than a decode
    // failure.
    if (hasCustomPageSize) {
      if (!allowPageSize) {
        this.err('malformed limits flags: a table has no page size');
        return limits;
      }
      const v = this.readU32Leb();
      // Bound only what the field must HOLD; legality (0 or 16) is the
      // validator's call. Unbounded, a log2 of 2^31 reached the WAT writer's
      // `2 ** log2` and printed `(pagesize Infinity)`.
      if (v > 64) {
        this.err(`invalid page size: 2^${v}`);
        return limits;
      }
      limits.pageSizeLog2 = v;
    }
    return limits;
  }

  private readMemArg(): { align: number; offset: bigint; memidx: Var } {
    const alignFlags = this.readU32Leb();
    // Bits 0-5 are the alignment exponent and bit 6 says an explicit memory
    // index follows. Nothing above bit 6 is defined, and `& 0x3f` DISCARDED
    // it: `align=0x80` decoded as alignment exponent 0, which is a different
    // instruction that V8 happily runs.
    if (alignFlags > 0x7f) this.err(`malformed memop flags: 0x${alignFlags.toString(16)}`);
    const hasMemIdx = (alignFlags & 0x40) !== 0;
    const alignLog2 = alignFlags & 0x3f;
    // `2 **`, NOT `1 <<`. JS shift operands are taken mod 32, so `1 << 32` is
    // 1 and `1 << 33` is 2: an absurd alignment exponent WRAPPED into a small
    // plausible one. The validator then compared that against the opcode's
    // natural alignment, found it smaller, and accepted a module V8 and
    // Wasmtime both reject — and `wasm2wat` printed it as `align=1`, so
    // re-encoding produced a VALID module that is a different instruction.
    // That is the T11 class (the pipeline must never repair invalid input),
    // reached through the decoder rather than the encoder. Exponents 31 and 63
    // happened to wrap to a NEGATIVE value and were rejected by accident,
    // which is why this looked covered.
    const align = 2 ** alignLog2;
    const memidx = hasMemIdx ? this.readU32Leb() : 0;
    // The memarg OFFSET is u64 under memory64 — align64.wast stores at
    // 0xffffffffffffffff — and reading it as u32 threw "LEB128 u32 overflow"
    // on a binary V8 accepts. A value that fits in u32 encodes identically, so
    // reading u64 unconditionally is safe; the IR field is already `bigint`.
    const offset = this.readU64Leb();
    return { align, offset, memidx: varIndex(memidx) };
  }

  private readRefType(): ValueType {
    // Element types can be CONCRETE typed references, whose heap type follows
    // the 0x64 / 0x63 marker. Reading a single byte left the heap type in the
    // stream, so every following field of the table entry was shifted by one
    // (`(table $x 1 (ref null $t))` came back as `(table 0 ref null)`).
    const t = this.readValType();
    // And it has to BE a reference type. `readValType` accepts any value type,
    // so an element segment declaring element type `i32` decoded to a table of
    // i32 rather than being rejected.
    if (typeof t === 'number' && !isReferenceType(t)) {
      this.err(`malformed reference type: 0x${(t as number).toString(16)}`);
    }
    return t;
  }

  // ---------------------------------------------------------------------------
  // Section readers
  // ---------------------------------------------------------------------------

  /**
   * Read the type section: a vector of REC GROUPS.
   *
   *   rectype  ::= 0x4e vec(subtype) | subtype
   *   subtype  ::= 0x50 vec(typeidx) comptype   (sub, non-final)
   *              | 0x4f vec(typeidx) comptype   (sub final)
   *              | comptype                     (shorthand for sub final, no supers)
   *
   * The vector counts GROUPS while the type index space counts SUBTYPES, so a
   * 2-type `(rec …)` is one vector slot and two indices. Reading the count as
   * a type count (the old behaviour) desyncs on the first explicit group.
   */
  private readTypeSection(m: Module, end: number): void {
    const groupCount = this.readU32Leb();
    // INTENT: the declared count and the entries present must AGREE. Running
    // out of input mid-section is `shortSection()`, not the end of the loop.
    //
    // This was the one section reader of eleven that put `this.pos < end` in
    // the loop CONDITION instead of checking it in the body — so a declared
    // count larger than the entries supplied simply stopped early and reported
    // nothing. `(type count 4294967295)` with no entries decoded to a module
    // with ZERO types and validated clean; V8 rejects it. Its ten siblings all
    // call `shortSection()` (or `this.err`) from inside the loop, which is the
    // pattern to copy (T13.33).
    for (let g = 0; g < groupCount && this.ok(); g++) {
      if (this.pos >= end) return this.shortSection();
      if (this.peekU8() === 0x4e) {
        this.pos++;
        const n = this.readU32Leb();
        const first = m.types.length;
        for (let i = 0; i < n && this.ok(); i++) {
          if (this.pos >= end) return this.shortSection();
          this.readSubType(m);
        }
        // Mark the group on its first entry so the writer can re-emit it.
        const head = m.types[first];
        if (head !== undefined) head.recGroupSize = n;
      } else {
        this.readSubType(m);
      }
    }
  }

  /** Read one subtype: the optional `sub` wrapper, then the comptype. */
  private readSubType(m: Module): void {
    const loc = this.loc();
    const marker = this.peekU8();
    let sub: { final: boolean; supertypes: Var[] } | undefined;
    if (marker === 0x4f || marker === 0x50) {
      this.pos++;
      const n = this.readU32Leb();
      const supertypes: Var[] = [];
      for (let i = 0; i < n; i++) supertypes.push(varIndex(this.readU32Leb()));
      sub = { final: marker === 0x4f, supertypes };
    }
    const before = m.types.length;
    this.readCompType(m, loc);
    // `sub` rides on the entry the comptype just pushed.
    const entry = m.types[before];
    if (entry !== undefined && sub !== undefined) entry.sub = sub;
  }

  /** Read the composite part: func (0x60), struct (0x5f), or array (0x5e). */
  private readCompType(m: Module, loc: Location): void {
    const marker = this.readU8();
    if (marker === 0x60) {
      const paramCount = this.readU32Leb();
      const params: ValueType[] = [];
      for (let j = 0; j < paramCount; j++) params.push(this.readValType());
      const resultCount = this.readU32Leb();
      const results: ValueType[] = [];
      for (let j = 0; j < resultCount; j++) results.push(this.readValType());
      m.types.push({ kind: 'func', name: '', sig: { params, results }, loc });
    } else if (marker === 0x5f) {
      const fieldCount = this.readU32Leb();
      const fields: Field[] = [];
      for (let j = 0; j < fieldCount; j++) {
        const type = this.readValType();
        const mutable = this.readMutability();
        fields.push({ name: '', type, mutable });
      }
      m.types.push({ kind: 'struct', name: '', fields, loc });
    } else if (marker === 0x5e) {
      const type = this.readValType();
      const mutable = this.readMutability();
      m.types.push({ kind: 'array', name: '', field: { name: '', type, mutable }, loc });
    } else {
      this.err(`unknown type section entry marker: 0x${marker.toString(16)}`);
    }
  }

  /**
   * A section declared more entries than its own bytes can hold.
   *
   * Every entry loop used to be guarded by `this.pos < end`, which STOPS at
   * the section boundary and produces a module with fewer items than the
   * count said -- `(table 1 …)` with no table entry decoded to a module with
   * no tables at all, and an export section claiming two exports decoded to
   * one. The count is part of the encoding; falling short of it is malformed.
   */
  private shortSection(): void {
    this.err('unexpected end of section or function');
  }

  private readImportSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const loc = this.loc();
      const module_ = this.readName();
      const field = this.readName();
      const kind = this.readU8() as ExternalKind;

      switch (kind) {
        case ExternalKind.Func: {
          const sigIdx = this.readU32Leb();
          const sig = getTypeSig(m, sigIdx);
          const func: Func = {
            name: '',
            loc,
            typeVar: varIndex(sigIdx),
            sig,
            localDecls: [],
            body: [],
            tailcall: false,
          };
          m.imports.push({ kind: ExternalKind.Func, module: module_, field, func });
          m.numFuncImports++;
          break;
        }
        case ExternalKind.Table: {
          const elemType = this.readRefType();
          const limits = this.readLimits(false);
          const table: Table = { name: '', loc, elemType, limits, init: [] };
          m.imports.push({ kind: ExternalKind.Table, module: module_, field, table });
          m.numTableImports++;
          break;
        }
        case ExternalKind.Memory: {
          const limits = this.readLimits();
          if (limits.isShared) m.featuresUsed.threads = true;
          const memory: Memory = { name: '', loc, limits };
          m.imports.push({ kind: ExternalKind.Memory, module: module_, field, memory });
          m.numMemoryImports++;
          break;
        }
        case ExternalKind.Global: {
          const type = this.readValType();
          const mutable = this.readMutability();
          const global: Global = { name: '', loc, type, mutable, init: [] };
          m.imports.push({ kind: ExternalKind.Global, module: module_, field, global });
          m.numGlobalImports++;
          break;
        }
        case ExternalKind.Tag: {
          // The attribute byte must be consumed before the type index, exactly
          // like readTagSection. The earlier code read the type index starting
          // at the attribute byte, so every imported tag resolved to type 0 and
          // the following bytes were misaligned for any subsequent import.
          if (!this.readTagAttribute()) break;
          const sigIdx = this.readU32Leb();
          const sig = getTypeSig(m, sigIdx);
          const tag: Tag = { name: '', loc, sig };
          m.imports.push({ kind: ExternalKind.Tag, module: module_, field, tag });
          m.numTagImports++;
          m.featuresUsed.exceptions = true;
          break;
        }
        default:
          this.err(`unknown import kind: ${kind}`);
      }
    }
  }

  private readFunctionSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const loc = this.loc();
      const sigIdx = this.readU32Leb();
      const sig = getTypeSig(m, sigIdx);
      m.funcs.push({
        name: '',
        loc,
        typeVar: varIndex(sigIdx),
        sig,
        localDecls: [],
        body: [],
        tailcall: false,
      });
    }
  }

  private readTableSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const loc = this.loc();
      // The table-with-init form (reference-types proposal) is signalled by
      // a leading 0x40 byte BEFORE the reftype: `0x40 0x00 reftype limits
      // init_expr`. The simple form is just `reftype limits`. An earlier
      // version of this decoder peeked a flag AFTER the reftype, which
      // confused the limits-flag byte for a "hasInit" indicator and
      // misaligned every subsequent section read. Bug found by the Phase 7
      // bridge dry-run 2026-05-25.
      if (this.peekU8() === 0x40) {
        this.readU8(); // 0x40 tag
        // The byte after 0x40 is RESERVED and defined as 0x00. Reading it into
        // nowhere accepted any value: `40 03 …` decoded to exactly the same
        // table as `40 00 …`. Our own writer emits 0x00 and says so — this is
        // the reader half of a rule the producer already knew (T13.5).
        const reserved = this.readU8();
        if (reserved !== 0x00) {
          this.err(`malformed table init form: reserved byte 0x${reserved.toString(16)}`);
          return;
        }
        const elemType = this.readRefType();
        const limits = this.readLimits(false);
        const init = this.readInitExpr(m);
        m.tables.push({ name: '', loc, elemType, limits, init });
      } else {
        const elemType = this.readRefType();
        const limits = this.readLimits(false);
        m.tables.push({ name: '', loc, elemType, limits, init: [] });
      }
    }
  }

  private readMemorySection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const loc = this.loc();
      const limits = this.readLimits();
      if (limits.isShared) m.featuresUsed.threads = true;
      m.memories.push({ name: '', loc, limits });
    }
  }

  private readGlobalSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const loc = this.loc();
      const type = this.readValType();
      const mutable = this.readMutability();
      const init = this.readInitExpr(m);
      m.globals.push({ name: '', loc, type, mutable, init });
    }
  }

  private readExportSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const name = this.readName();
      const kindByte = this.readU8();
      // The `as ExternalKind` cast this replaced asserted a fact about the byte
      // instead of checking it, so ANY value became a valid export kind and the
      // module was accepted. The import section beside this one has always had
      // the equivalent `default: unknown import kind` arm -- the two dispatches
      // disagreed, and only one of them was wrong.
      //
      // Found by MEASUREMENT, not review: the A3 corruption sweep
      // (`deno task offsets`) flips each byte of a valid module and asks whether
      // reader AND validator still accept what V8 rejects. This field was the
      // one shape the whole pipeline waved through.
      if (
        kindByte !== ExternalKind.Func && kindByte !== ExternalKind.Table &&
        kindByte !== ExternalKind.Memory && kindByte !== ExternalKind.Global &&
        kindByte !== ExternalKind.Tag
      ) {
        this.err(`unknown export kind: ${kindByte}`);
        return;
      }
      const kind = kindByte as ExternalKind;
      const idx = this.readU32Leb();
      m.exports.push({ name, kind, var: varIndex(idx) });
    }
  }

  private readStartSection(m: Module, _end: number): void {
    const funcIdx = this.readU32Leb();
    m.start = varIndex(funcIdx);
  }

  private readElemSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const loc = this.loc();
      const flags = this.readU32Leb();
      const isPassive = (flags & 0x01) !== 0;
      const hasExplicitIndex = (flags & 0x02) !== 0;
      const usesExprs = (flags & 0x04) !== 0;

      let kind: 'active' | 'passive' | 'declared' = 'active';
      if (isPassive) {
        if (hasExplicitIndex) kind = 'declared';
        else kind = 'passive';
      }

      let tableVar: Var = varIndex(0);
      let offset: Expr[] = [];

      if (!isPassive) {
        if (hasExplicitIndex) tableVar = varIndex(this.readU32Leb());
        offset = this.readInitExpr(m);
      }

      // The IMPLIED element type differs by form, and conflating them lost the
      // distinction the spec draws between `(elem … $f)` and
      // `(elem … funcref (ref.func $f))`:
      //
      //   funcidx (flags 0-3)  ->  NON-NULLABLE `(ref func)`; every entry is a
      //                            function index, so none can be null
      //   exprs   (flags 4)    ->  `funcref`, the nullable abstract type
      //
      // Only flags 0 and 4 leave it implicit; the rest spell it out.
      let elemType: ValueType = usesExprs
        ? Type.FuncRef
        : { kind: 'ref', heapType: { kind: 'name', name: 'func' }, nullable: false };
      if (isPassive || hasExplicitIndex) {
        if (usesExprs) {
          elemType = this.readRefType();
        } else {
          // The element KIND byte, which the spec defines as 0x00 and nothing
          // else. Reading it into nowhere accepted any byte at all.
          const kindByte = this.readU8();
          if (kindByte !== 0x00) this.err(`malformed element kind: 0x${kindByte.toString(16)}`);
        }
      }

      const elemExprs: Expr[][] = [];
      const elemCount = this.readU32Leb();

      if (usesExprs) {
        for (let j = 0; j < elemCount; j++) {
          elemExprs.push(this.readInitExpr(m));
        }
      } else {
        for (let j = 0; j < elemCount; j++) {
          const funcIdx = this.readU32Leb();
          const refExpr: Expr = { kind: 'ref.func', func: varIndex(funcIdx), loc: this.loc() };
          elemExprs.push([refExpr]);
        }
      }

      m.elemSegments.push({ name: '', loc, kind, tableVar, offset, elemType, elemExprs });
    }
  }

  private readTagSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const loc = this.loc();
      if (!this.readTagAttribute()) return;
      const sigIdx = this.readU32Leb();
      const sig = getTypeSig(m, sigIdx);
      m.tags.push({ name: '', loc, sig });
      m.featuresUsed.exceptions = true;
    }
  }

  /**
   * The data-count section declares how many data segments follow.
   *
   * It was read and thrown away with the comment "we don't store it". It is
   * not decoration: `memory.init` and `data.drop` REQUIRE it (the code section
   * is decoded before the data section, so it is the only way to know a data
   * index is in range at that point), and when it is present it must agree
   * with the data section's own count.
   */
  private readDataCountSection(_m: Module, _end: number): void {
    this.dataCount = this.readU32Leb();
  }

  private readDataSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) return this.shortSection();
      const loc = this.loc();
      const flags = this.readU32Leb();
      const isPassive = (flags & 0x01) !== 0;
      const hasExplicitMemIdx = (flags & 0x02) !== 0;

      const kind: 'active' | 'passive' = isPassive ? 'passive' : 'active';
      let memoryVar: Var = varIndex(0);
      let offset: Expr[] = [];

      if (!isPassive) {
        if (hasExplicitMemIdx) memoryVar = varIndex(this.readU32Leb());
        offset = this.readInitExpr(m);
      }

      const dataLen = this.readU32Leb();
      const data = this.readBytes(dataLen);

      m.dataSegments.push({ name: '', loc, kind, memoryVar, offset, data });
    }
  }

  private readCodeSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    // The code section has exactly one entry per DEFINED function, and
    // `m.funcs` holds exactly those (imports live in `m.imports`), so the two
    // counts must agree. Neither side checked, so a
    // module declaring three functions and supplying two bodies decoded to a
    // function with an EMPTY body rather than an error.
    if (count !== m.funcs.length) {
      this.err('function and code section have inconsistent lengths');
      return;
    }

    for (let i = 0; i < count && this.ok(); i++) {
      if (this.pos >= end) {
        this.err('unexpected end of section or function');
        return;
      }
      const bodySize = this.readU32Leb();
      const bodyEnd = this.pos + bodySize;
      if (bodyEnd > end) {
        this.err('unexpected end of section or function');
        return;
      }

      // The code section has one entry per DEFINED function (imports excluded),
      // so it lines up 1:1 with m.funcs. A previous version added
      // m.numFuncImports to the index, which fired only when a module had
      // both imports and defined funcs — unexercised by tests until the
      // Phase 7 dry-run bridged a wabt IR through binaryen-ts.
      const func = m.funcs[i];
      if (!func) {
        this.err(`code section function index out of range: ${i}`);
        this.pos = bodyEnd;
        continue;
      }

      func.loc = this.loc();

      // Local declarations. The counts are per-GROUP and the spec caps their
      // SUM at 2^32-1, so four groups of 2^30 overflow while no single one
      // does -- summing in a JS number keeps the check exact.
      const localDeclCount = this.readU32Leb();
      let totalLocals = 0;
      for (let j = 0; j < localDeclCount; j++) {
        const declCount = this.readU32Leb();
        const type = this.readValType();
        totalLocals += declCount;
        func.localDecls.push({ type, count: declCount });
      }
      if (totalLocals > 0xffff_ffff) {
        this.err('too many locals');
        return;
      }

      func.body = this.decodeBody(bodyEnd, m, func);
      if (this.ok() && this.pos !== bodyEnd) {
        this.err('unexpected end of section or function');
        return;
      }
      this.pos = bodyEnd;
    }
  }

  private readNameSection(m: Module, data: Uint8Array): void {
    if (!this.opts.readDebugNames) return;
    let pos = 0;

    const readU32Leb = (): number => {
      const [v, n] = decodeU32Leb128(data, pos);
      pos += n;
      return v;
    };
    const readName_ = (): string => {
      const len = readU32Leb();
      const bytes = data.slice(pos, pos + len);
      pos += len;
      return TEXT_DECODER.decode(bytes);
    };

    while (pos < data.length) {
      const subsectionType = data[pos++]!;
      const subsectionSize = readU32Leb();
      const subsectionEnd = pos + subsectionSize;

      switch (subsectionType) {
        case 0: // module name
          m.name = '$' + readName_();
          break;
        case 1: { // function names
          const fnCount = readU32Leb();
          for (let i = 0; i < fnCount && pos < subsectionEnd; i++) {
            const idx = readU32Leb();
            const name = readName_();
            if (name) {
              const func = m.funcs[idx - m.numFuncImports];
              if (func && idx >= m.numFuncImports) func.name = '$' + name;
            }
          }
          break;
        }
        default:
          pos = subsectionEnd;
      }
      pos = subsectionEnd;
    }
  }

  // ---------------------------------------------------------------------------
  // Init expression decoder (constant expressions)
  // ---------------------------------------------------------------------------

  private readInitExpr(m: Module): Expr[] {
    return this.decodeBody(this.data.length, m, null);
  }

  // ---------------------------------------------------------------------------
  // Function body / expression decoder (operand-stack → tree IR)
  // ---------------------------------------------------------------------------

  private decodeBody(bodyEnd: number, m: Module, func: Func | null): Expr[] {
    const funcResultCount = func ? func.sig.results.length : 1;
    const rootLoc = this.loc();
    const labelStack: Frame[] = [new Frame('root', BLOCK_TYPE_VOID, '', rootLoc)];

    while (this.pos < bodyEnd && labelStack.length > 0 && this.ok()) {
      const loc = this.loc();
      const op = this.readU8();
      const frame = labelStack[labelStack.length - 1]!;
      const { stack, stmts } = frame;

      switch (op) {
        // --- Control ---
        case Opcode.Unreachable: {
          pushStmt(stack, stmts, { kind: 'unreachable', loc } as UnreachableExpr);
          break;
        }
        case Opcode.Nop: {
          pushStmt(stack, stmts, { kind: 'nop', loc } as NopExpr);
          break;
        }
        case Opcode.Block: {
          const bt = this.readBlockType();
          labelStack.push(new Frame('block', bt, '', loc));
          break;
        }
        case Opcode.Loop: {
          const bt = this.readBlockType();
          labelStack.push(new Frame('loop', bt, '', loc));
          break;
        }
        case Opcode.If: {
          const bt = this.readBlockType();
          const cond = stack.pop() ?? operandPlaceholder(loc);
          const f = new Frame('if_then', bt, '', loc);
          f.cond = cond;
          labelStack.push(f);
          break;
        }
        case Opcode.Else: {
          if (frame.kind !== 'if_then') {
            this.err('else outside if');
            break;
          }
          const thenBody = frame.flush();
          frame.kind = 'if_else';
          frame.then_ = thenBody;
          break;
        }
        case Opcode.Try: {
          m.featuresUsed.exceptions = true;
          const bt = this.readBlockType();
          const f = new Frame('try', bt, '', loc);
          f.catches = [];
          labelStack.push(f);
          break;
        }
        case Opcode.Catch: {
          const tagIdx = this.readU32Leb();
          m.featuresUsed.exceptions = true;
          if (frame.kind !== 'try') {
            this.err('catch outside try');
            break;
          }
          const body = frame.flush();
          if (frame.tryBody === undefined) {
            frame.tryBody = body;
          } else if (frame.catches && frame.catches.length > 0) {
            // `body` holds the PREVIOUS catch handler's instructions. Assign it
            // to that catch before opening the new one — otherwise every catch
            // except the last is left with an empty body (the End finalizer
            // only fills the final catch). Mirrors the catch_all case below.
            frame.catches[frame.catches.length - 1]!.body = body;
          }
          if (frame.catches) {
            frame.catches.push({ loc, tag: varIndex(tagIdx), isRef: false, body: [] });
          }
          break;
        }
        case Opcode.CatchAll: {
          m.featuresUsed.exceptions = true;
          if (frame.kind !== 'try') {
            this.err('catch_all outside try');
            break;
          }
          const body = frame.flush();
          if (frame.tryBody === undefined) frame.tryBody = body;
          else if (frame.catches && frame.catches.length > 0) {
            const prev = frame.catches[frame.catches.length - 1]!;
            prev.body = body;
          }
          if (frame.catches) frame.catches.push({ loc, isRef: false, body: [] });
          break;
        }
        case Opcode.Delegate: {
          m.featuresUsed.exceptions = true;
          const depth = this.readU32Leb();
          if (frame.kind !== 'try') {
            this.err('delegate outside try');
            break;
          }
          const tryBody = frame.flush();
          labelStack.pop();
          const parent = labelStack[labelStack.length - 1]!;
          const tryExpr: Expr = {
            kind: 'try',
            label: frame.label,
            blockType: frame.blockType,
            body: tryBody,
            catches: [],
            delegate: varIndex(depth),
            loc: frame.loc,
          };
          const rCount = blockResultCount(frame.blockType, m);
          if (rCount > 0) parent.stack.push(tryExpr);
          else pushStmt(parent.stack, parent.stmts, tryExpr);
          break;
        }
        case Opcode.TryTable: {
          m.featuresUsed.exceptions = true;
          const bt = this.readBlockType();
          const catchCount = this.readU32Leb();
          const tableCatches: TableCatch[] = [];
          for (let i = 0; i < catchCount; i++) {
            const catchKind = this.readU8();
            let kind: CatchKind;
            let tag: Var | undefined;
            switch (catchKind) {
              case 0x00:
                kind = CatchKind.Catch;
                tag = varIndex(this.readU32Leb());
                break;
              case 0x01:
                kind = CatchKind.CatchRef;
                tag = varIndex(this.readU32Leb());
                break;
              case 0x02:
                kind = CatchKind.CatchAll;
                break;
              case 0x03:
                kind = CatchKind.CatchAllRef;
                break;
              default:
                // Unknown catch-kind byte. The 0x00/0x01 cases read a tag
                // varint and 0x02/0x03 don't; silently defaulting to Catch
                // (without reading the tag) would desync the byte stream for
                // everything after. Fail loud; the outer `this.ok()` guard then
                // halts decoding (the partial IR is discarded by readBinaryIr).
                this.err(`unknown try_table catch kind: 0x${catchKind.toString(16)}`);
                kind = CatchKind.Catch; // sentinel to satisfy definite-assignment
                break;
            }
            if (!this.ok()) break; // stop on a malformed catch clause
            const target = varIndex(this.readU32Leb());
            const tc: TableCatch = tag ? { loc, kind, tag, target } : { loc, kind, target };
            tableCatches.push(tc);
          }
          const f = new Frame('try_table', bt, '', loc);
          f.tableCatches = tableCatches;
          labelStack.push(f);
          break;
        }
        case Opcode.End: {
          if (labelStack.length === 1) {
            // Root frame done
            const body = frame.flush();
            return body;
          }
          labelStack.pop();
          const parent = labelStack[labelStack.length - 1]!;

          const endBody = frame.flush();
          let node: Expr | undefined;

          switch (frame.kind) {
            case 'block':
              node = {
                kind: 'block',
                label: frame.label,
                blockType: frame.blockType,
                body: endBody,
                loc: frame.loc,
              };
              break;
            case 'loop':
              node = {
                kind: 'loop',
                label: frame.label,
                blockType: frame.blockType,
                body: endBody,
                loc: frame.loc,
              };
              break;
            case 'if_then':
              node = {
                kind: 'if',
                label: frame.label,
                blockType: frame.blockType,
                cond: frame.cond ?? operandPlaceholder(loc),
                then_: endBody,
                else_: [],
                loc: frame.loc,
              };
              break;
            case 'if_else': {
              node = {
                kind: 'if',
                label: frame.label,
                blockType: frame.blockType,
                cond: frame.cond ?? operandPlaceholder(loc),
                then_: frame.then_ ?? [],
                else_: endBody,
                loc: frame.loc,
              };
              break;
            }
            case 'try': {
              let tryBody = frame.tryBody;
              const catches = frame.catches ?? [];
              if (tryBody === undefined) {
                tryBody = endBody;
              } else {
                if (catches.length > 0) {
                  const last = catches[catches.length - 1]!;
                  last.body = endBody;
                }
              }
              node = {
                kind: 'try',
                label: frame.label,
                blockType: frame.blockType,
                body: tryBody,
                catches,
                loc: frame.loc,
              };
              break;
            }
            case 'try_table':
              node = {
                kind: 'try_table',
                label: frame.label,
                blockType: frame.blockType,
                body: endBody,
                catches: frame.tableCatches ?? [],
                loc: frame.loc,
              };
              break;
          }

          if (node !== undefined) {
            // A loop's blocktype means different things at its two ends, and
            // this used to force `0` for loops, conflating them:
            //
            //   - a BRANCH to a loop targets its START and carries its
            //     PARAMETERS (handled by `brTargetResultCount`, which reads
            //     `blockParamCount` for loop frames);
            //   - a loop reaching its END falls through and produces its
            //     RESULTS, exactly like a block.
            //
            // Forcing 0 here flushed `(loop (result i32) …)` as a statement
            // instead of pushing its value, so whatever consumed it found an
            // empty stack and took an `operandPlaceholder`. That is 2,095 of the
            // 2,140 placeholders in the corpus, all landing in `local.set.value`.
            //
            // The modules still round-tripped -- the writer spells a placeholder
            // by emitting linear form, which reassembles -- so this was invisible
            // in bytes and visible only as an IR that could not be folded.
            const rCount = blockResultCount(frame.blockType, m);
            if (rCount > 0) parent.stack.push(node);
            else pushStmt(parent.stack, parent.stmts, node);
          }
          break;
        }

        // --- Branches ---
        case Opcode.Br: {
          const depth = this.readU32Leb();
          const rCount = brTargetResultCount(labelStack, depth, m);
          // The target may carry SEVERAL results; pop them all and restore
          // stack order. Popping one dropped the rest for a multi-value label.
          const values: Expr[] = [];
          for (let i = 0; i < rCount; i++) {
            const v = stack.pop();
            if (v === undefined) break;
            values.unshift(v);
          }
          pushStmt(stack, stmts, { kind: 'br', target: varIndex(depth), values, loc });
          break;
        }
        case Opcode.BrIf: {
          const depth = this.readU32Leb();
          const rCount = brTargetResultCount(labelStack, depth, m);
          const cond_ = stack.pop() ?? operandPlaceholder(loc);
          const values: Expr[] = [];
          for (let i = 0; i < rCount; i++) {
            const v = stack.pop();
            if (v === undefined) break;
            values.unshift(v);
          }
          pushStmt(stack, stmts, {
            kind: 'br_if',
            target: varIndex(depth),
            cond: cond_,
            values,
            loc,
          });
          break;
        }
        case Opcode.BrTable: {
          const numTargets = this.readU32Leb();
          const targets: Var[] = [];
          for (let i = 0; i < numTargets; i++) targets.push(varIndex(this.readU32Leb()));
          const defaultTarget = varIndex(this.readU32Leb());
          const value = stack.pop() ?? operandPlaceholder(loc);
          // Values carried to the target sit below the index. Leave them as
          // preceding statements (the linear shape) rather than pulling them
          // into the node, matching how the binary stream orders them.
          pushStmt(stack, stmts, {
            kind: 'br_table',
            targets,
            defaultTarget,
            value,
            values: [],
            loc,
          });
          break;
        }
        case Opcode.Return: {
          const values = funcResultCount > 0 ? popN(stack, funcResultCount) : [];
          pushStmt(stack, stmts, { kind: 'return', values, loc });
          break;
        }

        // --- Calls ---
        case Opcode.Call: {
          const funcIdx = this.readU32Leb();
          const sig = getFuncSig(m, funcIdx);
          const args = popN(stack, sig.params.length);
          const callExpr: Expr = { kind: 'call', func: varIndex(funcIdx), args, loc };
          if (sig.results.length > 0) stack.push(callExpr);
          else pushStmt(stack, stmts, callExpr);
          break;
        }
        case Opcode.CallIndirect: {
          const typeIdx = this.readU32Leb();
          const tableIdx = this.readU32Leb();
          const sig = getTypeSig(m, typeIdx);
          const callee = stack.pop() ?? operandPlaceholder(loc);
          const args = popN(stack, sig.params.length);
          const entry = m.types[typeIdx];
          const sigType: { params: ValueType[]; results: ValueType[] } =
            entry && entry.kind === 'func' ? entry.sig : { params: [], results: [] };
          const ciExpr: Expr = {
            kind: 'call_indirect',
            sig: sigType,
            typeVar: varIndex(typeIdx),
            table: varIndex(tableIdx),
            args,
            callee,
            loc,
          };
          if (sig.results.length > 0) stack.push(ciExpr);
          else pushStmt(stack, stmts, ciExpr);
          break;
        }
        case Opcode.CallRef: {
          const typeIdx = this.readU32Leb();
          const sig = getTypeSig(m, typeIdx);
          const callee = stack.pop() ?? operandPlaceholder(loc);
          const args = popN(stack, sig.params.length);
          const crExpr: Expr = { kind: 'call_ref', sigType: varIndex(typeIdx), args, callee, loc };
          if (sig.results.length > 0) stack.push(crExpr);
          else pushStmt(stack, stmts, crExpr);
          break;
        }
        case Opcode.ReturnCall: {
          m.featuresUsed.tailcall = true;
          const funcIdx = this.readU32Leb();
          const sig = getFuncSig(m, funcIdx);
          const args = popN(stack, sig.params.length);
          pushStmt(stack, stmts, { kind: 'return_call', func: varIndex(funcIdx), args, loc });
          break;
        }
        case Opcode.ReturnCallIndirect: {
          m.featuresUsed.tailcall = true;
          const typeIdx = this.readU32Leb();
          const tableIdx = this.readU32Leb();
          const sig = getTypeSig(m, typeIdx);
          const callee = stack.pop() ?? operandPlaceholder(loc);
          const args = popN(stack, sig.params.length);
          const entry = m.types[typeIdx];
          const sigType: { params: ValueType[]; results: ValueType[] } =
            entry && entry.kind === 'func' ? entry.sig : { params: [], results: [] };
          pushStmt(stack, stmts, {
            kind: 'return_call_indirect',
            sig: sigType,
            typeVar: varIndex(typeIdx),
            table: varIndex(tableIdx),
            args,
            callee,
            loc,
          });
          break;
        }
        case Opcode.ReturnCallRef: {
          m.featuresUsed.tailcall = true;
          const typeIdx = this.readU32Leb();
          const sig = getTypeSig(m, typeIdx);
          const callee = stack.pop() ?? operandPlaceholder(loc);
          const args = popN(stack, sig.params.length);
          pushStmt(stack, stmts, {
            kind: 'return_call_ref',
            sigType: varIndex(typeIdx),
            args,
            callee,
            loc,
          });
          break;
        }

        // --- Drop / Select ---
        case Opcode.Drop: {
          const value = stack.pop() ?? operandPlaceholder(loc);
          pushStmt(stack, stmts, { kind: 'drop', value, loc });
          break;
        }
        case Opcode.Select: {
          const cond_ = stack.pop() ?? operandPlaceholder(loc);
          const val2 = stack.pop() ?? operandPlaceholder(loc);
          const val1 = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'select', val1, val2, cond: cond_, resultType: [], loc });
          break;
        }
        case Opcode.SelectT: {
          const numTypes = this.readU32Leb();
          const resultType: ValueType[] = [];
          for (let i = 0; i < numTypes; i++) resultType.push(this.readValType());
          const cond_ = stack.pop() ?? operandPlaceholder(loc);
          const val2 = stack.pop() ?? operandPlaceholder(loc);
          const val1 = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'select', val1, val2, cond: cond_, resultType, loc });
          break;
        }

        // --- Locals ---
        case Opcode.LocalGet: {
          const idx = this.readU32Leb();
          stack.push({ kind: 'local.get', var: varIndex(idx), loc } as LocalGetExpr);
          break;
        }
        case Opcode.LocalSet: {
          const idx = this.readU32Leb();
          const value = stack.pop() ?? operandPlaceholder(loc);
          pushStmt(stack, stmts, { kind: 'local.set', var: varIndex(idx), value, loc });
          break;
        }
        case Opcode.LocalTee: {
          const idx = this.readU32Leb();
          const value = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'local.tee', var: varIndex(idx), value, loc });
          break;
        }

        // --- Globals ---
        case Opcode.GlobalGet: {
          const idx = this.readU32Leb();
          stack.push({ kind: 'global.get', var: varIndex(idx), loc } as GlobalGetExpr);
          break;
        }
        case Opcode.GlobalSet: {
          const idx = this.readU32Leb();
          const value = stack.pop() ?? operandPlaceholder(loc);
          pushStmt(stack, stmts, { kind: 'global.set', var: varIndex(idx), value, loc });
          break;
        }

        // --- Tables ---
        case Opcode.TableGet: {
          const idx = this.readU32Leb();
          const index = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'table.get', table: varIndex(idx), index, loc });
          break;
        }
        case Opcode.TableSet: {
          const idx = this.readU32Leb();
          const value = stack.pop() ?? operandPlaceholder(loc);
          const index = stack.pop() ?? operandPlaceholder(loc);
          pushStmt(stack, stmts, { kind: 'table.set', table: varIndex(idx), index, value, loc });
          break;
        }

        // --- Memory load/store ---
        case Opcode.I32Load:
        case Opcode.I64Load:
        case Opcode.F32Load:
        case Opcode.F64Load:
        case Opcode.I32Load8S:
        case Opcode.I32Load8U:
        case Opcode.I32Load16S:
        case Opcode.I32Load16U:
        case Opcode.I64Load8S:
        case Opcode.I64Load8U:
        case Opcode.I64Load16S:
        case Opcode.I64Load16U:
        case Opcode.I64Load32S:
        case Opcode.I64Load32U: {
          const { align, offset: memOffset, memidx } = this.readMemArg();
          const address = stack.pop() ?? operandPlaceholder(loc);
          stack.push({
            kind: 'load',
            opcode: op as Opcode,
            align,
            offset: memOffset,
            memidx,
            address,
            loc,
          });
          break;
        }
        case Opcode.I32Store:
        case Opcode.I64Store:
        case Opcode.F32Store:
        case Opcode.F64Store:
        case Opcode.I32Store8:
        case Opcode.I32Store16:
        case Opcode.I64Store8:
        case Opcode.I64Store16:
        case Opcode.I64Store32: {
          const { align, offset: memOffset, memidx } = this.readMemArg();
          const value = stack.pop() ?? operandPlaceholder(loc);
          const address = stack.pop() ?? operandPlaceholder(loc);
          pushStmt(stack, stmts, {
            kind: 'store',
            opcode: op as Opcode,
            align,
            offset: memOffset,
            memidx,
            address,
            value,
            loc,
          });
          break;
        }
        case Opcode.MemorySize: {
          const memidx = this.readU32Leb();
          stack.push({ kind: 'memory.size', memidx: varIndex(memidx), loc } as MemorySizeExpr);
          break;
        }
        case Opcode.MemoryGrow: {
          const memidx = this.readU32Leb();
          const delta = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'memory.grow', memidx: varIndex(memidx), delta, loc });
          break;
        }

        // --- Constants ---
        case Opcode.I32Const: {
          const value = this.readS32Leb();
          stack.push({ kind: 'const', value: constI32(value), loc } as ConstExpr);
          break;
        }
        case Opcode.I64Const: {
          const value = this.readS64Leb();
          stack.push({ kind: 'const', value: constI64(value), loc } as ConstExpr);
          break;
        }
        case Opcode.F32Const: {
          const bits = this.readF32Bits();
          stack.push({ kind: 'const', value: constF32(bits), loc } as ConstExpr);
          break;
        }
        case Opcode.F64Const: {
          const bits = this.readF64Bits();
          stack.push({ kind: 'const', value: constF64(bits), loc } as ConstExpr);
          break;
        }

        // --- Numeric: comparisons (2 pops, 1 push) ---
        case Opcode.I32Eq:
        case Opcode.I32Ne:
        case Opcode.I32LtS:
        case Opcode.I32LtU:
        case Opcode.I32GtS:
        case Opcode.I32GtU:
        case Opcode.I32LeS:
        case Opcode.I32LeU:
        case Opcode.I32GeS:
        case Opcode.I32GeU:
        case Opcode.I64Eq:
        case Opcode.I64Ne:
        case Opcode.I64LtS:
        case Opcode.I64LtU:
        case Opcode.I64GtS:
        case Opcode.I64GtU:
        case Opcode.I64LeS:
        case Opcode.I64LeU:
        case Opcode.I64GeS:
        case Opcode.I64GeU:
        case Opcode.F32Eq:
        case Opcode.F32Ne:
        case Opcode.F32Lt:
        case Opcode.F32Gt:
        case Opcode.F32Le:
        case Opcode.F32Ge:
        case Opcode.F64Eq:
        case Opcode.F64Ne:
        case Opcode.F64Lt:
        case Opcode.F64Gt:
        case Opcode.F64Le:
        case Opcode.F64Ge: {
          const right = stack.pop() ?? operandPlaceholder(loc);
          const left = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'compare', opcode: op as Opcode, left, right, loc });
          break;
        }

        // --- Numeric: unary (1 pop, 1 push) ---
        case Opcode.I32Eqz:
        case Opcode.I64Eqz:
        case Opcode.I32Clz:
        case Opcode.I32Ctz:
        case Opcode.I32Popcnt:
        case Opcode.I64Clz:
        case Opcode.I64Ctz:
        case Opcode.I64Popcnt:
        case Opcode.F32Abs:
        case Opcode.F32Neg:
        case Opcode.F32Ceil:
        case Opcode.F32Floor:
        case Opcode.F32Trunc:
        case Opcode.F32Nearest:
        case Opcode.F32Sqrt:
        case Opcode.F64Abs:
        case Opcode.F64Neg:
        case Opcode.F64Ceil:
        case Opcode.F64Floor:
        case Opcode.F64Trunc:
        case Opcode.F64Nearest:
        case Opcode.F64Sqrt:
        case Opcode.I32Extend8S:
        case Opcode.I32Extend16S:
        case Opcode.I64Extend8S:
        case Opcode.I64Extend16S:
        case Opcode.I64Extend32S: {
          const operand = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'unary', opcode: op as Opcode, operand, loc });
          break;
        }

        // --- Numeric: binary (2 pops, 1 push) ---
        case Opcode.I32Add:
        case Opcode.I32Sub:
        case Opcode.I32Mul:
        case Opcode.I32DivS:
        case Opcode.I32DivU:
        case Opcode.I32RemS:
        case Opcode.I32RemU:
        case Opcode.I32And:
        case Opcode.I32Or:
        case Opcode.I32Xor:
        case Opcode.I32Shl:
        case Opcode.I32ShrS:
        case Opcode.I32ShrU:
        case Opcode.I32Rotl:
        case Opcode.I32Rotr:
        case Opcode.I64Add:
        case Opcode.I64Sub:
        case Opcode.I64Mul:
        case Opcode.I64DivS:
        case Opcode.I64DivU:
        case Opcode.I64RemS:
        case Opcode.I64RemU:
        case Opcode.I64And:
        case Opcode.I64Or:
        case Opcode.I64Xor:
        case Opcode.I64Shl:
        case Opcode.I64ShrS:
        case Opcode.I64ShrU:
        case Opcode.I64Rotl:
        case Opcode.I64Rotr:
        case Opcode.F32Add:
        case Opcode.F32Sub:
        case Opcode.F32Mul:
        case Opcode.F32Div:
        case Opcode.F32Min:
        case Opcode.F32Max:
        case Opcode.F32Copysign:
        case Opcode.F64Add:
        case Opcode.F64Sub:
        case Opcode.F64Mul:
        case Opcode.F64Div:
        case Opcode.F64Min:
        case Opcode.F64Max:
        case Opcode.F64Copysign: {
          const right = stack.pop() ?? operandPlaceholder(loc);
          const left = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'binary', opcode: op as Opcode, left, right, loc });
          break;
        }

        // --- Conversions (1 pop, 1 push) ---
        case Opcode.I32WrapI64:
        case Opcode.I32TruncF32S:
        case Opcode.I32TruncF32U:
        case Opcode.I32TruncF64S:
        case Opcode.I32TruncF64U:
        case Opcode.I64ExtendI32S:
        case Opcode.I64ExtendI32U:
        case Opcode.I64TruncF32S:
        case Opcode.I64TruncF32U:
        case Opcode.I64TruncF64S:
        case Opcode.I64TruncF64U:
        case Opcode.F32ConvertI32S:
        case Opcode.F32ConvertI32U:
        case Opcode.F32ConvertI64S:
        case Opcode.F32ConvertI64U:
        case Opcode.F32DemoteF64:
        case Opcode.F64ConvertI32S:
        case Opcode.F64ConvertI32U:
        case Opcode.F64ConvertI64S:
        case Opcode.F64ConvertI64U:
        case Opcode.F64PromoteF32:
        case Opcode.I32ReinterpretF32:
        case Opcode.I64ReinterpretF64:
        case Opcode.F32ReinterpretI32:
        case Opcode.F64ReinterpretI64: {
          const operand = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'convert', opcode: op as Opcode, operand, loc });
          break;
        }

        // --- Ref types ---
        case Opcode.RefNull: {
          // Heap-type immediate, decoded the same way as ref.test / ref.cast:
          // abstract codes come back as keyword name-vars, user-defined types
          // as index-vars. The earlier readValType() + varIndex() stashed the
          // raw byte (e.g. 0x70) in an INDEX var — round-tripping only by
          // accident, and printing as `ref.null 112` in wasm2wat output.
          stack.push(
            { kind: 'ref.null', refType: this.readHeapTypeVar(), loc } as RefNullExpr,
          );
          break;
        }
        case Opcode.RefIsNull: {
          const value = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'ref.is_null', value, loc });
          break;
        }
        case Opcode.RefFunc: {
          const funcIdx = this.readU32Leb();
          stack.push({ kind: 'ref.func', func: varIndex(funcIdx), loc } as RefFuncExpr);
          break;
        }
        case Opcode.RefEq: {
          const right = stack.pop() ?? operandPlaceholder(loc);
          const left = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'ref.eq', left, right, loc } as RefEqExpr);
          break;
        }
        case Opcode.RefAsNonNull: {
          const value = stack.pop() ?? operandPlaceholder(loc);
          stack.push({ kind: 'ref.as_non_null', value, loc });
          break;
        }
        case Opcode.BrOnNull:
        case Opcode.BrOnNonNull: {
          const depth = this.readU32Leb();
          const ref = stack.pop() ?? operandPlaceholder(loc);
          // The target may take `t*` below the ref. br_on_null's target takes
          // exactly those; br_on_non_null's takes them plus the (non-null)
          // ref, so one of its result slots is the ref itself.
          const want = brTargetResultCount(labelStack, depth, m) -
            (op === Opcode.BrOnNonNull ? 1 : 0);
          const values: Expr[] = [];
          for (let i = 0; i < want; i++) {
            const v = stack.pop();
            if (v === undefined) break;
            values.unshift(v);
          }
          const node: Expr = {
            kind: op === Opcode.BrOnNull ? 'br_on_null' : 'br_on_non_null',
            target: varIndex(depth),
            ref,
            values,
            loc,
          };
          // br_on_null falls through with the (now non-null) ref still on the
          // stack, so it goes on the operand stack where a following
          // instruction can consume it — `pushStmt` keeps that safe from the
          // reordering hazard (T9.1). br_on_non_null branches AWAY with the
          // ref and falls through with nothing, so it is a statement.
          if (op === Opcode.BrOnNull) stack.push(node);
          else pushStmt(stack, stmts, node);
          break;
        }

        // --- Exceptions ---
        case Opcode.Throw: {
          m.featuresUsed.exceptions = true;
          const tagIdx = this.readU32Leb();
          const sig = getTagSig(m, tagIdx);
          const args = popN(stack, sig.params.length);
          pushStmt(stack, stmts, { kind: 'throw', tag: varIndex(tagIdx), args, loc });
          break;
        }
        case Opcode.ThrowRef: {
          m.featuresUsed.exceptions = true;
          const exnref = stack.pop() ?? operandPlaceholder(loc);
          pushStmt(stack, stmts, { kind: 'throw_ref', exnref, loc });
          break;
        }
        case Opcode.Rethrow: {
          m.featuresUsed.exceptions = true;
          const depth = this.readU32Leb();
          pushStmt(stack, stmts, { kind: 'rethrow', depth: varIndex(depth), loc } as RethrowExpr);
          break;
        }

        // --- Prefix: misc (0xfc) ---
        case PREFIX_MISC: {
          const miscOp = this.readU32Leb();
          this.decodeMiscOp(miscOp, stack, stmts, m, loc);
          break;
        }

        // --- Prefix: SIMD (0xfd) ---
        case PREFIX_SIMD: {
          m.featuresUsed.simd = true;
          const simdOp = this.readU32Leb();
          this.decodeSimdOp(simdOp, stack, stmts, m, loc);
          break;
        }

        // --- Prefix: Threads/Atomics (0xfe) ---
        case PREFIX_THREADS: {
          m.featuresUsed.threads = true;
          const atomicOp = this.readU32Leb();
          this.decodeAtomicOp(atomicOp, stack, stmts, m, loc);
          break;
        }

        // --- Prefix: GC (0xfb) ---
        case PREFIX_GC: {
          const gcOp = this.readU32Leb();
          this.decodeGcOp(gcOp, stack, stmts, m, loc);
          break;
        }

        default:
          this.err(`unknown opcode: 0x${op.toString(16)}`);
          break;
      }
    }

    // Reaching here means the body ran out before its root frame closed --
    // the root `end` returns directly, above. A function body and a constant
    // expression are BOTH terminated by an explicit `end` opcode, and one
    // missing it used to decode as though it had had one.
    if (this.ok()) this.err(func === null ? 'unexpected end' : 'END opcode expected');
    return labelStack.length > 0 ? labelStack[0]!.flush() : [];
  }

  // ---------------------------------------------------------------------------
  // Misc (0xfc) opcode decoder
  // ---------------------------------------------------------------------------

  private decodeMiscOp(op: number, stack: Expr[], stmts: Expr[], _m: Module, loc: Location): void {
    switch (op) {
      // Saturating truncation (unary, 1 pop 1 push)
      case MiscOpcode.I32TruncSatF32S:
      case MiscOpcode.I32TruncSatF32U:
      case MiscOpcode.I32TruncSatF64S:
      case MiscOpcode.I32TruncSatF64U:
      case MiscOpcode.I64TruncSatF32S:
      case MiscOpcode.I64TruncSatF32U:
      case MiscOpcode.I64TruncSatF64S:
      case MiscOpcode.I64TruncSatF64U: {
        const opcode = (PREFIX_MISC << 16) | op;
        const operand = stack.pop() ?? operandPlaceholder(loc);
        stack.push({ kind: 'convert', opcode: opcode as Opcode, operand, loc });
        break;
      }
      case MiscOpcode.MemoryInit: {
        this.requireDataCount();
        const segIdx = this.readU32Leb();
        const memIdx = this.readU32Leb();
        const size = stack.pop() ?? operandPlaceholder(loc);
        const src = stack.pop() ?? operandPlaceholder(loc);
        const dest = stack.pop() ?? operandPlaceholder(loc);
        pushStmt(stack, stmts, {
          kind: 'memory.init',
          segment: varIndex(segIdx),
          memidx: varIndex(memIdx),
          dest,
          src,
          size,
          loc,
        });
        break;
      }
      case MiscOpcode.DataDrop: {
        this.requireDataCount();
        const segIdx = this.readU32Leb();
        pushStmt(
          stack,
          stmts,
          { kind: 'data.drop', segment: varIndex(segIdx), loc } as DataDropExpr,
        );
        break;
      }
      case MiscOpcode.MemoryCopy: {
        const destMemIdx = this.readU32Leb();
        const srcMemIdx = this.readU32Leb();
        const size = stack.pop() ?? operandPlaceholder(loc);
        const src = stack.pop() ?? operandPlaceholder(loc);
        const dest = stack.pop() ?? operandPlaceholder(loc);
        pushStmt(stack, stmts, {
          kind: 'memory.copy',
          destMemidx: varIndex(destMemIdx),
          srcMemidx: varIndex(srcMemIdx),
          dest,
          src,
          size,
          loc,
        });
        break;
      }
      case MiscOpcode.MemoryFill: {
        const memIdx = this.readU32Leb();
        const size = stack.pop() ?? operandPlaceholder(loc);
        const value = stack.pop() ?? operandPlaceholder(loc);
        const dest = stack.pop() ?? operandPlaceholder(loc);
        pushStmt(stack, stmts, {
          kind: 'memory.fill',
          memidx: varIndex(memIdx),
          dest,
          value,
          size,
          loc,
        });
        break;
      }
      case MiscOpcode.TableInit: {
        const segIdx = this.readU32Leb();
        const tableIdx = this.readU32Leb();
        const size = stack.pop() ?? operandPlaceholder(loc);
        const src = stack.pop() ?? operandPlaceholder(loc);
        const dest = stack.pop() ?? operandPlaceholder(loc);
        pushStmt(stack, stmts, {
          kind: 'table.init',
          segment: varIndex(segIdx),
          table: varIndex(tableIdx),
          dest,
          src,
          size,
          loc,
        });
        break;
      }
      case MiscOpcode.ElemDrop: {
        const segIdx = this.readU32Leb();
        pushStmt(
          stack,
          stmts,
          { kind: 'elem.drop', segment: varIndex(segIdx), loc } as ElemDropExpr,
        );
        break;
      }
      case MiscOpcode.TableCopy: {
        const dstIdx = this.readU32Leb();
        const srcIdx = this.readU32Leb();
        const size = stack.pop() ?? operandPlaceholder(loc);
        const srcOffset = stack.pop() ?? operandPlaceholder(loc);
        const dest = stack.pop() ?? operandPlaceholder(loc);
        pushStmt(stack, stmts, {
          kind: 'table.copy',
          dst: varIndex(dstIdx),
          src: varIndex(srcIdx),
          dest,
          srcOffset,
          size,
          loc,
        });
        break;
      }
      case MiscOpcode.TableGrow: {
        const tableIdx = this.readU32Leb();
        const delta = stack.pop() ?? operandPlaceholder(loc);
        const initValue = stack.pop() ?? operandPlaceholder(loc);
        stack.push({ kind: 'table.grow', table: varIndex(tableIdx), initValue, delta, loc });
        break;
      }
      case MiscOpcode.TableSize: {
        const tableIdx = this.readU32Leb();
        stack.push({ kind: 'table.size', table: varIndex(tableIdx), loc } as TableSizeExpr);
        break;
      }
      case MiscOpcode.TableFill: {
        const tableIdx = this.readU32Leb();
        const size = stack.pop() ?? operandPlaceholder(loc);
        const value = stack.pop() ?? operandPlaceholder(loc);
        const start = stack.pop() ?? operandPlaceholder(loc);
        pushStmt(stack, stmts, {
          kind: 'table.fill',
          table: varIndex(tableIdx),
          start,
          value,
          size,
          loc,
        });
        break;
      }
      case MiscOpcode.I64MulWideS:
      case MiscOpcode.I64MulWideU: {
        // Two operands, two results — lexed as `TokenType.Binary`, so the IR
        // node is a plain BinaryExpr like every other two-operand op.
        const right = stack.pop() ?? operandPlaceholder(loc);
        const left = stack.pop() ?? operandPlaceholder(loc);
        stack.push({
          kind: 'binary',
          opcode: ((PREFIX_MISC << 16) | op) as Opcode,
          left,
          right,
          loc,
        } as BinaryExpr);
        break;
      }
      case MiscOpcode.I64Add128:
      case MiscOpcode.I64Sub128: {
        // Four operands, in stack order. `wat2wasm` has always ACCEPTED and
        // encoded these (the lexer maps them to TokenType.Quaternary), so
        // without this case `wasm2wat` could not read back a module our own
        // front end had just written — the producer/consumer mismatch that
        // keeps costing us.
        const d = stack.pop() ?? operandPlaceholder(loc);
        const c = stack.pop() ?? operandPlaceholder(loc);
        const b = stack.pop() ?? operandPlaceholder(loc);
        const a = stack.pop() ?? operandPlaceholder(loc);
        stack.push({
          kind: 'quaternary',
          opcode: ((PREFIX_MISC << 16) | op) as Opcode,
          a,
          b,
          c,
          d,
          loc,
        } as QuaternaryExpr);
        break;
      }
      default:
        this.err(`unknown misc opcode: ${op}`);
    }
  }

  // ---------------------------------------------------------------------------
  // SIMD (0xfd) opcode decoder
  // ---------------------------------------------------------------------------

  private decodeSimdOp(op: number, stack: Expr[], stmts: Expr[], _m: Module, loc: Location): void {
    const opcode = (PREFIX_SIMD << 16) | op;

    // v128.load + extending loads (0x00-0x06): memarg, 1 pop (address),
    // 1 push (v128).
    if (op >= 0x00 && op <= 0x06) {
      const { align, offset, memidx } = this.readMemArg();
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({ kind: 'load', opcode: opcode as Opcode, align, offset, memidx, address, loc });
      return;
    }

    // v128.loadN_splat (0x07-0x0a): memarg, 1 pop (address), 1 push (v128).
    // These must decode to `load_splat`, not plain `load` — the writer /
    // validator / bridge switch on the IR kind, not the opcode.
    if (op >= 0x07 && op <= 0x0a) {
      const { align, offset, memidx } = this.readMemArg();
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({
        kind: 'load_splat',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        address,
        loc,
      });
      return;
    }

    // v128.store (0x0b): memarg, 2 pops (address, value), void. NOT a
    // load_zero (the zero-extending loads are 0x5c / 0x5d, handled below).
    if (op === 0x0b) {
      const { align, offset, memidx } = this.readMemArg();
      const value = stack.pop() ?? operandPlaceholder(loc);
      const address = stack.pop() ?? operandPlaceholder(loc);
      pushStmt(stack, stmts, {
        kind: 'store',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        address,
        value,
        loc,
      });
      return;
    }

    if (op === 0x0c) {
      // v128.const: 16 literal bytes
      const bytes = this.readBytes(16);
      stack.push({ kind: 'const', value: constV128(bytes), loc });
      return;
    }

    if (op === 0x0d) {
      // i8x16.shuffle: 16 lane indices, 2 pops, 1 push
      const lanes = this.readBytes(16);
      const right = stack.pop() ?? operandPlaceholder(loc);
      const left = stack.pop() ?? operandPlaceholder(loc);
      stack.push({ kind: 'simd_shuffle', opcode: opcode as Opcode, lanes, left, right, loc });
      return;
    }

    if (op === 0x0e) {
      // i8x16.swizzle: binary
      const right = stack.pop() ?? operandPlaceholder(loc);
      const left = stack.pop() ?? operandPlaceholder(loc);
      stack.push({ kind: 'binary', opcode: opcode as Opcode, left, right, loc });
      return;
    }

    // splat ops (0x0f-0x14): unary, 1 pop, 1 push
    if (op >= 0x0f && op <= 0x14) {
      const operand = stack.pop() ?? operandPlaceholder(loc);
      stack.push({ kind: 'unary', opcode: opcode as Opcode, operand, loc });
      return;
    }

    // Lane ops (0x15-0x22): extract_lane (vec → scalar) or
    // replace_lane (vec, scalar → vec). The replace family is the six
    // opcodes at the odd-ish positions in the run; extract is everything
    // else in the range.
    if (op >= 0x15 && op <= 0x22) {
      const lane = this.readU8();
      const isReplace = op === 0x17 || op === 0x1a || op === 0x1c || op === 0x1e ||
        op === 0x20 || op === 0x22;
      if (isReplace) {
        // Stack order: vec was pushed first, then scalar — pop scalar first.
        const value = stack.pop() ?? operandPlaceholder(loc);
        const vec = stack.pop() ?? operandPlaceholder(loc);
        stack.push({
          kind: 'simd_lane_op',
          opcode: opcode as Opcode,
          lane,
          operand: vec,
          value,
          loc,
        });
      } else {
        const operand = stack.pop() ?? operandPlaceholder(loc);
        stack.push({ kind: 'simd_lane_op', opcode: opcode as Opcode, lane, operand, loc });
      }
      return;
    }

    // load*_lane (0x54-0x57): memarg + lane, 2 pops (address, vec), 1 push.
    // NOTE: 0x58-0x5b are STORE*_lane (handled below), not load — the earlier
    // 0x54-0x5b range swallowed the stores and decoded them as loads.
    if (op >= 0x54 && op <= 0x57) {
      const { align, offset, memidx } = this.readMemArg();
      const lane = this.readU8();
      const vec = stack.pop() ?? operandPlaceholder(loc);
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({
        kind: 'simd_load_lane',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        lane,
        address,
        vec,
        loc,
      });
      return;
    }

    // v128.load32_zero (0x5c), v128.load64_zero (0x5d)
    if (op === 0x5c || op === 0x5d) {
      const { align, offset, memidx } = this.readMemArg();
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({
        kind: 'load_zero',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        address,
        loc,
      });
      return;
    }

    // store*_lane (0x58-0x5b): memarg + lane, 2 pops (address, vec), void.
    if (op >= 0x58 && op <= 0x5b) {
      const { align, offset, memidx } = this.readMemArg();
      const lane = this.readU8();
      const vec = stack.pop() ?? operandPlaceholder(loc);
      const address = stack.pop() ?? operandPlaceholder(loc);
      pushStmt(stack, stmts, {
        kind: 'simd_store_lane',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        lane,
        address,
        vec,
        loc,
      });
      return;
    }

    // Remaining SIMD arith / convert / compare / bitwise ops (no immediates).
    // These reach here as the 0x23-0x53 and 0x5e-0xff ranges; arity is NOT
    // uniformly binary, so dispatch by the actual operand count.
    // Ternary: v128.bitselect (0x52) plus the relaxed set — relaxed_madd /
    // nmadd (0x105-0x108), relaxed_laneselect (0x109-0x10c), and
    // relaxed_dot_i8x16_i7x16_add_s (0x113). Arities mirror the lexer's
    // TokenType.Ternary entries.
    if (op === 0x52 || (op >= 0x105 && op <= 0x10c) || op === 0x113) {
      // v128.bitselect: 3 pops (a, b, mask), 1 push.
      const c = stack.pop() ?? operandPlaceholder(loc);
      const b = stack.pop() ?? operandPlaceholder(loc);
      const a = stack.pop() ?? operandPlaceholder(loc);
      stack.push({ kind: 'ternary', opcode: opcode as Opcode, a, b, c, loc });
      return;
    }
    if (SIMD_UNARY_OPS.has(op)) {
      // 1 pop, 1 push (abs/neg/sqrt/ceil/.../convert/not/any_true/...).
      const operand = stack.pop() ?? operandPlaceholder(loc);
      stack.push({ kind: 'unary', opcode: opcode as Opcode, operand, loc });
      return;
    }
    // Default: binary (2 pops, 1 push) — add/sub/mul/div/min/max/pmin/pmax,
    // all compares, and/or/xor/andnot, narrow, shifts (vec + i32 count),
    // q15mulr, avgr, extmul, dot. (Relaxed-SIMD ops 0x100+ also land here as
    // binary; the genuinely-ternary relaxed madd/laneselect are not yet
    // distinguishable because the `(prefix<<8)|sub` opcode encoding collides
    // for sub-opcodes >= 0x100 — see opcode.ts. Tracked as a known limitation.)
    const right = stack.pop() ?? operandPlaceholder(loc);
    const left = stack.pop() ?? operandPlaceholder(loc);
    stack.push({ kind: 'binary', opcode: opcode as Opcode, left, right, loc });
  }

  // ---------------------------------------------------------------------------
  // Atomics (0xfe) opcode decoder
  // ---------------------------------------------------------------------------

  private decodeAtomicOp(
    op: number,
    stack: Expr[],
    stmts: Expr[],
    _m: Module,
    loc: Location,
  ): void {
    const opcode = (PREFIX_THREADS << 16) | op;

    if (op === 0x03) {
      // atomic.fence: consistency_model byte
      const consistencyModel = this.readU8();
      pushStmt(stack, stmts, { kind: 'atomic_fence', consistencyModel, loc } as AtomicFenceExpr);
      return;
    }

    if (op === 0x00) {
      // memory.atomic.notify: memarg, 2 pops (address, count), 1 push (notify count)
      const { align, offset, memidx } = this.readMemArg();
      const count = stack.pop() ?? operandPlaceholder(loc);
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({ kind: 'atomic_notify', align, offset, memidx, address, count, loc });
      return;
    }

    if (op === 0x01 || op === 0x02) {
      // memory.atomic.wait32/64: memarg, 3 pops (address, expected, timeout), 1 push
      const { align, offset, memidx } = this.readMemArg();
      const timeout = stack.pop() ?? operandPlaceholder(loc);
      const expected = stack.pop() ?? operandPlaceholder(loc);
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({
        kind: 'atomic_wait',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        address,
        expected,
        timeout,
        loc,
      });
      return;
    }

    // Atomic loads (0x10-0x16): memarg, 1 pop (address), 1 push
    if (op >= 0x10 && op <= 0x16) {
      const { align, offset, memidx } = this.readMemArg();
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({
        kind: 'atomic_load',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        address,
        loc,
      });
      return;
    }

    // Atomic stores (0x17-0x1d): memarg, 2 pops (address, value), void
    if (op >= 0x17 && op <= 0x1d) {
      const { align, offset, memidx } = this.readMemArg();
      const value = stack.pop() ?? operandPlaceholder(loc);
      const address = stack.pop() ?? operandPlaceholder(loc);
      pushStmt(stack, stmts, {
        kind: 'atomic_store',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        address,
        value,
        loc,
      });
      return;
    }

    // Atomic RMW (0x1e-0x47): memarg, 2 pops (address, value), 1 push (old value)
    if (op >= 0x1e && op <= 0x47) {
      const { align, offset, memidx } = this.readMemArg();
      const value = stack.pop() ?? operandPlaceholder(loc);
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({
        kind: 'atomic_rmw',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        address,
        value,
        loc,
      });
      return;
    }

    // Atomic cmpxchg (0x48-0x4e): memarg, 3 pops (address, expected, replacement), 1 push
    if (op >= 0x48 && op <= 0x4e) {
      const { align, offset, memidx } = this.readMemArg();
      const replacement = stack.pop() ?? operandPlaceholder(loc);
      const expected = stack.pop() ?? operandPlaceholder(loc);
      const address = stack.pop() ?? operandPlaceholder(loc);
      stack.push({
        kind: 'atomic_rmw_cmpxchg',
        opcode: opcode as Opcode,
        align,
        offset,
        memidx,
        address,
        expected,
        replacement,
        loc,
      });
      return;
    }

    this.err(`unknown atomic opcode: 0xfe 0x${op.toString(16)}`);
  }

  // ---------------------------------------------------------------------------
  // Main module reader
  // ---------------------------------------------------------------------------

  /**
   * Read a mutability byte, which is 0 or 1 and NOTHING else.
   *
   * Every site read it as `this.readU8() !== 0`, so 0x02, 0x04 and 0xff all
   * decoded as MUTABLE. That is a silent wrong value in a global's type, and
   * the spec calls all three malformed.
   */
  private readMutability(): boolean {
    const b = this.readU8();
    if (b > 1) this.err(`malformed mutability: 0x${b.toString(16)}`);
    return b === 1;
  }

  /**
   * `memory.init` and `data.drop` may only appear in a module that HAS a
   * data-count section.
   *
   * The code section is decoded before the data section, so without the count
   * up front there is no way to know a data index is in range at the point it
   * is used -- which is exactly why the proposal added the section. A module
   * with data segments but no data-count section still decoded fine here.
   */
  private requireDataCount(): void {
    if (this.dataCount === null) this.err('data count section required');
  }

  /** Count from the data-count section, or null when there is none. */
  private dataCount: number | null = null;

  readModule(): Module {
    const m = makeModule();
    m.filename = this.filename;

    // Magic + version.
    //
    // The magic is judged AS SOON AS IT IS READ, before the version. Reading
    // both first meant a 4-byte input — enough bytes to prove the magic wrong —
    // failed on the VERSION read and reported `unexpected end of binary`, a
    // length fault, for a module whose actual fault is its content. The spec
    // names the expected error for exactly these two fixtures: "magic header
    // not detected" (T13.37).
    //
    // The `data.length >=` guards keep the genuinely-short cases honest: with
    // fewer than 4 bytes there is nothing to compare, `readU32Le` has already
    // reported the truncation, and "unexpected end of binary" IS the right
    // diagnosis.
    const magic = this.readU32Le();
    if (this.data.length < 4) return m;
    if (magic !== WASM_MAGIC) {
      this.err(`magic header not detected: bad magic 0x${magic.toString(16)}`);
      return m;
    }
    const version = this.readU32Le();
    if (this.data.length < 8) return m;
    if (version !== WASM_VERSION) {
      this.err(`unknown binary version: ${version}`);
      return m;
    }

    // Section loop.
    //
    // A module lists each non-custom section AT MOST ONCE and in ONE fixed
    // order. Neither rule was checked: an unknown id fell into `default` and
    // was skipped, a repeated or misordered section was read as if it were the
    // first, and the trailing `this.pos = sectionEnd` resynchronised silently
    // whenever a section's contents disagreed with its declared size. So a
    // module with two code sections decoded to the SECOND one's bodies, and a
    // section whose size ran past its contents lost the difference without a
    // word (T12.8).
    let lastRank = -1;
    const seen = new Set<number>();
    // Anchor for custom sections: the last NON-custom section seen, or null
    // while we are still before the first one. See `Custom.precedingSection`.
    let lastKnownSection: BinarySection | null = null;
    while (this.pos < this.data.length && this.ok()) {
      const sectionStart = this.pos;
      const sectionId = this.readU8() as BinarySection;
      if (sectionId !== BinarySection.Custom && sectionOrderRank(sectionId) < 0) {
        this.err(`malformed section id: ${sectionId}`);
        return m;
      }
      const sectionSize = this.readU32Leb();
      const sectionEnd = this.pos + sectionSize;
      if (sectionEnd > this.data.length) {
        this.err('length out of bounds');
        return m;
      }
      if (sectionId !== BinarySection.Custom) {
        const rank = sectionOrderRank(sectionId);
        if (seen.has(sectionId)) {
          this.err(`unexpected content after last section: duplicate section ${sectionId}`);
          return m;
        }
        if (rank < lastRank) {
          this.err(`unexpected content after last section: section ${sectionId} out of order`);
          return m;
        }
        seen.add(sectionId);
        lastRank = rank;
        lastKnownSection = sectionId;
      }
      const sectionBodyStart = this.pos;

      // Track section metadata
      const meta: SectionMeta = {
        section: sectionId,
        offset: sectionBodyStart,
        size: sectionSize,
        count: 0,
      };

      switch (sectionId) {
        case BinarySection.Custom: {
          const nameStart = this.pos;
          const name = this.readName();
          // A custom section IS a name plus a payload, so a section too small
          // to hold its own name is malformed. An empty one decoded to a
          // custom section named "".
          if (this.pos > sectionEnd) {
            this.err('unexpected end');
            return m;
          }
          const dataStart = this.pos;
          const data = this.data.slice(dataStart, sectionEnd);
          if (name === 'name' && this.opts.readDebugNames) {
            this.readNameSection(m, this.data.slice(nameStart, sectionEnd));
          } else {
            m.customs.push({
              name,
              data,
              loc: this.loc(),
              precedingSection: lastKnownSection,
            });
          }
          this.pos = sectionEnd;
          break;
        }
        case BinarySection.Type:
          this.readTypeSection(m, sectionEnd);
          break;
        case BinarySection.Import:
          this.readImportSection(m, sectionEnd);
          break;
        case BinarySection.Function:
          this.readFunctionSection(m, sectionEnd);
          break;
        case BinarySection.Table:
          this.readTableSection(m, sectionEnd);
          break;
        case BinarySection.Memory:
          this.readMemorySection(m, sectionEnd);
          break;
        case BinarySection.Global:
          this.readGlobalSection(m, sectionEnd);
          break;
        case BinarySection.Export:
          this.readExportSection(m, sectionEnd);
          break;
        case BinarySection.Start:
          this.readStartSection(m, sectionEnd);
          break;
        case BinarySection.Elem:
          this.readElemSection(m, sectionEnd);
          break;
        case BinarySection.Code:
          this.readCodeSection(m, sectionEnd);
          break;
        case BinarySection.Data:
          this.readDataSection(m, sectionEnd);
          break;
        case BinarySection.DataCount:
          this.readDataCountSection(m, sectionEnd);
          break;
        case BinarySection.Tag:
          this.readTagSection(m, sectionEnd);
          break;
        default:
          this.pos = sectionEnd;
          break;
      }

      meta.size = this.pos - sectionBodyStart;
      m.sectionMeta.push(meta);
      void sectionStart;

      if (this.ok() && this.pos !== sectionEnd) {
        // Reading LESS than the section declared leaves bytes no producer
        // could have meant; reading MORE means the contents ran off the end of
        // their own section. The spec names the two separately.
        this.err(
          this.pos < sectionEnd ? 'section size mismatch' : 'unexpected end of section or function',
        );
        return m;
      }
      this.pos = sectionEnd;
    }

    if (this.ok() && this.dataCount !== null && this.dataCount !== m.dataSegments.length) {
      this.err('data count and data section have inconsistent lengths');
    }
    // A function section with no code section at all is the same mismatch the
    // code reader checks when both are present -- but that reader never runs,
    // so the module decoded to functions with empty bodies.
    if (this.ok() && m.funcs.length > 0 && !seen.has(BinarySection.Code)) {
      this.err('function and code section have inconsistent lengths');
    }

    return m;
  }

  // ---------------------------------------------------------------------------
  // GC (0xfb) opcode decoder
  // ---------------------------------------------------------------------------

  private decodeGcOp(op: number, stack: Expr[], stmts: Expr[], m: Module, loc: Location): void {
    m.featuresUsed.gc = true;
    const nop = (): NopExpr => operandPlaceholder(loc);
    switch (op) {
      case GcOpcode.RefI31: {
        const value = stack.pop() ?? nop();
        stack.push({ kind: 'ref.i31', value, loc } as RefI31Expr);
        return;
      }
      case GcOpcode.AnyConvertExtern:
      case GcOpcode.ExternConvertAny: {
        const value = stack.pop() ?? nop();
        stack.push({
          kind: op === GcOpcode.AnyConvertExtern ? 'any.convert_extern' : 'extern.convert_any',
          value,
          loc,
        });
        return;
      }
      case GcOpcode.I31GetS:
      case GcOpcode.I31GetU: {
        const i31 = stack.pop() ?? nop();
        stack.push({
          kind: 'i31.get',
          i31,
          signed: op === GcOpcode.I31GetS,
          loc,
        } as I31GetExpr);
        return;
      }
      case GcOpcode.StructNew: {
        const typeIdx = this.readU32Leb();
        const t = m.types[typeIdx];
        const fieldCount = t && t.kind === 'struct' ? t.fields.length : 0;
        const operands = popN(stack, fieldCount);
        stack.push({
          kind: 'struct.new',
          typeVar: varIndex(typeIdx),
          operands,
          loc,
        } as StructNewExpr);
        return;
      }
      case GcOpcode.StructNewDefault: {
        const typeIdx = this.readU32Leb();
        stack.push({
          kind: 'struct.new_default',
          typeVar: varIndex(typeIdx),
          loc,
        } as StructNewDefaultExpr);
        return;
      }
      case GcOpcode.StructGet:
      case GcOpcode.StructGetS:
      case GcOpcode.StructGetU: {
        const typeIdx = this.readU32Leb();
        const fieldIdx = this.readU32Leb();
        const ref = stack.pop() ?? nop();
        const signed = op === GcOpcode.StructGetS
          ? true
          : op === GcOpcode.StructGetU
          ? false
          : undefined;
        const node: StructGetExpr = {
          kind: 'struct.get',
          typeVar: varIndex(typeIdx),
          fieldVar: varIndex(fieldIdx),
          ref,
          loc,
        };
        if (signed !== undefined) (node as { signed?: boolean }).signed = signed;
        stack.push(node);
        return;
      }
      case GcOpcode.StructSet: {
        const typeIdx = this.readU32Leb();
        const fieldIdx = this.readU32Leb();
        const value = stack.pop() ?? nop();
        const ref = stack.pop() ?? nop();
        pushStmt(stack, stmts, {
          kind: 'struct.set',
          typeVar: varIndex(typeIdx),
          fieldVar: varIndex(fieldIdx),
          ref,
          value,
          loc,
        } as StructSetExpr);
        return;
      }
      case GcOpcode.ArrayNew: {
        const typeIdx = this.readU32Leb();
        const length = stack.pop() ?? nop();
        const init = stack.pop() ?? nop();
        stack.push({
          kind: 'array.new',
          typeVar: varIndex(typeIdx),
          init,
          length,
          loc,
        } as ArrayNewExpr);
        return;
      }
      case GcOpcode.ArrayNewDefault: {
        const typeIdx = this.readU32Leb();
        const length = stack.pop() ?? nop();
        stack.push({
          kind: 'array.new_default',
          typeVar: varIndex(typeIdx),
          length,
          loc,
        } as ArrayNewDefaultExpr);
        return;
      }
      case GcOpcode.ArrayNewFixed: {
        const typeIdx = this.readU32Leb();
        const n = this.readU32Leb();
        const operands = popN(stack, n);
        stack.push({
          kind: 'array.new_fixed',
          typeVar: varIndex(typeIdx),
          operands,
          loc,
        } as ArrayNewFixedExpr);
        return;
      }
      case GcOpcode.ArrayNewData: {
        const typeIdx = this.readU32Leb();
        const dataIdx = this.readU32Leb();
        const length = stack.pop() ?? nop();
        const offset = stack.pop() ?? nop();
        stack.push({
          kind: 'array.new_data',
          typeVar: varIndex(typeIdx),
          dataVar: varIndex(dataIdx),
          offset,
          length,
          loc,
        } as ArrayNewDataExpr);
        return;
      }
      case GcOpcode.ArrayNewElem: {
        const typeIdx = this.readU32Leb();
        const elemIdx = this.readU32Leb();
        const length = stack.pop() ?? nop();
        const offset = stack.pop() ?? nop();
        stack.push({
          kind: 'array.new_elem',
          typeVar: varIndex(typeIdx),
          elemVar: varIndex(elemIdx),
          offset,
          length,
          loc,
        } as ArrayNewElemExpr);
        return;
      }
      case GcOpcode.ArrayGet:
      case GcOpcode.ArrayGetS:
      case GcOpcode.ArrayGetU: {
        const typeIdx = this.readU32Leb();
        const index = stack.pop() ?? nop();
        const ref = stack.pop() ?? nop();
        const signed = op === GcOpcode.ArrayGetS
          ? true
          : op === GcOpcode.ArrayGetU
          ? false
          : undefined;
        const node: ArrayGetExpr = {
          kind: 'array.get',
          typeVar: varIndex(typeIdx),
          ref,
          index,
          loc,
        };
        if (signed !== undefined) (node as { signed?: boolean }).signed = signed;
        stack.push(node);
        return;
      }
      case GcOpcode.ArrayFill: {
        const typeIdx = this.readU32Leb();
        const size = stack.pop() ?? nop();
        const value = stack.pop() ?? nop();
        const offset = stack.pop() ?? nop();
        const ref = stack.pop() ?? nop();
        pushStmt(stack, stmts, {
          kind: 'array.fill',
          typeVar: varIndex(typeIdx),
          ref,
          offset,
          value,
          size,
          loc,
        });
        return;
      }
      case GcOpcode.ArrayCopy: {
        const destTypeIdx = this.readU32Leb();
        const srcTypeIdx = this.readU32Leb();
        const size = stack.pop() ?? nop();
        const srcOffset = stack.pop() ?? nop();
        const srcRef = stack.pop() ?? nop();
        const destOffset = stack.pop() ?? nop();
        const destRef = stack.pop() ?? nop();
        pushStmt(stack, stmts, {
          kind: 'array.copy',
          destTypeVar: varIndex(destTypeIdx),
          srcTypeVar: varIndex(srcTypeIdx),
          destRef,
          destOffset,
          srcRef,
          srcOffset,
          size,
          loc,
        });
        return;
      }
      case GcOpcode.ArrayInitData:
      case GcOpcode.ArrayInitElem: {
        const typeIdx = this.readU32Leb();
        const segIdx = this.readU32Leb();
        const size = stack.pop() ?? nop();
        const srcOffset = stack.pop() ?? nop();
        const destOffset = stack.pop() ?? nop();
        const ref = stack.pop() ?? nop();
        pushStmt(stack, stmts, {
          kind: op === GcOpcode.ArrayInitData ? 'array.init_data' : 'array.init_elem',
          typeVar: varIndex(typeIdx),
          segment: varIndex(segIdx),
          ref,
          destOffset,
          srcOffset,
          size,
          loc,
        });
        return;
      }
      case GcOpcode.ArraySet: {
        const typeIdx = this.readU32Leb();
        const value = stack.pop() ?? nop();
        const index = stack.pop() ?? nop();
        const ref = stack.pop() ?? nop();
        pushStmt(stack, stmts, {
          kind: 'array.set',
          typeVar: varIndex(typeIdx),
          ref,
          index,
          value,
          loc,
        } as ArraySetExpr);
        return;
      }
      case GcOpcode.ArrayLen: {
        // array.len has no type immediate — it works on any array ref.
        const ref = stack.pop() ?? nop();
        stack.push({ kind: 'array.len', ref, loc } as ArrayLenExpr);
        return;
      }
      case GcOpcode.RefTest:
      case GcOpcode.RefTestNullable: {
        const heapType = this.readHeapTypeVar();
        const ref = stack.pop() ?? nop();
        stack.push({
          kind: 'ref.test',
          heapType,
          nullable: op === GcOpcode.RefTestNullable,
          ref,
          loc,
        } as RefTestExpr);
        return;
      }
      case GcOpcode.BrOnCast:
      case GcOpcode.BrOnCastFail: {
        const flags = this.readU8();
        const depth = this.readU32Leb();
        const fromHeap = this.readHeapTypeVar();
        const toHeap = this.readHeapTypeVar();
        const value = stack.pop() ?? nop();
        // Onto the operand STACK, not straight to stmts: br_on_cast falls
        // through with its ref still there, and a following instruction in
        // the same block may consume it. Ordering is safe because `pushStmt`
        // drains pending values ahead of the next statement (T9.1) — before
        // that, a stack push here sank the branch past the rest of the block.
        stack.push({
          kind: 'br_on_cast',
          onFail: op === GcOpcode.BrOnCastFail,
          target: varIndex(depth),
          from: { heapType: fromHeap, nullable: (flags & 1) !== 0 },
          to: { heapType: toHeap, nullable: (flags & 2) !== 0 },
          value,
          loc,
        } as BrOnCastExpr);
        return;
      }
      case GcOpcode.RefCast:
      case GcOpcode.RefCastNullable: {
        const heapType = this.readHeapTypeVar();
        const ref = stack.pop() ?? nop();
        stack.push({
          kind: 'ref.cast',
          heapType,
          nullable: op === GcOpcode.RefCastNullable,
          ref,
          loc,
        } as RefCastExpr);
        return;
      }
      default:
        this.err(`unknown GC opcode: 0xfb 0x${op.toString(16)}`);
        return;
    }
  }
}

/**
 * Map a single-byte abstract-heap-type code (as encoded by the GC proposal)
 * to its bare WAT keyword. Returns null for codes that aren't abstract heap
 * types. Thin alias over the canonical table in `core/types.ts` — the `Type`
 * enum values ARE the heap-type byte encodings.
 */
function abstractHeapTypeNameForByte(b: number): string | null {
  return typeToHeapTypeName(b as Type);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Decode a wasm binary into a {@link Module} IR. Errors accumulate in
 * the caller-supplied {@link ErrorList} rather than throwing.
 */
export function readBinaryIr(
  data: Uint8Array,
  errors: ErrorList,
  opts: ReadBinaryOptions = {},
): Module {
  const reader = new BinaryReader(data, errors, opts);
  try {
    return reader.readModule();
  } catch (e) {
    // Backstop. The LEB helpers convert their own RangeErrors, but this is a
    // decoder for UNTRUSTED bytes behind four published entrypoints whose
    // contract is `{ errors, result }` — one unconverted throw anywhere in
    // 3000 lines becomes a crash in a caller that was checking `result`
    // correctly. Report and return an empty module rather than propagate
    // (T13.29).
    addError(
      errors,
      unknownLocation(),
      `internal decode error: ${e instanceof Error ? e.message : String(e)}`,
    );
    return makeModule();
  }
}
