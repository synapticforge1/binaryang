// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/opcode.h, include/wabt/opcode.def
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * WebAssembly opcode definitions.
 *
 * Core opcodes are encoded as a single byte (0x00–0xbf). Extended opcode
 * groups use a one-byte prefix followed by a LEB128 index:
 * - `0xfc` — numeric/misc extensions (sat, memory operations)
 * - `0xfd` — SIMD (128-bit vector) instructions
 * - `0xfe` — threads and atomics
 */

import { OPCODE_DEFINITIONS } from '../../definitions/data.ts';

// ---------------------------------------------------------------------------
// Prefix bytes for multi-byte opcode groups
// ---------------------------------------------------------------------------

/** Prefix for miscellaneous numeric extension opcodes (0xfc group). */
export const PREFIX_MISC = 0xfc;

/** Prefix for SIMD opcodes (0xfd group). */
export const PREFIX_SIMD = 0xfd;

/** Prefix for threading/atomics opcodes (0xfe group). */
export const PREFIX_THREADS = 0xfe;

/** Prefix for GC opcodes (0xfb group — struct.*, array.*, ref.i31, i31.get_*, ref.test/cast). */
export const PREFIX_GC = 0xfb;

// ---------------------------------------------------------------------------
// Core opcodes (single-byte, 0x00–0xbf)
//
// Names match the WebAssembly spec and the WAT text format. Values are the
// raw byte in the binary encoding.
//
// Extended opcode groups (SIMD, threads, GC, etc.) are in separate enums
// below — each value is the LEB128 immediate that follows the prefix byte.
// ---------------------------------------------------------------------------

/** Core WebAssembly opcodes (no prefix). */
export enum Opcode {
  Unreachable = 0x00,
  Nop = 0x01,
  Block = 0x02,
  Loop = 0x03,
  If = 0x04,
  Else = 0x05,
  Try = 0x06,
  Catch = 0x07,
  Throw = 0x08,
  Rethrow = 0x09,
  ThrowRef = 0x0a,
  End = 0x0b,
  Br = 0x0c,
  BrIf = 0x0d,
  BrTable = 0x0e,
  Return = 0x0f,
  Call = 0x10,
  CallIndirect = 0x11,
  ReturnCall = 0x12,
  ReturnCallIndirect = 0x13,
  CallRef = 0x14,
  ReturnCallRef = 0x15,
  Delegate = 0x18,
  CatchAll = 0x19,
  Drop = 0x1a,
  Select = 0x1b,
  SelectT = 0x1c,
  TryTable = 0x1f,
  LocalGet = 0x20,
  LocalSet = 0x21,
  LocalTee = 0x22,
  GlobalGet = 0x23,
  GlobalSet = 0x24,
  TableGet = 0x25,
  TableSet = 0x26,
  // Memory load instructions (0x28–0x3e)
  I32Load = 0x28,
  I64Load = 0x29,
  F32Load = 0x2a,
  F64Load = 0x2b,
  I32Load8S = 0x2c,
  I32Load8U = 0x2d,
  I32Load16S = 0x2e,
  I32Load16U = 0x2f,
  I64Load8S = 0x30,
  I64Load8U = 0x31,
  I64Load16S = 0x32,
  I64Load16U = 0x33,
  I64Load32S = 0x34,
  I64Load32U = 0x35,
  I32Store = 0x36,
  I64Store = 0x37,
  F32Store = 0x38,
  F64Store = 0x39,
  I32Store8 = 0x3a,
  I32Store16 = 0x3b,
  I64Store8 = 0x3c,
  I64Store16 = 0x3d,
  I64Store32 = 0x3e,
  MemorySize = 0x3f,
  MemoryGrow = 0x40,
  // Constant instructions
  I32Const = 0x41,
  I64Const = 0x42,
  F32Const = 0x43,
  F64Const = 0x44,
  // i32 comparison
  I32Eqz = 0x45,
  I32Eq = 0x46,
  I32Ne = 0x47,
  I32LtS = 0x48,
  I32LtU = 0x49,
  I32GtS = 0x4a,
  I32GtU = 0x4b,
  I32LeS = 0x4c,
  I32LeU = 0x4d,
  I32GeS = 0x4e,
  I32GeU = 0x4f,
  // i64 comparison
  I64Eqz = 0x50,
  I64Eq = 0x51,
  I64Ne = 0x52,
  I64LtS = 0x53,
  I64LtU = 0x54,
  I64GtS = 0x55,
  I64GtU = 0x56,
  I64LeS = 0x57,
  I64LeU = 0x58,
  I64GeS = 0x59,
  I64GeU = 0x5a,
  // f32 comparison
  F32Eq = 0x5b,
  F32Ne = 0x5c,
  F32Lt = 0x5d,
  F32Gt = 0x5e,
  F32Le = 0x5f,
  F32Ge = 0x60,
  // f64 comparison
  F64Eq = 0x61,
  F64Ne = 0x62,
  F64Lt = 0x63,
  F64Gt = 0x64,
  F64Le = 0x65,
  F64Ge = 0x66,
  // i32 arithmetic
  I32Clz = 0x67,
  I32Ctz = 0x68,
  I32Popcnt = 0x69,
  I32Add = 0x6a,
  I32Sub = 0x6b,
  I32Mul = 0x6c,
  I32DivS = 0x6d,
  I32DivU = 0x6e,
  I32RemS = 0x6f,
  I32RemU = 0x70,
  I32And = 0x71,
  I32Or = 0x72,
  I32Xor = 0x73,
  I32Shl = 0x74,
  I32ShrS = 0x75,
  I32ShrU = 0x76,
  I32Rotl = 0x77,
  I32Rotr = 0x78,
  // i64 arithmetic
  I64Clz = 0x79,
  I64Ctz = 0x7a,
  I64Popcnt = 0x7b,
  I64Add = 0x7c,
  I64Sub = 0x7d,
  I64Mul = 0x7e,
  I64DivS = 0x7f,
  I64DivU = 0x80,
  I64RemS = 0x81,
  I64RemU = 0x82,
  I64And = 0x83,
  I64Or = 0x84,
  I64Xor = 0x85,
  I64Shl = 0x86,
  I64ShrS = 0x87,
  I64ShrU = 0x88,
  I64Rotl = 0x89,
  I64Rotr = 0x8a,
  // f32 arithmetic
  F32Abs = 0x8b,
  F32Neg = 0x8c,
  F32Ceil = 0x8d,
  F32Floor = 0x8e,
  F32Trunc = 0x8f,
  F32Nearest = 0x90,
  F32Sqrt = 0x91,
  F32Add = 0x92,
  F32Sub = 0x93,
  F32Mul = 0x94,
  F32Div = 0x95,
  F32Min = 0x96,
  F32Max = 0x97,
  F32Copysign = 0x98,
  // f64 arithmetic
  F64Abs = 0x99,
  F64Neg = 0x9a,
  F64Ceil = 0x9b,
  F64Floor = 0x9c,
  F64Trunc = 0x9d,
  F64Nearest = 0x9e,
  F64Sqrt = 0x9f,
  F64Add = 0xa0,
  F64Sub = 0xa1,
  F64Mul = 0xa2,
  F64Div = 0xa3,
  F64Min = 0xa4,
  F64Max = 0xa5,
  F64Copysign = 0xa6,
  // Conversion instructions
  I32WrapI64 = 0xa7,
  I32TruncF32S = 0xa8,
  I32TruncF32U = 0xa9,
  I32TruncF64S = 0xaa,
  I32TruncF64U = 0xab,
  I64ExtendI32S = 0xac,
  I64ExtendI32U = 0xad,
  I64TruncF32S = 0xae,
  I64TruncF32U = 0xaf,
  I64TruncF64S = 0xb0,
  I64TruncF64U = 0xb1,
  F32ConvertI32S = 0xb2,
  F32ConvertI32U = 0xb3,
  F32ConvertI64S = 0xb4,
  F32ConvertI64U = 0xb5,
  F32DemoteF64 = 0xb6,
  F64ConvertI32S = 0xb7,
  F64ConvertI32U = 0xb8,
  F64ConvertI64S = 0xb9,
  F64ConvertI64U = 0xba,
  F64PromoteF32 = 0xbb,
  I32ReinterpretF32 = 0xbc,
  I64ReinterpretF64 = 0xbd,
  F32ReinterpretI32 = 0xbe,
  F64ReinterpretI64 = 0xbf,
  // Sign-extension (sign-extension-ops proposal, now in spec)
  I32Extend8S = 0xc0,
  I32Extend16S = 0xc1,
  I64Extend8S = 0xc2,
  I64Extend16S = 0xc3,
  I64Extend32S = 0xc4,
  // GC reference instructions (0xd0–0xd6)
  RefNull = 0xd0,
  RefIsNull = 0xd1,
  RefFunc = 0xd2,
  RefEq = 0xd3,
  RefAsNonNull = 0xd4,
  BrOnNull = 0xd5,
  BrOnNonNull = 0xd6,
}

// ---------------------------------------------------------------------------
// Misc / numeric extension opcodes (PREFIX_MISC = 0xfc group)
// ---------------------------------------------------------------------------

/**
 * Opcodes in the `0xfc` prefix group (saturating trunc, bulk memory, table ops).
 * Each value is the LEB128 immediate following the `0xfc` prefix byte.
 */
export enum MiscOpcode {
  I32TruncSatF32S = 0,
  I32TruncSatF32U = 1,
  I32TruncSatF64S = 2,
  I32TruncSatF64U = 3,
  I64TruncSatF32S = 4,
  I64TruncSatF32U = 5,
  I64TruncSatF64S = 6,
  I64TruncSatF64U = 7,
  MemoryInit = 8,
  DataDrop = 9,
  MemoryCopy = 10,
  MemoryFill = 11,
  TableInit = 12,
  ElemDrop = 13,
  TableCopy = 14,
  TableGrow = 15,
  TableSize = 16,
  TableFill = 17,
  /**
   * Wide arithmetic. `add128` / `sub128` take four i64 operands (two 128-bit
   * values as lo/hi pairs) and give two; `mul_wide_s` / `mul_wide_u` take two
   * and give the 128-bit product as two.
   *
   * The lexer has always emitted all four (as `TokenType.Quaternary` and
   * `TokenType.Binary` respectively) with raw sub-opcodes, so `wat2wasm`
   * accepted and encoded them while the binary READER had no case — `wasm2wat`
   * could not read back what our own front end wrote. Naming them here is what
   * closes that.
   */
  I64Add128 = 19,
  I64Sub128 = 20,
  I64MulWideS = 21,
  I64MulWideU = 22,
}

// ---------------------------------------------------------------------------
// GC opcodes (PREFIX_GC = 0xfb group)
// ---------------------------------------------------------------------------

/**
 * Opcodes in the `0xfb` prefix group (GC proposal: struct/array/i31/ref.test).
 * Each value is the LEB128 immediate following the `0xfb` prefix byte.
 */
export enum GcOpcode {
  StructNew = 0x00,
  StructNewDefault = 0x01,
  StructGet = 0x02,
  StructGetS = 0x03,
  StructGetU = 0x04,
  StructSet = 0x05,
  ArrayNew = 0x06,
  ArrayNewDefault = 0x07,
  ArrayNewFixed = 0x08,
  ArrayNewData = 0x09,
  ArrayNewElem = 0x0a,
  ArrayGet = 0x0b,
  ArrayGetS = 0x0c,
  ArrayGetU = 0x0d,
  ArraySet = 0x0e,
  ArrayLen = 0x0f,
  ArrayFill = 0x10,
  ArrayCopy = 0x11,
  ArrayInitData = 0x12,
  ArrayInitElem = 0x13,
  RefTest = 0x14,
  RefTestNullable = 0x15,
  RefCast = 0x16,
  RefCastNullable = 0x17,
  BrOnCast = 0x18,
  BrOnCastFail = 0x19,
  AnyConvertExtern = 0x1a,
  ExternConvertAny = 0x1b,
  RefI31 = 0x1c,
  I31GetS = 0x1d,
  I31GetU = 0x1e,
  // Custom descriptors proposal.
  StructNewDesc = 0x20,
  StructNewDefaultDesc = 0x21,
  RefGetDesc = 0x22,
  RefCastDescEq = 0x23,
  RefCastDescEqNullable = 0x24,
  BrOnCastDescEq = 0x25,
  BrOnCastDescEqFail = 0x26,
}

// ---------------------------------------------------------------------------
// Name mapping (opcode → WAT mnemonic)
// ---------------------------------------------------------------------------

/**
 * Returns the WAT text-format mnemonic for a core {@link Opcode}.
 * Returns `undefined` for opcodes with no single-token mnemonic.
 */
export function opcodeName(op: Opcode): string | undefined {
  return OPCODE_NAMES.get(op);
}

/**
 * `i8x16.shuffle` — the ONE instruction the `simd.shuffle` expression kind
 * names.
 *
 * Named here rather than left inline at the writer, because the kind carries no
 * `opcode` field: with a single instruction the KIND *is* the operator, and a
 * field that can only hold one value is a field that can disagree with the kind.
 * The table below is keyed by the composed value, so this is the one place the
 * constant belongs.
 */
export const OPCODE_I8X16_SHUFFLE: Opcode = ((PREFIX_SIMD << 16) | 0x0d) as Opcode;

/** `v128.load` — the 16-byte plain SIMD load, `0xFD 0x00`. */
export const OPCODE_V128_LOAD: Opcode = ((PREFIX_SIMD << 16) | 0x00) as Opcode;

/** `v128.store` — the 16-byte plain SIMD store, `0xFD 0x0B`. */
export const OPCODE_V128_STORE: Opcode = ((PREFIX_SIMD << 16) | 0x0b) as Opcode;

// The names and access widths come from D1 — `src/definitions/opcodes.json`,
// the instruction table binaryang publishes for other projects to generate
// their copies from (open-work 22). They were ~790 hand-kept lines here: one
// fact in two places, and the copy had drifted before (~95 SIMD entries at
// wrong positions or colliding; relaxed-SIMD sub-opcodes ≥ 0x100 forced the
// `(prefix << 16) | sub` key; `delegate`, `catch_all` and `try_table` had no
// name at all, so a disassembly printed `<opcode:0x1f>`). binaryang reads the
// definition it publishes, so the two cannot drift.
const OPCODE_NAMES = new Map<number, string>();
const EXTENDED_OPCODE_NAMES = new Map<number, string>();
const NATURAL_ALIGN = new Map<number, number>();
for (const d of OPCODE_DEFINITIONS.entries) {
  const key = d.prefix === null ? d.opcode : (parseInt(d.prefix, 16) << 16) | d.opcode;
  const names = d.prefix === null ? OPCODE_NAMES : EXTENDED_OPCODE_NAMES;
  // Two opcodes may share a name (`select`, 0x1b / 0x1c); a key has one entry.
  if (!names.has(key)) names.set(key, d.name);
  if (d.align !== undefined) NATURAL_ALIGN.set(key, d.align);
}

/**
 * Returns the WAT mnemonic for an extended (prefixed) opcode.
 * The `combined` value is `(prefix << 16) | sub` as stored in Expr nodes.
 */
export function extendedOpcodeName(combined: number): string | undefined {
  return EXTENDED_OPCODE_NAMES.get(combined);
}

/**
 * Returns the WAT mnemonic for any opcode value (core or extended).
 * Falls back to `<opcode:0xXXXX>` if the opcode is unknown.
 */
export function anyOpcodeName(op: number): string {
  if (op <= 0xff) {
    return OPCODE_NAMES.get(op) ?? `<opcode:0x${op.toString(16)}>`;
  }
  return EXTENDED_OPCODE_NAMES.get(op) ?? `<opcode:0x${op.toString(16)}>`;
}

/**
 * The natural alignment in bytes for a memory-touching opcode — D1's `align`,
 * the width of the access (i32.store → 4, i64.load → 8, v128.load → 16,
 * i32.atomic.load → 4). The parser stores it when there is no explicit
 * `align=N`; the WAT writer compares against it to decide whether to print
 * one. Atomics MUST use it (threads proposal); other accesses accept any
 * align ≤ it, but binaryen's optimizer treats a smaller one as a hard
 * constraint.
 *
 * Returns 1 for an opcode that is not a memory access — callers only ask for
 * load/store-family instructions, so the fallback is defensive.
 */
export function naturalAlignForOpcode(op: number): number {
  return NATURAL_ALIGN.get(op) ?? 1;
}
