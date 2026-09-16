/**
 * @module binaryen-ts/ir/expressions
 *
 * WebAssembly expression (instruction) node types for the binaryen-ts IR.
 *
 * Every node in the IR tree is one of the discriminated-union variants below,
 * each with a unique `kind` field. This mirrors the `ExpressionId` enum and
 * per-expression structs in the upstream Binaryen C++ source (`WebAssembly/binaryen/src/wasm.h`).
 *
 * **Tree invariant** (inherited from Binaryen): each node must have exactly
 * one parent. Never share expression nodes between positions in the tree.
 *
 * @example
 * ```ts
 * import {
 *   BinaryOp,
 *   makeBinary,
 *   makeI32Const,
 *   makeLocalGet,
 *   ValType,
 * } from "@jrmarcum/binaryang/ir/binaryen-ts";
 * import { varIndex } from "@jrmarcum/binaryang/ir/wabt-ts";
 *
 * const expr = makeBinary(
 *   BinaryOp.AddI32,
 *   makeLocalGet(varIndex(0), ValType.I32),
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
import {
  type BrOnOp,
  type Const,
  heapAbstract,
  requireName,
  type Var,
  varIndex,
  varName,
} from '../../wabt-ts/ir/ir.ts';
import type { Location } from '../../wabt-ts/core/error.ts';
import type { BlockResult } from '../../wabt-ts/ir/ir.ts';
import { None, type TupleType, type Type, typeToString, Unreachable, ValType } from './types.ts';
import { AbstractHeapType, type HeapType, isRefType, type ValueType } from './gc-types.ts';
import { loadShape, storeShape } from './memory-access.ts';
export type { HeapType, RefType, ValueType } from './gc-types.ts';

// ---------------------------------------------------------------------------
// Expression kind discriminant
// ---------------------------------------------------------------------------

/**
 * Discriminant tag for every expression variant.
 * Mirrors `BinaryenExpressionId` / `ExpressionId` in Binaryen.
 *
 * A const object with a same-named union type, not an enum (S6 step 5, item 5
 * (2)): each member IS its literal string, which is wabt-ts's kind for the same
 * node, so `'br'` is an `ExpressionKind` and a wabt-ts node's `kind` fits a
 * binaryen-ts node's. In a TYPE position write `typeof ExpressionKind.Break`.
 */
export const ExpressionKind = {
  // Control flow
  Nop: 'nop',
  Block: 'block',
  Region: 'region',
  If: 'if',
  Loop: 'loop',
  Break: 'br',
  Switch: 'br_table',
  Return: 'return',
  Unreachable: 'unreachable',
  // Locals / globals
  LocalGet: 'local.get',
  LocalSet: 'local.set',
  LocalTee: 'local.tee',
  GlobalGet: 'global.get',
  GlobalSet: 'global.set',
  // Constants
  Const: 'const',
  // Arithmetic / logic
  Unary: 'unary',
  Binary: 'binary',
  Select: 'select',
  Drop: 'drop',
  // Memory
  Load: 'load',
  Store: 'store',
  MemorySize: 'memory.size',
  MemoryGrow: 'memory.grow',
  MemoryCopy: 'memory.copy',
  MemoryFill: 'memory.fill',
  MemoryInit: 'memory.init',
  DataDrop: 'data.drop',
  // Calls
  Call: 'call',
  CallIndirect: 'call_indirect',
  CallRef: 'call_ref',
  // Tables
  TableGet: 'table.get',
  TableSet: 'table.set',
  TableSize: 'table.size',
  TableGrow: 'table.grow',
  TableFill: 'table.fill',
  TableCopy: 'table.copy',
  ElemDrop: 'elem.drop',
  TableInit: 'table.init',
  // Atomics (threads proposal)
  AtomicLoad: 'atomic.load',
  AtomicStore: 'atomic.store',
  AtomicRMW: 'atomic.rmw',
  AtomicCmpxchg: 'atomic.cmpxchg',
  AtomicWait: 'atomic.wait',
  AtomicNotify: 'atomic.notify',
  AtomicFence: 'atomic.fence',
  // Annotations (wabt-ts's — see CodeMetadataExpr)
  CodeMetadata: 'code_metadata',
  // SIMD
  SIMDExtract: 'simd.extract',
  SIMDReplace: 'simd.replace',
  SIMDShuffle: 'simd.shuffle',
  SIMDTernary: 'simd.ternary',
  Quaternary: 'quaternary',
  // No `simd.shift`: the lane shifts are `binary` (K3, cmem/ir-convergence.md).
  SIMDLoad: 'simd.load',
  SIMDLoadStoreLane: 'simd.load_store_lane',
  // References (GC + reference-types proposals)
  RefNull: 'ref.null',
  RefIsNull: 'ref.is_null',
  RefAs: 'ref.as',
  RefFunc: 'ref.func',
  RefEq: 'ref.eq',
  RefI31: 'ref.i31',
  AnyConvertExtern: 'any.convert_extern',
  ExternConvertAny: 'extern.convert_any',
  I31Get: 'i31.get',
  RefTest: 'ref.test',
  RefCast: 'ref.cast',
  BrOn: 'br_on',
  // GC structs
  StructNew: 'struct.new',
  StructGet: 'struct.get',
  StructSet: 'struct.set',
  // GC arrays
  ArrayNew: 'array.new',
  ArrayNewFixed: 'array.new_fixed',
  ArrayNewData: 'array.new_data',
  ArrayNewElem: 'array.new_elem',
  ArrayGet: 'array.get',
  ArraySet: 'array.set',
  ArrayLen: 'array.len',
  ArrayCopy: 'array.copy',
  ArrayFill: 'array.fill',
  ArrayInitData: 'array.init_data',
  ArrayInitElem: 'array.init_elem',
  // Exception handling
  Try: 'try',
  TryTable: 'try_table',
  Throw: 'throw',
  ThrowRef: 'throw_ref',
  Rethrow: 'rethrow',
  Pop: 'pop',
  // 🔧 No `tuple.make` / `tuple.extract` (S6 decision 6A). `tuple.make` existed
  // only to pack a multi-value branch or return operand into one `value` slot;
  // those nodes now hold `values: Expression[]`. `tuple.extract` was declared
  // and never built. Neither is a wasm instruction.
} as const;
/** The union of every expression kind string. */
export type ExpressionKind = typeof ExpressionKind[keyof typeof ExpressionKind];

// ---------------------------------------------------------------------------
// Constant value union
// ---------------------------------------------------------------------------

/**
 * A WASM literal constant value — wabt-ts's {@link Const}.
 *
 * ⚠️ **Floats are BITS** (S6 step 5, stage C1). This was `{ f32: number } | { f64:
 * number } | …`, and a JS number does not keep a signalling NaN's payload: a bare
 * decode → encode changed every signalling NaN constant probed, which
 * `i32.reinterpret_f32` makes observable. Fidelity binds, so wabt-ts's form
 * controls: `{ type, value }` for integers, `{ type, bits }` for floats (the raw
 * IEEE 754 pattern — a u32, or an unsigned 64-bit bigint), `{ type, bytes }` for
 * v128. Read a float as a number with {@link literalFloat}, and test the arm with
 * `c.type === ValType.F32` — `'f32' in c` still COMPILES and is always false.
 */
export type Literal = Const;

const F32_VIEW = new DataView(new ArrayBuffer(8));

/** The IEEE 754 bit pattern of `n` as a float32 — a u32. (A NaN argument is canonical.) */
export function f32BitsOf(n: number): number {
  F32_VIEW.setFloat32(0, n, true);
  return F32_VIEW.getUint32(0, true);
}

/** The IEEE 754 bit pattern of `n` as a float64 — an unsigned bigint. */
export function f64BitsOf(n: number): bigint {
  F32_VIEW.setFloat64(0, n, true);
  return F32_VIEW.getBigUint64(0, true);
}

/**
 * A float literal's value as a number, for arithmetic. Converting a signalling
 * NaN's bits to a number may quiet it — which is why the NODE holds bits, and
 * only code that computes with the value should come through here.
 */
export function literalFloat(c: Const): number {
  if (c.type === ValType.F32) {
    F32_VIEW.setUint32(0, c.bits >>> 0, true);
    return F32_VIEW.getFloat32(0, true);
  }
  if (c.type === ValType.F64) {
    F32_VIEW.setBigUint64(0, BigInt.asUintN(64, c.bits), true);
    return F32_VIEW.getFloat64(0, true);
  }
  throw new Error(`literalFloat: not a float literal (type 0x${Number(c.type).toString(16)})`);
}

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
  // Lane shifts: a v128 on the LEFT, an i32 count on the RIGHT. K3 merged
  // binaryen-ts's separate `SIMDShift` kind into `binary`, as wabt-ts and upstream
  // wabt spell it (cmem/ir-convergence.md § "K3"). ⚠️ So a `binary`'s two operands
  // are NOT always the same type — upstream binaryen's validator requires that,
  // and splits these out for it. Match exact opcodes; never assume `left` and
  // `right` share a type (divergence K3, cmem/divergences.md).
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
  kind: typeof ExpressionKind.Nop;
  /** Result type — the value type yielded at runtime. */
  type: None;
}

/** {@link UnreachableExpr} — see {@link makeUnreachable} for the factory. */
export interface UnreachableExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Unreachable;
  /** Result type — the value type yielded at runtime. */
  type: Unreachable;
}

/**
 * A block-type carrier's PARAMETERS: the values it takes from the enclosing
 * stack on entry, and their declared types (S6 decision 7b(i), divergence B1).
 *
 * `values` are evaluated BEFORE the construct — before an `if`'s condition —
 * in stack order, and are children of the construct like any operand. Inside,
 * the body finds them already on its stack: the decoder seeds each region with
 * one `Pop` per type, exactly as a `catch` is seeded with its tag's values, and
 * a `Pop` encodes to nothing. A branch to a parametrised LOOP carries the
 * loop's parameters in its `values`.
 *
 * 🛑 **Fidelity phase only.** Upstream binaryen has no block parameters — its
 * reader lowers them to locals — and neither do the passes ported from it, so
 * `PassRunner` lowers every parameter to locals before the first pass runs
 * (`lowerBlockParams`). Nothing past that point sees this field. Absent means
 * none, which is what every factory and pass produces.
 */
export interface BlockParams {
  /** The declared parameter types, in order. */
  types: ValueType[];
  /** The entry values, one per type, in stack order. */
  values: Expression[];
}

/**
 * The type-section index a construct's header NAMED, where the same type could
 * have been written inline — S6 decision 7c. Carried by the five block-type
 * carriers and by `call_indirect`.
 *
 * A header with no parameters and at most one result has two legal spellings —
 * `0x40` / an inline value type, or an `s33` index — and they are different
 * bytes for the same type. Likewise `call_indirect` names ONE index, and a
 * module may hold several structurally identical function types: deriving the
 * index picks the first match, which is a different instruction from the one
 * written (T1).
 *
 * 🛑 **Fidelity phase only.** It is form, not meaning: the signature is on the
 * node either way, and `PassRunner` drops this before the first pass runs,
 * because a pass may retype the construct and leave the index naming something
 * else. Absent means "derive it", which is what every factory and pass produces.
 */
export type WrittenTypeIndex = number;

/** {@link BlockExpr} — see {@link makeBlock} for the factory. */
export interface BlockExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Block;
  /**
   * What the block DECLARES it yields — never `unreachable`, even when control
   * cannot reach its `end` (S6 step 5 item 5 (3), owner 2026-09-16). wasm types a
   * construct by its declaration: after `end` the stack holds exactly this, so
   * a type that said `unreachable` there was a cached control-flow fact that
   * could disagree with validation — and did (see `unreachable_construct.test.ts`).
   * REQUIRED: a construct always has a declaration, so there is nothing to
   * derive (S6 step 5 item 5 (4)).
   */
  type: BlockResult;
  /** Optional label for branch targets. */
  label: string;
  /** Ordered list of child expressions. */
  children: Expression[];
  /** Entry parameters, when the block declares any — see {@link BlockParams}. */
  params?: BlockParams;
  /** The type-section index its header NAMED — see {@link WrittenTypeIndex} (7c). */
  typeIndex?: WrittenTypeIndex;
}

/**
 * The instruction sequence of ONE REGION: the body of a `loop`, `try`,
 * `try_table`, each `catch`, each `if` arm, and a function.
 *
 * 🔑 **Why a node of its own, and not a `Block` or a bare `Expression[]`.**
 * A region slot used to hold one `Expression`, so a body of N instructions sat
 * inside a synthetic unnamed `Block` — and "synthetic" was a CONVENTION: every
 * parser named every real block, so `name === null` could mean "wrapper". The
 * encoder inlined unnamed blocks in slots on that theory, `isBlockTypeCarrier`
 * had to agree with it, and the wrapper cost twice (C6: its `''` label shadowed
 * the function frame; a multi-value function's wrapper registered a type entry
 * nothing addressed). A bare list would have fixed that and broken the one-slot
 * shape every pass is written against. This keeps the slot one `Expression` —
 * visit it, type it, replace it — while being synthetic by KIND:
 *
 * - it is never a branch target and has no label to be one;
 * - it never writes a blocktype; the enclosing construct owns that;
 * - it is ALWAYS present, even for 0 or 1 instructions, so a body has one
 *   spelling;
 * - it belongs ONLY in a region slot. The type cannot stop one being placed as
 *   an operand (excluding it from {@link Expression} would make every read of a
 *   slot a type error); the encoder rejects that loudly instead.
 *
 * Decided as S6 Group 2 decision 5; the measurements are in
 * `cmem/ir-convergence.md`.
 */
export interface RegionExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Region;
  /** The instructions, in order, exactly as the region holds them. */
  children: Expression[];
}

/** {@link IfExpr} — see {@link makeIf} for the factory. */
export interface IfExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.If;
  /**
   * What the `if` DECLARES it yields — never `unreachable`, even when control
   * cannot reach its `end` (S6 step 5 item 5 (3), owner 2026-09-16). wasm types a
   * construct by its declaration: after `end` the stack holds exactly this, so
   * a type that said `unreachable` there was a cached control-flow fact that
   * could disagree with validation — and did (see `unreachable_construct.test.ts`).
   * REQUIRED: a construct always has a declaration, so there is nothing to
   * derive (S6 step 5 item 5 (4)).
   */
  type: BlockResult;
  /** Condition expression (typed as i32). */
  condition: Expression;
  /** Branch taken when the condition is non-zero. */
  ifTrue: RegionExpr;
  /** Branch taken when the condition is zero (nullable). */
  ifFalse: RegionExpr | null;
  /**
   * Branch-target label for the `if` block. Like `block`/`loop`, an `if`
   * introduces a label a `br`/`br_if` can target (its end). The binary parser
   * stores the frame's label here so the encoder can reproduce the exact branch
   * depth; without it a `br` to the `if` from deeper nesting resolves to the
   * wrong (innermost) target. Optional — most `if`s are not branch targets.
   */
  label: string;
  /**
   * Entry parameters — see {@link BlockParams}. Evaluated before the
   * condition; BOTH arms start with them on their stack.
   */
  params?: BlockParams;
  /** The type-section index its header NAMED — see {@link WrittenTypeIndex} (7c). */
  typeIndex?: WrittenTypeIndex;
}

/** {@link LoopExpr} — see {@link makeLoop} for the factory. */
export interface LoopExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Loop;
  /**
   * What the loop DECLARES it yields — never `unreachable`, even when control
   * cannot reach its `end` (S6 step 5 item 5 (3), owner 2026-09-16). wasm types a
   * construct by its declaration: after `end` the stack holds exactly this, so
   * a type that said `unreachable` there was a cached control-flow fact that
   * could disagree with validation — and did (see `unreachable_construct.test.ts`).
   * REQUIRED: a construct always has a declaration, so there is nothing to
   * derive (S6 step 5 item 5 (4)).
   */
  type: BlockResult;
  /** Branch label for `br` back-edges. */
  label: string;
  /** The loop's region. */
  body: RegionExpr;
  /**
   * Entry parameters — see {@link BlockParams}. A back-edge `br` re-supplies
   * them in its own `values`.
   */
  params?: BlockParams;
  /** The type-section index its header NAMED — see {@link WrittenTypeIndex} (7c). */
  typeIndex?: WrittenTypeIndex;
}

/**
 * {@link BreakExpr} — see {@link makeBreak} for the factory.
 *
 * The values a branch carries are a LIST in stack order (S6 decision 6A,
 * divergence V1). Upstream binaryen holds one `value` and packs two or more
 * into a `tuple.make`; this port did too, and a packing step is where BOTH
 * halves of binaryang dropped values — wabt-ts's single `value?` "silently
 * dropped all but the first", and binaryen-ts's WAT `br_table` built one of
 * two. With a list there is no packing step to get wrong.
 *
 * ⚠️ Normally one entry per value. An entry that itself leaves several on the
 * stack — a multi-value `call` or `block` — stands for all of them, so
 * `values.length` is not always the target's arity.
 */
export interface BreakExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Break;
  /**
   * The label this branches to.
   *
   * Named `target` like every other single-label reference in this IR — it was
   * `name`, which reads as the node's OWN label (what `block`, `loop`, `if` and
   * `try` call `name`) rather than the one it jumps to.
   */
  target: Var;
  /** Optional condition — when present this is a `br_if`. */
  condition?: Expression;
  /** The forwarded values, in stack order — empty for a value-less branch. */
  values: Expression[];
}

/** {@link SwitchExpr} — see {@link makeSwitch} for the factory. Values as {@link BreakExpr}. */
export interface SwitchExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Switch;
  /** Branch table targets. */
  targets: Var[];
  /** Default branch label when no index matches. */
  defaultTarget: Var;
  /** Condition expression (typed as i32). */
  condition: Expression;
  /** The forwarded values, in stack order — empty for a value-less branch. */
  values: Expression[];
}

/** {@link ReturnExpr} — see {@link makeReturn} for the factory. Values as {@link BreakExpr}. */
export interface ReturnExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Return;
  /** The returned values, in stack order — normally one per function result. */
  values: Expression[];
}

/** {@link ConstExpr} — see {@link makeI32Const}, {@link makeI64Const}, {@link makeF32Const}, {@link makeF64Const} for factories. */
export interface ConstExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Const;
  /** Value expression. */
  value: Const;
}

/** {@link LocalGetExpr} — see {@link makeLocalGet} for the factory. */
export interface LocalGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.LocalGet;
  /** Local index. */
  var: Var;
}

/** {@link LocalSetExpr} — see {@link makeLocalSet} for the factory. */
export interface LocalSetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.LocalSet;
  /** Numeric index into the relevant table. */
  var: Var;
  /** Value expression. */
  value: Expression;
}

/** {@link LocalTeeExpr} — see {@link makeLocalTee} for the factory. */
export interface LocalTeeExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.LocalTee;
  /** Numeric index into the relevant table. */
  var: Var;
  /** Value expression. */
  value: Expression;
}

/** {@link TableGetExpr} — see {@link makeTableGet} for the factory.
 *  `table.get $t index` — reads the element at `index` from table `$t`. */
export interface TableGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.TableGet;
  /** Internal name of the table being read. */
  table: Var;
  /** i32 index into the table. */
  index: Expression;
}

/** {@link TableSetExpr} — see {@link makeTableSet} for the factory.
 *  `table.set $t index value` — writes `value` to `index` in table `$t`. */
export interface TableSetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.TableSet;
  /** Internal name of the table being written. */
  table: Var;
  /** i32 index into the table. */
  index: Expression;
  /** New reference value to store. */
  value: Expression;
}

/** {@link GlobalGetExpr} — see {@link makeGlobalGet} for the factory. */
export interface GlobalGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.GlobalGet;
  /** The global addressed. Name-form until `resolveNames`; wabt-ts calls it `var`. */
  var: Var;
}

/** {@link GlobalSetExpr} — see {@link makeGlobalSet} for the factory. */
export interface GlobalSetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.GlobalSet;
  /** The global addressed. Name-form until `resolveNames`; wabt-ts calls it `var`. */
  var: Var;
  /** Value expression. */
  value: Expression;
}

/** {@link UnaryExpr} — see {@link makeUnary} for the factory. */
export interface UnaryExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Unary;
  /** Operator code. */
  opcode: UnaryOp;
  /** Value expression. */
  value: Expression;
}

/** {@link BinaryExpr} — see {@link makeBinary} for the factory. */
export interface BinaryExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Binary;
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
  kind: typeof ExpressionKind.Select;
  /**
   * The value the instruction yields when the condition is NON-ZERO.
   *
   * Named as the spec names the operands, not `ifTrue` / `ifFalse`: a select
   * is not a branch. BOTH operands are evaluated, always — that is the whole
   * difference from an `if`, and the reason a select cannot host a trap or a
   * side effect that only one side should see.
   */
  val1: Expression;
  /** The value it yields when the condition is ZERO. Also always evaluated. */
  val2: Expression;
  /** Condition expression (typed as i32). */
  condition: Expression;
  /**
   * The DECLARED result type of a typed `select` (`0x1c`, `(select (result t))`),
   * or EMPTY for an untyped one (S6 decision 7a).
   *
   * Semantics, not decoration: over references the declared type is what
   * validation checks, and it may be WIDER than either arm — a `ref.null` arm
   * and a `(ref $a)` arm declared `(ref null $a)`. It rode in `type` through a
   * spread override, where anything rebuilding the node through the factory
   * lost it. Its presence also records that the source wrote the typed form,
   * so a numeric typed select re-encodes as written (divergence S1). Upstream
   * binaryen keeps neither: `wasm-opt` rewrites a numeric `0x1c` as `0x1b`.
   * ⚠️ **A list, and deliberately** (S6 step 5, stage S3). It held one `ValueType |
   * null` because validation requires exactly one type. But the ENCODING is a
   * vector, and wabt-ts's reader keeps whatever count a binary declares so its
   * validator can report a wrong one — a count this could not represent. Fidelity
   * binds, so wabt-ts's form controls; binaryen-ts's own front doors still refuse
   * any count but one.
   */
  resultType: ValueType[];
}

/** {@link DropExpr} — see {@link makeDrop} for the factory. */
export interface DropExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Drop;
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
  memidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Load;
  /**
   * The instruction, as written. Width, signedness and result type are derived
   * from it by `loadShape` in `memory-access.ts` — never stored beside it, so
   * a width/sign/type combination that is no real load cannot be built.
   */
  opcode: Opcode;
  /** Static byte offset added to the address operand. */
  offset: bigint;
  /** Power-of-two alignment hint (e.g. 0=byte, 2=i32). */
  align: number;
  /** Address operand. */
  address: Expression;
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
  memidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Store;
  /**
   * The instruction, as written. Width and operand type are derived from it by
   * `storeShape` in `memory-access.ts`. It used to be recomputed from `bytes`
   * and the OPERAND's type, so a store whose operand was not yet typed could
   * not be encoded at all.
   */
  opcode: Opcode;
  /** Static byte offset added to the address operand. */
  offset: bigint;
  /** Power-of-two alignment hint (e.g. 0=byte, 2=i32). */
  align: number;
  /** Address operand. */
  address: Expression;
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
  memidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.MemoryGrow;
  /** Result type — the value type yielded at runtime. */
  type: typeof ValType.I32;
  /** delta — see the matching factory for semantics. */
  delta: Expression;
}

/** {@link MemorySizeExpr} — see {@link makeMemorySize} for the factory. */
// ---------------------------------------------------------------------------
// Threads / atomics, and call_ref (S6 step 5 item 5 (5); divergence K1)
// ---------------------------------------------------------------------------
//
// wabt-ts's shapes, field for field: binaryen-ts had no node for any of these —
// the decoder refused `0xfe` and `0x14` — so there was nothing to merge, only a
// capability to port (S6 Bucket B). Each atomic keeps the instruction it was
// written as in `opcode`, as `load` / `store` do; width and result type are
// derived from it, never stored beside it.

/** `i32.atomic.load*` / `i64.atomic.load*` (0xfe 0x10–0x16). */
export interface AtomicLoadExpr extends ExprBase {
  kind: typeof ExpressionKind.AtomicLoad;
  /** The instruction, as written. */
  opcode: Opcode;
  align: number;
  offset: bigint;
  memidx: Var;
  address: Expression;
}

/** `i32.atomic.store*` / `i64.atomic.store*` (0xfe 0x17–0x1d). */
export interface AtomicStoreExpr extends ExprBase {
  kind: typeof ExpressionKind.AtomicStore;
  opcode: Opcode;
  align: number;
  offset: bigint;
  memidx: Var;
  address: Expression;
  value: Expression;
}

/** Atomic read-modify-write — `*.atomic.rmw*.{add,sub,and,or,xor,xchg}` (0xfe 0x1e–0x47); yields the old value. */
export interface AtomicRmwExpr extends ExprBase {
  kind: typeof ExpressionKind.AtomicRMW;
  opcode: Opcode;
  align: number;
  offset: bigint;
  memidx: Var;
  address: Expression;
  value: Expression;
}

/** Atomic compare-exchange (0xfe 0x48–0x4e) — writes `replacement` iff memory holds `expected`; yields the old value. */
export interface AtomicRmwCmpxchgExpr extends ExprBase {
  kind: typeof ExpressionKind.AtomicCmpxchg;
  opcode: Opcode;
  align: number;
  offset: bigint;
  memidx: Var;
  address: Expression;
  expected: Expression;
  replacement: Expression;
}

/** `memory.atomic.wait32` / `wait64` (0xfe 0x01 / 0x02) — yields 0 ok, 1 not-equal, 2 timed out. */
export interface AtomicWaitExpr extends ExprBase {
  kind: typeof ExpressionKind.AtomicWait;
  opcode: Opcode;
  align: number;
  offset: bigint;
  memidx: Var;
  address: Expression;
  expected: Expression;
  timeout: Expression;
}

/** `memory.atomic.notify` (0xfe 0x00) — yields the number of waiters woken. */
export interface AtomicNotifyExpr extends ExprBase {
  kind: typeof ExpressionKind.AtomicNotify;
  align: number;
  offset: bigint;
  memidx: Var;
  address: Expression;
  count: Expression;
}

/** `atomic.fence` (0xfe 0x03) — a consistency-model marker; no operands, no value. */
export interface AtomicFenceExpr extends ExprBase {
  kind: typeof ExpressionKind.AtomicFence;
  consistencyModel: number;
}

/** `call_ref $t` (0x14) / `return_call_ref $t` (0x15) — calls the function reference `callee`. */
export interface CallRefExpr extends ExprBase {
  kind: typeof ExpressionKind.CallRef;
  /** `return_call_ref` when true. */
  isReturn?: boolean;
  /** The function type the callee has — a type index, as written. */
  sigType: Var;
  /** Arguments, in declaration order. */
  operands: Expression[];
  /** The function reference, evaluated LAST. */
  callee: Expression;
}

/**
 * A code-metadata annotation — `(@metadata.code.<name> "<data>")` — standing
 * before the instruction it describes. wabt-ts's node, and wabt-ts's to build:
 * it is the TEXT form of a `metadata.code.*` section, which binaryen-ts reads
 * and writes as a raw custom section instead (divergence K2).
 *
 * 🗓️ Owner, 2026-09-16: binaryen-ts STRIPS it in its optimization runs —
 * `stripCodeMetadata` (walk.ts), run by `PassRunner` before the first pass.
 * Its encoder REFUSES one: it has no instruction bytes, and writing nothing for
 * it is how an annotation is silently lost (W8).
 */
export interface CodeMetadataExpr extends ExprBase {
  kind: typeof ExpressionKind.CodeMetadata;
  /** The metadata kind — `branch_hint` for `@metadata.code.branch_hint`. */
  name: string;
  /** The annotation's payload bytes. */
  data: Uint8Array;
}

export interface MemorySizeExpr extends ExprBase {
  /**
   * Memory this access addresses. Omitted means 0, the only memory a
   * single-memory module has.
   *
   * wabt-ts's IR carried `memidx` on 16 kinds; this tree carried none, so
   * multi-memory could not survive convergence without regressing behaviour
   * that already works. The worst load combination controls the element.
   */
  memidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.MemorySize;
  /** Result type — the value type yielded at runtime. */
  type: typeof ValType.I32;
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
  kind: typeof ExpressionKind.TableInit;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the element segment to copy from. */
  segment: Var;
  /** Name of the table to copy into. */
  table: Var;
  /** Index of the first table slot to write. */
  dest: Expression;
  /** Index of the first segment element to read. */
  source: Expression;
  /** How many elements to copy. */
  size: Expression;
}

/** `elem.drop` — release a passive element segment's storage. */
export interface ElemDropExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ElemDrop;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the element segment to drop. */
  segment: Var;
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
  memidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.MemoryInit;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the data segment to copy from. */
  segment: Var;
  /** Destination address in linear memory. */
  dest: Expression;
  /** Byte offset within the segment. */
  source: Expression;
  /** Number of bytes to copy. */
  size: Expression;
}

/** `data.drop` — release a passive data segment's storage. */
export interface DataDropExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.DataDrop;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the data segment to drop. */
  segment: Var;
}

/** `table.size` — the current number of elements in a table. */
export interface TableSizeExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.TableSize;
  /** Result type — the value type yielded at runtime. */
  type: typeof ValType.I32;
  /** Name of the table being measured. */
  table: Var;
}

/** `table.grow` — append `delta` copies of `value`, yielding the previous size. */
export interface TableGrowExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.TableGrow;
  /** Result type — the previous size, or -1 if the growth failed. */
  type: typeof ValType.I32;
  /** Name of the table being grown. */
  table: Var;
  /** The reference value to fill the new slots with. */
  value: Expression;
  /** How many slots to add. */
  delta: Expression;
}

/** `table.fill` — write `value` into a range of a table. */
export interface TableFillExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.TableFill;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the table being written. */
  table: Var;
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
  kind: typeof ExpressionKind.TableCopy;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Name of the table being written. */
  destTable: Var;
  /** Name of the table being read. */
  sourceTable: Var;
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
  destMemidx: Var;
  /** Memory the COPY READS FROM. Omitted means 0. `memory` is the destination. */
  srcMemidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.MemoryCopy;
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
  memidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.MemoryFill;
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
  kind: typeof ExpressionKind.Call;
  /** Target label of the branch. */
  func: Var;
  /** Argument expressions in declaration order. */
  operands: Expression[];
  /** isReturn — see the {@link make} factory for semantics. */
  isReturn?: boolean;
}

/**
 * A function signature: parameter and result types, together.
 *
 * wabt-ts's house concept (`FuncSignature` in `wabt-ts/ir/ir.ts`, on `Func`, the
 * func type entry, the func import and `call_indirect`), with the same name and
 * shape here over binaryen-ts's value types; the two become one when S6 unifies
 * the type systems. One field, so a signature's two halves travel together and
 * cannot be set or compared one at a time.
 */
export interface FuncSignature {
  /** Parameter types in declaration order. */
  params: ValueType[];
  /** Result types in declaration order (empty = void). */
  results: ValueType[];
}

/** {@link CallIndirectExpr} — see {@link makeCallIndirect} for the factory. */
export interface CallIndirectExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.CallIndirect;
  /** Table index (defaults to 0). */
  table: Var;
  /**
   * The operand giving the table SLOT to call — `call_indirect`'s last operand.
   *
   * 🔧 It was `target`, documented as "target label of the branch", which it is
   * not: this instruction does not branch and the field is not a label. `target`
   * meant three different things across kinds — the called function on `call`, a
   * branch label on `br_on`, this operand here — and here it sat right beside
   * `table`, the other thing a reader would call a target. Named `callee`, as
   * wabt-ts names it (S6 Group 3, on SAFETY, the `table.copy` precedent).
   */
  callee: Expression;
  /** Argument expressions in declaration order. */
  operands: Expression[];
  /**
   * The signature the call expects the table entry to have.
   *
   * 🔧 It was flat `params` + `results`. S6 Group 3's one tie where cost and
   * structure pointed opposite ways (11 compile errors to convert wabt-ts, 16 to
   * convert binaryen-ts — but 10 vs 9 in source alone); the owner took wabt-ts's
   * `sig` (2026-09-14), the form beside its `typeVar` / `typeUse` and the one
   * `FidelityEntry.sig` keys on (cmem/ir-convergence.md § "Group 3").
   */
  sig: FuncSignature;
  /** isReturn — see the matching factory for semantics. */
  isReturn?: boolean;
  /**
   * The type the instruction NAMED — form beside `sig` (7c). Without it the
   * encoder derives one by structural match, which picks the FIRST identical
   * type and so re-encodes `(type $b)` as `$a` (T1).
   *
   * 🔧 It was `typeIndex?: WrittenTypeIndex`, a number. A `Var`, as wabt-ts holds
   * it and as every GC kind's `typeVar` is on both sides (owner, 2026-09-16, S6
   * step 5 item 4 (a)): a type use can be a NAME, which `applyNames` writes.
   */
  typeVar?: Var;
}

/** {@link RefNullExpr} — see {@link makeRefNull} for the factory. */
export interface RefNullExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.RefNull;
  /**
   * The HEAP type the instruction names — `ref.null func`, `ref.null $T` —
   * wabt-ts's field, and what is written (S6 step 5 item 5 (6b)).
   *
   * 🔑 It was not on the node: the type `(ref null ht)` held it, and Group 3
   * found a field beside `type` would be the same fact twice — so it waited
   * until `type` stopped being the only carrier. It has: a node's `type` is
   * optional and DERIVED (step 3, item 5 (4)), while this is the instruction's
   * immediate. {@link makeRefNull} sets both from one value type.
   */
  refType: HeapType;
}

/** {@link RefIsNullExpr} — see {@link makeRefIsNull} for the factory. */
export interface RefIsNullExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.RefIsNull;
  /** Result type — the value type yielded at runtime. */
  type: typeof ValType.I32;
  /** Value expression. */
  value: Expression;
}

// `RefAsOp` stood here. It had one member, `RefAsNonNull: 0xd4`, and the
// `RefAsExpr.opcode` field it typed could hold nothing else — so the kind and
// the field said the same thing, and only the field could be wrong. S6 dropped
// both; the encoder writes 0xd4 because `ref.as` names that instruction.
//
// It was reserved for the extern conversions ("would be added here rather than
// as separate expression kinds"). They are their own kinds instead —
// {@link ExternConvertExpr}, named as wabt-ts names them — so the reservation
// was superseded rather than abandoned. (This note once said the unified IR
// "already models" them; that was true of wabt-ts only. binaryen-ts's decoder
// dropped both opcodes until the kinds existed here too.)

/**
 * `any.convert_extern` (0xfb 0x1a) / `extern.convert_any` (0xfb 0x1b) — the GC
 * proposal's conversions between the `extern` and `any` hierarchies. One
 * operand; the result keeps the operand's nullability.
 *
 * 🛑 The binary decoder used to read these as `push(pop())` — "identity
 * conversion in IR". The VALUE survived; the TYPE did not, so the opcode
 * vanished on re-encode: V8 rejected the module wherever the conversion was
 * load-bearing for typing, and it was silently absent where it was not.
 *
 * Same shape as wabt-ts's `ExternConvertExpr`: one node, the direction in the
 * kind.
 */
export interface ExternConvertExpr extends ExprBase {
  /** Discriminant — also the direction of the conversion. */
  kind: typeof ExpressionKind.AnyConvertExtern | typeof ExpressionKind.ExternConvertAny;
  /** The reference being converted. */
  value: Expression;
}

/** {@link RefAsExpr} — see {@link makeRefAsNonNull} for the factory. */
export interface RefAsExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.RefAs;
  /** Which `ref.as_*` operation this node performs. */
  /** The reference operand. */
  value: Expression;
}

/** {@link RefFuncExpr} — see {@link makeRefFunc} for the factory. */
export interface RefFuncExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.RefFunc;
  /** func — see the {@link make} factory for semantics. */
  func: Var;
}

// ---------------------------------------------------------------------------
// GC proposal expression node types (Phase 7)
// ---------------------------------------------------------------------------

/**
 * The `br_on_*` opcodes, and the operator type of a `br_on` — ONE definition,
 * wabt-ts's (S6 step 5). An operator is an OPCODE, so the field admits every
 * instruction; see S6 stage 1 in cmem/ir-convergence.md.
 */
export { BrOnOp } from '../../wabt-ts/ir/ir.ts';

/** {@link RefEqExpr} — see {@link makeRefEq} for the factory. */
export interface RefEqExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.RefEq;
  /** Result type — the value type yielded at runtime. */
  type: typeof ValType.I32;
  /** Left-hand operand. */
  left: Expression;
  /** Right-hand operand. */
  right: Expression;
}

/** {@link RefI31Expr} — see {@link makeRefI31} for the factory. */
export interface RefI31Expr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.RefI31;
  /** Value expression. */
  value: Expression;
}

/** {@link I31GetExpr} — see {@link makeI31Get} for the factory. */
export interface I31GetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.I31Get;
  /** Result type — the value type yielded at runtime. */
  type: typeof ValType.I32;
  /** i31 — see the matching factory for semantics. */
  i31: Expression;
  /** true = i31.get_s (sign-extend). */
  signed: boolean;
}

/** {@link StructNewExpr} — see {@link makeStructNew} for the factory. */
export interface StructNewExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.StructNew;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** Argument expressions in declaration order. */
  operands: Expression[];
  /** defaultInit — see the {@link make} factory for semantics. */
  defaultInit?: boolean;
}

/** {@link StructGetExpr} — see {@link makeStructGet} for the factory. */
export interface StructGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.StructGet;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** The struct field addressed. */
  fieldVar: Var;
  /** ref — see the {@link make} factory for semantics. */
  ref: Expression;
  /**
   * Which of the three spellings: absent is plain `get` (a non-packed field),
   * `true` is `get_s`, `false` is `get_u`. Three states, not two -- see
   * `tests/binaryen-ts/binary/get_signedness.test.ts`.
   */
  signed?: boolean;
}

/** {@link StructSetExpr} — see {@link makeStructSet} for the factory. */
export interface StructSetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.StructSet;
  /** Result type — the value type yielded at runtime. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** The struct field addressed. */
  fieldVar: Var;
  /** ref — see the matching factory for semantics. */
  ref: Expression;
  /** Value expression. */
  value: Expression;
}

/** {@link ArrayNewExpr} — see {@link makeArrayNew} for the factory. */
export interface ArrayNewExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayNew;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** init — see the matching factory for semantics. */
  init?: Expression;
  /** Byte length to operate on. */
  length: Expression;
}

/** {@link ArrayNewFixedExpr} — see {@link makeArrayNewFixed} for the factory. */
export interface ArrayNewFixedExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayNewFixed;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** values — see the matching factory for semantics. */
  operands: Expression[];
}

/** {@link ArrayNewDataExpr} — see {@link makeArrayNewData} for the factory. */
export interface ArrayNewDataExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayNewData;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** The data segment the array is initialised from. */
  dataVar: Var;
  /** Static byte offset added to the address operand. */
  offset: Expression;
  /** Byte length to operate on. */
  length: Expression;
}

/** {@link ArrayNewElemExpr} — see {@link makeArrayNewElem} for the factory. */
export interface ArrayNewElemExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayNewElem;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** The element segment the array is initialised from. */
  elemVar: Var;
  /** Static byte offset added to the address operand. */
  offset: Expression;
  /** Byte length to operate on. */
  length: Expression;
}

/** {@link ArrayGetExpr} — see {@link makeArrayGet} for the factory. */
export interface ArrayGetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayGet;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** ref — see the matching factory for semantics. */
  ref: Expression;
  /** Numeric index into the relevant table. */
  index: Expression;
  /** As {@link StructGetExpr.signed}: absent is plain `get`, `true` `get_s`, `false` `get_u`. */
  signed?: boolean;
}

/** {@link ArraySetExpr} — see {@link makeArraySet} for the factory. */
export interface ArraySetExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArraySet;
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
  kind: typeof ExpressionKind.ArrayFill;
  /** Result type — `array.fill` yields nothing. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** The array reference to write into. */
  ref: Expression;
  /** Start index within the array. */
  offset: Expression;
  /** The value written to every filled slot. */
  value: Expression;
  /** Number of elements to fill. */
  size: Expression;
}

/** {@link ArrayCopyExpr} — see {@link makeArrayCopy} for the factory. */
export interface ArrayCopyExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayCopy;
  /** Result type — `array.copy` yields nothing. */
  type: None;
  /** Heap-type index of the DESTINATION array. */
  destTypeVar: Var;
  /** Heap-type index of the SOURCE array. */
  srcTypeVar: Var;
  /** The destination array reference. */
  destRef: Expression;
  /** Start index within the destination. */
  destOffset: Expression;
  /** The source array reference. */
  srcRef: Expression;
  /** Start index within the source. */
  srcOffset: Expression;
  /** Number of elements to copy. */
  size: Expression;
}

/** {@link ArrayInitDataExpr} — see {@link makeArrayInitData} for the factory. */
export interface ArrayInitDataExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayInitData;
  /** Result type — `array.init_data` yields nothing. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** Index of the data segment read from. */
  segment: Var;
  /** The array reference to write into. */
  ref: Expression;
  /** Start index within the array. */
  destOffset: Expression;
  /** Byte offset within the data segment. */
  srcOffset: Expression;
  /** Number of elements to write. */
  size: Expression;
}

/** {@link ArrayInitElemExpr} — see {@link makeArrayInitElem} for the factory. */
export interface ArrayInitElemExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayInitElem;
  /** Result type — `array.init_elem` yields nothing. */
  type: None;
  /** Index into the module heap-type table. */
  typeVar: Var;
  /** Index of the element segment read from. */
  segment: Var;
  /** The array reference to write into. */
  ref: Expression;
  /** Start index within the array. */
  destOffset: Expression;
  /** Offset within the element segment. */
  srcOffset: Expression;
  /** Number of elements to write. */
  size: Expression;
}

/** {@link ArrayLenExpr} — see {@link makeArrayLen} for the factory. */
export interface ArrayLenExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ArrayLen;
  /** Result type — the value type yielded at runtime. */
  type: typeof ValType.I32;
  /** ref — see the matching factory for semantics. */
  ref: Expression;
}

/** {@link RefTestExpr} — see {@link makeRefTest} for the factory. */
export interface RefTestExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.RefTest;
  /** Result type — the value type yielded at runtime. */
  type: typeof ValType.I32;
  /** ref — see the matching factory for semantics. */
  ref: Expression;
  /** Target reference type for the cast. */
  heapType: HeapType;
  /** Whether the reference type is nullable. */
  nullable: boolean;
}

/** {@link RefCastExpr} — see {@link makeRefCast} for the factory. */
export interface RefCastExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.RefCast;
  /** ref — see the {@link make} factory for semantics. */
  ref: Expression;
  /** Target reference type for the cast. */
  heapType: HeapType;
  /** Whether the reference type is nullable. */
  nullable: boolean;
}

/** {@link BrOnExpr} — see {@link makeBrOn} for the factory. */
export interface BrOnExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.BrOn;
  /** Operator code. */
  opcode: BrOnOp;
  /** The label this branches to — see the matching factory for semantics. */
  target: Var;
  /** ref — see the {@link make} factory for semantics. */
  ref: Expression;
  /**
   * The branch values carried below the ref, in stack order — decision 6's shape,
   * extended to the last branch kind (S6 step 5, stage B3). binaryen-ts's decoder
   * leaves them EMPTY (they stay as preceding stack entries); a wabt-ts tree folds
   * them in, so everything that handles a `br_on` by hand must see them.
   */
  values: Expression[];
  /**
   * `rt1` — the type the operand is expected to have. Cast variants only.
   *
   * 🔑 The heap type and its nullability are ONE reference type, so they are
   * one field (S6 Group 3, taking wabt-ts's shape). As four flat optionals —
   * `srcType`, `srcNullable`, `castType`, `castNullable` — a node could hold a
   * nullability with no heap type beside it, and the encoder had to paper over
   * exactly that with `?? AbstractHeapType.Any`. Paired, the incoherent state
   * cannot be written down.
   */
  from?: RefTypeImmediate;
  /** `rt2` — the type being tested for. Cast variants only. */
  to?: RefTypeImmediate;
}

/** One reference type immediate: a heap type and whether it is nullable. */
export interface RefTypeImmediate {
  heapType: HeapType;
  nullable: boolean;
}

// ---------------------------------------------------------------------------
// Exception handling (EH proposal)
// ---------------------------------------------------------------------------

/**
 * A catch clause in a `try_table` expression.
 * Mirrors the four catch opcode variants (0x00–0x03) from the EH proposal.
 */
export interface TableCatch {
  /**
   * The tag caught. ABSENT means `catch_all` / `catch_all_ref`.
   *
   * 🔧 It was `string | null`, which spelled a catch tag differently from the
   * legacy `Catch.tag?: Var` beside it — the same concept, two shapes in one
   * IR — and the encoder had to wrap it in `varFromToken()` to resolve what the
   * other path passes straight through. A tag is an INDEX-SPACE reference (a
   * label is not), so `Var` is also the form that can carry `0` as written.
   */
  tag?: Var;
  /** The label this clause branches to when it matches. */
  target: Var;
  /** `true` for `catch_ref` and `catch_all_ref` (sends an exnref). */
  isRef: boolean;
}

/** `try_table` expression (new EH proposal). */
export interface TryTableExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.TryTable;
  /**
   * What the try_table DECLARES it yields — never `unreachable`, even when control
   * cannot reach its `end` (S6 step 5 item 5 (3), owner 2026-09-16). wasm types a
   * construct by its declaration: after `end` the stack holds exactly this, so
   * a type that said `unreachable` there was a cached control-flow fact that
   * could disagree with validation — and did (see `unreachable_construct.test.ts`).
   * REQUIRED: a construct always has a declaration, so there is nothing to
   * derive (S6 step 5 item 5 (4)).
   */
  type: BlockResult;
  /** Optional label for the try_table block itself. */
  label: string;
  /** The protected region. */
  body: RegionExpr;
  /** catches — see the matching factory for semantics. */
  catches: TableCatch[];
  /** Entry parameters — see {@link BlockParams}. Only the body is seeded. */
  params?: BlockParams;
  /** The type-section index its header NAMED — see {@link WrittenTypeIndex} (7c). */
  typeIndex?: WrittenTypeIndex;
}

/**
 * One `catch` clause of an old-EH `try`.
 *
 * 🔑 Replaces the parallel `catchTags[]` / `catchBodies[]` arrays. Those were
 * one fact in two places and could disagree in length — and did: the encoder
 * carried a guard because a mismatched `Try` emitted a `catch` opcode with no
 * handler after it, corrupting the rest of the function body. A record cannot
 * be half-present, so that guard is gone rather than merely passing.
 *
 * `try_table`'s clauses were already records ({@link TableCatch}); the same
 * concept was modelled both ways in one file.
 */
export interface Catch {
  /**
   * The tag caught. ABSENT means `catch_all` / `catch_all_ref`.
   *
   * The parallel form used `''` as that sentinel, which is a value the field
   * could otherwise hold; absence cannot be confused with a tag.
   */
  tag?: Var;
  /** `catch_ref` / `catch_all_ref` — the handler also receives an `exnref`. */
  isRef: boolean;
  /** The handler's region. */
  body: RegionExpr;
}

/** `try` expression (old/legacy EH). */
export interface TryExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Try;
  /**
   * What the try DECLARES it yields — never `unreachable`, even when control
   * cannot reach its `end` (S6 step 5 item 5 (3), owner 2026-09-16). wasm types a
   * construct by its declaration: after `end` the stack holds exactly this, so
   * a type that said `unreachable` there was a cached control-flow fact that
   * could disagree with validation — and did (see `unreachable_construct.test.ts`).
   * REQUIRED: a construct always has a declaration, so there is nothing to
   * derive (S6 step 5 item 5 (4)).
   */
  type: BlockResult;
  /** Label (targetable by `delegate`). */
  label: string;
  /** The protected region. */
  body: RegionExpr;
  /** The catch clauses, in order. */
  catches: Catch[];
  /**
   * Present for the `delegate` variant: the label it delegates to. A `Var`, and
   * wabt-ts's name and optionality (S6 step 5) — it was `delegateTarget: string |
   * null`.
   */
  delegate?: Var;
  /**
   * Entry parameters — see {@link BlockParams}. Only the try BODY is seeded: a
   * catch starts with its tag's values, not the try's.
   */
  params?: BlockParams;
  /** The type-section index its header NAMED — see {@link WrittenTypeIndex} (7c). */
  typeIndex?: WrittenTypeIndex;
}

/** `throw $tag operands*` expression. Always has type `unreachable`. */
export interface ThrowExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Throw;
  /** tag — see the {@link make} factory for semantics. */
  tag: Var;
  /** Argument expressions in declaration order. */
  operands: Expression[];
}

/** `throw_ref $exnref` expression (new EH). Always has type `unreachable`. */
export interface ThrowRefExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.ThrowRef;
  /** exnref — see the {@link make} factory for semantics. */
  exnref: Expression;
}

/** `rethrow $depth` expression (old EH). Always has type `unreachable`. */
export interface RethrowExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Rethrow;
  /** Label of the enclosing try whose caught exception to rethrow. */
  target: Var;
}

/** `pop` pseudo-instruction — implicit value producer at start of catch handlers. */
export interface PopExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.Pop;
}

// ---------------------------------------------------------------------------
// SIMD expression node types
// ---------------------------------------------------------------------------

/** `*.extract_lane` — extract a scalar lane from a v128. */
export interface SIMDExtractExpr extends ExprBase {
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.SIMDExtract;
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
  kind: typeof ExpressionKind.SIMDReplace;
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
  kind: typeof ExpressionKind.SIMDShuffle;
  /** Left-hand operand. */
  left: Expression;
  /** Right-hand operand. */
  right: Expression;
  /** 16-byte immediate lane-select mask. */
  lanes: Uint8Array;
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
  kind: typeof ExpressionKind.Quaternary;
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
  kind: typeof ExpressionKind.SIMDTernary;
  /** Operator code. */
  opcode: SIMDTernaryOp;
  /** First operand. */
  a: Expression;
  /** Second operand. */
  b: Expression;
  /** Third operand. */
  c: Expression;
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
  memidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.SIMDLoad;
  /** Operator code. */
  opcode: SIMDLoadOp;
  /** Address operand. */
  address: Expression;
  /** Static byte offset added to the address operand. */
  offset: bigint;
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
  memidx: Var;
  /** Discriminant — identifies which expression variant this is. */
  kind: typeof ExpressionKind.SIMDLoadStoreLane;
  /** Operator code. */
  opcode: SIMDLoadStoreLaneOp;
  /** Address operand. */
  address: Expression;
  /** vec — see the {@link make} factory for semantics. */
  vec: Expression;
  /** Static byte offset added to the address operand. */
  offset: bigint;
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
  | RegionExpr
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
  | AtomicLoadExpr
  | AtomicStoreExpr
  | AtomicRmwExpr
  | AtomicRmwCmpxchgExpr
  | AtomicWaitExpr
  | AtomicNotifyExpr
  | AtomicFenceExpr
  | CodeMetadataExpr
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
  | CallRefExpr
  | RefNullExpr
  | RefIsNullExpr
  | RefAsExpr
  | RefFuncExpr
  | RefEqExpr
  | RefI31Expr
  | ExternConvertExpr
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
  | SIMDLoadExpr
  | SIMDLoadStoreLaneExpr;

// ---------------------------------------------------------------------------
// Builder helpers (factory functions)
// ---------------------------------------------------------------------------

/** Creates an `i32` constant expression. */
export function makeI32Const(value: number): ConstExpr {
  return { kind: ExpressionKind.Const, type: ValType.I32, value: { type: ValType.I32, value } };
}

/** Creates an `i64` constant expression. */
export function makeI64Const(value: bigint): ConstExpr {
  return { kind: ExpressionKind.Const, type: ValType.I64, value: { type: ValType.I64, value } };
}

/** Creates an `f32` constant expression from a NUMBER (a NaN argument is canonical). */
export function makeF32Const(value: number): ConstExpr {
  return makeF32ConstBits(f32BitsOf(value));
}

/** Creates an `f32` constant expression from its exact IEEE 754 bits — a NaN payload is kept. */
export function makeF32ConstBits(bits: number): ConstExpr {
  return {
    kind: ExpressionKind.Const,
    type: ValType.F32,
    value: { type: ValType.F32, bits: bits >>> 0 },
  };
}

/** Creates an `f64` constant expression from a NUMBER (a NaN argument is canonical). */
export function makeF64Const(value: number): ConstExpr {
  return makeF64ConstBits(f64BitsOf(value));
}

/** Creates an `f64` constant expression from its exact IEEE 754 bits — a NaN payload is kept. */
export function makeF64ConstBits(bits: bigint): ConstExpr {
  return {
    kind: ExpressionKind.Const,
    type: ValType.F64,
    value: { type: ValType.F64, bits: BigInt.asUintN(64, bits) },
  };
}

/** Creates a `global.get` expression. */
export function makeGlobalGet(v: Var, type: ValueType): GlobalGetExpr {
  return { kind: ExpressionKind.GlobalGet, type, var: v };
}

/** Creates a `global.set` expression (result type is `none`). */
export function makeGlobalSet(v: Var, value: Expression): GlobalSetExpr {
  return { kind: ExpressionKind.GlobalSet, type: None, var: v, value };
}

/** Creates a `local.get` expression. */
export function makeLocalGet(index: Var, type: ValueType): LocalGetExpr {
  return { kind: ExpressionKind.LocalGet, type, var: index };
}

/** Creates a `local.set` expression (result type is `none`). */
export function makeLocalSet(index: Var, value: Expression): LocalSetExpr {
  return { kind: ExpressionKind.LocalSet, type: None, var: index, value };
}

/** Creates a `local.tee` expression (result type matches the value). */
export function makeLocalTee(index: Var, value: Expression, type: ValueType): LocalTeeExpr {
  return { kind: ExpressionKind.LocalTee, type, var: index, value };
}

/** Creates a `table.get` expression. Default element type is `funcref` (the
 *  most common reference table); pass `externref` for tables holding host
 *  references. */
export function makeTableGet(
  table: Var,
  index: Expression,
  type: ValType = ValType.FuncRef,
): TableGetExpr {
  return { kind: ExpressionKind.TableGet, type, table, index };
}

/** Creates a `table.set` expression (result type is `none`). */
export function makeTableSet(
  table: Var,
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

/**
 * The type a list of values denotes together — what a `br_if` carrying them
 * falls through with: `none` for none, the value's own type for one, else the
 * {@link TupleType} of every component. An entry that is itself multi-valued
 * contributes all its components; an `unreachable` entry makes the whole
 * unreachable, as upstream `Break::finalize` does for its one value.
 */
export function valuesType(values: readonly Expression[]): Type {
  if (values.length === 0) return None;
  // The value's own type object, exactly as the one-`value` node had it.
  if (values.length === 1) return typeOf(values[0]!);
  const parts: TupleType = [];
  for (const v of values) {
    const t = typeOf(v);
    if (t === Unreachable) return Unreachable;
    if (Array.isArray(t)) parts.push(...t);
    else if (t !== None) parts.push(t);
  }
  return parts.length === 1 ? parts[0]! : parts;
}

/** Creates a `return` expression carrying `values` (normally one per function result). */
export function makeReturn(values: Expression[] = []): ReturnExpr {
  // A `return` is a control-flow transfer, not a value producer: it never
  // yields a value to its enclosing block, so its type is always `unreachable`
  // (matches upstream `Return() { type = Type::unreachable; }` in wasm.h). The
  // returned values' types live on the values; the node's own type must not
  // leak into block type-inference, or a block ending in `(return x)` would be
  // mistyped as `x`'s type instead of `unreachable`.
  return { kind: ExpressionKind.Return, type: Unreachable, values };
}

/** Creates a `call` expression. */
export function makeCall(
  target: Var,
  operands: Expression[],
  resultType: Type,
  isReturn = false,
): CallExpr {
  return { kind: ExpressionKind.Call, type: resultType, func: target, operands, isReturn };
}

/** Creates an `if` expression. The optional `name` is the `if`'s branch-target label. */
export function makeIf(
  condition: Expression,
  thenArm: RegionInput,
  elseArm: RegionInput | null = null,
  name = '',
  type: BlockResult = None,
): IfExpr {
  // The type is DECLARED — `None` when not given, as `(if …)` without a
  // `(result …)` is. 🔧 It was inferred from the arms, as upstream's
  // `If::finalize` does, which typed an `if` whose arms both end in a transfer
  // `unreachable`; before that, `ifTrue.type` alone mistyped a one-sided one
  // and DCE deleted a loop's live back-edge. A declared type cannot drift.
  return {
    kind: ExpressionKind.If,
    type,
    condition,
    ifTrue: asRegion(thenArm),
    ifFalse: elseArm === null ? null : asRegion(elseArm),
    label: name,
  };
}

/**
 * Creates a `block` expression DECLARING `type` — `None` when not given, as
 * `(block …)` without a `(result …)` is.
 *
 * 🔧 An omitted type was INFERRED from the last child. That is wrong whenever
 * the value leaves through a branch (asyncify's unwind block is `i32` because
 * its `br`s carry the call index, while its last child is a barrier), and
 * wrong in the other direction when the last child never falls through: the
 * block came out typed `unreachable`, which wasm never gives a construct
 * (S6 step 5 item 5 (3)).
 */
export function makeBlock(
  children: Expression[],
  name: string | null = null,
  type: BlockResult = None,
): BlockExpr {
  return {
    kind: ExpressionKind.Block,
    type,
    // A label NAME in, `''` for none on the node (S6 step 5): one spelling of
    // "unnamed", and the same one wabt-ts uses.
    label: name ?? '',
    children,
  };
}

/**
 * Creates a region from its instructions, EXACTLY as given — for the parsers,
 * which hold the list as written. The type is `type` when given (a parser knows
 * the declared one), else inferred as {@link makeBlock} does.
 */
export function makeRegion(children: Expression[], type?: Type): RegionExpr {
  const last = children[children.length - 1];
  return {
    kind: ExpressionKind.Region,
    type: type ?? (last ? typeOf(last) : None),
    children,
  };
}

/**
 * A region's instructions as a BLOCK, for placing a body where a statement goes
 * — inlining a callee, or nesting a function's old body inside a new one.
 *
 * A region cannot be a statement (the encoder rejects one outside its slot), and
 * upstream binaryen nests the old body as a block in exactly these places, so
 * this is the faithful move. By default the block has no label: nothing could
 * branch to a region, so nothing can branch to it.
 *
 * `type` is REQUIRED: the type of what the block stands in for — the construct
 * the body belonged to, or the function's results. 🔧 It took the REGION's
 * type, which is inferred from its last instruction and so `unreachable` for a
 * body ending in a transfer (S6 step 5 item 5 (3)).
 */
export function blockOf(
  region: RegionExpr,
  type: BlockResult,
  name: string | null = null,
): BlockExpr {
  return { kind: ExpressionKind.Block, type, label: name ?? '', children: region.children };
}

/**
 * `e` fit to stand as a statement or operand. A region of ONE instruction
 * becomes that instruction; any other region becomes {@link blockOf} it;
 * anything that is not a region is returned as is.
 *
 * ⚠️ For code that holds an expression which MAY be a region — a body it is
 * about to put in `children` or an operand, or put in place of its construct
 * (a loop replaced by its body). Those positions are typed `Expression`, which
 * a region is, so the compiler cannot flag the mistake; the encoder would, at
 * run time.
 *
 * One-or-block is deliberate: it is the shape every such call site produced
 * before regions were a kind (a body was its lone expression or a wrapper
 * block), and the shape upstream's passes see — so pass output is unchanged.
 *
 * `type` is what a built block DECLARES — see {@link blockOf}.
 */
export function asStatement(e: Expression, type: BlockResult): Expression {
  if (e.kind !== ExpressionKind.Region) return e;
  return e.children.length === 1 ? e.children[0]! : blockOf(e, type);
}

/**
 * The {@link BlockParams} of a block-type carrier — `block`, `loop`, `if`,
 * `try`, `try_table` — or `undefined` for any other expression, or a carrier
 * that declares none.
 */
export function blockParamsOf(e: Expression): BlockParams | undefined {
  switch (e.kind) {
    case ExpressionKind.Block:
    case ExpressionKind.Loop:
    case ExpressionKind.If:
    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
      return e.params;
    default:
      return undefined;
  }
}

/**
 * The type-section index this node's header named, where one was written —
 * {@link WrittenTypeIndex} (7c). `undefined` for every other kind, and for a
 * node a pass built or the form was dropped from.
 */
export function writtenTypeIndexOf(e: Expression): WrittenTypeIndex | undefined {
  switch (e.kind) {
    case ExpressionKind.Block:
    case ExpressionKind.Loop:
    case ExpressionKind.If:
    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
      return e.typeIndex;
    default:
      return undefined;
  }
}

/**
 * Forget the as-written type index on ONE node — `PassRunner` does this to
 * every node before the first pass runs, because a pass may retype a construct
 * and leave the index naming something else (7c).
 */
export function dropWrittenTypeIndex(e: Expression): void {
  switch (e.kind) {
    case ExpressionKind.Block:
    case ExpressionKind.Loop:
    case ExpressionKind.If:
    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
      delete e.typeIndex;
      break;
    case ExpressionKind.CallIndirect:
      delete e.typeVar;
      break;
    default:
      break;
  }
}

/** What a region slot accepts from code that builds trees: a region, a list, or one expression. */
export type RegionInput = Expression | Expression[];

/**
 * A region for a slot, from whatever a tree-building caller has — for PASSES and
 * the builder API, not the parsers (they call {@link makeRegion}).
 *
 * - a region is returned as is — unless its ONE instruction is an unnamed
 *   `Block`, when it becomes that block's region;
 * - a list becomes a region of that list;
 * - an UNNAMED `Block` contributes its children, not itself;
 * - any other expression becomes a region of one.
 *
 * ⚠️ The unnamed-block rules are a normalization, not the old convention come
 * back. Passes were written against "a body is one expression", so they build
 * bodies as `makeBlock(list, null)` — and RemoveUnusedNames strips the name off
 * a block that IS a body's one instruction. The encoder used to inline an
 * unnamed block sitting in a body; without these rules each such body would
 * gain a `block … end` in optimized output. One level, exactly as the encoder
 * did it.
 *
 * Sound because an unnamed block cannot be a branch target (the encoder's label
 * stack gives it `null`), so its children in the region mean the same thing.
 * And it cannot touch FIDELITY: the parsers build regions with
 * {@link makeRegion} and never come through here; this runs on trees a pass or
 * a builder made — and on every region slot `mapExpression` rebuilds.
 */
export function asRegion(input: RegionInput): RegionExpr {
  if (Array.isArray(input)) return makeRegion(input);
  if (input.kind === ExpressionKind.Region) {
    const only = input.children.length === 1 ? input.children[0]! : undefined;
    if (only?.kind === ExpressionKind.Block && only.label === '') {
      return makeRegion(only.children, input.type);
    }
    return input;
  }
  if (input.kind === ExpressionKind.Block && input.label === '') {
    return makeRegion(input.children, input.type);
  }
  return makeRegion([input], input.type);
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
export function makeLoop(
  name: string,
  body: RegionInput,
  resultType: BlockResult = None,
): LoopExpr {
  return { kind: ExpressionKind.Loop, type: resultType, label: name, body: asRegion(body) };
}

/**
 * The NAME a label reference holds — how a pass reads `br.target`, a
 * `br_table` target, `br_on.target`, `rethrow.target`, `try.delegate` or a catch
 * clause's target.
 *
 * ⚠️ **The invariant, in one place** (S6 step 5). A label reference is a `Var`,
 * so it can hold the depth a text or binary source WROTE — fidelity needs that.
 * A pass must not see one: inserting or removing a block shifts every depth
 * below it, silently retargeting the branch. Passes therefore require the name
 * form, and a depth reaching one throws here rather than being guessed at. The
 * factories only ever build names.
 */
export function labelName(v: Var): string {
  return requireName(v, 'label reference');
}

/** Creates a `br` or `br_if` expression carrying `values`. */
export function makeBreak(
  name: string,
  // `null` is still accepted: every caller wrote it, and absent is what it means.
  condition: Expression | null | undefined = undefined,
  values: Expression[] = [],
): BreakExpr {
  // Mirrors upstream `Break::finalize`: an UNCONDITIONAL `br` always transfers
  // control, so its type is `unreachable` — a block ending in `(br $l)` is
  // therefore unreachable at its end, which is exactly what lets a result-typed
  // loop/block whose body exits via a back-edge validate (the implicit end is
  // unreachable, so no fallthrough value is required). A conditional `br_if`
  // falls through when the condition is false, so it takes its values' type
  // (`none` when value-less).
  const type: Type = condition == null ? Unreachable : valuesType(values);
  return {
    kind: ExpressionKind.Break,
    type,
    // A label NAME in, a name-form `Var` on the node: a factory-built label can
    // never be a depth, which a pass inserting a block would silently retarget.
    target: varName(name),
    ...(condition == null ? {} : { condition }),
    values,
  };
}

/** Creates a `br_table` expression carrying `values`. */
export function makeSwitch(
  targets: string[],
  defaultTarget: string,
  condition: Expression,
  values: Expression[] = [],
): SwitchExpr {
  // `br_table` always branches (it is unconditional — the operand only selects
  // WHICH target), so it is `unreachable`, matching upstream `Switch() { type =
  // Type::unreachable; }`. As with `br`, this keeps a block ending in a
  // `br_table` correctly unreachable for type-inference purposes.
  return {
    kind: ExpressionKind.Switch,
    type: Unreachable,
    targets: targets.map(varName),
    defaultTarget: varName(defaultTarget),
    condition,
    values,
  };
}

/** Creates a `select` expression. */
export function makeSelect(
  ifTrue: Expression,
  ifFalse: Expression,
  condition: Expression,
  // A single type or `null` is still accepted -- every caller wrote one.
  declared: ValueType | readonly ValueType[] | null = null,
): SelectExpr {
  const resultType: ValueType[] = declared === null
    ? []
    : Array.isArray(declared)
    ? [...declared]
    : [declared as ValueType];
  // The declared type wins when there is one. Otherwise a `select` always has
  // both arms, so its result type is the type of the reachable arm —
  // `unreachable` only when BOTH arms are unreachable. Taking `ifTrue.type`
  // blindly mistyped a select whose `ifTrue` is `unreachable` (e.g. it ends in
  // a trap/branch) even though `ifFalse` yields a real value, the same hazard
  // `makeIf` was fixed for.
  const type: Type = (resultType.length === 1 ? resultType[0] : undefined) ??
    (typeOf(ifTrue) === Unreachable ? typeOf(ifFalse) : typeOf(ifTrue));
  return { kind: ExpressionKind.Select, type, val1: ifTrue, val2: ifFalse, condition, resultType };
}

/** Creates a `call_indirect` expression. */
export function makeCallIndirect(
  table: Var,
  callee: Expression,
  operands: Expression[],
  sig: FuncSignature,
  isReturn = false,
): CallIndirectExpr {
  const type: Type = sig.results[0] ?? None;
  return {
    kind: ExpressionKind.CallIndirect,
    type,
    table,
    callee,
    operands,
    sig,
    isReturn,
  };
}

/**
 * Creates a memory load expression. The result type is the one `opcode`
 * produces; there is no separate type argument to disagree with it.
 */
export function makeLoad(
  opcode: Opcode,
  offset: bigint,
  align: number,
  ptr: Expression,
  memidx: Var = varIndex(0),
): LoadExpr {
  return {
    kind: ExpressionKind.Load,
    type: loadShape(opcode).type,
    opcode,
    offset,
    align,
    address: ptr,
    memidx,
  };
}

/** Creates a memory store expression. Throws if `opcode` is not a plain store. */
export function makeStore(
  opcode: Opcode,
  offset: bigint,
  align: number,
  ptr: Expression,
  value: Expression,
  memidx: Var = varIndex(0),
): StoreExpr {
  storeShape(opcode);
  return {
    kind: ExpressionKind.Store,
    type: None,
    opcode,
    offset,
    align,
    address: ptr,
    value,
    memidx,
  };
}

/** The scalar an atomic load / rmw / cmpxchg yields: `i64` for an `i64.*` instruction, else `i32`. */
function atomicValueType(opcode: Opcode): typeof ValType.I32 | typeof ValType.I64 {
  return anyOpcodeName(opcode).startsWith('i64.') ? ValType.I64 : ValType.I32;
}

/** Creates an atomic load. */
export function makeAtomicLoad(
  opcode: Opcode,
  offset: bigint,
  align: number,
  address: Expression,
  memidx: Var = varIndex(0),
): AtomicLoadExpr {
  const type = atomicValueType(opcode);
  return { kind: ExpressionKind.AtomicLoad, type, opcode, align, offset, memidx, address };
}

/** Creates an atomic store. */
export function makeAtomicStore(
  opcode: Opcode,
  offset: bigint,
  align: number,
  address: Expression,
  value: Expression,
  memidx: Var = varIndex(0),
): AtomicStoreExpr {
  return {
    kind: ExpressionKind.AtomicStore,
    type: None,
    opcode,
    align,
    offset,
    memidx,
    address,
    value,
  };
}

/** Creates an atomic read-modify-write. */
export function makeAtomicRmw(
  opcode: Opcode,
  offset: bigint,
  align: number,
  address: Expression,
  value: Expression,
  memidx: Var = varIndex(0),
): AtomicRmwExpr {
  const type = atomicValueType(opcode);
  return { kind: ExpressionKind.AtomicRMW, type, opcode, align, offset, memidx, address, value };
}

/** Creates an atomic compare-exchange. */
export function makeAtomicCmpxchg(
  opcode: Opcode,
  offset: bigint,
  align: number,
  address: Expression,
  expected: Expression,
  replacement: Expression,
  memidx: Var = varIndex(0),
): AtomicRmwCmpxchgExpr {
  return {
    kind: ExpressionKind.AtomicCmpxchg,
    type: atomicValueType(opcode),
    opcode,
    align,
    offset,
    memidx,
    address,
    expected,
    replacement,
  };
}

/** Creates `memory.atomic.wait32` / `wait64` — the opcode says which. */
export function makeAtomicWait(
  opcode: Opcode,
  offset: bigint,
  align: number,
  address: Expression,
  expected: Expression,
  timeout: Expression,
  memidx: Var = varIndex(0),
): AtomicWaitExpr {
  return {
    kind: ExpressionKind.AtomicWait,
    type: ValType.I32,
    opcode,
    align,
    offset,
    memidx,
    address,
    expected,
    timeout,
  };
}

/** Creates `memory.atomic.notify`. */
export function makeAtomicNotify(
  offset: bigint,
  align: number,
  address: Expression,
  count: Expression,
  memidx: Var = varIndex(0),
): AtomicNotifyExpr {
  return {
    kind: ExpressionKind.AtomicNotify,
    type: ValType.I32,
    align,
    offset,
    memidx,
    address,
    count,
  };
}

/** Creates `atomic.fence`. */
export function makeAtomicFence(consistencyModel: number): AtomicFenceExpr {
  return { kind: ExpressionKind.AtomicFence, type: None, consistencyModel };
}

/**
 * Creates `call_ref` / `return_call_ref`. `results` are the signature's —
 * the node's type is their tuple, as {@link makeCall}'s is.
 */
export function makeCallRef(
  sigType: Var,
  callee: Expression,
  operands: Expression[],
  results: readonly ValueType[],
  isReturn = false,
): CallRefExpr {
  const type: Type = results.length === 0
    ? None
    : results.length === 1
    ? results[0]!
    : [...results];
  return { kind: ExpressionKind.CallRef, type, isReturn, sigType, operands, callee };
}

/** Creates a `memory.size` expression. */
export function makeMemorySize(memidx: Var = varIndex(0)): MemorySizeExpr {
  return {
    kind: ExpressionKind.MemorySize,
    type: ValType.I32,
    memidx,
  };
}

/** Creates a `memory.grow` expression. */
export function makeMemoryGrow(delta: Expression, memidx: Var = varIndex(0)): MemoryGrowExpr {
  return {
    kind: ExpressionKind.MemoryGrow,
    type: ValType.I32,
    delta,
    memidx,
  };
}

/** Creates a `table.init` expression. */
export function makeTableInit(
  segment: Var,
  table: Var,
  dest: Expression,
  source: Expression,
  size: Expression,
): TableInitExpr {
  return { kind: ExpressionKind.TableInit, type: None, segment, table, dest, source, size };
}

/** Creates an `elem.drop` expression. */
export function makeElemDrop(segment: Var): ElemDropExpr {
  return { kind: ExpressionKind.ElemDrop, type: None, segment };
}

/** Creates a `memory.init` expression. */
export function makeMemoryInit(
  segment: Var,
  dest: Expression,
  source: Expression,
  size: Expression,
  memidx: Var = varIndex(0),
): MemoryInitExpr {
  return {
    kind: ExpressionKind.MemoryInit,
    type: None,
    segment,
    dest,
    source,
    size,
    memidx,
  };
}

/** Creates a `data.drop` expression. */
export function makeDataDrop(segment: Var): DataDropExpr {
  return { kind: ExpressionKind.DataDrop, type: None, segment };
}

/** Creates a `table.size` expression. */
export function makeTableSize(table: Var): TableSizeExpr {
  return { kind: ExpressionKind.TableSize, type: ValType.I32, table };
}

/** Creates a `table.grow` expression. */
export function makeTableGrow(
  table: Var,
  value: Expression,
  delta: Expression,
): TableGrowExpr {
  return { kind: ExpressionKind.TableGrow, type: ValType.I32, table, value, delta };
}

/** Creates a `table.fill` expression. */
export function makeTableFill(
  table: Var,
  dest: Expression,
  value: Expression,
  size: Expression,
): TableFillExpr {
  return { kind: ExpressionKind.TableFill, type: None, table, dest, value, size };
}

/** Creates a `table.copy` expression. */
export function makeTableCopy(
  destTable: Var,
  sourceTable: Var,
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
  destMemidx: Var = varIndex(0),
  srcMemidx: Var = varIndex(0),
): MemoryCopyExpr {
  return {
    kind: ExpressionKind.MemoryCopy,
    type: None,
    dest,
    source,
    size,
    destMemidx,
    srcMemidx,
  };
}

/** Creates a `memory.fill` expression. */
export function makeMemoryFill(
  dest: Expression,
  value: Expression,
  size: Expression,
  memidx: Var = varIndex(0),
): MemoryFillExpr {
  return {
    kind: ExpressionKind.MemoryFill,
    type: None,
    dest,
    value,
    size,
    memidx,
  };
}

/**
 * Creates a `ref.null` expression.
 *
 * Accepts a concrete `(ref null $T)` as well as an abstract reference type; the
 * encoder writes the corresponding heap type either way.
 */
export function makeRefNull(type: ValueType): RefNullExpr {
  return { kind: ExpressionKind.RefNull, type, refType: nullableHeapOf(type) };
}

/**
 * The heap type a nullable reference type names — a typed reference's own, or
 * the abstract heap of a shorthand (`funcref` → `func`). A non-reference value
 * type has none, and `ref.null` of one is refused, as the encoder refused it.
 */
function nullableHeapOf(type: ValueType): HeapType {
  if (isRefType(type)) return type.heapType;
  const name = REF_VALTYPE_HEAP[type];
  if (name === undefined) {
    throw new Error(`ref.null of a non-reference type: ${typeToString(type)}`);
  }
  return heapAbstract(name);
}

/** Each shorthand reference type's abstract heap — the byte they share on the wire. */
const REF_VALTYPE_HEAP: Partial<Record<ValType, AbstractHeapType>> = {
  [ValType.FuncRef]: AbstractHeapType.Func,
  [ValType.ExternRef]: AbstractHeapType.Ext,
  [ValType.AnyRef]: AbstractHeapType.Any,
  [ValType.EqRef]: AbstractHeapType.Eq,
  [ValType.I31Ref]: AbstractHeapType.I31,
  [ValType.StructRef]: AbstractHeapType.Struct,
  [ValType.ArrayRef]: AbstractHeapType.Array,
  [ValType.NullRef]: AbstractHeapType.None,
  [ValType.NullFuncRef]: AbstractHeapType.NoFunc,
  [ValType.NullExternRef]: AbstractHeapType.NoExt,
  [ValType.ExnRef]: AbstractHeapType.Exn,
  [ValType.NullExnRef]: AbstractHeapType.NoExn,
};

/** Creates a `ref.func` expression. */
export function makeRefFunc(func: Var, type: ValType = ValType.FuncRef): RefFuncExpr {
  return { kind: ExpressionKind.RefFunc, type, func };
}

/** Creates a `ref.is_null` expression. */
export function makeRefIsNull(value: Expression): RefIsNullExpr {
  return { kind: ExpressionKind.RefIsNull, type: ValType.I32, value };
}

/**
 * Creates a `ref.as_non_null` expression: asserts `value` is not null and
 * narrows it to the non-nullable `resultType`, trapping if it is null.
 *
 * `resultType` should be the operand's heap type with `nullable: false`. It is
 * passed rather than derived because the non-nullable form of a reference type
 * is not recoverable from `value.type` alone once a heap type is concrete.
 */
export function makeRefAsNonNull(value: Expression, resultType: Type): RefAsExpr {
  return { kind: ExpressionKind.RefAs, type: resultType, value };
}

/** Creates a ref.eq expression. */
export function makeRefEq(left: Expression, right: Expression): RefEqExpr {
  return { kind: ExpressionKind.RefEq, type: ValType.I32, left, right };
}

/** Creates a ref.i31 expression. */
export function makeRefI31(value: Expression, resultType: Type): RefI31Expr {
  return { kind: ExpressionKind.RefI31, type: resultType, value };
}

/**
 * Creates `any.convert_extern` or `extern.convert_any`. The result is `(ref
 * null? any)` / `(ref null? extern)` with the OPERAND's nullability — the spec's
 * typing: `[(ref null? extern)] -> [(ref null? any)]` and back.
 */
export function makeExternConvert(
  kind: typeof ExpressionKind.AnyConvertExtern | typeof ExpressionKind.ExternConvertAny,
  value: Expression,
): ExternConvertExpr {
  const t = value.type;
  const nullable = t !== undefined && isRefType(t) ? t.nullable : true;
  const heap = heapAbstract(
    kind === ExpressionKind.AnyConvertExtern ? AbstractHeapType.Any : AbstractHeapType.Ext,
  );
  return { kind, type: { heapType: heap, nullable }, value };
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
  fieldVar: Var,
  ref: Expression,
  resultType: Type,
  signed?: boolean,
): StructGetExpr {
  return {
    kind: ExpressionKind.StructGet,
    type: resultType,
    typeVar,
    fieldVar,
    ref,
    ...(signed === undefined ? {} : { signed }),
  };
}

/** Creates a struct.set expression. */
export function makeStructSet(
  typeVar: Var,
  fieldVar: Var,
  ref: Expression,
  value: Expression,
): StructSetExpr {
  return { kind: ExpressionKind.StructSet, type: None, typeVar, fieldVar, ref, value };
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
  return { kind: ExpressionKind.ArrayNew, type: resultType, typeVar, length };
}

/** Creates an array.new_fixed expression. */
export function makeArrayNewFixed(
  typeVar: Var,
  operands: Expression[],
  resultType: Type,
): ArrayNewFixedExpr {
  return { kind: ExpressionKind.ArrayNewFixed, type: resultType, typeVar, operands };
}

/** Creates an array.new_data expression. */
export function makeArrayNewData(
  typeVar: Var,
  dataVar: Var,
  offset: Expression,
  length: Expression,
  resultType: Type,
): ArrayNewDataExpr {
  return {
    kind: ExpressionKind.ArrayNewData,
    type: resultType,
    typeVar,
    dataVar,
    offset,
    length,
  };
}

/** Creates an array.new_elem expression. */
export function makeArrayNewElem(
  typeVar: Var,
  elemVar: Var,
  offset: Expression,
  length: Expression,
  resultType: Type,
): ArrayNewElemExpr {
  return {
    kind: ExpressionKind.ArrayNewElem,
    type: resultType,
    typeVar,
    elemVar,
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
  signed?: boolean,
): ArrayGetExpr {
  return {
    kind: ExpressionKind.ArrayGet,
    type: resultType,
    typeVar,
    ref,
    index,
    ...(signed === undefined ? {} : { signed }),
  };
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
  offset: Expression,
  value: Expression,
  size: Expression,
): ArrayFillExpr {
  return { kind: ExpressionKind.ArrayFill, type: None, typeVar, ref, offset, value, size };
}

/** Creates an `array.copy $Tdest $Tsrc` expression. */
export function makeArrayCopy(
  destTypeVar: Var,
  srcTypeVar: Var,
  destRef: Expression,
  destOffset: Expression,
  srcRef: Expression,
  srcOffset: Expression,
  size: Expression,
): ArrayCopyExpr {
  return {
    kind: ExpressionKind.ArrayCopy,
    type: None,
    destTypeVar,
    srcTypeVar,
    destRef,
    destOffset,
    srcRef,
    srcOffset,
    size,
  };
}

/** Creates an `array.init_data $T $seg` expression. */
export function makeArrayInitData(
  typeVar: Var,
  segment: Var,
  ref: Expression,
  destOffset: Expression,
  srcOffset: Expression,
  size: Expression,
): ArrayInitDataExpr {
  return {
    kind: ExpressionKind.ArrayInitData,
    type: None,
    typeVar,
    segment,
    ref,
    destOffset,
    srcOffset,
    size,
  };
}

/** Creates an `array.init_elem $T $seg` expression. */
export function makeArrayInitElem(
  typeVar: Var,
  segment: Var,
  ref: Expression,
  destOffset: Expression,
  srcOffset: Expression,
  size: Expression,
): ArrayInitElemExpr {
  return {
    kind: ExpressionKind.ArrayInitElem,
    type: None,
    typeVar,
    segment,
    ref,
    destOffset,
    srcOffset,
    size,
  };
}

/** Creates an array.len expression. */
export function makeArrayLen(ref: Expression): ArrayLenExpr {
  return { kind: ExpressionKind.ArrayLen, type: ValType.I32, ref };
}

/** Creates a ref.test or ref.test null expression. */
export function makeRefTest(ref: Expression, castType: HeapType, nullable: boolean): RefTestExpr {
  return { kind: ExpressionKind.RefTest, type: ValType.I32, ref, heapType: castType, nullable };
}

/** Creates a ref.cast or ref.cast null expression. */
export function makeRefCast(
  ref: Expression,
  castType: HeapType,
  nullable: boolean,
  resultType: Type,
): RefCastExpr {
  return { kind: ExpressionKind.RefCast, type: resultType, ref, heapType: castType, nullable };
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
  // The four parameters stay flat — every caller passes them positionally — but
  // the NODE pairs each heap type with its nullability (Group 3).
  return {
    kind: ExpressionKind.BrOn,
    type: resultType,
    opcode,
    target: varName(label),
    ref,
    values: [],
    ...(srcType !== undefined
      ? { from: { heapType: srcType, nullable: srcNullable ?? false } }
      : {}),
    ...(castType !== undefined
      ? { to: { heapType: castType, nullable: castNullable ?? false } }
      : {}),
  };
}

/** Creates a `try_table` expression. */
export function makeTryTable(
  name: string | null,
  body: RegionInput,
  catches: TableCatch[],
  resultType: BlockResult,
): TryTableExpr {
  return {
    kind: ExpressionKind.TryTable,
    type: resultType,
    label: name ?? '',
    body: asRegion(body),
    catches,
  };
}

/** Creates a `try` expression (old EH). */
export function makeTry(
  name: string | null,
  body: RegionInput,
  catches: Catch[],
  delegateTarget: string | null,
  resultType: BlockResult,
): TryExpr {
  return {
    kind: ExpressionKind.Try,
    type: resultType,
    label: name ?? '',
    body: asRegion(body),
    catches,
    ...(delegateTarget === null ? {} : { delegate: varName(delegateTarget) }),
  };
}

/** A `catch $tag` clause. */
export function tryCatch(tag: Var, body: RegionInput): Catch {
  return { tag, isRef: false, body: asRegion(body) };
}

/** A `catch_all` clause — no tag, which is what absence means. */
export function tryCatchAll(body: RegionInput): Catch {
  return { isRef: false, body: asRegion(body) };
}

/** Creates a `throw $tag operands*` expression. */
export function makeThrow(tag: Var, operands: Expression[]): ThrowExpr {
  return { kind: ExpressionKind.Throw, type: Unreachable, tag, operands };
}

/** Creates a `throw_ref` expression. */
export function makeThrowRef(exnref: Expression): ThrowRefExpr {
  return { kind: ExpressionKind.ThrowRef, type: Unreachable, exnref };
}

/** Creates a `rethrow $depth` expression (old EH). */
export function makeRethrow(target: string): RethrowExpr {
  return { kind: ExpressionKind.Rethrow, type: Unreachable, target: varName(target) };
}

/** Creates a `pop` pseudo-instruction. */
export function makePop(type: Type): PopExpr {
  return { kind: ExpressionKind.Pop, type };
}

/** Creates a `v128.const` expression from 16 raw bytes. */
export function makeV128Const(bytes: Uint8Array): ConstExpr {
  return { kind: ExpressionKind.Const, type: ValType.V128, value: { type: ValType.V128, bytes } };
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
  return { kind: ExpressionKind.SIMDShuffle, type: ValType.V128, left, right, lanes: mask };
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

/** Creates a SIMD extended load expression (splat, extend, or zero-extend). */
export function makeSIMDLoad(
  opcode: SIMDLoadOp,
  ptr: Expression,
  offset: bigint,
  align: number,
  memidx: Var = varIndex(0),
): SIMDLoadExpr {
  return {
    kind: ExpressionKind.SIMDLoad,
    type: ValType.V128,
    opcode,
    address: ptr,
    offset,
    align,
    memidx,
  };
}

/** Creates a `v128.loadN_lane` or `v128.storeN_lane` expression. */
export function makeSIMDLoadStoreLane(
  opcode: SIMDLoadStoreLaneOp,
  ptr: Expression,
  vec: Expression,
  offset: bigint,
  align: number,
  lane: number,
  memidx: Var = varIndex(0),
): SIMDLoadStoreLaneExpr {
  const isStore = opcode === SIMDLoadStoreLaneOp.Store8LaneVec128 ||
    opcode === SIMDLoadStoreLaneOp.Store16LaneVec128 ||
    opcode === SIMDLoadStoreLaneOp.Store32LaneVec128 ||
    opcode === SIMDLoadStoreLaneOp.Store64LaneVec128;
  return {
    kind: ExpressionKind.SIMDLoadStoreLane,
    type: isStore ? None : ValType.V128,
    opcode,
    address: ptr,
    vec,
    offset,
    align,
    lane,
    memidx,
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
