/**
 * @module binaryen-ts/ir/expressions
 *
 * WebAssembly expression (instruction) node types for the binaryen-ts IR.
 *
 * Every node in the IR tree is one of the discriminated-union variants below,
 * each with a unique `kind` field. This mirrors the `ExpressionId` enum and
 * per-expression structs in the upstream Binaryen C++ source (`src/wasm.h`).
 *
 * **Tree invariant** (inherited from Binaryen): each node must have exactly
 * one parent. Never share expression nodes between positions in the tree.
 *
 * @example
 * ```ts
 * import { makeBinary, makeI32Const, makeLocalGet } from "@jrmarcum/binaryang/ir/binaryen-ts";
 *
 * const expr = makeBinary(
 *   BinaryOp.AddI32,
 *   makeLocalGet(0, ValType.I32),
 *   makeI32Const(1),
 * );
 * ```
 *
 * @license MIT
 */

// The FIRST cross-half import: binaryen-ts depends on wabt-ts's opcode table.
// Deliberate, and the direction of travel -- S6 stage 1 made the numeric opcode
// the operator representation for both halves, and core/opcode.ts is a leaf
// module holding the wire format, the one fact neither half gets its own copy of.
import { anyOpcodeName, type Opcode } from '../../wabt-ts/core/opcode.ts';
import { indexOf, type Var, varIndex } from '../../wabt-ts/ir/ir.ts';
import type { Location } from '../../wabt-ts/core/error.ts';
import { None, type TupleType, type Type, Unreachable, ValType } from './types.ts';
import type { HeapType, ValueType } from './gc-types.ts';
export type { HeapType, RefType, ValueType } from './gc-types.ts';

// ---------------------------------------------------------------------------
// Expression kind discriminant
// ---------------------------------------------------------------------------

/**
 * Discriminant tag for every expression variant.
 * Mirrors `BinaryenExpressionId` / `ExpressionId` in Binaryen.
 */
export enum ExpressionKind {
  // Control flow
  Nop = 'nop',
  Block = 'block',
  If = 'if',
  Loop = 'loop',
  Break = 'br',
  Switch = 'br_table',
  Return = 'return',
  Unreachable = 'unreachable',
  // Locals / globals
  LocalGet = 'local.get',
  LocalSet = 'local.set',
  LocalTee = 'local.tee',
  GlobalGet = 'global.get',
  GlobalSet = 'global.set',
  // Constants
  Const = 'const',
  // Arithmetic / logic
  Unary = 'unary',
  Binary = 'binary',
  Select = 'select',
  Drop = 'drop',
  // Memory
  Load = 'load',
  Store = 'store',
  MemorySize = 'memory.size',
  MemoryGrow = 'memory.grow',
  MemoryCopy = 'memory.copy',
  MemoryFill = 'memory.fill',
  MemoryInit = 'memory.init',
  DataDrop = 'data.drop',
  // Calls
  Call = 'call',
  CallIndirect = 'call_indirect',
  CallRef = 'call_ref',
  // Tables
  TableGet = 'table.get',
  TableSet = 'table.set',
  TableSize = 'table.size',
  TableGrow = 'table.grow',
  TableFill = 'table.fill',
  TableCopy = 'table.copy',
  ElemDrop = 'elem.drop',
  TableInit = 'table.init',
  // Atomics
  AtomicRMW = 'atomic.rmw',
  AtomicCmpxchg = 'atomic.cmpxchg',
  AtomicWait = 'atomic.wait',
  AtomicNotify = 'atomic.notify',
  AtomicFence = 'atomic.fence',
  // SIMD
  SIMDExtract = 'simd.extract',
  SIMDReplace = 'simd.replace',
  SIMDShuffle = 'simd.shuffle',
  SIMDTernary = 'simd.ternary',
  Quaternary = 'quaternary',
  SIMDShift = 'simd.shift',
  SIMDLoad = 'simd.load',
  SIMDLoadStoreLane = 'simd.load_store_lane',
  // References (GC + reference-types proposals)
  RefNull = 'ref.null',
  RefIsNull = 'ref.is_null',
  RefAs = 'ref.as',
  RefFunc = 'ref.func',
  RefEq = 'ref.eq',
  RefI31 = 'ref.i31',
  I31Get = 'i31.get',
  RefTest = 'ref.test',
  RefCast = 'ref.cast',
  BrOn = 'br_on',
  // GC structs
  StructNew = 'struct.new',
  StructGet = 'struct.get',
  StructSet = 'struct.set',
  // GC arrays
  ArrayNew = 'array.new',
  ArrayNewFixed = 'array.new_fixed',
  ArrayNewData = 'array.new_data',
  ArrayNewElem = 'array.new_elem',
  ArrayGet = 'array.get',
  ArraySet = 'array.set',
  ArrayLen = 'array.len',
  ArrayCopy = 'array.copy',
  ArrayFill = 'array.fill',
  ArrayInitData = 'array.init_data',
  ArrayInitElem = 'array.init_elem',
  // Exception handling
  Try = 'try',
  TryTable = 'try_table',
  Throw = 'throw',
  ThrowRef = 'throw_ref',
  Rethrow = 'rethrow',
  Pop = 'pop',
  // Multi-value
  TupleMake = 'tuple.make',
  TupleExtract = 'tuple.extract',
}

// ---------------------------------------------------------------------------
// Constant value union
// ---------------------------------------------------------------------------

/**
 * A WASM literal constant value.
 * Exactly one field is present, corresponding to the value type.
 */
export type Literal =
  | { i32: number }
  | { i64: bigint }
  | { f32: number }
  | { f64: number }
  | { v128: Uint8Array };

// ---------------------------------------------------------------------------
// Operator enums
// ---------------------------------------------------------------------------

/** Unary operators. Mirrors `UnaryOp` in Binaryen. */
export const UnaryOp = {
  // i32
  ClzI32: 0x67, // i32.clz
  CtzI32: 0x68, // i32.ctz
  PopcntI32: 0x69, // i32.popcnt
  EqzI32: 0x45, // i32.eqz
  // i64
  ClzI64: 0x79, // i64.clz
  CtzI64: 0x7a, // i64.ctz
  PopcntI64: 0x7b, // i64.popcnt
  EqzI64: 0x50, // i64.eqz
  // f32
  AbsF32: 0x8b, // f32.abs
  NegF32: 0x8c, // f32.neg
  CeilF32: 0x8d, // f32.ceil
  FloorF32: 0x8e, // f32.floor
  TruncF32: 0x8f, // f32.trunc
  NearestF32: 0x90, // f32.nearest
  SqrtF32: 0x91, // f32.sqrt
  // f64
  AbsF64: 0x99, // f64.abs
  NegF64: 0x9a, // f64.neg
  CeilF64: 0x9b, // f64.ceil
  FloorF64: 0x9c, // f64.floor
  TruncF64: 0x9d, // f64.trunc
  NearestF64: 0x9e, // f64.nearest
  SqrtF64: 0x9f, // f64.sqrt
  // Conversions
  ExtendSI32: 0xac, // i64.extend_i32_s
  ExtendUI32: 0xad, // i64.extend_i32_u
  WrapI64: 0xa7, // i32.wrap_i64
  TruncSF32ToI32: 0xa8, // i32.trunc_f32_s
  TruncUF32ToI32: 0xa9, // i32.trunc_f32_u
  TruncSF64ToI32: 0xaa, // i32.trunc_f64_s
  TruncUF64ToI32: 0xab, // i32.trunc_f64_u
  TruncSF32ToI64: 0xae, // i64.trunc_f32_s
  TruncUF32ToI64: 0xaf, // i64.trunc_f32_u
  TruncSF64ToI64: 0xb0, // i64.trunc_f64_s
  TruncUF64ToI64: 0xb1, // i64.trunc_f64_u
  PromoteF32: 0xbb, // f64.promote_f32
  DemoteF64: 0xb6, // f32.demote_f64
  ConvertSI32ToF32: 0xb2, // f32.convert_i32_s
  ConvertUI32ToF32: 0xb3, // f32.convert_i32_u
  ConvertSI64ToF32: 0xb4, // f32.convert_i64_s
  ConvertUI64ToF32: 0xb5, // f32.convert_i64_u
  ConvertSI32ToF64: 0xb7, // f64.convert_i32_s
  ConvertUI32ToF64: 0xb8, // f64.convert_i32_u
  ConvertSI64ToF64: 0xb9, // f64.convert_i64_s
  ConvertUI64ToF64: 0xba, // f64.convert_i64_u
  ReinterpretI32: 0xbe, // f32.reinterpret_i32
  ReinterpretI64: 0xbf, // f64.reinterpret_i64
  ReinterpretF32: 0xbc, // i32.reinterpret_f32
  ReinterpretF64: 0xbd, // i64.reinterpret_f64
  ExtendS8I32: 0xc0, // i32.extend8_s
  ExtendS16I32: 0xc1, // i32.extend16_s
  ExtendS8I64: 0xc2, // i64.extend8_s
  ExtendS16I64: 0xc3, // i64.extend16_s
  ExtendS32I64: 0xc4, // i64.extend32_s
  // SIMD splats
  SplatVecI8x16: (0xfd << 16) | 0xf, // i8x16.splat
  SplatVecI16x8: (0xfd << 16) | 0x10, // i16x8.splat
  SplatVecI32x4: (0xfd << 16) | 0x11, // i32x4.splat
  SplatVecI64x2: (0xfd << 16) | 0x12, // i64x2.splat
  SplatVecF32x4: (0xfd << 16) | 0x13, // f32x4.splat
  SplatVecF64x2: (0xfd << 16) | 0x14, // f64x2.splat
  // v128 unary
  NotVec128: (0xfd << 16) | 0x4d, // v128.not
  AnyTrueVec128: (0xfd << 16) | 0x53, // v128.any_true
  // i8x16 unary
  AbsVecI8x16: (0xfd << 16) | 0x60, // i8x16.abs
  NegVecI8x16: (0xfd << 16) | 0x61, // i8x16.neg
  PopcntVecI8x16: (0xfd << 16) | 0x62, // i8x16.popcnt
  AllTrueVecI8x16: (0xfd << 16) | 0x63, // i8x16.all_true
  BitmaskVecI8x16: (0xfd << 16) | 0x64, // i8x16.bitmask
  // i16x8 unary
  AbsVecI16x8: (0xfd << 16) | 0x80, // i16x8.abs
  NegVecI16x8: (0xfd << 16) | 0x81, // i16x8.neg
  AllTrueVecI16x8: (0xfd << 16) | 0x83, // i16x8.all_true
  BitmaskVecI16x8: (0xfd << 16) | 0x84, // i16x8.bitmask
  ExtendLowSVecI8x16ToI16x8: (0xfd << 16) | 0x87, // i16x8.extend_low_i8x16_s
  ExtendHighSVecI8x16ToI16x8: (0xfd << 16) | 0x88, // i16x8.extend_high_i8x16_s
  ExtendLowUVecI8x16ToI16x8: (0xfd << 16) | 0x89, // i16x8.extend_low_i8x16_u
  ExtendHighUVecI8x16ToI16x8: (0xfd << 16) | 0x8a, // i16x8.extend_high_i8x16_u
  ExtaddPairwiseSVecI8x16ToI16x8: (0xfd << 16) | 0x7c, // i16x8.extadd_pairwise_i8x16_s
  ExtaddPairwiseUVecI8x16ToI16x8: (0xfd << 16) | 0x7d, // i16x8.extadd_pairwise_i8x16_u
  // i32x4 unary
  AbsVecI32x4: (0xfd << 16) | 0xa0, // i32x4.abs
  NegVecI32x4: (0xfd << 16) | 0xa1, // i32x4.neg
  AllTrueVecI32x4: (0xfd << 16) | 0xa3, // i32x4.all_true
  BitmaskVecI32x4: (0xfd << 16) | 0xa4, // i32x4.bitmask
  ExtendLowSVecI16x8ToI32x4: (0xfd << 16) | 0xa7, // i32x4.extend_low_i16x8_s
  ExtendHighSVecI16x8ToI32x4: (0xfd << 16) | 0xa8, // i32x4.extend_high_i16x8_s
  ExtendLowUVecI16x8ToI32x4: (0xfd << 16) | 0xa9, // i32x4.extend_low_i16x8_u
  ExtendHighUVecI16x8ToI32x4: (0xfd << 16) | 0xaa, // i32x4.extend_high_i16x8_u
  ExtaddPairwiseSVecI16x8ToI32x4: (0xfd << 16) | 0x7e, // i32x4.extadd_pairwise_i16x8_s
  ExtaddPairwiseUVecI16x8ToI32x4: (0xfd << 16) | 0x7f, // i32x4.extadd_pairwise_i16x8_u
  TruncSatSVecF32x4ToI32x4: (0xfd << 16) | 0xf8, // i32x4.trunc_sat_f32x4_s
  TruncSatUVecF32x4ToI32x4: (0xfd << 16) | 0xf9, // i32x4.trunc_sat_f32x4_u
  TruncSatSVecF64x2ToI32x4Zero: (0xfd << 16) | 0xfc, // i32x4.trunc_sat_f64x2_s_zero
  TruncSatUVecF64x2ToI32x4Zero: (0xfd << 16) | 0xfd, // i32x4.trunc_sat_f64x2_u_zero
  // i64x2 unary
  AbsVecI64x2: (0xfd << 16) | 0xc0, // i64x2.abs
  NegVecI64x2: (0xfd << 16) | 0xc1, // i64x2.neg
  AllTrueVecI64x2: (0xfd << 16) | 0xc3, // i64x2.all_true
  BitmaskVecI64x2: (0xfd << 16) | 0xc4, // i64x2.bitmask
  ExtendLowSVecI32x4ToI64x2: (0xfd << 16) | 0xc7, // i64x2.extend_low_i32x4_s
  ExtendHighSVecI32x4ToI64x2: (0xfd << 16) | 0xc8, // i64x2.extend_high_i32x4_s
  ExtendLowUVecI32x4ToI64x2: (0xfd << 16) | 0xc9, // i64x2.extend_low_i32x4_u
  ExtendHighUVecI32x4ToI64x2: (0xfd << 16) | 0xca, // i64x2.extend_high_i32x4_u
  // f32x4 unary
  AbsVecF32x4: (0xfd << 16) | 0xe0, // f32x4.abs
  NegVecF32x4: (0xfd << 16) | 0xe1, // f32x4.neg
  SqrtVecF32x4: (0xfd << 16) | 0xe3, // f32x4.sqrt
  CeilVecF32x4: (0xfd << 16) | 0x67, // f32x4.ceil
  FloorVecF32x4: (0xfd << 16) | 0x68, // f32x4.floor
  TruncVecF32x4: (0xfd << 16) | 0x69, // f32x4.trunc
  NearestVecF32x4: (0xfd << 16) | 0x6a, // f32x4.nearest
  DemoteZeroVecF64x2ToF32x4: (0xfd << 16) | 0x5e, // f32x4.demote_f64x2_zero
  ConvertSVecI32x4ToF32x4: (0xfd << 16) | 0xfa, // f32x4.convert_i32x4_s
  ConvertUVecI32x4ToF32x4: (0xfd << 16) | 0xfb, // f32x4.convert_i32x4_u
  // f64x2 unary
  AbsVecF64x2: (0xfd << 16) | 0xec, // f64x2.abs
  NegVecF64x2: (0xfd << 16) | 0xed, // f64x2.neg
  SqrtVecF64x2: (0xfd << 16) | 0xef, // f64x2.sqrt
  CeilVecF64x2: (0xfd << 16) | 0x74, // f64x2.ceil
  FloorVecF64x2: (0xfd << 16) | 0x75, // f64x2.floor
  TruncVecF64x2: (0xfd << 16) | 0x7a, // f64x2.trunc
  NearestVecF64x2: (0xfd << 16) | 0x94, // f64x2.nearest
  PromoteLowVecF32x4ToF64x2: (0xfd << 16) | 0x5f, // f64x2.promote_low_f32x4
  ConvertLowSVecI32x4ToF64x2: (0xfd << 16) | 0xfe, // f64x2.convert_low_i32x4_s
  ConvertLowUVecI32x4ToF64x2: (0xfd << 16) | 0xff, // f64x2.convert_low_i32x4_u
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type UnaryOp = Opcode;

/** Binary operators. Mirrors `BinaryOp` in Binaryen. */
export const BinaryOp = {
  /**
   * Wide multiply: two i64 in, a 128-bit product out as TWO i64. Binary
   * rather than quaternary because the operand count is two — the same
   * split wabt-ts makes, where `isWideMul` special-cases the result arity
   * inside `onBinary`.
   */
  MulWideSInt64: (0xfc << 16) | 0x15, // i64.mul_wide_s
  MulWideUInt64: (0xfc << 16) | 0x16, // i64.mul_wide_u
  // i32
  AddI32: 0x6a, // i32.add
  SubI32: 0x6b, // i32.sub
  MulI32: 0x6c, // i32.mul
  DivSI32: 0x6d, // i32.div_s
  DivUI32: 0x6e, // i32.div_u
  RemSI32: 0x6f, // i32.rem_s
  RemUI32: 0x70, // i32.rem_u
  AndI32: 0x71, // i32.and
  OrI32: 0x72, // i32.or
  XorI32: 0x73, // i32.xor
  ShlI32: 0x74, // i32.shl
  ShrSI32: 0x75, // i32.shr_s
  ShrUI32: 0x76, // i32.shr_u
  RotlI32: 0x77, // i32.rotl
  RotrI32: 0x78, // i32.rotr
  EqI32: 0x46, // i32.eq
  NeI32: 0x47, // i32.ne
  LtSI32: 0x48, // i32.lt_s
  LtUI32: 0x49, // i32.lt_u
  LeSI32: 0x4c, // i32.le_s
  LeUI32: 0x4d, // i32.le_u
  GtSI32: 0x4a, // i32.gt_s
  GtUI32: 0x4b, // i32.gt_u
  GeSI32: 0x4e, // i32.ge_s
  GeUI32: 0x4f, // i32.ge_u
  // i64
  AddI64: 0x7c, // i64.add
  SubI64: 0x7d, // i64.sub
  MulI64: 0x7e, // i64.mul
  DivSI64: 0x7f, // i64.div_s
  DivUI64: 0x80, // i64.div_u
  RemSI64: 0x81, // i64.rem_s
  RemUI64: 0x82, // i64.rem_u
  AndI64: 0x83, // i64.and
  OrI64: 0x84, // i64.or
  XorI64: 0x85, // i64.xor
  ShlI64: 0x86, // i64.shl
  ShrSI64: 0x87, // i64.shr_s
  ShrUI64: 0x88, // i64.shr_u
  RotlI64: 0x89, // i64.rotl
  RotrI64: 0x8a, // i64.rotr
  EqI64: 0x51, // i64.eq
  NeI64: 0x52, // i64.ne
  LtSI64: 0x53, // i64.lt_s
  LtUI64: 0x54, // i64.lt_u
  LeSI64: 0x57, // i64.le_s
  LeUI64: 0x58, // i64.le_u
  GtSI64: 0x55, // i64.gt_s
  GtUI64: 0x56, // i64.gt_u
  GeSI64: 0x59, // i64.ge_s
  GeUI64: 0x5a, // i64.ge_u
  // f32
  AddF32: 0x92, // f32.add
  SubF32: 0x93, // f32.sub
  MulF32: 0x94, // f32.mul
  DivF32: 0x95, // f32.div
  CopySignF32: 0x98, // f32.copysign
  MinF32: 0x96, // f32.min
  MaxF32: 0x97, // f32.max
  EqF32: 0x5b, // f32.eq
  NeF32: 0x5c, // f32.ne
  LtF32: 0x5d, // f32.lt
  LeF32: 0x5f, // f32.le
  GtF32: 0x5e, // f32.gt
  GeF32: 0x60, // f32.ge
  // f64
  AddF64: 0xa0, // f64.add
  SubF64: 0xa1, // f64.sub
  MulF64: 0xa2, // f64.mul
  DivF64: 0xa3, // f64.div
  CopySignF64: 0xa6, // f64.copysign
  MinF64: 0xa4, // f64.min
  MaxF64: 0xa5, // f64.max
  EqF64: 0x61, // f64.eq
  NeF64: 0x62, // f64.ne
  LtF64: 0x63, // f64.lt
  LeF64: 0x65, // f64.le
  GtF64: 0x64, // f64.gt
  GeF64: 0x66, // f64.ge
  // SIMD binary
  SwizzleVecI8x16: (0xfd << 16) | 0xe, // i8x16.swizzle
  // i8x16 comparisons (return v128)
  EqVecI8x16: (0xfd << 16) | 0x23, // i8x16.eq
  NeVecI8x16: (0xfd << 16) | 0x24, // i8x16.ne
  LtSVecI8x16: (0xfd << 16) | 0x25, // i8x16.lt_s
  LtUVecI8x16: (0xfd << 16) | 0x26, // i8x16.lt_u
  GtSVecI8x16: (0xfd << 16) | 0x27, // i8x16.gt_s
  GtUVecI8x16: (0xfd << 16) | 0x28, // i8x16.gt_u
  LeSVecI8x16: (0xfd << 16) | 0x29, // i8x16.le_s
  LeUVecI8x16: (0xfd << 16) | 0x2a, // i8x16.le_u
  GeSVecI8x16: (0xfd << 16) | 0x2b, // i8x16.ge_s
  GeUVecI8x16: (0xfd << 16) | 0x2c, // i8x16.ge_u
  // i16x8 comparisons
  EqVecI16x8: (0xfd << 16) | 0x2d, // i16x8.eq
  NeVecI16x8: (0xfd << 16) | 0x2e, // i16x8.ne
  LtSVecI16x8: (0xfd << 16) | 0x2f, // i16x8.lt_s
  LtUVecI16x8: (0xfd << 16) | 0x30, // i16x8.lt_u
  GtSVecI16x8: (0xfd << 16) | 0x31, // i16x8.gt_s
  GtUVecI16x8: (0xfd << 16) | 0x32, // i16x8.gt_u
  LeSVecI16x8: (0xfd << 16) | 0x33, // i16x8.le_s
  LeUVecI16x8: (0xfd << 16) | 0x34, // i16x8.le_u
  GeSVecI16x8: (0xfd << 16) | 0x35, // i16x8.ge_s
  GeUVecI16x8: (0xfd << 16) | 0x36, // i16x8.ge_u
  // i32x4 comparisons
  EqVecI32x4: (0xfd << 16) | 0x37, // i32x4.eq
  NeVecI32x4: (0xfd << 16) | 0x38, // i32x4.ne
  LtSVecI32x4: (0xfd << 16) | 0x39, // i32x4.lt_s
  LtUVecI32x4: (0xfd << 16) | 0x3a, // i32x4.lt_u
  GtSVecI32x4: (0xfd << 16) | 0x3b, // i32x4.gt_s
  GtUVecI32x4: (0xfd << 16) | 0x3c, // i32x4.gt_u
  LeSVecI32x4: (0xfd << 16) | 0x3d, // i32x4.le_s
  LeUVecI32x4: (0xfd << 16) | 0x3e, // i32x4.le_u
  GeSVecI32x4: (0xfd << 16) | 0x3f, // i32x4.ge_s
  GeUVecI32x4: (0xfd << 16) | 0x40, // i32x4.ge_u
  // f32x4 comparisons
  EqVecF32x4: (0xfd << 16) | 0x41, // f32x4.eq
  NeVecF32x4: (0xfd << 16) | 0x42, // f32x4.ne
  LtVecF32x4: (0xfd << 16) | 0x43, // f32x4.lt
  GtVecF32x4: (0xfd << 16) | 0x44, // f32x4.gt
  LeVecF32x4: (0xfd << 16) | 0x45, // f32x4.le
  GeVecF32x4: (0xfd << 16) | 0x46, // f32x4.ge
  // f64x2 comparisons
  EqVecF64x2: (0xfd << 16) | 0x47, // f64x2.eq
  NeVecF64x2: (0xfd << 16) | 0x48, // f64x2.ne
  LtVecF64x2: (0xfd << 16) | 0x49, // f64x2.lt
  GtVecF64x2: (0xfd << 16) | 0x4a, // f64x2.gt
  LeVecF64x2: (0xfd << 16) | 0x4b, // f64x2.le
  GeVecF64x2: (0xfd << 16) | 0x4c, // f64x2.ge
  // i64x2 comparisons
  EqVecI64x2: (0xfd << 16) | 0xd6, // i64x2.eq
  NeVecI64x2: (0xfd << 16) | 0xd7, // i64x2.ne
  LtSVecI64x2: (0xfd << 16) | 0xd8, // i64x2.lt_s
  GtSVecI64x2: (0xfd << 16) | 0xd9, // i64x2.gt_s
  LeSVecI64x2: (0xfd << 16) | 0xda, // i64x2.le_s
  GeSVecI64x2: (0xfd << 16) | 0xdb, // i64x2.ge_s
  // v128 bitwise
  AndVec128: (0xfd << 16) | 0x4e, // v128.and
  OrVec128: (0xfd << 16) | 0x50, // v128.or
  XorVec128: (0xfd << 16) | 0x51, // v128.xor
  AndNotVec128: (0xfd << 16) | 0x4f, // v128.andnot
  // i8x16 arithmetic
  AddVecI8x16: (0xfd << 16) | 0x6e, // i8x16.add
  AddSatSVecI8x16: (0xfd << 16) | 0x6f, // i8x16.add_sat_s
  AddSatUVecI8x16: (0xfd << 16) | 0x70, // i8x16.add_sat_u
  SubVecI8x16: (0xfd << 16) | 0x71, // i8x16.sub
  SubSatSVecI8x16: (0xfd << 16) | 0x72, // i8x16.sub_sat_s
  SubSatUVecI8x16: (0xfd << 16) | 0x73, // i8x16.sub_sat_u
  MinSVecI8x16: (0xfd << 16) | 0x76, // i8x16.min_s
  MinUVecI8x16: (0xfd << 16) | 0x77, // i8x16.min_u
  MaxSVecI8x16: (0xfd << 16) | 0x78, // i8x16.max_s
  MaxUVecI8x16: (0xfd << 16) | 0x79, // i8x16.max_u
  AvgrUVecI8x16: (0xfd << 16) | 0x7b, // i8x16.avgr_u
  NarrowSVecI16x8ToI8x16: (0xfd << 16) | 0x65, // i8x16.narrow_i16x8_s
  NarrowUVecI16x8ToI8x16: (0xfd << 16) | 0x66, // i8x16.narrow_i16x8_u
  // i16x8 arithmetic
  AddVecI16x8: (0xfd << 16) | 0x8e, // i16x8.add
  AddSatSVecI16x8: (0xfd << 16) | 0x8f, // i16x8.add_sat_s
  AddSatUVecI16x8: (0xfd << 16) | 0x90, // i16x8.add_sat_u
  SubVecI16x8: (0xfd << 16) | 0x91, // i16x8.sub
  SubSatSVecI16x8: (0xfd << 16) | 0x92, // i16x8.sub_sat_s
  SubSatUVecI16x8: (0xfd << 16) | 0x93, // i16x8.sub_sat_u
  MulVecI16x8: (0xfd << 16) | 0x95, // i16x8.mul
  MinSVecI16x8: (0xfd << 16) | 0x96, // i16x8.min_s
  MinUVecI16x8: (0xfd << 16) | 0x97, // i16x8.min_u
  MaxSVecI16x8: (0xfd << 16) | 0x98, // i16x8.max_s
  MaxUVecI16x8: (0xfd << 16) | 0x99, // i16x8.max_u
  AvgrUVecI16x8: (0xfd << 16) | 0x9b, // i16x8.avgr_u
  Q15MulrSatSVecI16x8: (0xfd << 16) | 0x82, // i16x8.q15mulr_sat_s
  NarrowSVecI32x4ToI16x8: (0xfd << 16) | 0x85, // i16x8.narrow_i32x4_s
  NarrowUVecI32x4ToI16x8: (0xfd << 16) | 0x86, // i16x8.narrow_i32x4_u
  ExtmulLowSVecI8x16ToI16x8: (0xfd << 16) | 0x9c, // i16x8.extmul_low_i8x16_s
  ExtmulHighSVecI8x16ToI16x8: (0xfd << 16) | 0x9d, // i16x8.extmul_high_i8x16_s
  ExtmulLowUVecI8x16ToI16x8: (0xfd << 16) | 0x9e, // i16x8.extmul_low_i8x16_u
  ExtmulHighUVecI8x16ToI16x8: (0xfd << 16) | 0x9f, // i16x8.extmul_high_i8x16_u
  // i32x4 arithmetic
  AddVecI32x4: (0xfd << 16) | 0xae, // i32x4.add
  SubVecI32x4: (0xfd << 16) | 0xb1, // i32x4.sub
  MulVecI32x4: (0xfd << 16) | 0xb5, // i32x4.mul
  MinSVecI32x4: (0xfd << 16) | 0xb6, // i32x4.min_s
  MinUVecI32x4: (0xfd << 16) | 0xb7, // i32x4.min_u
  MaxSVecI32x4: (0xfd << 16) | 0xb8, // i32x4.max_s
  MaxUVecI32x4: (0xfd << 16) | 0xb9, // i32x4.max_u
  DotSVecI16x8ToI32x4: (0xfd << 16) | 0xba, // i32x4.dot_i16x8_s
  ExtmulLowSVecI16x8ToI32x4: (0xfd << 16) | 0xbc, // i32x4.extmul_low_i16x8_s
  ExtmulHighSVecI16x8ToI32x4: (0xfd << 16) | 0xbd, // i32x4.extmul_high_i16x8_s
  ExtmulLowUVecI16x8ToI32x4: (0xfd << 16) | 0xbe, // i32x4.extmul_low_i16x8_u
  ExtmulHighUVecI16x8ToI32x4: (0xfd << 16) | 0xbf, // i32x4.extmul_high_i16x8_u
  // i64x2 arithmetic
  AddVecI64x2: (0xfd << 16) | 0xce, // i64x2.add
  SubVecI64x2: (0xfd << 16) | 0xd1, // i64x2.sub
  MulVecI64x2: (0xfd << 16) | 0xd5, // i64x2.mul
  ExtmulLowSVecI32x4ToI64x2: (0xfd << 16) | 0xdc, // i64x2.extmul_low_i32x4_s
  ExtmulHighSVecI32x4ToI64x2: (0xfd << 16) | 0xdd, // i64x2.extmul_high_i32x4_s
  ExtmulLowUVecI32x4ToI64x2: (0xfd << 16) | 0xde, // i64x2.extmul_low_i32x4_u
  ExtmulHighUVecI32x4ToI64x2: (0xfd << 16) | 0xdf, // i64x2.extmul_high_i32x4_u
  // f32x4 arithmetic
  AddVecF32x4: (0xfd << 16) | 0xe4, // f32x4.add
  SubVecF32x4: (0xfd << 16) | 0xe5, // f32x4.sub
  MulVecF32x4: (0xfd << 16) | 0xe6, // f32x4.mul
  DivVecF32x4: (0xfd << 16) | 0xe7, // f32x4.div
  MinVecF32x4: (0xfd << 16) | 0xe8, // f32x4.min
  MaxVecF32x4: (0xfd << 16) | 0xe9, // f32x4.max
  PminVecF32x4: (0xfd << 16) | 0xea, // f32x4.pmin
  PmaxVecF32x4: (0xfd << 16) | 0xeb, // f32x4.pmax
  // f64x2 arithmetic
  AddVecF64x2: (0xfd << 16) | 0xf0, // f64x2.add
  SubVecF64x2: (0xfd << 16) | 0xf1, // f64x2.sub
  MulVecF64x2: (0xfd << 16) | 0xf2, // f64x2.mul
  DivVecF64x2: (0xfd << 16) | 0xf3, // f64x2.div
  MinVecF64x2: (0xfd << 16) | 0xf4, // f64x2.min
  MaxVecF64x2: (0xfd << 16) | 0xf5, // f64x2.max
  PminVecF64x2: (0xfd << 16) | 0xf6, // f64x2.pmin
  PmaxVecF64x2: (0xfd << 16) | 0xf7, // f64x2.pmax
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type BinaryOp = Opcode;

// ---------------------------------------------------------------------------
// SIMD-specific operator enums
// ---------------------------------------------------------------------------

/** Lane extract operators. Mirrors `SIMDExtractOp` in Binaryen. */
export const SIMDExtractOp = {
  ExtractLaneSVecI8x16: (0xfd << 16) | 0x15, // i8x16.extract_lane_s
  ExtractLaneUVecI8x16: (0xfd << 16) | 0x16, // i8x16.extract_lane_u
  ExtractLaneSVecI16x8: (0xfd << 16) | 0x18, // i16x8.extract_lane_s
  ExtractLaneUVecI16x8: (0xfd << 16) | 0x19, // i16x8.extract_lane_u
  ExtractLaneVecI32x4: (0xfd << 16) | 0x1b, // i32x4.extract_lane
  ExtractLaneVecI64x2: (0xfd << 16) | 0x1d, // i64x2.extract_lane
  ExtractLaneVecF32x4: (0xfd << 16) | 0x1f, // f32x4.extract_lane
  ExtractLaneVecF64x2: (0xfd << 16) | 0x21, // f64x2.extract_lane
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type SIMDExtractOp = Opcode;

/** Lane replace operators. Mirrors `SIMDReplaceOp` in Binaryen. */
export const SIMDReplaceOp = {
  ReplaceLaneVecI8x16: (0xfd << 16) | 0x17, // i8x16.replace_lane
  ReplaceLaneVecI16x8: (0xfd << 16) | 0x1a, // i16x8.replace_lane
  ReplaceLaneVecI32x4: (0xfd << 16) | 0x1c, // i32x4.replace_lane
  ReplaceLaneVecI64x2: (0xfd << 16) | 0x1e, // i64x2.replace_lane
  ReplaceLaneVecF32x4: (0xfd << 16) | 0x20, // f32x4.replace_lane
  ReplaceLaneVecF64x2: (0xfd << 16) | 0x22, // f64x2.replace_lane
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type SIMDReplaceOp = Opcode;

/** SIMD lane shift operators. Mirrors `SIMDShiftOp` in Binaryen. */
export const SIMDShiftOp = {
  ShlVecI8x16: (0xfd << 16) | 0x6b, // i8x16.shl
  ShrSVecI8x16: (0xfd << 16) | 0x6c, // i8x16.shr_s
  ShrUVecI8x16: (0xfd << 16) | 0x6d, // i8x16.shr_u
  ShlVecI16x8: (0xfd << 16) | 0x8b, // i16x8.shl
  ShrSVecI16x8: (0xfd << 16) | 0x8c, // i16x8.shr_s
  ShrUVecI16x8: (0xfd << 16) | 0x8d, // i16x8.shr_u
  ShlVecI32x4: (0xfd << 16) | 0xab, // i32x4.shl
  ShrSVecI32x4: (0xfd << 16) | 0xac, // i32x4.shr_s
  ShrUVecI32x4: (0xfd << 16) | 0xad, // i32x4.shr_u
  ShlVecI64x2: (0xfd << 16) | 0xcb, // i64x2.shl
  ShrSVecI64x2: (0xfd << 16) | 0xcc, // i64x2.shr_s
  ShrUVecI64x2: (0xfd << 16) | 0xcd, // i64x2.shr_u
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type SIMDShiftOp = Opcode;

/** SIMD extended-load operators. Mirrors `SIMDLoadOp` in Binaryen. */
export const SIMDLoadOp = {
  Load8SplatVec128: (0xfd << 16) | 0x7, // v128.load8_splat
  Load16SplatVec128: (0xfd << 16) | 0x8, // v128.load16_splat
  Load32SplatVec128: (0xfd << 16) | 0x9, // v128.load32_splat
  Load64SplatVec128: (0xfd << 16) | 0xa, // v128.load64_splat
  Load8x8SVec128: (0xfd << 16) | 0x1, // v128.load8x8_s
  Load8x8UVec128: (0xfd << 16) | 0x2, // v128.load8x8_u
  Load16x4SVec128: (0xfd << 16) | 0x3, // v128.load16x4_s
  Load16x4UVec128: (0xfd << 16) | 0x4, // v128.load16x4_u
  Load32x2SVec128: (0xfd << 16) | 0x5, // v128.load32x2_s
  Load32x2UVec128: (0xfd << 16) | 0x6, // v128.load32x2_u
  Load32ZeroVec128: (0xfd << 16) | 0x5c, // v128.load32_zero
  Load64ZeroVec128: (0xfd << 16) | 0x5d, // v128.load64_zero
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type SIMDLoadOp = Opcode;

/** SIMD load/store lane operators. Mirrors `SIMDLoadStoreLaneOp` in Binaryen. */
export const SIMDLoadStoreLaneOp = {
  Load8LaneVec128: (0xfd << 16) | 0x54, // v128.load8_lane
  Load16LaneVec128: (0xfd << 16) | 0x55, // v128.load16_lane
  Load32LaneVec128: (0xfd << 16) | 0x56, // v128.load32_lane
  Load64LaneVec128: (0xfd << 16) | 0x57, // v128.load64_lane
  Store8LaneVec128: (0xfd << 16) | 0x58, // v128.store8_lane
  Store16LaneVec128: (0xfd << 16) | 0x59, // v128.store16_lane
  Store32LaneVec128: (0xfd << 16) | 0x5a, // v128.store32_lane
  Store64LaneVec128: (0xfd << 16) | 0x5b, // v128.store64_lane
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type SIMDLoadStoreLaneOp = Opcode;

/** SIMD ternary operators. Mirrors `SIMDTernaryOp` in Binaryen. */
export const SIMDTernaryOp = {
  Bitselect: (0xfd << 16) | 0x52, // v128.bitselect
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type SIMDTernaryOp = Opcode;

// ---------------------------------------------------------------------------
// Expression node types (discriminated union)
// ---------------------------------------------------------------------------

/**
 * Common base for all expression nodes.
 *
 * Every expression node in the IR has a `kind` discriminant (which determines
 * the specific variant of the {@link Expression} discriminated union) and a
 * `type` recording the value type that the expression yields at runtime.
 *
 * Exported so all subtype interfaces (e.g. {@link BinaryExpr}, {@link CallExpr})
 * have a public supertype reachable from JSR documentation. Construct
 * expression nodes through the typed `make*` factory functions
 * (e.g. {@link makeBinary}, {@link makeI32Const}) rather than the interfaces
 * directly.
 */
export interface ExprBase {
  /** The WAT instruction name (discriminant). */
  kind: ExpressionKind;

  /**
   * The result type of this expression, where something has computed it.
   *
   * ⚠️ **Optional since S6 step 3, and the reason is structural.** The two node
   * bases were DISJOINT: every wabt-ts node carries `loc` and none carries
   * `type`; every node here carried `type` and none mentioned `loc`. One shared
   * node needs both, and neither half can be made to populate the other's field
   * cheaply -- wabt-ts defers typing to its validator on purpose.
   *
   * So both are optional, and absent means "derive it" -- the same rule S3
   * established for the fidelity table. Relaxing it is safe today because all 81
   * factories here set it; a node without one can only arrive once wabt-ts's
   * tree flows in directly, at step 4.
   *
   * 🔑 **Read it through {@link typeOf} wherever a type is REQUIRED.** A pass
   * that needs a type should fail at the node that lacks one, naming it, rather
   * than propagate `undefined` into a decision.
   */
  type?: Type;

  /**
   * Source position, where something recorded it.
   *
   * Absent on everything binaryen-ts builds today: it is wabt-ts's half of the
   * disjoint base, carried here so one shared node can hold a diagnostic's
   * anchor. Optimization neither sets nor reads it.
   */
  loc?: Location;
}

/**
 * The result type of an expression, or a loud failure.
 *
 * `type` became optional so one node could serve both halves; this is where that
 * optionality is paid for. A node reaching a pass untyped names itself instead
 * of turning into a silent `undefined` comparison.
 */
export function typeOf(e: ExprBase): Type {
  if (e.type === undefined) {
    throw new Error(
      `expression of kind "${e.kind}" has no computed type, and reached code that ` +
        `requires one. Types are set by every factory here; a tree built elsewhere ` +
        `must be annotated before it reaches optimization.`,
    );
  }
  return e.type;
}

/** {@link NopExpr} — see {@link makeNop} for the factory. */
export interface NopExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Nop;
  /** Result type — the value type yielded at runtime. */
  type: None;
}

/** {@link UnreachableExpr} — see {@link makeUnreachable} for the factory. */
export interface UnreachableExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Unreachable;
  /** Result type — the value type yielded at runtime. */
  type: Unreachable;
}

/** {@link BlockExpr} — see {@link makeBlock} for the factory. */
export interface BlockExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Block;
  /** Optional label for branch targets. */
  name: string | null;
  /** Ordered list of child expressions. */
  children: Expression[];
}

/** {@link IfExpr} — see {@link makeIf} for the factory. */
export interface IfExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.If;
  /** Condition expression (typed as i32). */
  condition: Expression;
  /** Branch taken when the condition is non-zero. */
  ifTrue: Expression;
  /** Branch taken when the condition is zero (nullable). */
  ifFalse: Expression | null;
  /**
   * Branch-target label for the `if` block. Like `block`/`loop`, an `if`
   * introduces a label a `br`/`br_if` can target (its end). The binary parser
   * stores the frame's label here so the encoder can reproduce the exact branch
   * depth; without it a `br` to the `if` from deeper nesting resolves to the
   * wrong (innermost) target. Optional — most `if`s are not branch targets.
   */
  name?: string | undefined;
}

/** {@link LoopExpr} — see {@link makeLoop} for the factory. */
export interface LoopExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Loop;
  /** Branch label for `br` back-edges. */
  name: string;
  /** Body expression. */
  body: Expression;
}

/** {@link BreakExpr} — see {@link makeBreak} for the factory. */
export interface BreakExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Break;
  /** Target label. */
  name: string;
  /** Optional condition — when present this is a `br_if`. */
  condition: Expression | null;
  /** Optional forwarded value. */
  value: Expression | null;
}

/** {@link SwitchExpr} — see {@link makeSwitch} for the factory. */
export interface SwitchExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Switch;
  /** Branch table targets. */
  targets: string[];
  /** Default branch label when no index matches. */
  defaultTarget: string;
  /** Condition expression (typed as i32). */
  condition: Expression;
  /** Value expression. */
  value: Expression | null;
}

/** {@link ReturnExpr} — see {@link makeReturn} for the factory. */
export interface ReturnExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Return;
  /** Value expression. */
  value: Expression | null;
}

/** {@link ConstExpr} — see {@link makeI32Const}, {@link makeI64Const}, {@link makeF32Const}, {@link makeF64Const} for factories. */
export interface ConstExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Const;
  /** Value expression. */
  value: Literal;
}

/** {@link LocalGetExpr} — see {@link makeLocalGet} for the factory. */
export interface LocalGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.LocalGet;
  /** Local index. */
  index: number;
}

/** {@link LocalSetExpr} — see {@link makeLocalSet} for the factory. */
export interface LocalSetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.LocalSet;
  /** Numeric index into the relevant table. */
  index: number;
  /** Value expression. */
  value: Expression;
}

/** {@link LocalTeeExpr} — see {@link makeLocalTee} for the factory. */
export interface LocalTeeExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.LocalTee;
  /** Numeric index into the relevant table. */
  index: number;
  /** Value expression. */
  value: Expression;
}

/** {@link TableGetExpr} — see {@link makeTableGet} for the factory.
 *  `table.get $t index` — reads the element at `index` from table `$t`. */
export interface TableGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TableGet;
  /** Internal name of the table being read. */
  table: string;
  /** i32 index into the table. */
  index: Expression;
}

/** {@link TableSetExpr} — see {@link makeTableSet} for the factory.
 *  `table.set $t index value` — writes `value` to `index` in table `$t`. */
export interface TableSetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TableSet;
  /** Internal name of the table being written. */
  table: string;
  /** i32 index into the table. */
  index: Expression;
  /** New reference value to store. */
  value: Expression;
}

/** {@link GlobalGetExpr} — see {@link makeGlobalGet} for the factory. */
export interface GlobalGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.GlobalGet;
  /** Identifier label or symbolic name. */
  name: string;
}

/** {@link GlobalSetExpr} — see {@link makeGlobalSet} for the factory. */
export interface GlobalSetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.GlobalSet;
  /** Identifier label or symbolic name. */
  name: string;
  /** Value expression. */
  value: Expression;
}

/** {@link UnaryExpr} — see {@link makeUnary} for the factory. */
export interface UnaryExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Unary;
  /** Operator code. */
  opcode: UnaryOp;
  /** Value expression. */
  value: Expression;
}

/** {@link BinaryExpr} — see {@link makeBinary} for the factory. */
export interface BinaryExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Binary;
  /** Operator code. */
  opcode: BinaryOp;
  /** Left-hand operand. */
  left: Expression;
  /** Right-hand operand. */
  right: Expression;
}

/** {@link SelectExpr} — see {@link makeSelect} for the factory. */
export interface SelectExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Select;
  /** Branch taken when the condition is non-zero. */
  ifTrue: Expression;
  /** Branch taken when the condition is zero (nullable). */
  ifFalse: Expression;
  /** Condition expression (typed as i32). */
  condition: Expression;
}

/** {@link DropExpr} — see {@link makeDrop} for the factory. */
export interface DropExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Drop;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Value expression. */
  value: Expression;
}

/** Memory load node. */
export interface LoadExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Load;
  /** Byte width of the memory access (1, 2, 4, 8, 16). */
  bytes: 1 | 2 | 4 | 8 | 16;
  /** Whether the loaded integer is sign-extended. */
  signed: boolean;
  /** Static byte offset added to the address operand. */
  offset: number;
  /** Power-of-two alignment hint (e.g. 0=byte, 2=i32). */
  align: number;
  /** Address operand. */
  ptr: Expression;
}

/** Memory store node. */
export interface StoreExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Store;
  /** Width in bytes of the access. */
  bytes: 1 | 2 | 4 | 8 | 16;
  /** Static byte offset added to the address operand. */
  offset: number;
  /** Power-of-two alignment hint (e.g. 0=byte, 2=i32). */
  align: number;
  /** Address operand. */
  ptr: Expression;
  /** Value expression. */
  value: Expression;
}

/** {@link MemoryGrowExpr} — see {@link makeMemoryGrow} for the factory. */
export interface MemoryGrowExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.MemoryGrow;
  /** Result type — the value type yielded at runtime. */
  type: ValType.I32;
  /** delta — see the matching factory for semantics. */
  delta: Expression;
}

/** {@link MemorySizeExpr} — see {@link makeMemorySize} for the factory. */
export interface MemorySizeExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.MemorySize;
  /** Result type — the value type yielded at runtime. */
  type: ValType.I32;
}

/** {@link MemoryCopyExpr} — see {@link makeMemoryCopy} for the factory. */
/**
 * `table.init` — copy from a passive element segment into a table.
 *
 * Both the segment and the table are held by NAME and resolved to indices by
 * the encoder, like every other cross-section reference in this IR.
 */
export interface TableInitExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TableInit;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the element segment to copy from. */
  segment: string;
  /** Name of the table to copy into. */
  table: string;
  /** Index of the first table slot to write. */
  dest: Expression;
  /** Index of the first segment element to read. */
  offset: Expression;
  /** How many elements to copy. */
  size: Expression;
}

/** `elem.drop` — release a passive element segment's storage. */
export interface ElemDropExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ElemDrop;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the element segment to drop. */
  segment: string;
}

/**
 * `memory.init` — copy from a passive data segment into linear memory.
 *
 * The segment is held by NAME, like every other cross-section reference in this
 * IR, and resolved to its index by the encoder.
 */
export interface MemoryInitExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.MemoryInit;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the data segment to copy from. */
  segment: string;
  /** Destination address in linear memory. */
  dest: Expression;
  /** Byte offset within the segment. */
  offset: Expression;
  /** Number of bytes to copy. */
  size: Expression;
}

/** `data.drop` — release a passive data segment's storage. */
export interface DataDropExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.DataDrop;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the data segment to drop. */
  segment: string;
}

/** `table.size` — the current number of elements in a table. */
export interface TableSizeExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TableSize;
  /** Result type — the value type yielded at runtime. */
  type: ValType.I32;
  /** Name of the table being measured. */
  table: string;
}

/** `table.grow` — append `delta` copies of `value`, yielding the previous size. */
export interface TableGrowExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TableGrow;
  /** Result type — the previous size, or -1 if the growth failed. */
  type: ValType.I32;
  /** Name of the table being grown. */
  table: string;
  /** The reference value to fill the new slots with. */
  value: Expression;
  /** How many slots to add. */
  delta: Expression;
}

/** `table.fill` — write `value` into a range of a table. */
export interface TableFillExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TableFill;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the table being written. */
  table: string;
  /** Index of the first slot to write. */
  dest: Expression;
  /** The reference value to write. */
  value: Expression;
  /** How many slots to write. */
  size: Expression;
}

/** `table.copy` — copy a range of elements between (possibly the same) tables. */
export interface TableCopyExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TableCopy;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the table being written. */
  destTable: string;
  /** Name of the table being read. */
  sourceTable: string;
  /** Index of the first slot to write. */
  dest: Expression;
  /** Index of the first slot to read. */
  source: Expression;
  /** How many slots to copy. */
  size: Expression;
}

export interface MemoryCopyExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Memory the COPY READS FROM. Omitted means 0. `memory` is the destination. */
  sourceMemory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.MemoryCopy;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Destination address operand. */
  dest: Expression;
  /** source — see the {@link make} factory for semantics. */
  source: Expression;
  /** Number of elements. */
  size: Expression;
}

/** {@link MemoryFillExpr} — see {@link makeMemoryFill} for the factory. */
export interface MemoryFillExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.MemoryFill;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Destination address operand. */
  dest: Expression;
  /** Value expression. */
  value: Expression;
  /** Number of elements. */
  size: Expression;
}

/** {@link CallExpr} — see {@link makeCall} for the factory. */
export interface CallExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Call;
  /** Target label of the branch. */
  target: string;
  /** Argument expressions in declaration order. */
  operands: Expression[];
  /** isReturn — see the {@link make} factory for semantics. */
  isReturn: boolean;
}

/** {@link CallIndirectExpr} — see {@link makeCallIndirect} for the factory. */
export interface CallIndirectExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.CallIndirect;
  /** Table index (defaults to 0). */
  table: string;
  /** Target label of the branch. */
  target: Expression;
  /** Argument expressions in declaration order. */
  operands: Expression[];
  /** params — see the matching factory for semantics. */
  params: ValueType[];
  /** results — see the {@link make} factory for semantics. */
  results: ValueType[];
  /** isReturn — see the matching factory for semantics. */
  isReturn: boolean;
}

/** {@link RefNullExpr} — see {@link makeRefNull} for the factory. */
export interface RefNullExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.RefNull;
}

/** {@link RefIsNullExpr} — see {@link makeRefIsNull} for the factory. */
export interface RefIsNullExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.RefIsNull;
  /** Result type — the value type yielded at runtime. */
  type: ValType.I32;
  /** Value expression. */
  value: Expression;
}

/**
 * The `ref.as_*` operations.
 *
 * Mirrors upstream's `RefAsOp`. Only `RefAsNonNull` is wired through the
 * parser/encoder today; the extern conversions are post-MVP and would be added
 * here rather than as separate expression kinds.
 */
export const RefAsOp = {
  /** `ref.as_non_null` — traps if the operand is null, else yields it non-null. */
  RefAsNonNull: 0xd4, // ref.as_non_null
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type RefAsOp = Opcode;

/** {@link TupleMakeExpr} — see {@link makeTupleMake} for the factory. */
export interface TupleMakeExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TupleMake;
  /** The tuple's component types, in order. */
  type: TupleType;
  /** The operands, evaluated left to right, one per component. */
  operands: Expression[];
}

/** {@link RefAsExpr} — see {@link makeRefAsNonNull} for the factory. */
export interface RefAsExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.RefAs;
  /** Which `ref.as_*` operation this node performs. */
  opcode: RefAsOp;
  /** The reference operand. */
  value: Expression;
}

/** {@link RefFuncExpr} — see {@link makeRefFunc} for the factory. */
export interface RefFuncExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.RefFunc;
  /** func — see the {@link make} factory for semantics. */
  func: string;
}

// ---------------------------------------------------------------------------
// GC proposal expression node types (Phase 7)
// ---------------------------------------------------------------------------

/** Discriminant for br_on variants. */
export const BrOnOp = {
  Null: 0xd5, // br_on_null
  NonNull: 0xd6, // br_on_non_null
  Cast: (0xfb << 16) | 0x18, // br_on_cast
  CastFail: (0xfb << 16) | 0x19, // br_on_cast_fail
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type BrOnOp = Opcode;

/** {@link RefEqExpr} — see {@link makeRefEq} for the factory. */
export interface RefEqExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.RefEq;
  /** Result type — the value type yielded at runtime. */
  type: ValType.I32;
  /** Left-hand operand. */
  left: Expression;
  /** Right-hand operand. */
  right: Expression;
}

/** {@link RefI31Expr} — see {@link makeRefI31} for the factory. */
export interface RefI31Expr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.RefI31;
  /** Value expression. */
  value: Expression;
}

/** {@link I31GetExpr} — see {@link makeI31Get} for the factory. */
export interface I31GetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.I31Get;
  /** Result type — the value type yielded at runtime. */
  type: ValType.I32;
  /** i31 — see the matching factory for semantics. */
  i31: Expression;
  /** true = i31.get_s (sign-extend). */
  signed: boolean;
}

/** {@link StructNewExpr} — see {@link makeStructNew} for the factory. */
export interface StructNewExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.StructNew;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** Argument expressions in declaration order. */
  operands: Expression[];
  /** defaultInit — see the {@link make} factory for semantics. */
  defaultInit: boolean;
}

/** {@link StructGetExpr} — see {@link makeStructGet} for the factory. */
export interface StructGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.StructGet;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** Index of the struct field. */
  fieldIndex: number;
  /** ref — see the {@link make} factory for semantics. */
  ref: Expression;
  /** Whether the load is sign-extended (signed=true) or zero-extended. */
  signed: boolean;
}

/** {@link StructSetExpr} — see {@link makeStructSet} for the factory. */
export interface StructSetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.StructSet;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** Index of the struct field. */
  fieldIndex: number;
  /** ref — see the matching factory for semantics. */
  ref: Expression;
  /** Value expression. */
  value: Expression;
}

/** {@link ArrayNewExpr} — see {@link makeArrayNew} for the factory. */
export interface ArrayNewExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayNew;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** init — see the matching factory for semantics. */
  init: Expression | null;
  /** Byte length to operate on. */
  length: Expression;
}

/** {@link ArrayNewFixedExpr} — see {@link makeArrayNewFixed} for the factory. */
export interface ArrayNewFixedExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayNewFixed;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** values — see the matching factory for semantics. */
  values: Expression[];
}

/** {@link ArrayNewDataExpr} — see {@link makeArrayNewData} for the factory. */
export interface ArrayNewDataExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayNewData;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** dataSegment — see the matching factory for semantics. */
  dataSegment: number;
  /** Static byte offset added to the address operand. */
  offset: Expression;
  /** Byte length to operate on. */
  length: Expression;
}

/** {@link ArrayNewElemExpr} — see {@link makeArrayNewElem} for the factory. */
export interface ArrayNewElemExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayNewElem;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** elemSegment — see the matching factory for semantics. */
  elemSegment: number;
  /** Static byte offset added to the address operand. */
  offset: Expression;
  /** Byte length to operate on. */
  length: Expression;
}

/** {@link ArrayGetExpr} — see {@link makeArrayGet} for the factory. */
export interface ArrayGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayGet;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** ref — see the matching factory for semantics. */
  ref: Expression;
  /** Numeric index into the relevant table. */
  index: Expression;
  /** Whether the load is sign-extended (signed=true) or zero-extended. */
  signed: boolean;
}

/** {@link ArraySetExpr} — see {@link makeArraySet} for the factory. */
export interface ArraySetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArraySet;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** ref — see the {@link make} factory for semantics. */
  ref: Expression;
  /** Numeric index into the relevant table. */
  index: Expression;
  /** Value expression. */
  value: Expression;
}

/** {@link ArrayFillExpr} — see {@link makeArrayFill} for the factory. */
export interface ArrayFillExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayFill;
  /** Result type — `array.fill` yields nothing. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** The array reference to write into. */
  ref: Expression;
  /** Start index within the array. */
  index: Expression;
  /** The value written to every filled slot. */
  value: Expression;
  /** Number of elements to fill. */
  size: Expression;
}

/** {@link ArrayCopyExpr} — see {@link makeArrayCopy} for the factory. */
export interface ArrayCopyExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayCopy;
  /** Result type — `array.copy` yields nothing. */
  type: None;
  /** Heap-type index of the DESTINATION array. */
  destTypeVar: Var;
  /** Heap-type index of the SOURCE array. */
  srcTypeVar: Var;
  /** The destination array reference. */
  destRef: Expression;
  /** Start index within the destination. */
  destIndex: Expression;
  /** The source array reference. */
  srcRef: Expression;
  /** Start index within the source. */
  srcIndex: Expression;
  /** Number of elements to copy. */
  size: Expression;
}

/** {@link ArrayInitDataExpr} — see {@link makeArrayInitData} for the factory. */
export interface ArrayInitDataExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayInitData;
  /** Result type — `array.init_data` yields nothing. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** Index of the data segment read from. */
  segment: number;
  /** The array reference to write into. */
  ref: Expression;
  /** Start index within the array. */
  index: Expression;
  /** Byte offset within the data segment. */
  offset: Expression;
  /** Number of elements to write. */
  size: Expression;
}

/** {@link ArrayInitElemExpr} — see {@link makeArrayInitElem} for the factory. */
export interface ArrayInitElemExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayInitElem;
  /** Result type — `array.init_elem` yields nothing. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** Index of the element segment read from. */
  segment: number;
  /** The array reference to write into. */
  ref: Expression;
  /** Start index within the array. */
  index: Expression;
  /** Offset within the element segment. */
  offset: Expression;
  /** Number of elements to write. */
  size: Expression;
}

/** {@link ArrayLenExpr} — see {@link makeArrayLen} for the factory. */
export interface ArrayLenExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ArrayLen;
  /** Result type — the value type yielded at runtime. */
  type: ValType.I32;
  /** ref — see the matching factory for semantics. */
  ref: Expression;
}

/** {@link RefTestExpr} — see {@link makeRefTest} for the factory. */
export interface RefTestExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.RefTest;
  /** Result type — the value type yielded at runtime. */
  type: ValType.I32;
  /** ref — see the matching factory for semantics. */
  ref: Expression;
  /** Target reference type for the cast. */
  castType: HeapType;
  /** Whether the reference type is nullable. */
  nullable: boolean;
}

/** {@link RefCastExpr} — see {@link makeRefCast} for the factory. */
export interface RefCastExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.RefCast;
  /** ref — see the {@link make} factory for semantics. */
  ref: Expression;
  /** Target reference type for the cast. */
  castType: HeapType;
  /** Whether the reference type is nullable. */
  nullable: boolean;
}

/** {@link BrOnExpr} — see {@link makeBrOn} for the factory. */
export interface BrOnExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.BrOn;
  /** Operator code. */
  opcode: BrOnOp;
  /** label — see the matching factory for semantics. */
  label: string;
  /** ref — see the {@link make} factory for semantics. */
  ref: Expression;
  /** Target reference type for the cast (`br_on_cast`/`br_on_cast_fail`). */
  castType?: HeapType | undefined;
  /** Whether the cast TARGET type is nullable (flags bit 1). */
  castNullable?: boolean | undefined;
  /** Source reference heap type (`br_on_cast`/`br_on_cast_fail` first immediate). */
  srcType?: HeapType | undefined;
  /** Whether the SOURCE type is nullable (flags bit 0). */
  srcNullable?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Exception handling (EH proposal)
// ---------------------------------------------------------------------------

/**
 * A catch clause in a `try_table` expression.
 * Mirrors the four catch opcode variants (0x00–0x03) from the EH proposal.
 */
export interface CatchClause {
  /** Tag name, or `null` for `catch_all` / `catch_all_ref`. */
  tag: string | null;
  /** Branch label to jump to when this clause matches. */
  dest: string;
  /** `true` for `catch_ref` and `catch_all_ref` (sends an exnref). */
  isRef: boolean;
}

/** `try_table` expression (new EH proposal). */
export interface TryTableExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.TryTable;
  /** Optional label for the try_table block itself. */
  name: string | null;
  /** The protected body. */
  body: Expression;
  /** catches — see the matching factory for semantics. */
  catches: CatchClause[];
}

/** `try` expression (old/legacy EH). */
export interface TryExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Try;
  /** Label (targetable by `delegate`). */
  name: string | null;
  /** Body expression. */
  body: Expression;
  /** Parallel arrays: catchTags[i] is the tag for catchBodies[i].
   *  An empty string tag signals `catch_all`. */
  catchTags: string[];
  /** catchBodies — see the matching factory for semantics. */
  catchBodies: Expression[];
  /** Set for the `delegate` variant; depth to delegate to. */
  delegateTarget: string | null;
}

/** `throw $tag operands*` expression. Always has type `unreachable`. */
export interface ThrowExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Throw;
  /** tag — see the {@link make} factory for semantics. */
  tag: string;
  /** Argument expressions in declaration order. */
  operands: Expression[];
}

/** `throw_ref $exnref` expression (new EH). Always has type `unreachable`. */
export interface ThrowRefExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.ThrowRef;
  /** exnref — see the {@link make} factory for semantics. */
  exnref: Expression;
}

/** `rethrow $depth` expression (old EH). Always has type `unreachable`. */
export interface RethrowExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Rethrow;
  /** Label of the enclosing try whose caught exception to rethrow. */
  target: string;
}

/** `pop` pseudo-instruction — implicit value producer at start of catch handlers. */
export interface PopExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Pop;
}

// ---------------------------------------------------------------------------
// SIMD expression node types
// ---------------------------------------------------------------------------

/** `*.extract_lane` — extract a scalar lane from a v128. */
export interface SIMDExtractExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.SIMDExtract;
  /** Operator code. */
  opcode: SIMDExtractOp;
  /** vec — see the matching factory for semantics. */
  vec: Expression;
  /** Lane index for the SIMD operation. */
  lane: number;
}

/** `*.replace_lane` — replace a scalar lane in a v128. */
export interface SIMDReplaceExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.SIMDReplace;
  /** Operator code. */
  opcode: SIMDReplaceOp;
  /** vec — see the matching factory for semantics. */
  vec: Expression;
  /** Lane index for the SIMD operation. */
  lane: number;
  /** Value expression. */
  value: Expression;
}

/** `i8x16.shuffle` — byte-level permute of two v128 operands. */
export interface SIMDShuffleExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.SIMDShuffle;
  /** Left-hand operand. */
  left: Expression;
  /** Right-hand operand. */
  right: Expression;
  /** 16-byte immediate lane-select mask. */
  mask: Uint8Array;
}

/** `v128.bitselect` and relaxed ternary SIMD ops. */
/**
 * Wide arithmetic: `i64.add128` (0xfc 0x13) and `i64.sub128` (0xfc 0x14).
 *
 * Four i64 operands — two 128-bit values as (lo, hi) pairs — and TWO i64
 * results, so the node's type is a tuple.
 *
 * ⚠️ **Shaped to match wabt-ts's `quaternary`, deliberately.** wabt-ts was the
 * only side that implemented these at all, so under the worst-condition rule its
 * shape controls; inventing a binaryen-ts-specific node would have left S6 three
 * shapes to reconcile instead of one. `i64.mul_wide_s`/`_u` are NOT here — they
 * take two operands, so they are `BinaryOp` members, exactly as in wabt-ts.
 */
export const QuaternaryOp = {
  Add128: (0xfc << 16) | 0x13, // i64.add128
  Sub128: (0xfc << 16) | 0x14, // i64.sub128
} as const;

/**
 * An operator is an OPCODE, so the field admits every instruction — including
 * the ~116 that have no member above. See S6 stage 1 in cmem/ir-convergence.md.
 */
export type QuaternaryOp = Opcode;

/** Four-operand numeric node — the wide-arithmetic proposal. */
export interface QuaternaryExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.Quaternary;
  /** Two i64 results: the low and high halves of the 128-bit sum. */
  type: TupleType;
  opcode: QuaternaryOp;
  a: Expression;
  b: Expression;
  c: Expression;
  d: Expression;
}

/** Creates a wide-arithmetic (`i64.add128` / `i64.sub128`) expression. */
export function makeQuaternary(
  opcode: QuaternaryOp,
  a: Expression,
  b: Expression,
  c: Expression,
  d: Expression,
): QuaternaryExpr {
  return {
    kind: ExpressionKind.Quaternary,
    type: [ValType.I64, ValType.I64],
    opcode,
    a,
    b,
    c,
    d,
  };
}

export interface SIMDTernaryExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.SIMDTernary;
  /** Operator code. */
  opcode: SIMDTernaryOp;
  /** First operand. */
  a: Expression;
  /** Second operand. */
  b: Expression;
  /** Third operand. */
  c: Expression;
}

/** `*.shl` / `*.shr_s` / `*.shr_u` — SIMD lane shift (vec: v128, shift: i32). */
export interface SIMDShiftExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.SIMDShift;
  /** Operator code. */
  opcode: SIMDShiftOp;
  /** vec — see the matching factory for semantics. */
  vec: Expression;
  /** Shift amount operand. */
  shift: Expression;
}

/** Extended SIMD loads: splat, extend (8x8/16x4/32x2), and zero-extend. */
export interface SIMDLoadExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.SIMDLoad;
  /** Operator code. */
  opcode: SIMDLoadOp;
  /** Address operand. */
  ptr: Expression;
  /** Static byte offset added to the address operand. */
  offset: number;
  /** Power-of-two alignment hint (e.g. 0=byte, 2=i32). */
  align: number;
}

/** `v128.loadN_lane` / `v128.storeN_lane`. */
export interface SIMDLoadStoreLaneExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memory?: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: ExpressionKind.SIMDLoadStoreLane;
  /** Operator code. */
  opcode: SIMDLoadStoreLaneOp;
  /** Address operand. */
  ptr: Expression;
  /** vec — see the {@link make} factory for semantics. */
  vec: Expression;
  /** Static byte offset added to the address operand. */
  offset: number;
  /** Power-of-two alignment hint (e.g. 0=byte, 2=i32). */
  align: number;
  /** Lane index for the SIMD operation. */
  lane: number;
}

// ---------------------------------------------------------------------------
// Top-level Expression union
// ---------------------------------------------------------------------------

/**
 * The union of all IR expression node types.
 * Use the `kind` discriminant to narrow to a specific variant.
 */
export type Expression =
  | NopExpr
  | UnreachableExpr
  | BlockExpr
  | IfExpr
  | LoopExpr
  | BreakExpr
  | SwitchExpr
  | ReturnExpr
  | ConstExpr
  | LocalGetExpr
  | LocalSetExpr
  | LocalTeeExpr
  | TableGetExpr
  | TableSetExpr
  | GlobalGetExpr
  | GlobalSetExpr
  | UnaryExpr
  | BinaryExpr
  | SelectExpr
  | DropExpr
  | LoadExpr
  | StoreExpr
  | MemoryGrowExpr
  | MemorySizeExpr
  | TableInitExpr
  | ElemDropExpr
  | MemoryInitExpr
  | DataDropExpr
  | TableSizeExpr
  | TableGrowExpr
  | TableFillExpr
  | TableCopyExpr
  | MemoryCopyExpr
  | MemoryFillExpr
  | CallExpr
  | CallIndirectExpr
  | RefNullExpr
  | RefIsNullExpr
  | RefAsExpr
  | TupleMakeExpr
  | RefFuncExpr
  | RefEqExpr
  | RefI31Expr
  | I31GetExpr
  | StructNewExpr
  | StructGetExpr
  | StructSetExpr
  | ArrayNewExpr
  | ArrayNewFixedExpr
  | ArrayNewDataExpr
  | ArrayNewElemExpr
  | ArrayGetExpr
  | ArraySetExpr
  | ArrayFillExpr
  | ArrayCopyExpr
  | ArrayInitDataExpr
  | ArrayInitElemExpr
  | ArrayLenExpr
  | RefTestExpr
  | RefCastExpr
  | BrOnExpr
  | TryTableExpr
  | TryExpr
  | ThrowExpr
  | ThrowRefExpr
  | RethrowExpr
  | PopExpr
  | SIMDExtractExpr
  | SIMDReplaceExpr
  | SIMDShuffleExpr
  | SIMDTernaryExpr
  | QuaternaryExpr
  | SIMDShiftExpr
  | SIMDLoadExpr
  | SIMDLoadStoreLaneExpr;

// ---------------------------------------------------------------------------
// Builder helpers (factory functions)
// ---------------------------------------------------------------------------

/** Creates an `i32` constant expression. */
export function makeI32Const(value: number): ConstExpr {
  return { kind: ExpressionKind.Const, type: ValType.I32, value: { i32: value } };
}

/** Creates an `i64` constant expression. */
export function makeI64Const(value: bigint): ConstExpr {
  return { kind: ExpressionKind.Const, type: ValType.I64, value: { i64: value } };
}

/** Creates an `f32` constant expression. */
export function makeF32Const(value: number): ConstExpr {
  return { kind: ExpressionKind.Const, type: ValType.F32, value: { f32: value } };
}

/** Creates an `f64` constant expression. */
export function makeF64Const(value: number): ConstExpr {
  return { kind: ExpressionKind.Const, type: ValType.F64, value: { f64: value } };
}

/** Creates a `global.get` expression. */
export function makeGlobalGet(name: string, type: ValueType): GlobalGetExpr {
  return { kind: ExpressionKind.GlobalGet, type, name };
}

/** Creates a `global.set` expression (result type is `none`). */
export function makeGlobalSet(name: string, value: Expression): GlobalSetExpr {
  return { kind: ExpressionKind.GlobalSet, type: None, name, value };
}

/** Creates a `local.get` expression. */
export function makeLocalGet(index: number, type: ValueType): LocalGetExpr {
  return { kind: ExpressionKind.LocalGet, type, index };
}

/** Creates a `local.set` expression (result type is `none`). */
export function makeLocalSet(index: number, value: Expression): LocalSetExpr {
  return { kind: ExpressionKind.LocalSet, type: None, index, value };
}

/** Creates a `local.tee` expression (result type matches the value). */
export function makeLocalTee(index: number, value: Expression, type: ValueType): LocalTeeExpr {
  return { kind: ExpressionKind.LocalTee, type, index, value };
}

/** Creates a `table.get` expression. Default element type is `funcref` (the
 *  most common reference table); pass `externref` for tables holding host
 *  references. */
export function makeTableGet(
  table: string,
  index: Expression,
  type: ValType = ValType.FuncRef,
): TableGetExpr {
  return { kind: ExpressionKind.TableGet, type, table, index };
}

/** Creates a `table.set` expression (result type is `none`). */
export function makeTableSet(
  table: string,
  index: Expression,
  value: Expression,
): TableSetExpr {
  return { kind: ExpressionKind.TableSet, type: None, table, index, value };
}

/** Creates a binary expression. */
export function makeBinary(opcode: BinaryOp, left: Expression, right: Expression): BinaryExpr {
  const type = inferBinaryType(opcode);
  return { kind: ExpressionKind.Binary, type, opcode, left, right };
}

/** Creates a unary expression. */
export function makeUnary(opcode: UnaryOp, value: Expression): UnaryExpr {
  const type = inferUnaryType(opcode);
  return { kind: ExpressionKind.Unary, type, opcode, value };
}

/** Creates a `return` expression. */
export function makeReturn(value: Expression | null = null): ReturnExpr {
  // A `return` is a control-flow transfer, not a value producer: it never
  // yields a value to its enclosing block, so its type is always `unreachable`
  // (matches upstream `Return() { type = Type::unreachable; }` in wasm.h). The
  // returned *value's* type lives on `value.type`; the node's own type must not
  // leak into block type-inference, or a block ending in `(return x)` would be
  // mistyped as `x`'s type instead of `unreachable`.
  return { kind: ExpressionKind.Return, type: Unreachable, value };
}

/** Creates a `call` expression. */
export function makeCall(
  target: string,
  operands: Expression[],
  resultType: Type,
  isReturn = false,
): CallExpr {
  return { kind: ExpressionKind.Call, type: resultType, target, operands, isReturn };
}

/** Creates an `if` expression. The optional `name` is the `if`'s branch-target label. */
export function makeIf(
  condition: Expression,
  ifTrue: Expression,
  ifFalse: Expression | null = null,
  name?: string,
): IfExpr {
  // Type follows upstream `If::finalize`:
  //  - no `else` → `none` (the `then` may be skipped, so nothing flows out);
  //  - with `else` → the result type of the REACHABLE arm. When one arm is
  //    `unreachable` the type is the other arm's type; only when BOTH arms are
  //    unreachable is the `if` itself unreachable.
  // Blindly taking `ifTrue.type` mistyped an `if` as `unreachable` whenever its
  // `then` arm ended in a control transfer (`br`/`return`, correctly typed
  // `unreachable`) even though the `else` arm fell through — which made DCE
  // treat everything after the `if` as dead and delete live code (e.g. a loop
  // back-edge `br`, silently breaking the loop so it ran once and returned 0).
  let type: Type;
  if (!ifFalse) {
    type = None;
  } else if (ifTrue.type === Unreachable) {
    type = typeOf(ifFalse);
  } else {
    type = typeOf(ifTrue);
  }
  return {
    kind: ExpressionKind.If,
    type,
    condition,
    ifTrue,
    ifFalse,
    name,
  };
}

/** Creates a `block` expression. */
export function makeBlock(
  children: Expression[],
  name: string | null = null,
): BlockExpr {
  const last = children[children.length - 1];
  const type: Type = last ? typeOf(last) : None;
  return { kind: ExpressionKind.Block, type, name, children };
}

/** Creates a `drop` expression (discards a value). */
export function makeDrop(value: Expression): DropExpr {
  return { kind: ExpressionKind.Drop, type: None, value };
}

/** Creates a `nop` expression. */
export function makeNop(): NopExpr {
  return { kind: ExpressionKind.Nop, type: None };
}

/** Creates an `unreachable` expression. */
export function makeUnreachable(): UnreachableExpr {
  return { kind: ExpressionKind.Unreachable, type: Unreachable };
}

/** Creates a `loop` expression. */
export function makeLoop(name: string, body: Expression, resultType: Type = None): LoopExpr {
  return { kind: ExpressionKind.Loop, type: resultType, name, body };
}

/** Creates a `br` or `br_if` expression. */
export function makeBreak(
  name: string,
  condition: Expression | null = null,
  value: Expression | null = null,
): BreakExpr {
  // Mirrors upstream `Break::finalize`: an UNCONDITIONAL `br` always transfers
  // control, so its type is `unreachable` — a block ending in `(br $l)` is
  // therefore unreachable at its end, which is exactly what lets a result-typed
  // loop/block whose body exits via a back-edge validate (the implicit end is
  // unreachable, so no fallthrough value is required). A conditional `br_if`
  // falls through when the condition is false, so it takes the value's type
  // (or `none` when value-less).
  const type: Type = condition === null ? Unreachable : value ? typeOf(value) : None;
  return { kind: ExpressionKind.Break, type, name, condition, value };
}

/** Creates a `br_table` expression. */
export function makeSwitch(
  targets: string[],
  defaultTarget: string,
  condition: Expression,
  value: Expression | null = null,
): SwitchExpr {
  // `br_table` always branches (it is unconditional — the operand only selects
  // WHICH target), so it is `unreachable`, matching upstream `Switch() { type =
  // Type::unreachable; }`. As with `br`, this keeps a block ending in a
  // `br_table` correctly unreachable for type-inference purposes.
  return {
    kind: ExpressionKind.Switch,
    type: Unreachable,
    targets,
    defaultTarget,
    condition,
    value,
  };
}

/** Creates a `select` expression. */
export function makeSelect(
  ifTrue: Expression,
  ifFalse: Expression,
  condition: Expression,
): SelectExpr {
  // A `select` always has both arms, so its result type is the type of the
  // reachable arm — `unreachable` only when BOTH arms are unreachable. Taking
  // `ifTrue.type` blindly mistyped a select whose `ifTrue` is `unreachable`
  // (e.g. it ends in a trap/branch) even though `ifFalse` yields a real value,
  // the same hazard `makeIf` was fixed for.
  const type: Type = typeOf(ifTrue) === Unreachable ? typeOf(ifFalse) : typeOf(ifTrue);
  return { kind: ExpressionKind.Select, type, ifTrue, ifFalse, condition };
}

/** Creates a `call_indirect` expression. */
export function makeCallIndirect(
  table: string,
  target: Expression,
  operands: Expression[],
  params: ValueType[],
  results: ValueType[],
  isReturn = false,
): CallIndirectExpr {
  const type: Type = results[0] ?? None;
  return {
    kind: ExpressionKind.CallIndirect,
    type,
    table,
    target,
    operands,
    params,
    results,
    isReturn,
  };
}

/** Creates a memory load expression. */
export function makeLoad(
  bytes: 1 | 2 | 4 | 8 | 16,
  signed: boolean,
  offset: number,
  align: number,
  ptr: Expression,
  resultType: ValType,
  memory: Var = varIndex(0),
): LoadExpr {
  return {
    kind: ExpressionKind.Load,
    type: resultType,
    bytes,
    signed,
    offset,
    align,
    ptr,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
  };
}

/** Creates a memory store expression. */
export function makeStore(
  bytes: 1 | 2 | 4 | 8 | 16,
  offset: number,
  align: number,
  ptr: Expression,
  value: Expression,
  memory: Var = varIndex(0),
): StoreExpr {
  return {
    kind: ExpressionKind.Store,
    type: None,
    bytes,
    offset,
    align,
    ptr,
    value,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
  };
}

/** Creates a `memory.size` expression. */
export function makeMemorySize(memory: Var = varIndex(0)): MemorySizeExpr {
  return {
    kind: ExpressionKind.MemorySize,
    type: ValType.I32,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
  };
}

/** Creates a `memory.grow` expression. */
export function makeMemoryGrow(delta: Expression, memory: Var = varIndex(0)): MemoryGrowExpr {
  return {
    kind: ExpressionKind.MemoryGrow,
    type: ValType.I32,
    delta,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
  };
}

/** Creates a `table.init` expression. */
export function makeTableInit(
  segment: string,
  table: string,
  dest: Expression,
  offset: Expression,
  size: Expression,
): TableInitExpr {
  return { kind: ExpressionKind.TableInit, type: None, segment, table, dest, offset, size };
}

/** Creates an `elem.drop` expression. */
export function makeElemDrop(segment: string): ElemDropExpr {
  return { kind: ExpressionKind.ElemDrop, type: None, segment };
}

/** Creates a `memory.init` expression. */
export function makeMemoryInit(
  segment: string,
  dest: Expression,
  offset: Expression,
  size: Expression,
  memory: Var = varIndex(0),
): MemoryInitExpr {
  return {
    kind: ExpressionKind.MemoryInit,
    type: None,
    segment,
    dest,
    offset,
    size,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
  };
}

/** Creates a `data.drop` expression. */
export function makeDataDrop(segment: string): DataDropExpr {
  return { kind: ExpressionKind.DataDrop, type: None, segment };
}

/** Creates a `table.size` expression. */
export function makeTableSize(table: string): TableSizeExpr {
  return { kind: ExpressionKind.TableSize, type: ValType.I32, table };
}

/** Creates a `table.grow` expression. */
export function makeTableGrow(
  table: string,
  value: Expression,
  delta: Expression,
): TableGrowExpr {
  return { kind: ExpressionKind.TableGrow, type: ValType.I32, table, value, delta };
}

/** Creates a `table.fill` expression. */
export function makeTableFill(
  table: string,
  dest: Expression,
  value: Expression,
  size: Expression,
): TableFillExpr {
  return { kind: ExpressionKind.TableFill, type: None, table, dest, value, size };
}

/** Creates a `table.copy` expression. */
export function makeTableCopy(
  destTable: string,
  sourceTable: string,
  dest: Expression,
  source: Expression,
  size: Expression,
): TableCopyExpr {
  return {
    kind: ExpressionKind.TableCopy,
    type: None,
    destTable,
    sourceTable,
    dest,
    source,
    size,
  };
}

/** Creates a `memory.copy` expression. */
export function makeMemoryCopy(
  dest: Expression,
  source: Expression,
  size: Expression,
  memory: Var = varIndex(0),
  sourceMemory: Var = varIndex(0),
): MemoryCopyExpr {
  return {
    kind: ExpressionKind.MemoryCopy,
    type: None,
    dest,
    source,
    size,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
    ...(indexOf(sourceMemory) !== 0 ? { sourceMemory } : {}),
  };
}

/** Creates a `memory.fill` expression. */
export function makeMemoryFill(
  dest: Expression,
  value: Expression,
  size: Expression,
  memory: Var = varIndex(0),
): MemoryFillExpr {
  return {
    kind: ExpressionKind.MemoryFill,
    type: None,
    dest,
    value,
    size,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
  };
}

/**
 * Creates a `ref.null` expression.
 *
 * Accepts a concrete `(ref null $T)` as well as an abstract reference type; the
 * encoder writes the corresponding heap type either way.
 */
export function makeRefNull(type: ValueType): RefNullExpr {
  return { kind: ExpressionKind.RefNull, type };
}

/** Creates a `ref.func` expression. */
export function makeRefFunc(func: string, type: ValType = ValType.FuncRef): RefFuncExpr {
  return { kind: ExpressionKind.RefFunc, type, func };
}

/** Creates a `ref.is_null` expression. */
export function makeRefIsNull(value: Expression): RefIsNullExpr {
  return { kind: ExpressionKind.RefIsNull, type: ValType.I32, value };
}

/**
 * Creates a `ref.as_non_null` expression.
 *
 * Traps at runtime if `value` is null; otherwise yields the same reference
 * with a non-nullable type. `resultType` should be the operand's heap type
 * with `nullable: false`.
 */
/**
 * Creates a `tuple.make` expression — N values delivered as one operand.
 *
 * There is no `tuple.make` opcode in wasm. It is how the IR names "these N
 * expressions, left to right, leaving N values on the stack", which is what a
 * multi-value `br` / `br_if` / `br_table` / `return` carries and what a
 * multi-result block falls through with. The encoder therefore emits the
 * operands in order and nothing else.
 *
 * Its type is the {@link TupleType} of the operand types, so a single-valued
 * consumer that mistakes it for a scalar is caught by the type rather than
 * silently taking only the first component.
 */
export function makeTupleMake(operands: Expression[]): TupleMakeExpr {
  return {
    kind: ExpressionKind.TupleMake,
    type: operands.map((o) => o.type) as TupleType,
    operands,
  };
}

/**
 * Creates a `ref.as_non_null` expression: asserts `value` is not null and
 * narrows it to the non-nullable `resultType`, trapping if it is null.
 *
 * `resultType` is passed rather than derived because the non-nullable form of a
 * reference type is not recoverable from `value.type` alone once a heap type is
 * concrete.
 */
export function makeRefAsNonNull(value: Expression, resultType: Type): RefAsExpr {
  return { kind: ExpressionKind.RefAs, type: resultType, opcode: RefAsOp.RefAsNonNull, value };
}

/** Creates a ref.eq expression. */
export function makeRefEq(left: Expression, right: Expression): RefEqExpr {
  return { kind: ExpressionKind.RefEq, type: ValType.I32, left, right };
}

/** Creates a ref.i31 expression. */
export function makeRefI31(value: Expression, resultType: Type): RefI31Expr {
  return { kind: ExpressionKind.RefI31, type: resultType, value };
}

/** Creates an i31.get_s or i31.get_u expression. */
export function makeI31Get(i31: Expression, signed: boolean): I31GetExpr {
  return { kind: ExpressionKind.I31Get, type: ValType.I32, i31, signed };
}

/** Creates a struct.new expression. */
export function makeStructNew(
  typeVar: Var,
  operands: Expression[],
  resultType: Type,
): StructNewExpr {
  return {
    kind: ExpressionKind.StructNew,
    type: resultType,
    typeVar,
    operands,
    defaultInit: false,
  };
}

/** Creates a struct.new_default expression. */
export function makeStructNewDefault(typeVar: Var, resultType: Type): StructNewExpr {
  return {
    kind: ExpressionKind.StructNew,
    type: resultType,
    typeVar,
    operands: [],
    defaultInit: true,
  };
}

/** Creates a struct.get expression. */
export function makeStructGet(
  typeVar: Var,
  fieldIndex: number,
  ref: Expression,
  resultType: Type,
  signed = false,
): StructGetExpr {
  return { kind: ExpressionKind.StructGet, type: resultType, typeVar, fieldIndex, ref, signed };
}

/** Creates a struct.set expression. */
export function makeStructSet(
  typeVar: Var,
  fieldIndex: number,
  ref: Expression,
  value: Expression,
): StructSetExpr {
  return { kind: ExpressionKind.StructSet, type: None, typeVar, fieldIndex, ref, value };
}

/** Creates an array.new expression. */
export function makeArrayNew(
  typeVar: Var,
  init: Expression,
  length: Expression,
  resultType: Type,
): ArrayNewExpr {
  return { kind: ExpressionKind.ArrayNew, type: resultType, typeVar, init, length };
}

/** Creates an array.new_default expression. */
export function makeArrayNewDefault(
  typeVar: Var,
  length: Expression,
  resultType: Type,
): ArrayNewExpr {
  return { kind: ExpressionKind.ArrayNew, type: resultType, typeVar, init: null, length };
}

/** Creates an array.new_fixed expression. */
export function makeArrayNewFixed(
  typeVar: Var,
  values: Expression[],
  resultType: Type,
): ArrayNewFixedExpr {
  return { kind: ExpressionKind.ArrayNewFixed, type: resultType, typeVar, values };
}

/** Creates an array.new_data expression. */
export function makeArrayNewData(
  typeVar: Var,
  dataSegment: number,
  offset: Expression,
  length: Expression,
  resultType: Type,
): ArrayNewDataExpr {
  return {
    kind: ExpressionKind.ArrayNewData,
    type: resultType,
    typeVar,
    dataSegment,
    offset,
    length,
  };
}

/** Creates an array.new_elem expression. */
export function makeArrayNewElem(
  typeVar: Var,
  elemSegment: number,
  offset: Expression,
  length: Expression,
  resultType: Type,
): ArrayNewElemExpr {
  return {
    kind: ExpressionKind.ArrayNewElem,
    type: resultType,
    typeVar,
    elemSegment,
    offset,
    length,
  };
}

/** Creates an array.get expression. */
export function makeArrayGet(
  typeVar: Var,
  ref: Expression,
  index: Expression,
  resultType: Type,
  signed = false,
): ArrayGetExpr {
  return { kind: ExpressionKind.ArrayGet, type: resultType, typeVar, ref, index, signed };
}

/** Creates an array.set expression. */
export function makeArraySet(
  typeVar: Var,
  ref: Expression,
  index: Expression,
  value: Expression,
): ArraySetExpr {
  return { kind: ExpressionKind.ArraySet, type: None, typeVar, ref, index, value };
}

/** Creates an `array.fill $T` expression (fills `size` slots from `index`). */
export function makeArrayFill(
  typeVar: Var,
  ref: Expression,
  index: Expression,
  value: Expression,
  size: Expression,
): ArrayFillExpr {
  return { kind: ExpressionKind.ArrayFill, type: None, typeVar, ref, index, value, size };
}

/** Creates an `array.copy $Tdest $Tsrc` expression. */
export function makeArrayCopy(
  destTypeVar: Var,
  srcTypeVar: Var,
  destRef: Expression,
  destIndex: Expression,
  srcRef: Expression,
  srcIndex: Expression,
  size: Expression,
): ArrayCopyExpr {
  return {
    kind: ExpressionKind.ArrayCopy,
    type: None,
    destTypeVar,
    srcTypeVar,
    destRef,
    destIndex,
    srcRef,
    srcIndex,
    size,
  };
}

/** Creates an `array.init_data $T $seg` expression. */
export function makeArrayInitData(
  typeVar: Var,
  segment: number,
  ref: Expression,
  index: Expression,
  offset: Expression,
  size: Expression,
): ArrayInitDataExpr {
  return {
    kind: ExpressionKind.ArrayInitData,
    type: None,
    typeVar,
    segment,
    ref,
    index,
    offset,
    size,
  };
}

/** Creates an `array.init_elem $T $seg` expression. */
export function makeArrayInitElem(
  typeVar: Var,
  segment: number,
  ref: Expression,
  index: Expression,
  offset: Expression,
  size: Expression,
): ArrayInitElemExpr {
  return {
    kind: ExpressionKind.ArrayInitElem,
    type: None,
    typeVar,
    segment,
    ref,
    index,
    offset,
    size,
  };
}

/** Creates an array.len expression. */
export function makeArrayLen(ref: Expression): ArrayLenExpr {
  return { kind: ExpressionKind.ArrayLen, type: ValType.I32, ref };
}

/** Creates a ref.test or ref.test null expression. */
export function makeRefTest(ref: Expression, castType: HeapType, nullable: boolean): RefTestExpr {
  return { kind: ExpressionKind.RefTest, type: ValType.I32, ref, castType, nullable };
}

/** Creates a ref.cast or ref.cast null expression. */
export function makeRefCast(
  ref: Expression,
  castType: HeapType,
  nullable: boolean,
  resultType: Type,
): RefCastExpr {
  return { kind: ExpressionKind.RefCast, type: resultType, ref, castType, nullable };
}

/** Creates a br_on_null, br_on_non_null, br_on_cast, or br_on_cast_fail expression. */
export function makeBrOn(
  opcode: BrOnOp,
  label: string,
  ref: Expression,
  resultType: Type,
  castType?: HeapType,
  castNullable?: boolean,
  srcType?: HeapType,
  srcNullable?: boolean,
): BrOnExpr {
  return {
    kind: ExpressionKind.BrOn,
    type: resultType,
    opcode,
    label,
    ref,
    castType,
    castNullable,
    srcType,
    srcNullable,
  };
}

/** Creates a `try_table` expression. */
export function makeTryTable(
  name: string | null,
  body: Expression,
  catches: CatchClause[],
  resultType: Type,
): TryTableExpr {
  return { kind: ExpressionKind.TryTable, type: resultType, name, body, catches };
}

/** Creates a `try` expression (old EH). */
export function makeTry(
  name: string | null,
  body: Expression,
  catchTags: string[],
  catchBodies: Expression[],
  delegateTarget: string | null,
  resultType: Type,
): TryExpr {
  return {
    kind: ExpressionKind.Try,
    type: resultType,
    name,
    body,
    catchTags,
    catchBodies,
    delegateTarget,
  };
}

/** Creates a `throw $tag operands*` expression. */
export function makeThrow(tag: string, operands: Expression[]): ThrowExpr {
  return { kind: ExpressionKind.Throw, type: Unreachable, tag, operands };
}

/** Creates a `throw_ref` expression. */
export function makeThrowRef(exnref: Expression): ThrowRefExpr {
  return { kind: ExpressionKind.ThrowRef, type: Unreachable, exnref };
}

/** Creates a `rethrow $depth` expression (old EH). */
export function makeRethrow(target: string): RethrowExpr {
  return { kind: ExpressionKind.Rethrow, type: Unreachable, target };
}

/** Creates a `pop` pseudo-instruction. */
export function makePop(type: Type): PopExpr {
  return { kind: ExpressionKind.Pop, type };
}

/** Creates a `v128.const` expression from 16 raw bytes. */
export function makeV128Const(bytes: Uint8Array): ConstExpr {
  return { kind: ExpressionKind.Const, type: ValType.V128, value: { v128: bytes } };
}

/** Creates a `*.extract_lane` SIMD expression. */
export function makeSIMDExtract(
  opcode: SIMDExtractOp,
  vec: Expression,
  lane: number,
): SIMDExtractExpr {
  const type = _simdExtractResultType(opcode);
  return { kind: ExpressionKind.SIMDExtract, type, opcode, vec, lane };
}

/** Creates a `*.replace_lane` SIMD expression. */
export function makeSIMDReplace(
  opcode: SIMDReplaceOp,
  vec: Expression,
  lane: number,
  value: Expression,
): SIMDReplaceExpr {
  return { kind: ExpressionKind.SIMDReplace, type: ValType.V128, opcode, vec, lane, value };
}

/** Creates an `i8x16.shuffle` expression. */
export function makeSIMDShuffle(
  left: Expression,
  right: Expression,
  mask: Uint8Array,
): SIMDShuffleExpr {
  return { kind: ExpressionKind.SIMDShuffle, type: ValType.V128, left, right, mask };
}

/** Creates a `v128.bitselect` or relaxed ternary SIMD expression. */
export function makeSIMDTernary(
  opcode: SIMDTernaryOp,
  a: Expression,
  b: Expression,
  c: Expression,
): SIMDTernaryExpr {
  return { kind: ExpressionKind.SIMDTernary, type: ValType.V128, opcode, a, b, c };
}

/** Creates a `*.shl` / `*.shr_s` / `*.shr_u` SIMD shift expression. */
export function makeSIMDShift(
  opcode: SIMDShiftOp,
  vec: Expression,
  shift: Expression,
): SIMDShiftExpr {
  return { kind: ExpressionKind.SIMDShift, type: ValType.V128, opcode, vec, shift };
}

/** Creates a SIMD extended load expression (splat, extend, or zero-extend). */
export function makeSIMDLoad(
  opcode: SIMDLoadOp,
  ptr: Expression,
  offset: number,
  align: number,
  memory: Var = varIndex(0),
): SIMDLoadExpr {
  return {
    kind: ExpressionKind.SIMDLoad,
    type: ValType.V128,
    opcode,
    ptr,
    offset,
    align,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
  };
}

/** Creates a `v128.loadN_lane` or `v128.storeN_lane` expression. */
export function makeSIMDLoadStoreLane(
  opcode: SIMDLoadStoreLaneOp,
  ptr: Expression,
  vec: Expression,
  offset: number,
  align: number,
  lane: number,
  memory: Var = varIndex(0),
): SIMDLoadStoreLaneExpr {
  const isStore = opcode === SIMDLoadStoreLaneOp.Store8LaneVec128 ||
    opcode === SIMDLoadStoreLaneOp.Store16LaneVec128 ||
    opcode === SIMDLoadStoreLaneOp.Store32LaneVec128 ||
    opcode === SIMDLoadStoreLaneOp.Store64LaneVec128;
  return {
    kind: ExpressionKind.SIMDLoadStoreLane,
    type: isStore ? None : ValType.V128,
    opcode,
    ptr,
    vec,
    offset,
    align,
    lane,
    ...(indexOf(memory) !== 0 ? { memory } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internal type inference helpers
// ---------------------------------------------------------------------------

function inferBinaryType(opcode: BinaryOp): ValType {
  // The operator is an OPCODE now, so the name comes from the table.
  // The tests below are unchanged.
  const name = anyOpcodeName(opcode);
  // SIMD ops all return v128 (including SIMD comparisons, unlike scalar comparisons)
  if (
    name.startsWith('i8x16.') || name.startsWith('i16x8.') || name.startsWith('i32x4.') ||
    name.startsWith('i64x2.') || name.startsWith('f32x4.') || name.startsWith('f64x2.') ||
    name.startsWith('v128.')
  ) return ValType.V128;
  // Scalar RELATIONAL ops (eq/ne/lt/gt/le/ge, with optional _s/_u) always yield i32
  // regardless of operand width — `f64.le`, `i64.eq`, `f32.gt`, etc. all return i32.
  // Without this, the operand-prefix fallthrough below mistyped them as the operand
  // type (e.g. `f64.le` → f64). That wrong type then propagated through `makeIf`
  // (which infers an `if`'s result type from its `then` arm), so a round-tripped
  // `(if (result i32) (f64.cmp …) (then (f64.cmp …)) (else (i32.const 0)))` was
  // re-emitted with block type `f64` and the module failed validation.
  if (/\.(eq|ne|lt|gt|le|ge)(_[su])?$/.test(name)) return ValType.I32;
  if (name.startsWith('i32')) return ValType.I32;
  if (name.startsWith('i64')) return ValType.I64;
  if (name.startsWith('f32')) return ValType.F32;
  return ValType.F64;
}

function inferUnaryType(opcode: UnaryOp): ValType {
  // The operator is an OPCODE now, so the name comes from the table.
  // The tests below are unchanged.
  const name = anyOpcodeName(opcode);
  // SIMD reduction ops return i32
  if (name.endsWith('.all_true') || name.endsWith('.bitmask') || opcode === UnaryOp.AnyTrueVec128) {
    return ValType.I32;
  }
  // All other SIMD ops return v128
  if (
    name.startsWith('i8x16.') || name.startsWith('i16x8.') || name.startsWith('i32x4.') ||
    name.startsWith('i64x2.') || name.startsWith('f32x4.') || name.startsWith('f64x2.') ||
    name.startsWith('v128.')
  ) return ValType.V128;
  // `eqz` is a relational unary — both `i32.eqz` and `i64.eqz` return i32, so the
  // operand-prefix fallthrough below would mistype `i64.eqz` as i64.
  if (name.endsWith('.eqz')) return ValType.I32;
  if (name.startsWith('i32')) return ValType.I32;
  if (name.startsWith('i64')) return ValType.I64;
  if (name.startsWith('f32')) return ValType.F32;
  return ValType.F64;
}

function _simdExtractResultType(opcode: SIMDExtractOp): ValType {
  if (opcode === SIMDExtractOp.ExtractLaneVecI64x2) return ValType.I64;
  if (opcode === SIMDExtractOp.ExtractLaneVecF32x4) return ValType.F32;
  if (opcode === SIMDExtractOp.ExtractLaneVecF64x2) return ValType.F64;
  return ValType.I32;
}
