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

// Built lazily from the enum above; avoids a large switch statement.
const OPCODE_NAMES: ReadonlyMap<Opcode, string> = new Map<Opcode, string>([
  [Opcode.Unreachable, 'unreachable'],
  [Opcode.Nop, 'nop'],
  [Opcode.Block, 'block'],
  [Opcode.Loop, 'loop'],
  [Opcode.If, 'if'],
  [Opcode.Else, 'else'],
  [Opcode.Try, 'try'],
  [Opcode.Catch, 'catch'],
  [Opcode.Throw, 'throw'],
  [Opcode.Rethrow, 'rethrow'],
  [Opcode.ThrowRef, 'throw_ref'],
  [Opcode.End, 'end'],
  [Opcode.Br, 'br'],
  [Opcode.BrIf, 'br_if'],
  [Opcode.BrTable, 'br_table'],
  [Opcode.Return, 'return'],
  [Opcode.Call, 'call'],
  [Opcode.CallIndirect, 'call_indirect'],
  [Opcode.ReturnCall, 'return_call'],
  [Opcode.ReturnCallIndirect, 'return_call_indirect'],
  [Opcode.CallRef, 'call_ref'],
  [Opcode.ReturnCallRef, 'return_call_ref'],
  [Opcode.Drop, 'drop'],
  [Opcode.Select, 'select'],
  [Opcode.SelectT, 'select'],
  [Opcode.LocalGet, 'local.get'],
  [Opcode.LocalSet, 'local.set'],
  [Opcode.LocalTee, 'local.tee'],
  [Opcode.GlobalGet, 'global.get'],
  [Opcode.GlobalSet, 'global.set'],
  [Opcode.TableGet, 'table.get'],
  [Opcode.TableSet, 'table.set'],
  [Opcode.I32Load, 'i32.load'],
  [Opcode.I64Load, 'i64.load'],
  [Opcode.F32Load, 'f32.load'],
  [Opcode.F64Load, 'f64.load'],
  [Opcode.I32Load8S, 'i32.load8_s'],
  [Opcode.I32Load8U, 'i32.load8_u'],
  [Opcode.I32Load16S, 'i32.load16_s'],
  [Opcode.I32Load16U, 'i32.load16_u'],
  [Opcode.I64Load8S, 'i64.load8_s'],
  [Opcode.I64Load8U, 'i64.load8_u'],
  [Opcode.I64Load16S, 'i64.load16_s'],
  [Opcode.I64Load16U, 'i64.load16_u'],
  [Opcode.I64Load32S, 'i64.load32_s'],
  [Opcode.I64Load32U, 'i64.load32_u'],
  [Opcode.I32Store, 'i32.store'],
  [Opcode.I64Store, 'i64.store'],
  [Opcode.F32Store, 'f32.store'],
  [Opcode.F64Store, 'f64.store'],
  [Opcode.I32Store8, 'i32.store8'],
  [Opcode.I32Store16, 'i32.store16'],
  [Opcode.I64Store8, 'i64.store8'],
  [Opcode.I64Store16, 'i64.store16'],
  [Opcode.I64Store32, 'i64.store32'],
  [Opcode.MemorySize, 'memory.size'],
  [Opcode.MemoryGrow, 'memory.grow'],
  [Opcode.I32Const, 'i32.const'],
  [Opcode.I64Const, 'i64.const'],
  [Opcode.F32Const, 'f32.const'],
  [Opcode.F64Const, 'f64.const'],
  [Opcode.I32Eqz, 'i32.eqz'],
  [Opcode.I32Eq, 'i32.eq'],
  [Opcode.I32Ne, 'i32.ne'],
  [Opcode.I32LtS, 'i32.lt_s'],
  [Opcode.I32LtU, 'i32.lt_u'],
  [Opcode.I32GtS, 'i32.gt_s'],
  [Opcode.I32GtU, 'i32.gt_u'],
  [Opcode.I32LeS, 'i32.le_s'],
  [Opcode.I32LeU, 'i32.le_u'],
  [Opcode.I32GeS, 'i32.ge_s'],
  [Opcode.I32GeU, 'i32.ge_u'],
  [Opcode.I64Eqz, 'i64.eqz'],
  [Opcode.I64Eq, 'i64.eq'],
  [Opcode.I64Ne, 'i64.ne'],
  [Opcode.I64LtS, 'i64.lt_s'],
  [Opcode.I64LtU, 'i64.lt_u'],
  [Opcode.I64GtS, 'i64.gt_s'],
  [Opcode.I64GtU, 'i64.gt_u'],
  [Opcode.I64LeS, 'i64.le_s'],
  [Opcode.I64LeU, 'i64.le_u'],
  [Opcode.I64GeS, 'i64.ge_s'],
  [Opcode.I64GeU, 'i64.ge_u'],
  [Opcode.F32Eq, 'f32.eq'],
  [Opcode.F32Ne, 'f32.ne'],
  [Opcode.F32Lt, 'f32.lt'],
  [Opcode.F32Gt, 'f32.gt'],
  [Opcode.F32Le, 'f32.le'],
  [Opcode.F32Ge, 'f32.ge'],
  [Opcode.F64Eq, 'f64.eq'],
  [Opcode.F64Ne, 'f64.ne'],
  [Opcode.F64Lt, 'f64.lt'],
  [Opcode.F64Gt, 'f64.gt'],
  [Opcode.F64Le, 'f64.le'],
  [Opcode.F64Ge, 'f64.ge'],
  [Opcode.I32Clz, 'i32.clz'],
  [Opcode.I32Ctz, 'i32.ctz'],
  [Opcode.I32Popcnt, 'i32.popcnt'],
  [Opcode.I32Add, 'i32.add'],
  [Opcode.I32Sub, 'i32.sub'],
  [Opcode.I32Mul, 'i32.mul'],
  [Opcode.I32DivS, 'i32.div_s'],
  [Opcode.I32DivU, 'i32.div_u'],
  [Opcode.I32RemS, 'i32.rem_s'],
  [Opcode.I32RemU, 'i32.rem_u'],
  [Opcode.I32And, 'i32.and'],
  [Opcode.I32Or, 'i32.or'],
  [Opcode.I32Xor, 'i32.xor'],
  [Opcode.I32Shl, 'i32.shl'],
  [Opcode.I32ShrS, 'i32.shr_s'],
  [Opcode.I32ShrU, 'i32.shr_u'],
  [Opcode.I32Rotl, 'i32.rotl'],
  [Opcode.I32Rotr, 'i32.rotr'],
  [Opcode.I64Clz, 'i64.clz'],
  [Opcode.I64Ctz, 'i64.ctz'],
  [Opcode.I64Popcnt, 'i64.popcnt'],
  [Opcode.I64Add, 'i64.add'],
  [Opcode.I64Sub, 'i64.sub'],
  [Opcode.I64Mul, 'i64.mul'],
  [Opcode.I64DivS, 'i64.div_s'],
  [Opcode.I64DivU, 'i64.div_u'],
  [Opcode.I64RemS, 'i64.rem_s'],
  [Opcode.I64RemU, 'i64.rem_u'],
  [Opcode.I64And, 'i64.and'],
  [Opcode.I64Or, 'i64.or'],
  [Opcode.I64Xor, 'i64.xor'],
  [Opcode.I64Shl, 'i64.shl'],
  [Opcode.I64ShrS, 'i64.shr_s'],
  [Opcode.I64ShrU, 'i64.shr_u'],
  [Opcode.I64Rotl, 'i64.rotl'],
  [Opcode.I64Rotr, 'i64.rotr'],
  [Opcode.F32Abs, 'f32.abs'],
  [Opcode.F32Neg, 'f32.neg'],
  [Opcode.F32Ceil, 'f32.ceil'],
  [Opcode.F32Floor, 'f32.floor'],
  [Opcode.F32Trunc, 'f32.trunc'],
  [Opcode.F32Nearest, 'f32.nearest'],
  [Opcode.F32Sqrt, 'f32.sqrt'],
  [Opcode.F32Add, 'f32.add'],
  [Opcode.F32Sub, 'f32.sub'],
  [Opcode.F32Mul, 'f32.mul'],
  [Opcode.F32Div, 'f32.div'],
  [Opcode.F32Min, 'f32.min'],
  [Opcode.F32Max, 'f32.max'],
  [Opcode.F32Copysign, 'f32.copysign'],
  [Opcode.F64Abs, 'f64.abs'],
  [Opcode.F64Neg, 'f64.neg'],
  [Opcode.F64Ceil, 'f64.ceil'],
  [Opcode.F64Floor, 'f64.floor'],
  [Opcode.F64Trunc, 'f64.trunc'],
  [Opcode.F64Nearest, 'f64.nearest'],
  [Opcode.F64Sqrt, 'f64.sqrt'],
  [Opcode.F64Add, 'f64.add'],
  [Opcode.F64Sub, 'f64.sub'],
  [Opcode.F64Mul, 'f64.mul'],
  [Opcode.F64Div, 'f64.div'],
  [Opcode.F64Min, 'f64.min'],
  [Opcode.F64Max, 'f64.max'],
  [Opcode.F64Copysign, 'f64.copysign'],
  [Opcode.I32WrapI64, 'i32.wrap_i64'],
  [Opcode.I32TruncF32S, 'i32.trunc_f32_s'],
  [Opcode.I32TruncF32U, 'i32.trunc_f32_u'],
  [Opcode.I32TruncF64S, 'i32.trunc_f64_s'],
  [Opcode.I32TruncF64U, 'i32.trunc_f64_u'],
  [Opcode.I64ExtendI32S, 'i64.extend_i32_s'],
  [Opcode.I64ExtendI32U, 'i64.extend_i32_u'],
  [Opcode.I64TruncF32S, 'i64.trunc_f32_s'],
  [Opcode.I64TruncF32U, 'i64.trunc_f32_u'],
  [Opcode.I64TruncF64S, 'i64.trunc_f64_s'],
  [Opcode.I64TruncF64U, 'i64.trunc_f64_u'],
  [Opcode.F32ConvertI32S, 'f32.convert_i32_s'],
  [Opcode.F32ConvertI32U, 'f32.convert_i32_u'],
  [Opcode.F32ConvertI64S, 'f32.convert_i64_s'],
  [Opcode.F32ConvertI64U, 'f32.convert_i64_u'],
  [Opcode.F32DemoteF64, 'f32.demote_f64'],
  [Opcode.F64ConvertI32S, 'f64.convert_i32_s'],
  [Opcode.F64ConvertI32U, 'f64.convert_i32_u'],
  [Opcode.F64ConvertI64S, 'f64.convert_i64_s'],
  [Opcode.F64ConvertI64U, 'f64.convert_i64_u'],
  [Opcode.F64PromoteF32, 'f64.promote_f32'],
  [Opcode.I32ReinterpretF32, 'i32.reinterpret_f32'],
  [Opcode.I64ReinterpretF64, 'i64.reinterpret_f64'],
  [Opcode.F32ReinterpretI32, 'f32.reinterpret_i32'],
  [Opcode.F64ReinterpretI64, 'f64.reinterpret_i64'],
  [Opcode.I32Extend8S, 'i32.extend8_s'],
  [Opcode.I32Extend16S, 'i32.extend16_s'],
  [Opcode.I64Extend8S, 'i64.extend8_s'],
  [Opcode.I64Extend16S, 'i64.extend16_s'],
  [Opcode.I64Extend32S, 'i64.extend32_s'],
  [Opcode.RefNull, 'ref.null'],
  [Opcode.RefIsNull, 'ref.is_null'],
  [Opcode.RefFunc, 'ref.func'],
  [Opcode.RefEq, 'ref.eq'],
  [Opcode.RefAsNonNull, 'ref.as_non_null'],
  [Opcode.BrOnNull, 'br_on_null'],
  [Opcode.BrOnNonNull, 'br_on_non_null'],
]);

// ---------------------------------------------------------------------------
// Extended opcode names (prefix × 256 + op)
//
// Covers:
//   PREFIX_MISC   (0xfc) — saturating trunc
//   PREFIX_SIMD   (0xfd) — v128 / SIMD instructions
//   PREFIX_THREADS (0xfe) — atomics
// ---------------------------------------------------------------------------

const EXTENDED_OPCODE_NAMES: ReadonlyMap<number, string> = new Map<number, string>([
  // --- 0xfc: misc (saturating truncation + bulk-memory + reference-types + i128) ---
  [(PREFIX_MISC << 16) | 0x00, 'i32.trunc_sat_f32_s'],
  [(PREFIX_MISC << 16) | 0x01, 'i32.trunc_sat_f32_u'],
  [(PREFIX_MISC << 16) | 0x02, 'i32.trunc_sat_f64_s'],
  [(PREFIX_MISC << 16) | 0x03, 'i32.trunc_sat_f64_u'],
  [(PREFIX_MISC << 16) | 0x04, 'i64.trunc_sat_f32_s'],
  [(PREFIX_MISC << 16) | 0x05, 'i64.trunc_sat_f32_u'],
  [(PREFIX_MISC << 16) | 0x06, 'i64.trunc_sat_f64_s'],
  [(PREFIX_MISC << 16) | 0x07, 'i64.trunc_sat_f64_u'],
  [(PREFIX_MISC << 16) | 0x08, 'memory.init'],
  [(PREFIX_MISC << 16) | 0x09, 'data.drop'],
  [(PREFIX_MISC << 16) | 0x0a, 'memory.copy'],
  [(PREFIX_MISC << 16) | 0x0b, 'memory.fill'],
  [(PREFIX_MISC << 16) | 0x0c, 'table.init'],
  [(PREFIX_MISC << 16) | 0x0d, 'elem.drop'],
  [(PREFIX_MISC << 16) | 0x0e, 'table.copy'],
  [(PREFIX_MISC << 16) | 0x0f, 'table.grow'],
  [(PREFIX_MISC << 16) | 0x10, 'table.size'],
  [(PREFIX_MISC << 16) | 0x11, 'table.fill'],
  [(PREFIX_MISC << 16) | 0x13, 'i64.add128'],
  [(PREFIX_MISC << 16) | 0x14, 'i64.sub128'],
  [(PREFIX_MISC << 16) | 0x15, 'i64.mul_wide_s'],
  [(PREFIX_MISC << 16) | 0x16, 'i64.mul_wide_u'],

  // --- 0xfd: SIMD / v128 instructions (regenerated from upstream wabt
  // opcode.def via scripts/gen_simd_opcode_table.ts; cross-checked against
  // https://github.com/WebAssembly/simd/blob/main/proposals/simd/BinarySIMD.md).
  // Previous hand-written entries had drifted: ~95 opcodes were either at
  // wrong byte positions (e.g. i64x2 compares listed at 0x41-0x46 instead of
  // 0xd6-0xdb), missing entirely (extmul, extend_low/high families), or
  // colliding via duplicate keys (relaxed-SIMD ops written as `| 0x100+` end
  // up OR'd into the same 16-bit key as low SIMD opcodes). Run the audit
  // script (scripts/audit_opcodes.ts) to detect future drift.
  //
  // SIMD sub-opcodes >= 0x100 (the relaxed-SIMD set) are LEB128-encoded in the
  // binary. They did NOT fit the old `(prefix << 8) | byte` key: `S(0x100)`
  // computed 0xfd00, aliasing onto v128.load (bit 8 is already set by the
  // prefix, so the OR changed nothing), and 0x111 aliased onto i32x4.splat.
  // The key is now
  // `(prefix << 16) | sub`, which holds them, and they are listed below;
  // without the names wasm2wat printed `<opcode:0xfd0100>` and could not
  // round-trip.
  [(PREFIX_SIMD << 16) | 0x00, 'v128.load'],
  // --- Relaxed SIMD (sub-opcodes 0x100-0x113) ---
  [(PREFIX_SIMD << 16) | 0x100, 'i8x16.relaxed_swizzle'],
  [(PREFIX_SIMD << 16) | 0x101, 'i32x4.relaxed_trunc_f32x4_s'],
  [(PREFIX_SIMD << 16) | 0x102, 'i32x4.relaxed_trunc_f32x4_u'],
  [(PREFIX_SIMD << 16) | 0x103, 'i32x4.relaxed_trunc_f64x2_s_zero'],
  [(PREFIX_SIMD << 16) | 0x104, 'i32x4.relaxed_trunc_f64x2_u_zero'],
  [(PREFIX_SIMD << 16) | 0x105, 'f32x4.relaxed_madd'],
  [(PREFIX_SIMD << 16) | 0x106, 'f32x4.relaxed_nmadd'],
  [(PREFIX_SIMD << 16) | 0x107, 'f64x2.relaxed_madd'],
  [(PREFIX_SIMD << 16) | 0x108, 'f64x2.relaxed_nmadd'],
  [(PREFIX_SIMD << 16) | 0x109, 'i8x16.relaxed_laneselect'],
  [(PREFIX_SIMD << 16) | 0x10a, 'i16x8.relaxed_laneselect'],
  [(PREFIX_SIMD << 16) | 0x10b, 'i32x4.relaxed_laneselect'],
  [(PREFIX_SIMD << 16) | 0x10c, 'i64x2.relaxed_laneselect'],
  [(PREFIX_SIMD << 16) | 0x10d, 'f32x4.relaxed_min'],
  [(PREFIX_SIMD << 16) | 0x10e, 'f32x4.relaxed_max'],
  [(PREFIX_SIMD << 16) | 0x10f, 'f64x2.relaxed_min'],
  [(PREFIX_SIMD << 16) | 0x110, 'f64x2.relaxed_max'],
  [(PREFIX_SIMD << 16) | 0x111, 'i16x8.relaxed_q15mulr_s'],
  [(PREFIX_SIMD << 16) | 0x112, 'i16x8.relaxed_dot_i8x16_i7x16_s'],
  [(PREFIX_SIMD << 16) | 0x113, 'i32x4.relaxed_dot_i8x16_i7x16_add_s'],
  [(PREFIX_SIMD << 16) | 0x01, 'v128.load8x8_s'],
  [(PREFIX_SIMD << 16) | 0x02, 'v128.load8x8_u'],
  [(PREFIX_SIMD << 16) | 0x03, 'v128.load16x4_s'],
  [(PREFIX_SIMD << 16) | 0x04, 'v128.load16x4_u'],
  [(PREFIX_SIMD << 16) | 0x05, 'v128.load32x2_s'],
  [(PREFIX_SIMD << 16) | 0x06, 'v128.load32x2_u'],
  [(PREFIX_SIMD << 16) | 0x07, 'v128.load8_splat'],
  [(PREFIX_SIMD << 16) | 0x08, 'v128.load16_splat'],
  [(PREFIX_SIMD << 16) | 0x09, 'v128.load32_splat'],
  [(PREFIX_SIMD << 16) | 0x0a, 'v128.load64_splat'],
  [(PREFIX_SIMD << 16) | 0x0b, 'v128.store'],
  [(PREFIX_SIMD << 16) | 0x0c, 'v128.const'],
  [(PREFIX_SIMD << 16) | 0x0d, 'i8x16.shuffle'],
  [(PREFIX_SIMD << 16) | 0x0e, 'i8x16.swizzle'],
  [(PREFIX_SIMD << 16) | 0x0f, 'i8x16.splat'],
  [(PREFIX_SIMD << 16) | 0x10, 'i16x8.splat'],
  [(PREFIX_SIMD << 16) | 0x11, 'i32x4.splat'],
  [(PREFIX_SIMD << 16) | 0x12, 'i64x2.splat'],
  [(PREFIX_SIMD << 16) | 0x13, 'f32x4.splat'],
  [(PREFIX_SIMD << 16) | 0x14, 'f64x2.splat'],
  [(PREFIX_SIMD << 16) | 0x15, 'i8x16.extract_lane_s'],
  [(PREFIX_SIMD << 16) | 0x16, 'i8x16.extract_lane_u'],
  [(PREFIX_SIMD << 16) | 0x17, 'i8x16.replace_lane'],
  [(PREFIX_SIMD << 16) | 0x18, 'i16x8.extract_lane_s'],
  [(PREFIX_SIMD << 16) | 0x19, 'i16x8.extract_lane_u'],
  [(PREFIX_SIMD << 16) | 0x1a, 'i16x8.replace_lane'],
  [(PREFIX_SIMD << 16) | 0x1b, 'i32x4.extract_lane'],
  [(PREFIX_SIMD << 16) | 0x1c, 'i32x4.replace_lane'],
  [(PREFIX_SIMD << 16) | 0x1d, 'i64x2.extract_lane'],
  [(PREFIX_SIMD << 16) | 0x1e, 'i64x2.replace_lane'],
  [(PREFIX_SIMD << 16) | 0x1f, 'f32x4.extract_lane'],
  [(PREFIX_SIMD << 16) | 0x20, 'f32x4.replace_lane'],
  [(PREFIX_SIMD << 16) | 0x21, 'f64x2.extract_lane'],
  [(PREFIX_SIMD << 16) | 0x22, 'f64x2.replace_lane'],
  [(PREFIX_SIMD << 16) | 0x23, 'i8x16.eq'],
  [(PREFIX_SIMD << 16) | 0x24, 'i8x16.ne'],
  [(PREFIX_SIMD << 16) | 0x25, 'i8x16.lt_s'],
  [(PREFIX_SIMD << 16) | 0x26, 'i8x16.lt_u'],
  [(PREFIX_SIMD << 16) | 0x27, 'i8x16.gt_s'],
  [(PREFIX_SIMD << 16) | 0x28, 'i8x16.gt_u'],
  [(PREFIX_SIMD << 16) | 0x29, 'i8x16.le_s'],
  [(PREFIX_SIMD << 16) | 0x2a, 'i8x16.le_u'],
  [(PREFIX_SIMD << 16) | 0x2b, 'i8x16.ge_s'],
  [(PREFIX_SIMD << 16) | 0x2c, 'i8x16.ge_u'],
  [(PREFIX_SIMD << 16) | 0x2d, 'i16x8.eq'],
  [(PREFIX_SIMD << 16) | 0x2e, 'i16x8.ne'],
  [(PREFIX_SIMD << 16) | 0x2f, 'i16x8.lt_s'],
  [(PREFIX_SIMD << 16) | 0x30, 'i16x8.lt_u'],
  [(PREFIX_SIMD << 16) | 0x31, 'i16x8.gt_s'],
  [(PREFIX_SIMD << 16) | 0x32, 'i16x8.gt_u'],
  [(PREFIX_SIMD << 16) | 0x33, 'i16x8.le_s'],
  [(PREFIX_SIMD << 16) | 0x34, 'i16x8.le_u'],
  [(PREFIX_SIMD << 16) | 0x35, 'i16x8.ge_s'],
  [(PREFIX_SIMD << 16) | 0x36, 'i16x8.ge_u'],
  [(PREFIX_SIMD << 16) | 0x37, 'i32x4.eq'],
  [(PREFIX_SIMD << 16) | 0x38, 'i32x4.ne'],
  [(PREFIX_SIMD << 16) | 0x39, 'i32x4.lt_s'],
  [(PREFIX_SIMD << 16) | 0x3a, 'i32x4.lt_u'],
  [(PREFIX_SIMD << 16) | 0x3b, 'i32x4.gt_s'],
  [(PREFIX_SIMD << 16) | 0x3c, 'i32x4.gt_u'],
  [(PREFIX_SIMD << 16) | 0x3d, 'i32x4.le_s'],
  [(PREFIX_SIMD << 16) | 0x3e, 'i32x4.le_u'],
  [(PREFIX_SIMD << 16) | 0x3f, 'i32x4.ge_s'],
  [(PREFIX_SIMD << 16) | 0x40, 'i32x4.ge_u'],
  [(PREFIX_SIMD << 16) | 0x41, 'f32x4.eq'],
  [(PREFIX_SIMD << 16) | 0x42, 'f32x4.ne'],
  [(PREFIX_SIMD << 16) | 0x43, 'f32x4.lt'],
  [(PREFIX_SIMD << 16) | 0x44, 'f32x4.gt'],
  [(PREFIX_SIMD << 16) | 0x45, 'f32x4.le'],
  [(PREFIX_SIMD << 16) | 0x46, 'f32x4.ge'],
  [(PREFIX_SIMD << 16) | 0x47, 'f64x2.eq'],
  [(PREFIX_SIMD << 16) | 0x48, 'f64x2.ne'],
  [(PREFIX_SIMD << 16) | 0x49, 'f64x2.lt'],
  [(PREFIX_SIMD << 16) | 0x4a, 'f64x2.gt'],
  [(PREFIX_SIMD << 16) | 0x4b, 'f64x2.le'],
  [(PREFIX_SIMD << 16) | 0x4c, 'f64x2.ge'],
  [(PREFIX_SIMD << 16) | 0x4d, 'v128.not'],
  [(PREFIX_SIMD << 16) | 0x4e, 'v128.and'],
  [(PREFIX_SIMD << 16) | 0x4f, 'v128.andnot'],
  [(PREFIX_SIMD << 16) | 0x50, 'v128.or'],
  [(PREFIX_SIMD << 16) | 0x51, 'v128.xor'],
  [(PREFIX_SIMD << 16) | 0x52, 'v128.bitselect'],
  [(PREFIX_SIMD << 16) | 0x53, 'v128.any_true'],
  [(PREFIX_SIMD << 16) | 0x54, 'v128.load8_lane'],
  [(PREFIX_SIMD << 16) | 0x55, 'v128.load16_lane'],
  [(PREFIX_SIMD << 16) | 0x56, 'v128.load32_lane'],
  [(PREFIX_SIMD << 16) | 0x57, 'v128.load64_lane'],
  [(PREFIX_SIMD << 16) | 0x58, 'v128.store8_lane'],
  [(PREFIX_SIMD << 16) | 0x59, 'v128.store16_lane'],
  [(PREFIX_SIMD << 16) | 0x5a, 'v128.store32_lane'],
  [(PREFIX_SIMD << 16) | 0x5b, 'v128.store64_lane'],
  [(PREFIX_SIMD << 16) | 0x5c, 'v128.load32_zero'],
  [(PREFIX_SIMD << 16) | 0x5d, 'v128.load64_zero'],
  [(PREFIX_SIMD << 16) | 0x5e, 'f32x4.demote_f64x2_zero'],
  [(PREFIX_SIMD << 16) | 0x5f, 'f64x2.promote_low_f32x4'],
  [(PREFIX_SIMD << 16) | 0x60, 'i8x16.abs'],
  [(PREFIX_SIMD << 16) | 0x61, 'i8x16.neg'],
  [(PREFIX_SIMD << 16) | 0x62, 'i8x16.popcnt'],
  [(PREFIX_SIMD << 16) | 0x63, 'i8x16.all_true'],
  [(PREFIX_SIMD << 16) | 0x64, 'i8x16.bitmask'],
  [(PREFIX_SIMD << 16) | 0x65, 'i8x16.narrow_i16x8_s'],
  [(PREFIX_SIMD << 16) | 0x66, 'i8x16.narrow_i16x8_u'],
  [(PREFIX_SIMD << 16) | 0x67, 'f32x4.ceil'],
  [(PREFIX_SIMD << 16) | 0x68, 'f32x4.floor'],
  [(PREFIX_SIMD << 16) | 0x69, 'f32x4.trunc'],
  [(PREFIX_SIMD << 16) | 0x6a, 'f32x4.nearest'],
  [(PREFIX_SIMD << 16) | 0x6b, 'i8x16.shl'],
  [(PREFIX_SIMD << 16) | 0x6c, 'i8x16.shr_s'],
  [(PREFIX_SIMD << 16) | 0x6d, 'i8x16.shr_u'],
  [(PREFIX_SIMD << 16) | 0x6e, 'i8x16.add'],
  [(PREFIX_SIMD << 16) | 0x6f, 'i8x16.add_sat_s'],
  [(PREFIX_SIMD << 16) | 0x70, 'i8x16.add_sat_u'],
  [(PREFIX_SIMD << 16) | 0x71, 'i8x16.sub'],
  [(PREFIX_SIMD << 16) | 0x72, 'i8x16.sub_sat_s'],
  [(PREFIX_SIMD << 16) | 0x73, 'i8x16.sub_sat_u'],
  [(PREFIX_SIMD << 16) | 0x74, 'f64x2.ceil'],
  [(PREFIX_SIMD << 16) | 0x75, 'f64x2.floor'],
  [(PREFIX_SIMD << 16) | 0x76, 'i8x16.min_s'],
  [(PREFIX_SIMD << 16) | 0x77, 'i8x16.min_u'],
  [(PREFIX_SIMD << 16) | 0x78, 'i8x16.max_s'],
  [(PREFIX_SIMD << 16) | 0x79, 'i8x16.max_u'],
  [(PREFIX_SIMD << 16) | 0x7a, 'f64x2.trunc'],
  [(PREFIX_SIMD << 16) | 0x7b, 'i8x16.avgr_u'],
  [(PREFIX_SIMD << 16) | 0x7c, 'i16x8.extadd_pairwise_i8x16_s'],
  [(PREFIX_SIMD << 16) | 0x7d, 'i16x8.extadd_pairwise_i8x16_u'],
  [(PREFIX_SIMD << 16) | 0x7e, 'i32x4.extadd_pairwise_i16x8_s'],
  [(PREFIX_SIMD << 16) | 0x7f, 'i32x4.extadd_pairwise_i16x8_u'],
  [(PREFIX_SIMD << 16) | 0x80, 'i16x8.abs'],
  [(PREFIX_SIMD << 16) | 0x81, 'i16x8.neg'],
  [(PREFIX_SIMD << 16) | 0x82, 'i16x8.q15mulr_sat_s'],
  [(PREFIX_SIMD << 16) | 0x83, 'i16x8.all_true'],
  [(PREFIX_SIMD << 16) | 0x84, 'i16x8.bitmask'],
  [(PREFIX_SIMD << 16) | 0x85, 'i16x8.narrow_i32x4_s'],
  [(PREFIX_SIMD << 16) | 0x86, 'i16x8.narrow_i32x4_u'],
  [(PREFIX_SIMD << 16) | 0x87, 'i16x8.extend_low_i8x16_s'],
  [(PREFIX_SIMD << 16) | 0x88, 'i16x8.extend_high_i8x16_s'],
  [(PREFIX_SIMD << 16) | 0x89, 'i16x8.extend_low_i8x16_u'],
  [(PREFIX_SIMD << 16) | 0x8a, 'i16x8.extend_high_i8x16_u'],
  [(PREFIX_SIMD << 16) | 0x8b, 'i16x8.shl'],
  [(PREFIX_SIMD << 16) | 0x8c, 'i16x8.shr_s'],
  [(PREFIX_SIMD << 16) | 0x8d, 'i16x8.shr_u'],
  [(PREFIX_SIMD << 16) | 0x8e, 'i16x8.add'],
  [(PREFIX_SIMD << 16) | 0x8f, 'i16x8.add_sat_s'],
  [(PREFIX_SIMD << 16) | 0x90, 'i16x8.add_sat_u'],
  [(PREFIX_SIMD << 16) | 0x91, 'i16x8.sub'],
  [(PREFIX_SIMD << 16) | 0x92, 'i16x8.sub_sat_s'],
  [(PREFIX_SIMD << 16) | 0x93, 'i16x8.sub_sat_u'],
  [(PREFIX_SIMD << 16) | 0x94, 'f64x2.nearest'],
  [(PREFIX_SIMD << 16) | 0x95, 'i16x8.mul'],
  [(PREFIX_SIMD << 16) | 0x96, 'i16x8.min_s'],
  [(PREFIX_SIMD << 16) | 0x97, 'i16x8.min_u'],
  [(PREFIX_SIMD << 16) | 0x98, 'i16x8.max_s'],
  [(PREFIX_SIMD << 16) | 0x99, 'i16x8.max_u'],
  [(PREFIX_SIMD << 16) | 0x9b, 'i16x8.avgr_u'],
  [(PREFIX_SIMD << 16) | 0x9c, 'i16x8.extmul_low_i8x16_s'],
  [(PREFIX_SIMD << 16) | 0x9d, 'i16x8.extmul_high_i8x16_s'],
  [(PREFIX_SIMD << 16) | 0x9e, 'i16x8.extmul_low_i8x16_u'],
  [(PREFIX_SIMD << 16) | 0x9f, 'i16x8.extmul_high_i8x16_u'],
  [(PREFIX_SIMD << 16) | 0xa0, 'i32x4.abs'],
  [(PREFIX_SIMD << 16) | 0xa1, 'i32x4.neg'],
  [(PREFIX_SIMD << 16) | 0xa3, 'i32x4.all_true'],
  [(PREFIX_SIMD << 16) | 0xa4, 'i32x4.bitmask'],
  [(PREFIX_SIMD << 16) | 0xa7, 'i32x4.extend_low_i16x8_s'],
  [(PREFIX_SIMD << 16) | 0xa8, 'i32x4.extend_high_i16x8_s'],
  [(PREFIX_SIMD << 16) | 0xa9, 'i32x4.extend_low_i16x8_u'],
  [(PREFIX_SIMD << 16) | 0xaa, 'i32x4.extend_high_i16x8_u'],
  [(PREFIX_SIMD << 16) | 0xab, 'i32x4.shl'],
  [(PREFIX_SIMD << 16) | 0xac, 'i32x4.shr_s'],
  [(PREFIX_SIMD << 16) | 0xad, 'i32x4.shr_u'],
  [(PREFIX_SIMD << 16) | 0xae, 'i32x4.add'],
  [(PREFIX_SIMD << 16) | 0xb1, 'i32x4.sub'],
  [(PREFIX_SIMD << 16) | 0xb5, 'i32x4.mul'],
  [(PREFIX_SIMD << 16) | 0xb6, 'i32x4.min_s'],
  [(PREFIX_SIMD << 16) | 0xb7, 'i32x4.min_u'],
  [(PREFIX_SIMD << 16) | 0xb8, 'i32x4.max_s'],
  [(PREFIX_SIMD << 16) | 0xb9, 'i32x4.max_u'],
  [(PREFIX_SIMD << 16) | 0xba, 'i32x4.dot_i16x8_s'],
  [(PREFIX_SIMD << 16) | 0xbc, 'i32x4.extmul_low_i16x8_s'],
  [(PREFIX_SIMD << 16) | 0xbd, 'i32x4.extmul_high_i16x8_s'],
  [(PREFIX_SIMD << 16) | 0xbe, 'i32x4.extmul_low_i16x8_u'],
  [(PREFIX_SIMD << 16) | 0xbf, 'i32x4.extmul_high_i16x8_u'],
  [(PREFIX_SIMD << 16) | 0xc0, 'i64x2.abs'],
  [(PREFIX_SIMD << 16) | 0xc1, 'i64x2.neg'],
  [(PREFIX_SIMD << 16) | 0xc3, 'i64x2.all_true'],
  [(PREFIX_SIMD << 16) | 0xc4, 'i64x2.bitmask'],
  [(PREFIX_SIMD << 16) | 0xc7, 'i64x2.extend_low_i32x4_s'],
  [(PREFIX_SIMD << 16) | 0xc8, 'i64x2.extend_high_i32x4_s'],
  [(PREFIX_SIMD << 16) | 0xc9, 'i64x2.extend_low_i32x4_u'],
  [(PREFIX_SIMD << 16) | 0xca, 'i64x2.extend_high_i32x4_u'],
  [(PREFIX_SIMD << 16) | 0xcb, 'i64x2.shl'],
  [(PREFIX_SIMD << 16) | 0xcc, 'i64x2.shr_s'],
  [(PREFIX_SIMD << 16) | 0xcd, 'i64x2.shr_u'],
  [(PREFIX_SIMD << 16) | 0xce, 'i64x2.add'],
  [(PREFIX_SIMD << 16) | 0xd1, 'i64x2.sub'],
  [(PREFIX_SIMD << 16) | 0xd5, 'i64x2.mul'],
  [(PREFIX_SIMD << 16) | 0xd6, 'i64x2.eq'],
  [(PREFIX_SIMD << 16) | 0xd7, 'i64x2.ne'],
  [(PREFIX_SIMD << 16) | 0xd8, 'i64x2.lt_s'],
  [(PREFIX_SIMD << 16) | 0xd9, 'i64x2.gt_s'],
  [(PREFIX_SIMD << 16) | 0xda, 'i64x2.le_s'],
  [(PREFIX_SIMD << 16) | 0xdb, 'i64x2.ge_s'],
  [(PREFIX_SIMD << 16) | 0xdc, 'i64x2.extmul_low_i32x4_s'],
  [(PREFIX_SIMD << 16) | 0xdd, 'i64x2.extmul_high_i32x4_s'],
  [(PREFIX_SIMD << 16) | 0xde, 'i64x2.extmul_low_i32x4_u'],
  [(PREFIX_SIMD << 16) | 0xdf, 'i64x2.extmul_high_i32x4_u'],
  [(PREFIX_SIMD << 16) | 0xe0, 'f32x4.abs'],
  [(PREFIX_SIMD << 16) | 0xe1, 'f32x4.neg'],
  [(PREFIX_SIMD << 16) | 0xe3, 'f32x4.sqrt'],
  [(PREFIX_SIMD << 16) | 0xe4, 'f32x4.add'],
  [(PREFIX_SIMD << 16) | 0xe5, 'f32x4.sub'],
  [(PREFIX_SIMD << 16) | 0xe6, 'f32x4.mul'],
  [(PREFIX_SIMD << 16) | 0xe7, 'f32x4.div'],
  [(PREFIX_SIMD << 16) | 0xe8, 'f32x4.min'],
  [(PREFIX_SIMD << 16) | 0xe9, 'f32x4.max'],
  [(PREFIX_SIMD << 16) | 0xea, 'f32x4.pmin'],
  [(PREFIX_SIMD << 16) | 0xeb, 'f32x4.pmax'],
  [(PREFIX_SIMD << 16) | 0xec, 'f64x2.abs'],
  [(PREFIX_SIMD << 16) | 0xed, 'f64x2.neg'],
  [(PREFIX_SIMD << 16) | 0xef, 'f64x2.sqrt'],
  [(PREFIX_SIMD << 16) | 0xf0, 'f64x2.add'],
  [(PREFIX_SIMD << 16) | 0xf1, 'f64x2.sub'],
  [(PREFIX_SIMD << 16) | 0xf2, 'f64x2.mul'],
  [(PREFIX_SIMD << 16) | 0xf3, 'f64x2.div'],
  [(PREFIX_SIMD << 16) | 0xf4, 'f64x2.min'],
  [(PREFIX_SIMD << 16) | 0xf5, 'f64x2.max'],
  [(PREFIX_SIMD << 16) | 0xf6, 'f64x2.pmin'],
  [(PREFIX_SIMD << 16) | 0xf7, 'f64x2.pmax'],
  [(PREFIX_SIMD << 16) | 0xf8, 'i32x4.trunc_sat_f32x4_s'],
  [(PREFIX_SIMD << 16) | 0xf9, 'i32x4.trunc_sat_f32x4_u'],
  [(PREFIX_SIMD << 16) | 0xfa, 'f32x4.convert_i32x4_s'],
  [(PREFIX_SIMD << 16) | 0xfb, 'f32x4.convert_i32x4_u'],
  [(PREFIX_SIMD << 16) | 0xfc, 'i32x4.trunc_sat_f64x2_s_zero'],
  [(PREFIX_SIMD << 16) | 0xfd, 'i32x4.trunc_sat_f64x2_u_zero'],
  [(PREFIX_SIMD << 16) | 0xfe, 'f64x2.convert_low_i32x4_s'],
  [(PREFIX_SIMD << 16) | 0xff, 'f64x2.convert_low_i32x4_u'],

  // --- 0xfe: atomics ---
  [(PREFIX_THREADS << 16) | 0x00, 'memory.atomic.notify'],
  [(PREFIX_THREADS << 16) | 0x01, 'memory.atomic.wait32'],
  [(PREFIX_THREADS << 16) | 0x02, 'memory.atomic.wait64'],
  [(PREFIX_THREADS << 16) | 0x03, 'atomic.fence'],
  [(PREFIX_THREADS << 16) | 0x10, 'i32.atomic.load'],
  [(PREFIX_THREADS << 16) | 0x11, 'i64.atomic.load'],
  [(PREFIX_THREADS << 16) | 0x12, 'i32.atomic.load8_u'],
  [(PREFIX_THREADS << 16) | 0x13, 'i32.atomic.load16_u'],
  [(PREFIX_THREADS << 16) | 0x14, 'i64.atomic.load8_u'],
  [(PREFIX_THREADS << 16) | 0x15, 'i64.atomic.load16_u'],
  [(PREFIX_THREADS << 16) | 0x16, 'i64.atomic.load32_u'],
  [(PREFIX_THREADS << 16) | 0x17, 'i32.atomic.store'],
  [(PREFIX_THREADS << 16) | 0x18, 'i64.atomic.store'],
  [(PREFIX_THREADS << 16) | 0x19, 'i32.atomic.store8'],
  [(PREFIX_THREADS << 16) | 0x1a, 'i32.atomic.store16'],
  [(PREFIX_THREADS << 16) | 0x1b, 'i64.atomic.store8'],
  [(PREFIX_THREADS << 16) | 0x1c, 'i64.atomic.store16'],
  [(PREFIX_THREADS << 16) | 0x1d, 'i64.atomic.store32'],
  [(PREFIX_THREADS << 16) | 0x1e, 'i32.atomic.rmw.add'],
  [(PREFIX_THREADS << 16) | 0x1f, 'i64.atomic.rmw.add'],
  [(PREFIX_THREADS << 16) | 0x20, 'i32.atomic.rmw8.add_u'],
  [(PREFIX_THREADS << 16) | 0x21, 'i32.atomic.rmw16.add_u'],
  [(PREFIX_THREADS << 16) | 0x22, 'i64.atomic.rmw8.add_u'],
  [(PREFIX_THREADS << 16) | 0x23, 'i64.atomic.rmw16.add_u'],
  [(PREFIX_THREADS << 16) | 0x24, 'i64.atomic.rmw32.add_u'],
  [(PREFIX_THREADS << 16) | 0x25, 'i32.atomic.rmw.sub'],
  [(PREFIX_THREADS << 16) | 0x26, 'i64.atomic.rmw.sub'],
  [(PREFIX_THREADS << 16) | 0x27, 'i32.atomic.rmw8.sub_u'],
  [(PREFIX_THREADS << 16) | 0x28, 'i32.atomic.rmw16.sub_u'],
  [(PREFIX_THREADS << 16) | 0x29, 'i64.atomic.rmw8.sub_u'],
  [(PREFIX_THREADS << 16) | 0x2a, 'i64.atomic.rmw16.sub_u'],
  [(PREFIX_THREADS << 16) | 0x2b, 'i64.atomic.rmw32.sub_u'],
  [(PREFIX_THREADS << 16) | 0x2c, 'i32.atomic.rmw.and'],
  [(PREFIX_THREADS << 16) | 0x2d, 'i64.atomic.rmw.and'],
  [(PREFIX_THREADS << 16) | 0x2e, 'i32.atomic.rmw8.and_u'],
  [(PREFIX_THREADS << 16) | 0x2f, 'i32.atomic.rmw16.and_u'],
  [(PREFIX_THREADS << 16) | 0x30, 'i64.atomic.rmw8.and_u'],
  [(PREFIX_THREADS << 16) | 0x31, 'i64.atomic.rmw16.and_u'],
  [(PREFIX_THREADS << 16) | 0x32, 'i64.atomic.rmw32.and_u'],
  [(PREFIX_THREADS << 16) | 0x33, 'i32.atomic.rmw.or'],
  [(PREFIX_THREADS << 16) | 0x34, 'i64.atomic.rmw.or'],
  [(PREFIX_THREADS << 16) | 0x35, 'i32.atomic.rmw8.or_u'],
  [(PREFIX_THREADS << 16) | 0x36, 'i32.atomic.rmw16.or_u'],
  [(PREFIX_THREADS << 16) | 0x37, 'i64.atomic.rmw8.or_u'],
  [(PREFIX_THREADS << 16) | 0x38, 'i64.atomic.rmw16.or_u'],
  [(PREFIX_THREADS << 16) | 0x39, 'i64.atomic.rmw32.or_u'],
  [(PREFIX_THREADS << 16) | 0x3a, 'i32.atomic.rmw.xor'],
  [(PREFIX_THREADS << 16) | 0x3b, 'i64.atomic.rmw.xor'],
  [(PREFIX_THREADS << 16) | 0x3c, 'i32.atomic.rmw8.xor_u'],
  [(PREFIX_THREADS << 16) | 0x3d, 'i32.atomic.rmw16.xor_u'],
  [(PREFIX_THREADS << 16) | 0x3e, 'i64.atomic.rmw8.xor_u'],
  [(PREFIX_THREADS << 16) | 0x3f, 'i64.atomic.rmw16.xor_u'],
  [(PREFIX_THREADS << 16) | 0x40, 'i64.atomic.rmw32.xor_u'],
  [(PREFIX_THREADS << 16) | 0x41, 'i32.atomic.rmw.xchg'],
  [(PREFIX_THREADS << 16) | 0x42, 'i64.atomic.rmw.xchg'],
  [(PREFIX_THREADS << 16) | 0x43, 'i32.atomic.rmw8.xchg_u'],
  [(PREFIX_THREADS << 16) | 0x44, 'i32.atomic.rmw16.xchg_u'],
  [(PREFIX_THREADS << 16) | 0x45, 'i64.atomic.rmw8.xchg_u'],
  [(PREFIX_THREADS << 16) | 0x46, 'i64.atomic.rmw16.xchg_u'],
  [(PREFIX_THREADS << 16) | 0x47, 'i64.atomic.rmw32.xchg_u'],
  [(PREFIX_THREADS << 16) | 0x48, 'i32.atomic.rmw.cmpxchg'],
  [(PREFIX_THREADS << 16) | 0x49, 'i64.atomic.rmw.cmpxchg'],
  [(PREFIX_THREADS << 16) | 0x4a, 'i32.atomic.rmw8.cmpxchg_u'],
  [(PREFIX_THREADS << 16) | 0x4b, 'i32.atomic.rmw16.cmpxchg_u'],
  [(PREFIX_THREADS << 16) | 0x4c, 'i64.atomic.rmw8.cmpxchg_u'],
  [(PREFIX_THREADS << 16) | 0x4d, 'i64.atomic.rmw16.cmpxchg_u'],
  [(PREFIX_THREADS << 16) | 0x4e, 'i64.atomic.rmw32.cmpxchg_u'],

  // GC proposal (PREFIX_GC = 0xfb)
  [(PREFIX_GC << 16) | GcOpcode.StructNew, 'struct.new'],
  [(PREFIX_GC << 16) | GcOpcode.StructNewDefault, 'struct.new_default'],
  [(PREFIX_GC << 16) | GcOpcode.StructGet, 'struct.get'],
  [(PREFIX_GC << 16) | GcOpcode.StructGetS, 'struct.get_s'],
  [(PREFIX_GC << 16) | GcOpcode.StructGetU, 'struct.get_u'],
  [(PREFIX_GC << 16) | GcOpcode.StructSet, 'struct.set'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayNew, 'array.new'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayNewDefault, 'array.new_default'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayNewFixed, 'array.new_fixed'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayNewData, 'array.new_data'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayNewElem, 'array.new_elem'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayGet, 'array.get'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayGetS, 'array.get_s'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayGetU, 'array.get_u'],
  [(PREFIX_GC << 16) | GcOpcode.ArraySet, 'array.set'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayLen, 'array.len'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayFill, 'array.fill'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayCopy, 'array.copy'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayInitData, 'array.init_data'],
  [(PREFIX_GC << 16) | GcOpcode.ArrayInitElem, 'array.init_elem'],
  [(PREFIX_GC << 16) | GcOpcode.RefTest, 'ref.test'],
  [(PREFIX_GC << 16) | GcOpcode.RefTestNullable, 'ref.test null'],
  [(PREFIX_GC << 16) | GcOpcode.RefCast, 'ref.cast'],
  [(PREFIX_GC << 16) | GcOpcode.RefCastNullable, 'ref.cast null'],
  [(PREFIX_GC << 16) | GcOpcode.BrOnCast, 'br_on_cast'],
  [(PREFIX_GC << 16) | GcOpcode.BrOnCastFail, 'br_on_cast_fail'],
  [(PREFIX_GC << 16) | GcOpcode.RefI31, 'ref.i31'],
  [(PREFIX_GC << 16) | GcOpcode.AnyConvertExtern, 'any.convert_extern'],
  [(PREFIX_GC << 16) | GcOpcode.ExternConvertAny, 'extern.convert_any'],
  [(PREFIX_GC << 16) | GcOpcode.I31GetS, 'i31.get_s'],
  [(PREFIX_GC << 16) | GcOpcode.I31GetU, 'i31.get_u'],
]);

/**
 * Returns the WAT mnemonic for an extended (prefixed) opcode.
 * The `combined` value is `(prefix << 8) | immediateIndex` as stored in Expr nodes.
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
    return OPCODE_NAMES.get(op as Opcode) ?? `<opcode:0x${op.toString(16)}>`;
  }
  return EXTENDED_OPCODE_NAMES.get(op) ?? `<opcode:0x${op.toString(16)}>`;
}

/**
 * The natural alignment in bytes for a memory-touching opcode. Used by the
 * binary writer to emit a spec-correct `memarg.align` when the IR carries
 * `align = 0` (the parser's sentinel for "no explicit `align=N` keyword").
 *
 * Returns the data width of the access — i32.store → 4, i64.load → 8,
 * v128.load → 16, i32.atomic.load → 4, etc. Atomics MUST use the natural
 * alignment per the threads proposal; non-atomic ops accept any align ≤
 * natural but binaryen's optimizer reads the field and treats a too-small
 * alignment as a hard constraint, generating worse code or refusing some
 * rewrites.
 *
 * Returns 1 for opcodes that aren't memory ops at all — callers shouldn't
 * pass those in (the binary writer only calls this for load/store-family
 * expressions), so the fallback is just defensive.
 */
export function naturalAlignForOpcode(op: number): number {
  switch (op) {
    // --- Core loads/stores (one-byte opcodes) ---
    // 1-byte access
    case 0x2c: // i32.load8_s
    case 0x2d: // i32.load8_u
    case 0x30: // i64.load8_s
    case 0x31: // i64.load8_u
    case 0x3a: // i32.store8
    case 0x3c: // i64.store8
      return 1;
    // 2-byte access
    case 0x2e: // i32.load16_s
    case 0x2f: // i32.load16_u
    case 0x32: // i64.load16_s
    case 0x33: // i64.load16_u
    case 0x3b: // i32.store16
    case 0x3d: // i64.store16
      return 2;
    // 4-byte access
    case 0x28: // i32.load
    case 0x2a: // f32.load
    case 0x34: // i64.load32_s
    case 0x35: // i64.load32_u
    case 0x36: // i32.store
    case 0x38: // f32.store
    case 0x3e: // i64.store32
      return 4;
    // 8-byte access
    case 0x29: // i64.load
    case 0x2b: // f64.load
    case 0x37: // i64.store
    case 0x39: // f64.store
      return 8;
  }
  // --- Extended opcodes (prefix << 8 | subop) ---
  switch (op) {
    // SIMD memory (0xfd-prefix)
    case (PREFIX_SIMD << 16) | 0x00: // v128.load
    case (PREFIX_SIMD << 16) | 0x0b: // v128.store
      return 16;
    case (PREFIX_SIMD << 16) | 0x01: // v128.load8x8_s
    case (PREFIX_SIMD << 16) | 0x02: // v128.load8x8_u
    case (PREFIX_SIMD << 16) | 0x03: // v128.load16x4_s
    case (PREFIX_SIMD << 16) | 0x04: // v128.load16x4_u
    case (PREFIX_SIMD << 16) | 0x05: // v128.load32x2_s
    case (PREFIX_SIMD << 16) | 0x06: // v128.load32x2_u
    case (PREFIX_SIMD << 16) | 0x0a: // v128.load64_splat
    case (PREFIX_SIMD << 16) | 0x5d: // v128.load64_zero
    case (PREFIX_SIMD << 16) | 0x57: // v128.load64_lane
    case (PREFIX_SIMD << 16) | 0x5b: // v128.store64_lane
      return 8;
    case (PREFIX_SIMD << 16) | 0x09: // v128.load32_splat
    case (PREFIX_SIMD << 16) | 0x5c: // v128.load32_zero
    case (PREFIX_SIMD << 16) | 0x56: // v128.load32_lane
    case (PREFIX_SIMD << 16) | 0x5a: // v128.store32_lane
      return 4;
    case (PREFIX_SIMD << 16) | 0x08: // v128.load16_splat
    case (PREFIX_SIMD << 16) | 0x55: // v128.load16_lane
    case (PREFIX_SIMD << 16) | 0x59: // v128.store16_lane
      return 2;
    case (PREFIX_SIMD << 16) | 0x07: // v128.load8_splat
    case (PREFIX_SIMD << 16) | 0x54: // v128.load8_lane
    case (PREFIX_SIMD << 16) | 0x58: // v128.store8_lane
      return 1;

    // Atomics (0xfe-prefix). The threads proposal requires natural alignment
    // for all atomic memory ops — any other value is a validation error.
    case (PREFIX_THREADS << 16) | 0x00: // memory.atomic.notify
    case (PREFIX_THREADS << 16) | 0x01: // memory.atomic.wait32
    case (PREFIX_THREADS << 16) | 0x10: // i32.atomic.load
    case (PREFIX_THREADS << 16) | 0x16: // i64.atomic.load32_u
    case (PREFIX_THREADS << 16) | 0x17: // i32.atomic.store
    case (PREFIX_THREADS << 16) | 0x1d: // i64.atomic.store32
    case (PREFIX_THREADS << 16) | 0x1e: // i32.atomic.rmw.add
    case (PREFIX_THREADS << 16) | 0x24: // i64.atomic.rmw32.add_u
    case (PREFIX_THREADS << 16) | 0x25: // i32.atomic.rmw.sub
    case (PREFIX_THREADS << 16) | 0x2b: // i64.atomic.rmw32.sub_u
    case (PREFIX_THREADS << 16) | 0x2c: // i32.atomic.rmw.and
    case (PREFIX_THREADS << 16) | 0x32: // i64.atomic.rmw32.and_u
    case (PREFIX_THREADS << 16) | 0x33: // i32.atomic.rmw.or
    case (PREFIX_THREADS << 16) | 0x39: // i64.atomic.rmw32.or_u
    case (PREFIX_THREADS << 16) | 0x3a: // i32.atomic.rmw.xor
    case (PREFIX_THREADS << 16) | 0x40: // i64.atomic.rmw32.xor_u
    case (PREFIX_THREADS << 16) | 0x41: // i32.atomic.rmw.xchg
    case (PREFIX_THREADS << 16) | 0x47: // i64.atomic.rmw32.xchg_u
    case (PREFIX_THREADS << 16) | 0x48: // i32.atomic.rmw.cmpxchg
    case (PREFIX_THREADS << 16) | 0x4e: // i64.atomic.rmw32.cmpxchg_u
      return 4;
    case (PREFIX_THREADS << 16) | 0x02: // memory.atomic.wait64
    case (PREFIX_THREADS << 16) | 0x11: // i64.atomic.load
    case (PREFIX_THREADS << 16) | 0x18: // i64.atomic.store
    case (PREFIX_THREADS << 16) | 0x1f: // i64.atomic.rmw.add
    case (PREFIX_THREADS << 16) | 0x26: // i64.atomic.rmw.sub
    case (PREFIX_THREADS << 16) | 0x2d: // i64.atomic.rmw.and
    case (PREFIX_THREADS << 16) | 0x34: // i64.atomic.rmw.or
    case (PREFIX_THREADS << 16) | 0x3b: // i64.atomic.rmw.xor
    case (PREFIX_THREADS << 16) | 0x42: // i64.atomic.rmw.xchg
    case (PREFIX_THREADS << 16) | 0x49: // i64.atomic.rmw.cmpxchg
      return 8;
    case (PREFIX_THREADS << 16) | 0x13: // i32.atomic.load16_u
    case (PREFIX_THREADS << 16) | 0x15: // i64.atomic.load16_u
    case (PREFIX_THREADS << 16) | 0x1a: // i32.atomic.store16
    case (PREFIX_THREADS << 16) | 0x1c: // i64.atomic.store16
    case (PREFIX_THREADS << 16) | 0x21: // i32.atomic.rmw16.add_u
    case (PREFIX_THREADS << 16) | 0x23: // i64.atomic.rmw16.add_u
    case (PREFIX_THREADS << 16) | 0x28: // i32.atomic.rmw16.sub_u
    case (PREFIX_THREADS << 16) | 0x2a: // i64.atomic.rmw16.sub_u
    case (PREFIX_THREADS << 16) | 0x2f: // i32.atomic.rmw16.and_u
    case (PREFIX_THREADS << 16) | 0x31: // i64.atomic.rmw16.and_u
    case (PREFIX_THREADS << 16) | 0x36: // i32.atomic.rmw16.or_u
    case (PREFIX_THREADS << 16) | 0x38: // i64.atomic.rmw16.or_u
    case (PREFIX_THREADS << 16) | 0x3d: // i32.atomic.rmw16.xor_u
    case (PREFIX_THREADS << 16) | 0x3f: // i64.atomic.rmw16.xor_u
    case (PREFIX_THREADS << 16) | 0x44: // i32.atomic.rmw16.xchg_u
    case (PREFIX_THREADS << 16) | 0x46: // i64.atomic.rmw16.xchg_u
    case (PREFIX_THREADS << 16) | 0x4b: // i32.atomic.rmw16.cmpxchg_u
    case (PREFIX_THREADS << 16) | 0x4d: // i64.atomic.rmw16.cmpxchg_u
      return 2;
    case (PREFIX_THREADS << 16) | 0x12: // i32.atomic.load8_u
    case (PREFIX_THREADS << 16) | 0x14: // i64.atomic.load8_u
    case (PREFIX_THREADS << 16) | 0x19: // i32.atomic.store8
    case (PREFIX_THREADS << 16) | 0x1b: // i64.atomic.store8
    case (PREFIX_THREADS << 16) | 0x20: // i32.atomic.rmw8.add_u
    case (PREFIX_THREADS << 16) | 0x22: // i64.atomic.rmw8.add_u
    case (PREFIX_THREADS << 16) | 0x27: // i32.atomic.rmw8.sub_u
    case (PREFIX_THREADS << 16) | 0x29: // i64.atomic.rmw8.sub_u
    case (PREFIX_THREADS << 16) | 0x2e: // i32.atomic.rmw8.and_u
    case (PREFIX_THREADS << 16) | 0x30: // i64.atomic.rmw8.and_u
    case (PREFIX_THREADS << 16) | 0x35: // i32.atomic.rmw8.or_u
    case (PREFIX_THREADS << 16) | 0x37: // i64.atomic.rmw8.or_u
    case (PREFIX_THREADS << 16) | 0x3c: // i32.atomic.rmw8.xor_u
    case (PREFIX_THREADS << 16) | 0x3e: // i64.atomic.rmw8.xor_u
    case (PREFIX_THREADS << 16) | 0x43: // i32.atomic.rmw8.xchg_u
    case (PREFIX_THREADS << 16) | 0x45: // i64.atomic.rmw8.xchg_u
    case (PREFIX_THREADS << 16) | 0x4a: // i32.atomic.rmw8.cmpxchg_u
    case (PREFIX_THREADS << 16) | 0x4c: // i64.atomic.rmw8.cmpxchg_u
      return 1;
  }
  return 1; // unknown opcode — defensive default
}
