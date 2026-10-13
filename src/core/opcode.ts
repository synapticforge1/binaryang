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

import { OPCODE_DEFINITIONS } from '../definitions/data.ts';
import type { InstrCode } from '../definitions/instr-code.ts';

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
export const Opcode = {
  Unreachable: 0x00,
  Nop: 0x01,
  Block: 0x02,
  Loop: 0x03,
  If: 0x04,
  Else: 0x05,
  Try: 0x06,
  Catch: 0x07,
  Throw: 0x08,
  Rethrow: 0x09,
  ThrowRef: 0x0a,
  End: 0x0b,
  Br: 0x0c,
  BrIf: 0x0d,
  BrTable: 0x0e,
  Return: 0x0f,
  Call: 0x10,
  CallIndirect: 0x11,
  ReturnCall: 0x12,
  ReturnCallIndirect: 0x13,
  CallRef: 0x14,
  ReturnCallRef: 0x15,
  Delegate: 0x18,
  CatchAll: 0x19,
  Drop: 0x1a,
  Select: 0x1b,
  SelectT: 0x1c,
  TryTable: 0x1f,
  LocalGet: 0x20,
  LocalSet: 0x21,
  LocalTee: 0x22,
  GlobalGet: 0x23,
  GlobalSet: 0x24,
  TableGet: 0x25,
  TableSet: 0x26,
  // Memory load instructions (0x28–0x3e)
  I32Load: 0x28,
  I64Load: 0x29,
  F32Load: 0x2a,
  F64Load: 0x2b,
  I32Load8S: 0x2c,
  I32Load8U: 0x2d,
  I32Load16S: 0x2e,
  I32Load16U: 0x2f,
  I64Load8S: 0x30,
  I64Load8U: 0x31,
  I64Load16S: 0x32,
  I64Load16U: 0x33,
  I64Load32S: 0x34,
  I64Load32U: 0x35,
  I32Store: 0x36,
  I64Store: 0x37,
  F32Store: 0x38,
  F64Store: 0x39,
  I32Store8: 0x3a,
  I32Store16: 0x3b,
  I64Store8: 0x3c,
  I64Store16: 0x3d,
  I64Store32: 0x3e,
  MemorySize: 0x3f,
  MemoryGrow: 0x40,
  // Constant instructions
  I32Const: 0x41,
  I64Const: 0x42,
  F32Const: 0x43,
  F64Const: 0x44,
  // i32 comparison
  I32Eqz: 0x45,
  I32Eq: 0x46,
  I32Ne: 0x47,
  I32LtS: 0x48,
  I32LtU: 0x49,
  I32GtS: 0x4a,
  I32GtU: 0x4b,
  I32LeS: 0x4c,
  I32LeU: 0x4d,
  I32GeS: 0x4e,
  I32GeU: 0x4f,
  // i64 comparison
  I64Eqz: 0x50,
  I64Eq: 0x51,
  I64Ne: 0x52,
  I64LtS: 0x53,
  I64LtU: 0x54,
  I64GtS: 0x55,
  I64GtU: 0x56,
  I64LeS: 0x57,
  I64LeU: 0x58,
  I64GeS: 0x59,
  I64GeU: 0x5a,
  // f32 comparison
  F32Eq: 0x5b,
  F32Ne: 0x5c,
  F32Lt: 0x5d,
  F32Gt: 0x5e,
  F32Le: 0x5f,
  F32Ge: 0x60,
  // f64 comparison
  F64Eq: 0x61,
  F64Ne: 0x62,
  F64Lt: 0x63,
  F64Gt: 0x64,
  F64Le: 0x65,
  F64Ge: 0x66,
  // i32 arithmetic
  I32Clz: 0x67,
  I32Ctz: 0x68,
  I32Popcnt: 0x69,
  I32Add: 0x6a,
  I32Sub: 0x6b,
  I32Mul: 0x6c,
  I32DivS: 0x6d,
  I32DivU: 0x6e,
  I32RemS: 0x6f,
  I32RemU: 0x70,
  I32And: 0x71,
  I32Or: 0x72,
  I32Xor: 0x73,
  I32Shl: 0x74,
  I32ShrS: 0x75,
  I32ShrU: 0x76,
  I32Rotl: 0x77,
  I32Rotr: 0x78,
  // i64 arithmetic
  I64Clz: 0x79,
  I64Ctz: 0x7a,
  I64Popcnt: 0x7b,
  I64Add: 0x7c,
  I64Sub: 0x7d,
  I64Mul: 0x7e,
  I64DivS: 0x7f,
  I64DivU: 0x80,
  I64RemS: 0x81,
  I64RemU: 0x82,
  I64And: 0x83,
  I64Or: 0x84,
  I64Xor: 0x85,
  I64Shl: 0x86,
  I64ShrS: 0x87,
  I64ShrU: 0x88,
  I64Rotl: 0x89,
  I64Rotr: 0x8a,
  // f32 arithmetic
  F32Abs: 0x8b,
  F32Neg: 0x8c,
  F32Ceil: 0x8d,
  F32Floor: 0x8e,
  F32Trunc: 0x8f,
  F32Nearest: 0x90,
  F32Sqrt: 0x91,
  F32Add: 0x92,
  F32Sub: 0x93,
  F32Mul: 0x94,
  F32Div: 0x95,
  F32Min: 0x96,
  F32Max: 0x97,
  F32Copysign: 0x98,
  // f64 arithmetic
  F64Abs: 0x99,
  F64Neg: 0x9a,
  F64Ceil: 0x9b,
  F64Floor: 0x9c,
  F64Trunc: 0x9d,
  F64Nearest: 0x9e,
  F64Sqrt: 0x9f,
  F64Add: 0xa0,
  F64Sub: 0xa1,
  F64Mul: 0xa2,
  F64Div: 0xa3,
  F64Min: 0xa4,
  F64Max: 0xa5,
  F64Copysign: 0xa6,
  // Conversion instructions
  I32WrapI64: 0xa7,
  I32TruncF32S: 0xa8,
  I32TruncF32U: 0xa9,
  I32TruncF64S: 0xaa,
  I32TruncF64U: 0xab,
  I64ExtendI32S: 0xac,
  I64ExtendI32U: 0xad,
  I64TruncF32S: 0xae,
  I64TruncF32U: 0xaf,
  I64TruncF64S: 0xb0,
  I64TruncF64U: 0xb1,
  F32ConvertI32S: 0xb2,
  F32ConvertI32U: 0xb3,
  F32ConvertI64S: 0xb4,
  F32ConvertI64U: 0xb5,
  F32DemoteF64: 0xb6,
  F64ConvertI32S: 0xb7,
  F64ConvertI32U: 0xb8,
  F64ConvertI64S: 0xb9,
  F64ConvertI64U: 0xba,
  F64PromoteF32: 0xbb,
  I32ReinterpretF32: 0xbc,
  I64ReinterpretF64: 0xbd,
  F32ReinterpretI32: 0xbe,
  F64ReinterpretI64: 0xbf,
  // Sign-extension (sign-extension-ops proposal, now in spec)
  I32Extend8S: 0xc0,
  I32Extend16S: 0xc1,
  I64Extend8S: 0xc2,
  I64Extend16S: 0xc3,
  I64Extend32S: 0xc4,
  // GC reference instructions (0xd0–0xd6)
  RefNull: 0xd0,
  RefIsNull: 0xd1,
  RefFunc: 0xd2,
  RefEq: 0xd3,
  RefAsNonNull: 0xd4,
  BrOnNull: 0xd5,
  BrOnNonNull: 0xd6,
} as const;
/**
 * An opcode NUMBER, in any of this codebase's encodings: a single-byte opcode (every member of
 * {@link Opcode}), or the IR's combined `(prefix << 16) | sub` for a prefixed instruction (the
 * operator tables in `ir/expressions.ts`). Deliberately `number`, not the union of `Opcode`'s
 * members: as a numeric `enum`, `Opcode` accepted any number, and the IR's ~20 `opcode` fields,
 * its operator types (`UnaryOp = Opcode`, …) and `loadShape` / `storeShape` rely on that for
 * prefixed values, which are not members. Narrowing it is a separate change: open-work 28 part
 * 4, 2026-10-12, when the enums became const objects. Each member is still an exact type
 * (`Opcode.I32Add`).
 */
export type Opcode = InstrCode;
/** Each member as a type (`Opcode.Unreachable`), as when Opcode was an `enum`. */
export declare namespace Opcode {
  type Unreachable = typeof Opcode.Unreachable;
  type Nop = typeof Opcode.Nop;
  type Block = typeof Opcode.Block;
  type Loop = typeof Opcode.Loop;
  type If = typeof Opcode.If;
  type Else = typeof Opcode.Else;
  type Try = typeof Opcode.Try;
  type Catch = typeof Opcode.Catch;
  type Throw = typeof Opcode.Throw;
  type Rethrow = typeof Opcode.Rethrow;
  type ThrowRef = typeof Opcode.ThrowRef;
  type End = typeof Opcode.End;
  type Br = typeof Opcode.Br;
  type BrIf = typeof Opcode.BrIf;
  type BrTable = typeof Opcode.BrTable;
  type Return = typeof Opcode.Return;
  type Call = typeof Opcode.Call;
  type CallIndirect = typeof Opcode.CallIndirect;
  type ReturnCall = typeof Opcode.ReturnCall;
  type ReturnCallIndirect = typeof Opcode.ReturnCallIndirect;
  type CallRef = typeof Opcode.CallRef;
  type ReturnCallRef = typeof Opcode.ReturnCallRef;
  type Delegate = typeof Opcode.Delegate;
  type CatchAll = typeof Opcode.CatchAll;
  type Drop = typeof Opcode.Drop;
  type Select = typeof Opcode.Select;
  type SelectT = typeof Opcode.SelectT;
  type TryTable = typeof Opcode.TryTable;
  type LocalGet = typeof Opcode.LocalGet;
  type LocalSet = typeof Opcode.LocalSet;
  type LocalTee = typeof Opcode.LocalTee;
  type GlobalGet = typeof Opcode.GlobalGet;
  type GlobalSet = typeof Opcode.GlobalSet;
  type TableGet = typeof Opcode.TableGet;
  type TableSet = typeof Opcode.TableSet;
  type I32Load = typeof Opcode.I32Load;
  type I64Load = typeof Opcode.I64Load;
  type F32Load = typeof Opcode.F32Load;
  type F64Load = typeof Opcode.F64Load;
  type I32Load8S = typeof Opcode.I32Load8S;
  type I32Load8U = typeof Opcode.I32Load8U;
  type I32Load16S = typeof Opcode.I32Load16S;
  type I32Load16U = typeof Opcode.I32Load16U;
  type I64Load8S = typeof Opcode.I64Load8S;
  type I64Load8U = typeof Opcode.I64Load8U;
  type I64Load16S = typeof Opcode.I64Load16S;
  type I64Load16U = typeof Opcode.I64Load16U;
  type I64Load32S = typeof Opcode.I64Load32S;
  type I64Load32U = typeof Opcode.I64Load32U;
  type I32Store = typeof Opcode.I32Store;
  type I64Store = typeof Opcode.I64Store;
  type F32Store = typeof Opcode.F32Store;
  type F64Store = typeof Opcode.F64Store;
  type I32Store8 = typeof Opcode.I32Store8;
  type I32Store16 = typeof Opcode.I32Store16;
  type I64Store8 = typeof Opcode.I64Store8;
  type I64Store16 = typeof Opcode.I64Store16;
  type I64Store32 = typeof Opcode.I64Store32;
  type MemorySize = typeof Opcode.MemorySize;
  type MemoryGrow = typeof Opcode.MemoryGrow;
  type I32Const = typeof Opcode.I32Const;
  type I64Const = typeof Opcode.I64Const;
  type F32Const = typeof Opcode.F32Const;
  type F64Const = typeof Opcode.F64Const;
  type I32Eqz = typeof Opcode.I32Eqz;
  type I32Eq = typeof Opcode.I32Eq;
  type I32Ne = typeof Opcode.I32Ne;
  type I32LtS = typeof Opcode.I32LtS;
  type I32LtU = typeof Opcode.I32LtU;
  type I32GtS = typeof Opcode.I32GtS;
  type I32GtU = typeof Opcode.I32GtU;
  type I32LeS = typeof Opcode.I32LeS;
  type I32LeU = typeof Opcode.I32LeU;
  type I32GeS = typeof Opcode.I32GeS;
  type I32GeU = typeof Opcode.I32GeU;
  type I64Eqz = typeof Opcode.I64Eqz;
  type I64Eq = typeof Opcode.I64Eq;
  type I64Ne = typeof Opcode.I64Ne;
  type I64LtS = typeof Opcode.I64LtS;
  type I64LtU = typeof Opcode.I64LtU;
  type I64GtS = typeof Opcode.I64GtS;
  type I64GtU = typeof Opcode.I64GtU;
  type I64LeS = typeof Opcode.I64LeS;
  type I64LeU = typeof Opcode.I64LeU;
  type I64GeS = typeof Opcode.I64GeS;
  type I64GeU = typeof Opcode.I64GeU;
  type F32Eq = typeof Opcode.F32Eq;
  type F32Ne = typeof Opcode.F32Ne;
  type F32Lt = typeof Opcode.F32Lt;
  type F32Gt = typeof Opcode.F32Gt;
  type F32Le = typeof Opcode.F32Le;
  type F32Ge = typeof Opcode.F32Ge;
  type F64Eq = typeof Opcode.F64Eq;
  type F64Ne = typeof Opcode.F64Ne;
  type F64Lt = typeof Opcode.F64Lt;
  type F64Gt = typeof Opcode.F64Gt;
  type F64Le = typeof Opcode.F64Le;
  type F64Ge = typeof Opcode.F64Ge;
  type I32Clz = typeof Opcode.I32Clz;
  type I32Ctz = typeof Opcode.I32Ctz;
  type I32Popcnt = typeof Opcode.I32Popcnt;
  type I32Add = typeof Opcode.I32Add;
  type I32Sub = typeof Opcode.I32Sub;
  type I32Mul = typeof Opcode.I32Mul;
  type I32DivS = typeof Opcode.I32DivS;
  type I32DivU = typeof Opcode.I32DivU;
  type I32RemS = typeof Opcode.I32RemS;
  type I32RemU = typeof Opcode.I32RemU;
  type I32And = typeof Opcode.I32And;
  type I32Or = typeof Opcode.I32Or;
  type I32Xor = typeof Opcode.I32Xor;
  type I32Shl = typeof Opcode.I32Shl;
  type I32ShrS = typeof Opcode.I32ShrS;
  type I32ShrU = typeof Opcode.I32ShrU;
  type I32Rotl = typeof Opcode.I32Rotl;
  type I32Rotr = typeof Opcode.I32Rotr;
  type I64Clz = typeof Opcode.I64Clz;
  type I64Ctz = typeof Opcode.I64Ctz;
  type I64Popcnt = typeof Opcode.I64Popcnt;
  type I64Add = typeof Opcode.I64Add;
  type I64Sub = typeof Opcode.I64Sub;
  type I64Mul = typeof Opcode.I64Mul;
  type I64DivS = typeof Opcode.I64DivS;
  type I64DivU = typeof Opcode.I64DivU;
  type I64RemS = typeof Opcode.I64RemS;
  type I64RemU = typeof Opcode.I64RemU;
  type I64And = typeof Opcode.I64And;
  type I64Or = typeof Opcode.I64Or;
  type I64Xor = typeof Opcode.I64Xor;
  type I64Shl = typeof Opcode.I64Shl;
  type I64ShrS = typeof Opcode.I64ShrS;
  type I64ShrU = typeof Opcode.I64ShrU;
  type I64Rotl = typeof Opcode.I64Rotl;
  type I64Rotr = typeof Opcode.I64Rotr;
  type F32Abs = typeof Opcode.F32Abs;
  type F32Neg = typeof Opcode.F32Neg;
  type F32Ceil = typeof Opcode.F32Ceil;
  type F32Floor = typeof Opcode.F32Floor;
  type F32Trunc = typeof Opcode.F32Trunc;
  type F32Nearest = typeof Opcode.F32Nearest;
  type F32Sqrt = typeof Opcode.F32Sqrt;
  type F32Add = typeof Opcode.F32Add;
  type F32Sub = typeof Opcode.F32Sub;
  type F32Mul = typeof Opcode.F32Mul;
  type F32Div = typeof Opcode.F32Div;
  type F32Min = typeof Opcode.F32Min;
  type F32Max = typeof Opcode.F32Max;
  type F32Copysign = typeof Opcode.F32Copysign;
  type F64Abs = typeof Opcode.F64Abs;
  type F64Neg = typeof Opcode.F64Neg;
  type F64Ceil = typeof Opcode.F64Ceil;
  type F64Floor = typeof Opcode.F64Floor;
  type F64Trunc = typeof Opcode.F64Trunc;
  type F64Nearest = typeof Opcode.F64Nearest;
  type F64Sqrt = typeof Opcode.F64Sqrt;
  type F64Add = typeof Opcode.F64Add;
  type F64Sub = typeof Opcode.F64Sub;
  type F64Mul = typeof Opcode.F64Mul;
  type F64Div = typeof Opcode.F64Div;
  type F64Min = typeof Opcode.F64Min;
  type F64Max = typeof Opcode.F64Max;
  type F64Copysign = typeof Opcode.F64Copysign;
  type I32WrapI64 = typeof Opcode.I32WrapI64;
  type I32TruncF32S = typeof Opcode.I32TruncF32S;
  type I32TruncF32U = typeof Opcode.I32TruncF32U;
  type I32TruncF64S = typeof Opcode.I32TruncF64S;
  type I32TruncF64U = typeof Opcode.I32TruncF64U;
  type I64ExtendI32S = typeof Opcode.I64ExtendI32S;
  type I64ExtendI32U = typeof Opcode.I64ExtendI32U;
  type I64TruncF32S = typeof Opcode.I64TruncF32S;
  type I64TruncF32U = typeof Opcode.I64TruncF32U;
  type I64TruncF64S = typeof Opcode.I64TruncF64S;
  type I64TruncF64U = typeof Opcode.I64TruncF64U;
  type F32ConvertI32S = typeof Opcode.F32ConvertI32S;
  type F32ConvertI32U = typeof Opcode.F32ConvertI32U;
  type F32ConvertI64S = typeof Opcode.F32ConvertI64S;
  type F32ConvertI64U = typeof Opcode.F32ConvertI64U;
  type F32DemoteF64 = typeof Opcode.F32DemoteF64;
  type F64ConvertI32S = typeof Opcode.F64ConvertI32S;
  type F64ConvertI32U = typeof Opcode.F64ConvertI32U;
  type F64ConvertI64S = typeof Opcode.F64ConvertI64S;
  type F64ConvertI64U = typeof Opcode.F64ConvertI64U;
  type F64PromoteF32 = typeof Opcode.F64PromoteF32;
  type I32ReinterpretF32 = typeof Opcode.I32ReinterpretF32;
  type I64ReinterpretF64 = typeof Opcode.I64ReinterpretF64;
  type F32ReinterpretI32 = typeof Opcode.F32ReinterpretI32;
  type F64ReinterpretI64 = typeof Opcode.F64ReinterpretI64;
  type I32Extend8S = typeof Opcode.I32Extend8S;
  type I32Extend16S = typeof Opcode.I32Extend16S;
  type I64Extend8S = typeof Opcode.I64Extend8S;
  type I64Extend16S = typeof Opcode.I64Extend16S;
  type I64Extend32S = typeof Opcode.I64Extend32S;
  type RefNull = typeof Opcode.RefNull;
  type RefIsNull = typeof Opcode.RefIsNull;
  type RefFunc = typeof Opcode.RefFunc;
  type RefEq = typeof Opcode.RefEq;
  type RefAsNonNull = typeof Opcode.RefAsNonNull;
  type BrOnNull = typeof Opcode.BrOnNull;
  type BrOnNonNull = typeof Opcode.BrOnNonNull;
}

// ---------------------------------------------------------------------------
// Misc / numeric extension opcodes (PREFIX_MISC = 0xfc group)
// ---------------------------------------------------------------------------

/**
 * Opcodes in the `0xfc` prefix group (saturating trunc, bulk memory, table ops).
 * Each value is the LEB128 immediate following the `0xfc` prefix byte.
 */
export const MiscOpcode = {
  I32TruncSatF32S: 0,
  I32TruncSatF32U: 1,
  I32TruncSatF64S: 2,
  I32TruncSatF64U: 3,
  I64TruncSatF32S: 4,
  I64TruncSatF32U: 5,
  I64TruncSatF64S: 6,
  I64TruncSatF64U: 7,
  MemoryInit: 8,
  DataDrop: 9,
  MemoryCopy: 10,
  MemoryFill: 11,
  TableInit: 12,
  ElemDrop: 13,
  TableCopy: 14,
  TableGrow: 15,
  TableSize: 16,
  TableFill: 17,
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
  I64Add128: 19,
  I64Sub128: 20,
  I64MulWideS: 21,
  I64MulWideU: 22,
} as const;
/** One of {@link MiscOpcode}'s values. */
export type MiscOpcode = (typeof MiscOpcode)[keyof typeof MiscOpcode];
/** Each member as a type (`MiscOpcode.I32TruncSatF32S`), as when MiscOpcode was an `enum`. */
export declare namespace MiscOpcode {
  type I32TruncSatF32S = typeof MiscOpcode.I32TruncSatF32S;
  type I32TruncSatF32U = typeof MiscOpcode.I32TruncSatF32U;
  type I32TruncSatF64S = typeof MiscOpcode.I32TruncSatF64S;
  type I32TruncSatF64U = typeof MiscOpcode.I32TruncSatF64U;
  type I64TruncSatF32S = typeof MiscOpcode.I64TruncSatF32S;
  type I64TruncSatF32U = typeof MiscOpcode.I64TruncSatF32U;
  type I64TruncSatF64S = typeof MiscOpcode.I64TruncSatF64S;
  type I64TruncSatF64U = typeof MiscOpcode.I64TruncSatF64U;
  type MemoryInit = typeof MiscOpcode.MemoryInit;
  type DataDrop = typeof MiscOpcode.DataDrop;
  type MemoryCopy = typeof MiscOpcode.MemoryCopy;
  type MemoryFill = typeof MiscOpcode.MemoryFill;
  type TableInit = typeof MiscOpcode.TableInit;
  type ElemDrop = typeof MiscOpcode.ElemDrop;
  type TableCopy = typeof MiscOpcode.TableCopy;
  type TableGrow = typeof MiscOpcode.TableGrow;
  type TableSize = typeof MiscOpcode.TableSize;
  type TableFill = typeof MiscOpcode.TableFill;
  type I64Add128 = typeof MiscOpcode.I64Add128;
  type I64Sub128 = typeof MiscOpcode.I64Sub128;
  type I64MulWideS = typeof MiscOpcode.I64MulWideS;
  type I64MulWideU = typeof MiscOpcode.I64MulWideU;
}

// ---------------------------------------------------------------------------
// GC opcodes (PREFIX_GC = 0xfb group)
// ---------------------------------------------------------------------------

/**
 * Opcodes in the `0xfb` prefix group (GC proposal: struct/array/i31/ref.test).
 * Each value is the LEB128 immediate following the `0xfb` prefix byte.
 */
export const GcOpcode = {
  StructNew: 0x00,
  StructNewDefault: 0x01,
  StructGet: 0x02,
  StructGetS: 0x03,
  StructGetU: 0x04,
  StructSet: 0x05,
  ArrayNew: 0x06,
  ArrayNewDefault: 0x07,
  ArrayNewFixed: 0x08,
  ArrayNewData: 0x09,
  ArrayNewElem: 0x0a,
  ArrayGet: 0x0b,
  ArrayGetS: 0x0c,
  ArrayGetU: 0x0d,
  ArraySet: 0x0e,
  ArrayLen: 0x0f,
  ArrayFill: 0x10,
  ArrayCopy: 0x11,
  ArrayInitData: 0x12,
  ArrayInitElem: 0x13,
  RefTest: 0x14,
  RefTestNullable: 0x15,
  RefCast: 0x16,
  RefCastNullable: 0x17,
  BrOnCast: 0x18,
  BrOnCastFail: 0x19,
  AnyConvertExtern: 0x1a,
  ExternConvertAny: 0x1b,
  RefI31: 0x1c,
  I31GetS: 0x1d,
  I31GetU: 0x1e,
  // Custom descriptors proposal.
  StructNewDesc: 0x20,
  StructNewDefaultDesc: 0x21,
  RefGetDesc: 0x22,
  RefCastDescEq: 0x23,
  RefCastDescEqNullable: 0x24,
  BrOnCastDescEq: 0x25,
  BrOnCastDescEqFail: 0x26,
} as const;
/** One of {@link GcOpcode}'s values. */
export type GcOpcode = (typeof GcOpcode)[keyof typeof GcOpcode];
/** Each member as a type (`GcOpcode.StructNew`), as when GcOpcode was an `enum`. */
export declare namespace GcOpcode {
  type StructNew = typeof GcOpcode.StructNew;
  type StructNewDefault = typeof GcOpcode.StructNewDefault;
  type StructGet = typeof GcOpcode.StructGet;
  type StructGetS = typeof GcOpcode.StructGetS;
  type StructGetU = typeof GcOpcode.StructGetU;
  type StructSet = typeof GcOpcode.StructSet;
  type ArrayNew = typeof GcOpcode.ArrayNew;
  type ArrayNewDefault = typeof GcOpcode.ArrayNewDefault;
  type ArrayNewFixed = typeof GcOpcode.ArrayNewFixed;
  type ArrayNewData = typeof GcOpcode.ArrayNewData;
  type ArrayNewElem = typeof GcOpcode.ArrayNewElem;
  type ArrayGet = typeof GcOpcode.ArrayGet;
  type ArrayGetS = typeof GcOpcode.ArrayGetS;
  type ArrayGetU = typeof GcOpcode.ArrayGetU;
  type ArraySet = typeof GcOpcode.ArraySet;
  type ArrayLen = typeof GcOpcode.ArrayLen;
  type ArrayFill = typeof GcOpcode.ArrayFill;
  type ArrayCopy = typeof GcOpcode.ArrayCopy;
  type ArrayInitData = typeof GcOpcode.ArrayInitData;
  type ArrayInitElem = typeof GcOpcode.ArrayInitElem;
  type RefTest = typeof GcOpcode.RefTest;
  type RefTestNullable = typeof GcOpcode.RefTestNullable;
  type RefCast = typeof GcOpcode.RefCast;
  type RefCastNullable = typeof GcOpcode.RefCastNullable;
  type BrOnCast = typeof GcOpcode.BrOnCast;
  type BrOnCastFail = typeof GcOpcode.BrOnCastFail;
  type AnyConvertExtern = typeof GcOpcode.AnyConvertExtern;
  type ExternConvertAny = typeof GcOpcode.ExternConvertAny;
  type RefI31 = typeof GcOpcode.RefI31;
  type I31GetS = typeof GcOpcode.I31GetS;
  type I31GetU = typeof GcOpcode.I31GetU;
  type StructNewDesc = typeof GcOpcode.StructNewDesc;
  type StructNewDefaultDesc = typeof GcOpcode.StructNewDefaultDesc;
  type RefGetDesc = typeof GcOpcode.RefGetDesc;
  type RefCastDescEq = typeof GcOpcode.RefCastDescEq;
  type RefCastDescEqNullable = typeof GcOpcode.RefCastDescEqNullable;
  type BrOnCastDescEq = typeof GcOpcode.BrOnCastDescEq;
  type BrOnCastDescEqFail = typeof GcOpcode.BrOnCastDescEqFail;
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
export const OPCODE_I8X16_SHUFFLE: Opcode = 0xfd000d;

/** `v128.load` — the 16-byte plain SIMD load, `0xFD 0x00`. */
export const OPCODE_V128_LOAD: Opcode = 0xfd0000;

/** `v128.store` — the 16-byte plain SIMD store, `0xFD 0x0B`. */
export const OPCODE_V128_STORE: Opcode = 0xfd000b;

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
