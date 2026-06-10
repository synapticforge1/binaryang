// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/binary-reader.h, src/binary-reader.cc,
//                  include/wabt/binary-reader-ir.h, src/binary-reader-ir.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import type { Location } from '../core/error.ts';
import { addError, type ErrorList } from '../core/error.ts';
import { Type } from '../core/types.ts';
import { BinarySection, ExternalKind, WASM_MAGIC, WASM_VERSION } from '../core/binary.ts';
import {
  GcOpcode,
  MiscOpcode,
  Opcode,
  PREFIX_GC,
  PREFIX_MISC,
  PREFIX_SIMD,
  PREFIX_THREADS,
} from '../core/opcode.ts';
import { decodeS32Leb128, decodeS64Leb128, decodeU32Leb128 } from '../core/leb128.ts';

// UTF-8 decoder reused across every name read. TextDecoder is stateless when
// called via .decode(); a single module-level instance avoids reallocating
// per call in the hot path.
const TEXT_DECODER = new TextDecoder();
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
  BLOCK_TYPE_VOID,
  type BlockType,
  blockTypeFuncType,
  blockTypeValue,
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
  type TypeEntry,
  type UnreachableExpr,
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
        ({ kind: 'nop', loc: { filename: '', line: 0, column: 0, offset: 0 } } as NopExpr),
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

  private readU32Leb(): number {
    const [v, n] = decodeU32Leb128(this.data, this.pos);
    this.pos += n;
    return v;
  }

  private readS32Leb(): number {
    const [v, n] = decodeS32Leb128(this.data, this.pos);
    this.pos += n;
    return v;
  }

  private readS64Leb(): bigint {
    const [v, n] = decodeS64Leb128(this.data, this.pos);
    this.pos += n;
    return v;
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
    return TEXT_DECODER.decode(bytes);
  }

  // ---------------------------------------------------------------------------
  // Type helpers
  // ---------------------------------------------------------------------------

  private readValType(): Type {
    const b = this.readU8();
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
      if (b >= 0x40) return blockTypeValue(b as Type);
      return blockTypeFuncType(b);
    }
    // Multi-byte: read as s33 for type index
    const [v, n] = decodeS32Leb128(this.data, this.pos);
    this.pos += n;
    if (v < 0) return blockTypeValue((-v & 0x7f) as Type);
    return blockTypeFuncType(v);
  }

  private readLimits(): Limits {
    const flags = this.readU8();
    const hasMax = (flags & 0x01) !== 0;
    const isShared = (flags & 0x02) !== 0;
    const is64 = (flags & 0x04) !== 0;
    const hasCustomPageSize = (flags & 0x08) !== 0;
    const initial = this.readU32Leb();
    const max = hasMax ? this.readU32Leb() : undefined;
    const limits: Limits = { initial, isShared, is64 };
    if (max !== undefined) limits.max = max;
    if (hasCustomPageSize) limits.pageSize = this.readU32Leb();
    return limits;
  }

  private readMemArg(): { align: number; offset: bigint; memidx: Var } {
    const alignFlags = this.readU32Leb();
    const hasMemIdx = (alignFlags & 0x40) !== 0;
    const alignLog2 = alignFlags & 0x3f;
    const align = 1 << alignLog2;
    const memidx = hasMemIdx ? this.readU32Leb() : 0;
    const offset = BigInt(this.readU32Leb());
    return { align, offset, memidx: varIndex(memidx) };
  }

  private readRefType(): Type {
    return this.readU8() as Type;
  }

  // ---------------------------------------------------------------------------
  // Section readers
  // ---------------------------------------------------------------------------

  private readTypeSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
      const loc = this.loc();
      const marker = this.readU8();
      if (marker === 0x60) {
        // func type
        const paramCount = this.readU32Leb();
        const params: Type[] = [];
        for (let j = 0; j < paramCount; j++) params.push(this.readValType());
        const resultCount = this.readU32Leb();
        const results: Type[] = [];
        for (let j = 0; j < resultCount; j++) results.push(this.readValType());
        const entry: TypeEntry = { kind: 'func', name: '', sig: { params, results }, loc };
        m.types.push(entry);
      } else if (marker === 0x5f) {
        // struct type (GC)
        const fieldCount = this.readU32Leb();
        const fields: Field[] = [];
        for (let j = 0; j < fieldCount; j++) {
          const type = this.readValType();
          const mutable = this.readU8() !== 0;
          fields.push({ name: '', type, mutable });
        }
        m.types.push({ kind: 'struct', name: '', fields, loc });
      } else if (marker === 0x5e) {
        // array type (GC)
        const type = this.readValType();
        const mutable = this.readU8() !== 0;
        m.types.push({ kind: 'array', name: '', field: { name: '', type, mutable }, loc });
      } else {
        this.err(`unknown type section entry marker: 0x${marker.toString(16)}`);
      }
    }
  }

  private readImportSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
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
          const limits = this.readLimits();
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
          const mutable = this.readU8() !== 0;
          const global: Global = { name: '', loc, type, mutable, init: [] };
          m.imports.push({ kind: ExternalKind.Global, module: module_, field, global });
          m.numGlobalImports++;
          break;
        }
        case ExternalKind.Tag: {
          this.readU8(); // attribute byte (always 0 = exception) — must be
          // consumed before the type index, exactly like readTagSection. The
          // earlier code read the type index starting at the attribute byte,
          // so every imported tag resolved to type 0 and the following bytes
          // were misaligned for any subsequent import.
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
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
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
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
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
        this.readU8(); // reserved 0x00
        const elemType = this.readRefType();
        const limits = this.readLimits();
        const init = this.readInitExpr(m);
        m.tables.push({ name: '', loc, elemType, limits, init });
      } else {
        const elemType = this.readRefType();
        const limits = this.readLimits();
        m.tables.push({ name: '', loc, elemType, limits, init: [] });
      }
    }
  }

  private readMemorySection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
      const loc = this.loc();
      const limits = this.readLimits();
      if (limits.isShared) m.featuresUsed.threads = true;
      m.memories.push({ name: '', loc, limits });
    }
  }

  private readGlobalSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
      const loc = this.loc();
      const type = this.readValType();
      const mutable = this.readU8() !== 0;
      const init = this.readInitExpr(m);
      m.globals.push({ name: '', loc, type, mutable, init });
    }
  }

  private readExportSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
      const name = this.readName();
      const kind = this.readU8() as ExternalKind;
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
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
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

      let elemType: Type = Type.FuncRef;
      if (isPassive || hasExplicitIndex) {
        if (usesExprs) {
          elemType = this.readValType();
        } else {
          this.readU8(); // skip element kind byte (0x00 = funcref)
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
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
      const loc = this.loc();
      this.readU8(); // attribute byte (always 0)
      const sigIdx = this.readU32Leb();
      const sig = getTypeSig(m, sigIdx);
      m.tags.push({ name: '', loc, sig });
      m.featuresUsed.exceptions = true;
    }
  }

  private readDataCountSection(_m: Module, _end: number): void {
    this.readU32Leb(); // data count (used for validation, we don't store it)
  }

  private readDataSection(m: Module, end: number): void {
    const count = this.readU32Leb();
    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
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

    for (let i = 0; i < count && this.pos < end && this.ok(); i++) {
      const bodySize = this.readU32Leb();
      const bodyEnd = this.pos + bodySize;

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

      // Local declarations
      const localDeclCount = this.readU32Leb();
      for (let j = 0; j < localDeclCount; j++) {
        const declCount = this.readU32Leb();
        const type = this.readValType();
        func.localDecls.push({ type, count: declCount });
      }

      func.body = this.decodeBody(bodyEnd, m, func);
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
          stmts.push({ kind: 'unreachable', loc } as UnreachableExpr);
          break;
        }
        case Opcode.Nop: {
          stmts.push({ kind: 'nop', loc } as NopExpr);
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
          const cond = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
          else parent.stmts.push(tryExpr);
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
                cond: frame.cond ?? ({ kind: 'nop', loc } as NopExpr),
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
                cond: frame.cond ?? ({ kind: 'nop', loc } as NopExpr),
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
            const rCount = frame.kind === 'loop' ? 0 : blockResultCount(frame.blockType, m);
            if (rCount > 0) parent.stack.push(node);
            else parent.stmts.push(node);
          }
          break;
        }

        // --- Branches ---
        case Opcode.Br: {
          const depth = this.readU32Leb();
          const rCount = brTargetResultCount(labelStack, depth, m);
          const value = rCount > 0 ? stack.pop() : undefined;
          const brExpr: Expr = value
            ? { kind: 'br', target: varIndex(depth), value, loc }
            : { kind: 'br', target: varIndex(depth), loc };
          stmts.push(brExpr);
          break;
        }
        case Opcode.BrIf: {
          const depth = this.readU32Leb();
          const rCount = brTargetResultCount(labelStack, depth, m);
          const cond_ = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const value = rCount > 0 ? stack.pop() : undefined;
          const brIfExpr: Expr = value
            ? { kind: 'br_if', target: varIndex(depth), cond: cond_, value, loc }
            : { kind: 'br_if', target: varIndex(depth), cond: cond_, loc };
          stmts.push(brIfExpr);
          break;
        }
        case Opcode.BrTable: {
          const numTargets = this.readU32Leb();
          const targets: Var[] = [];
          for (let i = 0; i < numTargets; i++) targets.push(varIndex(this.readU32Leb()));
          const defaultTarget = varIndex(this.readU32Leb());
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({ kind: 'br_table', targets, defaultTarget, value, loc });
          break;
        }
        case Opcode.Return: {
          const values = funcResultCount > 0 ? popN(stack, funcResultCount) : [];
          stmts.push({ kind: 'return', values, loc });
          break;
        }

        // --- Calls ---
        case Opcode.Call: {
          const funcIdx = this.readU32Leb();
          const sig = getFuncSig(m, funcIdx);
          const args = popN(stack, sig.params.length);
          const callExpr: Expr = { kind: 'call', func: varIndex(funcIdx), args, loc };
          if (sig.results.length > 0) stack.push(callExpr);
          else stmts.push(callExpr);
          break;
        }
        case Opcode.CallIndirect: {
          const typeIdx = this.readU32Leb();
          const tableIdx = this.readU32Leb();
          const sig = getTypeSig(m, typeIdx);
          const callee = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const args = popN(stack, sig.params.length);
          const entry = m.types[typeIdx];
          const sigType: { params: Type[]; results: Type[] } = entry && entry.kind === 'func'
            ? entry.sig
            : { params: [], results: [] };
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
          else stmts.push(ciExpr);
          break;
        }
        case Opcode.CallRef: {
          const typeIdx = this.readU32Leb();
          const sig = getTypeSig(m, typeIdx);
          const callee = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const args = popN(stack, sig.params.length);
          const crExpr: Expr = { kind: 'call_ref', sigType: varIndex(typeIdx), args, callee, loc };
          if (sig.results.length > 0) stack.push(crExpr);
          else stmts.push(crExpr);
          break;
        }
        case Opcode.ReturnCall: {
          m.featuresUsed.tailcall = true;
          const funcIdx = this.readU32Leb();
          const sig = getFuncSig(m, funcIdx);
          const args = popN(stack, sig.params.length);
          stmts.push({ kind: 'return_call', func: varIndex(funcIdx), args, loc });
          break;
        }
        case Opcode.ReturnCallIndirect: {
          m.featuresUsed.tailcall = true;
          const typeIdx = this.readU32Leb();
          const tableIdx = this.readU32Leb();
          const sig = getTypeSig(m, typeIdx);
          const callee = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const args = popN(stack, sig.params.length);
          const entry = m.types[typeIdx];
          const sigType: { params: Type[]; results: Type[] } = entry && entry.kind === 'func'
            ? entry.sig
            : { params: [], results: [] };
          stmts.push({
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
          const callee = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const args = popN(stack, sig.params.length);
          stmts.push({ kind: 'return_call_ref', sigType: varIndex(typeIdx), args, callee, loc });
          break;
        }

        // --- Drop / Select ---
        case Opcode.Drop: {
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({ kind: 'drop', value, loc });
          break;
        }
        case Opcode.Select: {
          const cond_ = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const val2 = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const val1 = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stack.push({ kind: 'select', val1, val2, cond: cond_, resultType: [], loc });
          break;
        }
        case Opcode.SelectT: {
          const numTypes = this.readU32Leb();
          const resultType: Type[] = [];
          for (let i = 0; i < numTypes; i++) resultType.push(this.readValType());
          const cond_ = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const val2 = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const val1 = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({ kind: 'local.set', var: varIndex(idx), value, loc });
          break;
        }
        case Opcode.LocalTee: {
          const idx = this.readU32Leb();
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({ kind: 'global.set', var: varIndex(idx), value, loc });
          break;
        }

        // --- Tables ---
        case Opcode.TableGet: {
          const idx = this.readU32Leb();
          const index = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stack.push({ kind: 'table.get', table: varIndex(idx), index, loc });
          break;
        }
        case Opcode.TableSet: {
          const idx = this.readU32Leb();
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const index = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({ kind: 'table.set', table: varIndex(idx), index, value, loc });
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
          const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({
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
          const delta = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
          const right = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const left = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
          const operand = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
          const right = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const left = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
          const operand = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stack.push({ kind: 'convert', opcode: op as Opcode, operand, loc });
          break;
        }

        // --- Ref types ---
        case Opcode.RefNull: {
          const refType = this.readValType();
          stack.push(
            { kind: 'ref.null', refType: varIndex(refType as number), loc } as RefNullExpr,
          );
          break;
        }
        case Opcode.RefIsNull: {
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stack.push({ kind: 'ref.is_null', value, loc });
          break;
        }
        case Opcode.RefFunc: {
          const funcIdx = this.readU32Leb();
          stack.push({ kind: 'ref.func', func: varIndex(funcIdx), loc } as RefFuncExpr);
          break;
        }
        case Opcode.RefEq: {
          const right = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          const left = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stack.push({ kind: 'ref.eq', left, right, loc } as RefEqExpr);
          break;
        }
        case Opcode.RefAsNonNull: {
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stack.push({ kind: 'ref.as_non_null', value, loc });
          break;
        }
        case Opcode.BrOnNull: {
          const depth = this.readU32Leb();
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({ kind: 'br_on_null', target: varIndex(depth), value, loc });
          break;
        }
        case Opcode.BrOnNonNull: {
          const depth = this.readU32Leb();
          const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({ kind: 'br_on_non_null', target: varIndex(depth), value, loc });
          break;
        }

        // --- Exceptions ---
        case Opcode.Throw: {
          m.featuresUsed.exceptions = true;
          const tagIdx = this.readU32Leb();
          const sig = getTagSig(m, tagIdx);
          const args = popN(stack, sig.params.length);
          stmts.push({ kind: 'throw', tag: varIndex(tagIdx), args, loc });
          break;
        }
        case Opcode.ThrowRef: {
          m.featuresUsed.exceptions = true;
          const exnref = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
          stmts.push({ kind: 'throw_ref', exnref, loc });
          break;
        }
        case Opcode.Rethrow: {
          m.featuresUsed.exceptions = true;
          const depth = this.readU32Leb();
          stmts.push({ kind: 'rethrow', depth: varIndex(depth), loc } as RethrowExpr);
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
        const opcode = (PREFIX_MISC << 8) | op;
        const operand = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        stack.push({ kind: 'convert', opcode: opcode as Opcode, operand, loc });
        break;
      }
      case MiscOpcode.MemoryInit: {
        const segIdx = this.readU32Leb();
        const memIdx = this.readU32Leb();
        const size = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const src = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const dest = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        stmts.push({
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
        const segIdx = this.readU32Leb();
        stmts.push({ kind: 'data.drop', segment: varIndex(segIdx), loc } as DataDropExpr);
        break;
      }
      case MiscOpcode.MemoryCopy: {
        const destMemIdx = this.readU32Leb();
        const srcMemIdx = this.readU32Leb();
        const size = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const src = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const dest = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        stmts.push({
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
        const size = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const dest = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        stmts.push({ kind: 'memory.fill', memidx: varIndex(memIdx), dest, value, size, loc });
        break;
      }
      case MiscOpcode.TableInit: {
        const segIdx = this.readU32Leb();
        const tableIdx = this.readU32Leb();
        const size = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const src = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const dest = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        stmts.push({
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
        stmts.push({ kind: 'elem.drop', segment: varIndex(segIdx), loc } as ElemDropExpr);
        break;
      }
      case MiscOpcode.TableCopy: {
        const dstIdx = this.readU32Leb();
        const srcIdx = this.readU32Leb();
        const size = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const srcOffset = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const dest = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        stmts.push({
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
        const delta = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const initValue = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
        const size = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const start = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        stmts.push({ kind: 'table.fill', table: varIndex(tableIdx), start, value, size, loc });
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
    const opcode = (PREFIX_SIMD << 8) | op;

    // v128.load + extending loads (0x00-0x06): memarg, 1 pop (address),
    // 1 push (v128).
    if (op >= 0x00 && op <= 0x06) {
      const { align, offset, memidx } = this.readMemArg();
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stack.push({ kind: 'load', opcode: opcode as Opcode, align, offset, memidx, address, loc });
      return;
    }

    // v128.loadN_splat (0x07-0x0a): memarg, 1 pop (address), 1 push (v128).
    // These must decode to `load_splat`, not plain `load` — the writer /
    // validator / bridge switch on the IR kind, not the opcode.
    if (op >= 0x07 && op <= 0x0a) {
      const { align, offset, memidx } = this.readMemArg();
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
      const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stmts.push({
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
      const right = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const left = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stack.push({ kind: 'simd_shuffle', opcode: opcode as Opcode, lanes, left, right, loc });
      return;
    }

    if (op === 0x0e) {
      // i8x16.swizzle: binary
      const right = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const left = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stack.push({ kind: 'binary', opcode: opcode as Opcode, left, right, loc });
      return;
    }

    // splat ops (0x0f-0x14): unary, 1 pop, 1 push
    if (op >= 0x0f && op <= 0x14) {
      const operand = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
        const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        const vec = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
        stack.push({
          kind: 'simd_lane_op',
          opcode: opcode as Opcode,
          lane,
          operand: vec,
          value,
          loc,
        });
      } else {
        const operand = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
      const vec = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
      const vec = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stmts.push({
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
    if (op === 0x52) {
      // v128.bitselect: 3 pops (a, b, mask), 1 push.
      const c = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const b = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const a = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stack.push({ kind: 'ternary', opcode: opcode as Opcode, a, b, c, loc });
      return;
    }
    if (SIMD_UNARY_OPS.has(op)) {
      // 1 pop, 1 push (abs/neg/sqrt/ceil/.../convert/not/any_true/...).
      const operand = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stack.push({ kind: 'unary', opcode: opcode as Opcode, operand, loc });
      return;
    }
    // Default: binary (2 pops, 1 push) — add/sub/mul/div/min/max/pmin/pmax,
    // all compares, and/or/xor/andnot, narrow, shifts (vec + i32 count),
    // q15mulr, avgr, extmul, dot. (Relaxed-SIMD ops 0x100+ also land here as
    // binary; the genuinely-ternary relaxed madd/laneselect are not yet
    // distinguishable because the `(prefix<<8)|sub` opcode encoding collides
    // for sub-opcodes >= 0x100 — see opcode.ts. Tracked as a known limitation.)
    const right = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
    const left = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
    const opcode = (PREFIX_THREADS << 8) | op;

    if (op === 0x03) {
      // atomic.fence: consistency_model byte
      const consistencyModel = this.readU8();
      stmts.push({ kind: 'atomic_fence', consistencyModel, loc } as AtomicFenceExpr);
      return;
    }

    if (op === 0x00) {
      // memory.atomic.notify: memarg, 2 pops (address, count), 1 push (notify count)
      const { align, offset, memidx } = this.readMemArg();
      const count = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stack.push({ kind: 'atomic_notify', align, offset, memidx, address, count, loc });
      return;
    }

    if (op === 0x01 || op === 0x02) {
      // memory.atomic.wait32/64: memarg, 3 pops (address, expected, timeout), 1 push
      const { align, offset, memidx } = this.readMemArg();
      const timeout = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const expected = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
      const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      stmts.push({
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
      const value = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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
      const replacement = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const expected = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
      const address = stack.pop() ?? ({ kind: 'nop', loc } as NopExpr);
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

  readModule(): Module {
    const m = makeModule();
    m.filename = this.filename;

    // Magic + version
    const magic = this.readU32Le();
    const version = this.readU32Le();
    if (magic !== WASM_MAGIC) {
      this.err(`bad magic: 0x${magic.toString(16)}`);
      return m;
    }
    if (version !== WASM_VERSION) {
      this.err(`bad version: ${version}`);
      return m;
    }

    // Section loop
    while (this.pos < this.data.length && this.ok()) {
      const sectionStart = this.pos;
      const sectionId = this.readU8() as BinarySection;
      const sectionSize = this.readU32Leb();
      const sectionEnd = this.pos + sectionSize;
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
          const dataStart = this.pos;
          const data = this.data.slice(dataStart, sectionEnd);
          if (name === 'name' && this.opts.readDebugNames) {
            this.readNameSection(m, this.data.slice(nameStart, sectionEnd));
          } else {
            m.customs.push({ name, data, loc: this.loc() });
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

      if (this.pos !== sectionEnd) this.pos = sectionEnd;
    }

    return m;
  }

  // ---------------------------------------------------------------------------
  // GC (0xfb) opcode decoder
  // ---------------------------------------------------------------------------

  private decodeGcOp(op: number, stack: Expr[], stmts: Expr[], m: Module, loc: Location): void {
    m.featuresUsed.gc = true;
    const nop = (): NopExpr => ({ kind: 'nop', loc });
    switch (op) {
      case GcOpcode.RefI31: {
        const value = stack.pop() ?? nop();
        stack.push({ kind: 'ref.i31', value, loc } as RefI31Expr);
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
        stmts.push({
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
      case GcOpcode.ArraySet: {
        const typeIdx = this.readU32Leb();
        const value = stack.pop() ?? nop();
        const index = stack.pop() ?? nop();
        const ref = stack.pop() ?? nop();
        stmts.push({
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
 * to the bare keyword name used in `(ref [null] NAME)` syntax. Returns null
 * for codes that aren't recognized abstract heap types.
 */
function abstractHeapTypeNameForByte(b: number): string | null {
  switch (b) {
    case Type.AnyRef:
      return 'any';
    case Type.EqRef:
      return 'eq';
    case Type.I31Ref:
      return 'i31';
    case Type.StructRef:
      return 'struct';
    case Type.ArrayRef:
      return 'array';
    case Type.FuncRef:
      return 'func';
    case Type.ExternRef:
      return 'extern';
    case Type.NullRef:
      return 'none';
    case Type.NullFuncRef:
      return 'nofunc';
    case Type.NullExternRef:
      return 'noextern';
    default:
      return null;
  }
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
  return reader.readModule();
}
