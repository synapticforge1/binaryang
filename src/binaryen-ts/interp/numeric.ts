/**
 * @module binaryen-ts/interp/numeric
 *
 * The evaluator's numeric core (open-work 23, stage E1): every scalar unary
 * and binary operator on {@link Literal}s, as the WebAssembly spec defines it.
 *
 * ONE semantics for every consumer — OptimizeInstructions' folds, Precompute,
 * the interpreter and `wasm-ctor-eval` all come here, so a constant is never
 * folded one way and executed another.
 *
 * **A trap is a RESULT**, never a throw: `{ trap: 'integer divide by zero' }`.
 * A folding pass must leave a trapping expression as it is; the interpreter
 * stops on one. The messages are the spec testsuite's (D3, `./definitions`).
 *
 * **Floats are bits.** `abs`, `neg`, `copysign` and the reinterpretations act on
 * the bits and keep a NaN's payload, as the spec requires. Arithmetic computes
 * in JS numbers, where a NaN result comes out CANONICAL — which the spec allows
 * for every arithmetic operator (a canonical NaN is an arithmetic NaN), though
 * an engine may give another NaN. A consumer that must match an engine bit for
 * bit, rather than the spec, checks {@link isNaNLiteral} on the result.
 *
 * An f32 operation computes in double precision and rounds once: for `+ - * /`
 * and `sqrt` that is exact (a double carries more than twice f32's precision
 * plus two bits). A 64-bit integer converted to f32 is first narrowed to 53 bits
 * with a sticky bit, so it too rounds once.
 *
 * `null` means "not an operator this core evaluates, or operands of the wrong
 * type" — never a guess. A `v128` operand, or a splat, goes to `simd.ts`
 * (E3e), which computes each float lane through the scalar operator here.
 *
 * @license MIT
 */

import {
  BinaryOp,
  f32BitsOf,
  f64BitsOf,
  type Literal,
  literalFloat,
  UnaryOp,
} from '../ir/expressions.ts';
import { ValType } from '../ir/types.ts';
import { isNaNLane, isRelaxed, simdBinary, simdSplat, simdUnary } from './simd.ts';

/** The trap messages a numeric operator can produce — the spec testsuite's wording. */
export type NumericTrap =
  | 'integer divide by zero'
  | 'integer overflow'
  | 'invalid conversion to integer';

/** An operator's outcome: its value, or the trap it raises. */
export type NumericResult = { readonly value: Literal } | { readonly trap: NumericTrap };

// ---------------------------------------------------------------------------
// Literal construction
// ---------------------------------------------------------------------------

const i32 = (v: number): NumericResult => ({ value: { type: ValType.I32, value: v | 0 } });
const i64 = (v: bigint): NumericResult => ({
  value: { type: ValType.I64, value: BigInt.asIntN(64, v) },
});
// An arithmetic result that is NaN is written as the canonical NaN EXPLICITLY.
// 🔧 Converting the number's bits was not enough: V8 can carry a NaN's payload
// through `Math.ceil` and a DataView, so `f64.ceil` of a signalling NaN gave the
// signalling NaN back — not an arithmetic NaN, which the spec requires (found by
// the V8 differential, E1).
const f32 = (n: number): NumericResult => ({
  value: { type: ValType.F32, bits: Number.isNaN(n) ? 0x7fc00000 : f32BitsOf(n) },
});
const f64 = (n: number): NumericResult => ({
  value: { type: ValType.F64, bits: Number.isNaN(n) ? 0x7ff8000000000000n : f64BitsOf(n) },
});
const f32Bits = (bits: number): NumericResult => ({
  value: { type: ValType.F32, bits: bits >>> 0 },
});
const f64Bits = (bits: bigint): NumericResult => ({
  value: { type: ValType.F64, bits: BigInt.asUintN(64, bits) },
});
const bool = (b: boolean): NumericResult => i32(b ? 1 : 0);
const trap = (t: NumericTrap): NumericResult => ({ trap: t });

/** Whether `lit` is a float NaN (any payload, either sign). */
export function isNaNLiteral(lit: Literal): boolean {
  if (lit.type === ValType.F32) {
    return (lit.bits & 0x7f800000) === 0x7f800000 && (lit.bits & 0x7fffff) !== 0;
  }
  if (lit.type === ValType.F64) {
    const b = BigInt.asUintN(64, lit.bits);
    return (b & 0x7ff0000000000000n) === 0x7ff0000000000000n && (b & 0xfffffffffffffn) !== 0n;
  }
  return false;
}

const BIT_EXACT = new Set<number>([
  UnaryOp.AbsF32,
  UnaryOp.AbsF64,
  UnaryOp.NegF32,
  UnaryOp.NegF64,
  BinaryOp.CopySignF32,
  BinaryOp.CopySignF64,
  UnaryOp.ReinterpretI32,
  UnaryOp.ReinterpretI64,
]);

/**
 * Whether `op`'s float RESULT is fixed to the bit by the spec, a NaN's payload
 * included: the sign operations and the reinterpretations. Every other float
 * operator may give any arithmetic NaN, so a NaN it computes here need not be
 * the NaN an engine computes — a fold to it changes the bits a program can see.
 */
export function isBitExact(op: UnaryOp | BinaryOp): boolean {
  return BIT_EXACT.has(op);
}

/**
 * The SIMD operators whose result lanes are float ARITHMETIC — where a NaN
 * lane may be any arithmetic NaN, as for the scalar operators above. Every
 * other SIMD operator is exact on the bits: the sign operations, `pmin` /
 * `pmax` (an operand's bits), the bitwise ones, and everything with integer
 * lanes. `true` for the `f64x2` ones (two wide lanes), `false` for `f32x4`.
 */
const SIMD_FLOAT_ARITH = new Map<number, boolean>([
  [UnaryOp.SqrtVecF32x4, false],
  [UnaryOp.CeilVecF32x4, false],
  [UnaryOp.FloorVecF32x4, false],
  [UnaryOp.TruncVecF32x4, false],
  [UnaryOp.NearestVecF32x4, false],
  [UnaryOp.DemoteZeroVecF64x2ToF32x4, false],
  [UnaryOp.ConvertSVecI32x4ToF32x4, false],
  [UnaryOp.ConvertUVecI32x4ToF32x4, false],
  [BinaryOp.AddVecF32x4, false],
  [BinaryOp.SubVecF32x4, false],
  [BinaryOp.MulVecF32x4, false],
  [BinaryOp.DivVecF32x4, false],
  [BinaryOp.MinVecF32x4, false],
  [BinaryOp.MaxVecF32x4, false],
  [UnaryOp.SqrtVecF64x2, true],
  [UnaryOp.CeilVecF64x2, true],
  [UnaryOp.FloorVecF64x2, true],
  [UnaryOp.TruncVecF64x2, true],
  [UnaryOp.NearestVecF64x2, true],
  [UnaryOp.PromoteLowVecF32x4ToF64x2, true],
  [UnaryOp.ConvertLowSVecI32x4ToF64x2, true],
  [UnaryOp.ConvertLowUVecI32x4ToF64x2, true],
  [BinaryOp.AddVecF64x2, true],
  [BinaryOp.SubVecF64x2, true],
  [BinaryOp.MulVecF64x2, true],
  [BinaryOp.DivVecF64x2, true],
  [BinaryOp.MinVecF64x2, true],
  [BinaryOp.MaxVecF64x2, true],
]);

/**
 * The constant a pass may FOLD `op`'s outcome to, or `null` when it must leave
 * the expression to run: not evaluated, a trap (folding it away would remove
 * the trap), a NaN from an operator that is not {@link isBitExact} (the
 * engine picks that NaN, and a program can read it back) — a NaN LANE from a
 * float-arithmetic SIMD operator likewise — or a relaxed-SIMD operator, whose
 * result the engine picks among the alternatives the spec allows. Every
 * folding pass decides through here — one rule as well as one semantics.
 */
export function foldedLiteral(op: UnaryOp | BinaryOp, r: NumericResult | null): Literal | null {
  if (r === null || 'trap' in r) return null;
  if (isRelaxed(op)) return null;
  if (isNaNLiteral(r.value) && !isBitExact(op)) return null;
  if (r.value.type === ValType.V128) {
    const wide = SIMD_FLOAT_ARITH.get(op);
    if (wide !== undefined && isNaNLane(r.value.bytes, wide)) return null;
  }
  return r.value;
}

// ---------------------------------------------------------------------------
// Bit counting
// ---------------------------------------------------------------------------

function popcnt32(v: number): number {
  let x = v >>> 0, n = 0;
  while (x !== 0) {
    x &= x - 1;
    n++;
  }
  return n;
}
const ctz32 = (v: number): number => (v === 0 ? 32 : 31 - Math.clz32(v & -v));
function clz64(v: bigint): bigint {
  const u = BigInt.asUintN(64, v);
  return u === 0n ? 64n : BigInt(64 - u.toString(2).length);
}
function ctz64(v: bigint): bigint {
  const u = BigInt.asUintN(64, v);
  if (u === 0n) return 64n;
  const s = u.toString(2);
  return BigInt(s.length - 1 - s.lastIndexOf('1'));
}
function popcnt64(v: bigint): bigint {
  let n = 0n;
  for (const c of BigInt.asUintN(64, v).toString(2)) if (c === '1') n++;
  return n;
}

// ---------------------------------------------------------------------------
// Float helpers
// ---------------------------------------------------------------------------

/** Round to nearest, ties to even, keeping the sign of a zero result. */
function nearest(x: number): number {
  if (!Number.isFinite(x) || x === 0 || Math.abs(x) >= 2 ** 52) return x;
  let r = Math.floor(x);
  const d = x - r;
  if (d > 0.5 || (d === 0.5 && r % 2 !== 0)) r += 1;
  return r === 0 ? (x < 0 ? -0 : 0) : r;
}

/** A 64-bit integer (as an unsigned magnitude with a sign) to f32, rounded ONCE. */
function bigToF32(v: bigint, unsigned: boolean): number {
  const neg = !unsigned && v < 0n;
  let u = unsigned ? BigInt.asUintN(64, v) : (neg ? -v : v);
  const n = u.toString(2).length;
  let r: number;
  if (n > 53) {
    // Keep 53 bits, OR-ing what is dropped into the lowest: a double holds it
    // exactly, and the f32 rounding then sees the same nearest / tie it would
    // have seen in the full value.
    const k = BigInt(n - 53);
    const dropped = u & ((1n << k) - 1n);
    u = (u >> k) | (dropped !== 0n ? 1n : 0n);
    r = Number(u) * 2 ** (n - 53);
  } else {
    r = Number(u);
  }
  return Math.fround(neg ? -r : r);
}

const TWO_63 = 2 ** 63;
const TWO_64 = 2 ** 64;

function truncToI32(x: number, unsigned: boolean): NumericResult {
  if (Number.isNaN(x)) return trap('invalid conversion to integer');
  const t = Math.trunc(x);
  if (unsigned ? (t < 0 || t > 0xffffffff) : (t < -0x80000000 || t > 0x7fffffff)) {
    return trap('integer overflow');
  }
  return i32(t);
}
function truncToI64(x: number, unsigned: boolean): NumericResult {
  if (Number.isNaN(x)) return trap('invalid conversion to integer');
  const t = Math.trunc(x);
  if (unsigned ? (t < 0 || t >= TWO_64) : (t < -TWO_63 || t >= TWO_63)) {
    return trap('integer overflow');
  }
  return i64(BigInt(t));
}
function truncSatToI32(x: number, unsigned: boolean): NumericResult {
  if (Number.isNaN(x)) return i32(0);
  const t = Math.trunc(x);
  if (unsigned) return i32(t <= 0 ? 0 : t >= 0xffffffff ? 0xffffffff : t);
  return i32(t <= -0x80000000 ? -0x80000000 : t >= 0x7fffffff ? 0x7fffffff : t);
}
function truncSatToI64(x: number, unsigned: boolean): NumericResult {
  if (Number.isNaN(x)) return i64(0n);
  const t = Math.trunc(x);
  if (unsigned) return i64(t <= 0 ? 0n : t >= TWO_64 ? 0xffffffffffffffffn : BigInt(t));
  return i64(t <= -TWO_63 ? -(2n ** 63n) : t >= TWO_63 ? 2n ** 63n - 1n : BigInt(t));
}

// ---------------------------------------------------------------------------
// Unary
// ---------------------------------------------------------------------------

/**
 * Evaluates a unary operator — scalar, or SIMD on a `v128` (a splat takes a
 * scalar). `null` when `op` is not one this core evaluates or `a` is not its
 * operand type.
 */
export function evalUnary(op: UnaryOp, a: Literal): NumericResult | null {
  switch (a.type) {
    case ValType.I32:
      return unaryI32(op, a.value | 0) ?? simdSplat(op, a);
    case ValType.I64:
      return unaryI64(op, BigInt.asIntN(64, a.value)) ?? simdSplat(op, a);
    case ValType.F32:
      return unaryF32(op, a.bits >>> 0, literalFloat(a)) ?? simdSplat(op, a);
    case ValType.F64:
      return unaryF64(op, BigInt.asUintN(64, a.bits), literalFloat(a)) ?? simdSplat(op, a);
    case ValType.V128:
      return simdUnary(op, a.bytes);
    default:
      return null;
  }
}

function unaryI32(op: UnaryOp, v: number): NumericResult | null {
  switch (op) {
    case UnaryOp.ClzI32:
      return i32(Math.clz32(v));
    case UnaryOp.CtzI32:
      return i32(ctz32(v));
    case UnaryOp.PopcntI32:
      return i32(popcnt32(v));
    case UnaryOp.EqzI32:
      return bool(v === 0);
    case UnaryOp.ExtendS8I32:
      return i32((v << 24) >> 24);
    case UnaryOp.ExtendS16I32:
      return i32((v << 16) >> 16);
    case UnaryOp.ExtendSI32:
      return i64(BigInt(v));
    case UnaryOp.ExtendUI32:
      return i64(BigInt(v >>> 0));
    case UnaryOp.ConvertSI32ToF32:
      return f32(Math.fround(v));
    case UnaryOp.ConvertUI32ToF32:
      return f32(Math.fround(v >>> 0));
    case UnaryOp.ConvertSI32ToF64:
      return f64(v);
    case UnaryOp.ConvertUI32ToF64:
      return f64(v >>> 0);
    case UnaryOp.ReinterpretI32:
      return f32Bits(v);
    default:
      return null;
  }
}

function unaryI64(op: UnaryOp, v: bigint): NumericResult | null {
  switch (op) {
    case UnaryOp.ClzI64:
      return i64(clz64(v));
    case UnaryOp.CtzI64:
      return i64(ctz64(v));
    case UnaryOp.PopcntI64:
      return i64(popcnt64(v));
    case UnaryOp.EqzI64:
      return bool(v === 0n);
    case UnaryOp.WrapI64:
      return i32(Number(BigInt.asIntN(32, v)));
    case UnaryOp.ExtendS8I64:
      return i64(BigInt.asIntN(8, v));
    case UnaryOp.ExtendS16I64:
      return i64(BigInt.asIntN(16, v));
    case UnaryOp.ExtendS32I64:
      return i64(BigInt.asIntN(32, v));
    case UnaryOp.ConvertSI64ToF32:
      return f32(bigToF32(v, false));
    case UnaryOp.ConvertUI64ToF32:
      return f32(bigToF32(v, true));
    case UnaryOp.ConvertSI64ToF64:
      // BigInt → Number rounds to nearest, ties to even (ECMA-262 § 21.1.2.x).
      return f64(Number(v));
    case UnaryOp.ConvertUI64ToF64:
      return f64(Number(BigInt.asUintN(64, v)));
    case UnaryOp.ReinterpretI64:
      return f64Bits(v);
    default:
      return null;
  }
}

function unaryF32(op: UnaryOp, bits: number, x: number): NumericResult | null {
  switch (op) {
    // Sign operations act on the BITS: a NaN keeps its payload.
    case UnaryOp.AbsF32:
      return f32Bits(bits & 0x7fffffff);
    case UnaryOp.NegF32:
      return f32Bits(bits ^ 0x80000000);
    case UnaryOp.CeilF32:
      return f32(Math.ceil(x));
    case UnaryOp.FloorF32:
      return f32(Math.floor(x));
    case UnaryOp.TruncF32:
      return f32(Math.trunc(x));
    case UnaryOp.NearestF32:
      return f32(nearest(x));
    case UnaryOp.SqrtF32:
      return f32(Math.fround(Math.sqrt(x)));
    case UnaryOp.ReinterpretF32:
      return i32(bits | 0);
    case UnaryOp.PromoteF32:
      return f64(x);
    case UnaryOp.TruncSF32ToI32:
      return truncToI32(x, false);
    case UnaryOp.TruncUF32ToI32:
      return truncToI32(x, true);
    case UnaryOp.TruncSF32ToI64:
      return truncToI64(x, false);
    case UnaryOp.TruncUF32ToI64:
      return truncToI64(x, true);
    case UnaryOp.TruncSatSF32ToI32:
      return truncSatToI32(x, false);
    case UnaryOp.TruncSatUF32ToI32:
      return truncSatToI32(x, true);
    case UnaryOp.TruncSatSF32ToI64:
      return truncSatToI64(x, false);
    case UnaryOp.TruncSatUF32ToI64:
      return truncSatToI64(x, true);
    default:
      return null;
  }
}

function unaryF64(op: UnaryOp, bits: bigint, x: number): NumericResult | null {
  switch (op) {
    case UnaryOp.AbsF64:
      return f64Bits(bits & 0x7fffffffffffffffn);
    case UnaryOp.NegF64:
      return f64Bits(bits ^ 0x8000000000000000n);
    case UnaryOp.CeilF64:
      return f64(Math.ceil(x));
    case UnaryOp.FloorF64:
      return f64(Math.floor(x));
    case UnaryOp.TruncF64:
      return f64(Math.trunc(x));
    case UnaryOp.NearestF64:
      return f64(nearest(x));
    case UnaryOp.SqrtF64:
      return f64(Math.sqrt(x));
    case UnaryOp.ReinterpretF64:
      return i64(bits);
    case UnaryOp.DemoteF64:
      return f32(Math.fround(x));
    case UnaryOp.TruncSF64ToI32:
      return truncToI32(x, false);
    case UnaryOp.TruncUF64ToI32:
      return truncToI32(x, true);
    case UnaryOp.TruncSF64ToI64:
      return truncToI64(x, false);
    case UnaryOp.TruncUF64ToI64:
      return truncToI64(x, true);
    case UnaryOp.TruncSatSF64ToI32:
      return truncSatToI32(x, false);
    case UnaryOp.TruncSatUF64ToI32:
      return truncSatToI32(x, true);
    case UnaryOp.TruncSatSF64ToI64:
      return truncSatToI64(x, false);
    case UnaryOp.TruncSatUF64ToI64:
      return truncSatToI64(x, true);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Binary
// ---------------------------------------------------------------------------

/**
 * Evaluates a binary operator — scalar, or SIMD on a `v128` (a lane shift
 * takes an `i32` count on the right). `null` when `op` is not one this core
 * evaluates or the operands are not its operand types.
 */
export function evalBinary(op: BinaryOp, a: Literal, b: Literal): NumericResult | null {
  if (a.type === ValType.V128) return simdBinary(op, a.bytes, b);
  if (a.type !== b.type) return null;
  switch (a.type) {
    case ValType.I32:
      return binaryI32(op, a.value | 0, (b as typeof a).value | 0);
    case ValType.I64:
      return binaryI64(op, BigInt.asIntN(64, a.value), BigInt.asIntN(64, (b as typeof a).value));
    case ValType.F32:
      return binaryF32(
        op,
        a.bits >>> 0,
        (b as typeof a).bits >>> 0,
        literalFloat(a),
        literalFloat(b),
      );
    case ValType.F64:
      return binaryF64(
        op,
        BigInt.asUintN(64, a.bits),
        BigInt.asUintN(64, (b as typeof a).bits),
        literalFloat(a),
        literalFloat(b),
      );
    default:
      return null;
  }
}

function binaryI32(op: BinaryOp, a: number, b: number): NumericResult | null {
  const ua = a >>> 0, ub = b >>> 0;
  switch (op) {
    case BinaryOp.AddI32:
      return i32(a + b);
    case BinaryOp.SubI32:
      return i32(a - b);
    case BinaryOp.MulI32:
      return i32(Math.imul(a, b));
    case BinaryOp.DivSI32:
      if (b === 0) return trap('integer divide by zero');
      if (a === -0x80000000 && b === -1) return trap('integer overflow');
      return i32(Math.trunc(a / b));
    case BinaryOp.DivUI32:
      if (b === 0) return trap('integer divide by zero');
      return i32(Math.trunc(ua / ub));
    case BinaryOp.RemSI32:
      if (b === 0) return trap('integer divide by zero');
      // INT_MIN rem -1 is 0, not a trap; JS gives -0, which `| 0` makes 0.
      return i32(a % b);
    case BinaryOp.RemUI32:
      if (b === 0) return trap('integer divide by zero');
      return i32(ua % ub);
    case BinaryOp.AndI32:
      return i32(a & b);
    case BinaryOp.OrI32:
      return i32(a | b);
    case BinaryOp.XorI32:
      return i32(a ^ b);
    case BinaryOp.ShlI32:
      return i32(a << (b & 31));
    case BinaryOp.ShrSI32:
      return i32(a >> (b & 31));
    case BinaryOp.ShrUI32:
      return i32(a >>> (b & 31));
    case BinaryOp.RotlI32: {
      const s = b & 31;
      return i32(s === 0 ? a : (a << s) | (a >>> (32 - s)));
    }
    case BinaryOp.RotrI32: {
      const s = b & 31;
      return i32(s === 0 ? a : (a >>> s) | (a << (32 - s)));
    }
    case BinaryOp.EqI32:
      return bool(a === b);
    case BinaryOp.NeI32:
      return bool(a !== b);
    case BinaryOp.LtSI32:
      return bool(a < b);
    case BinaryOp.LtUI32:
      return bool(ua < ub);
    case BinaryOp.LeSI32:
      return bool(a <= b);
    case BinaryOp.LeUI32:
      return bool(ua <= ub);
    case BinaryOp.GtSI32:
      return bool(a > b);
    case BinaryOp.GtUI32:
      return bool(ua > ub);
    case BinaryOp.GeSI32:
      return bool(a >= b);
    case BinaryOp.GeUI32:
      return bool(ua >= ub);
    default:
      return null;
  }
}

function binaryI64(op: BinaryOp, a: bigint, b: bigint): NumericResult | null {
  const ua = BigInt.asUintN(64, a), ub = BigInt.asUintN(64, b);
  switch (op) {
    case BinaryOp.AddI64:
      return i64(a + b);
    case BinaryOp.SubI64:
      return i64(a - b);
    case BinaryOp.MulI64:
      return i64(a * b);
    case BinaryOp.DivSI64:
      if (b === 0n) return trap('integer divide by zero');
      if (a === -(2n ** 63n) && b === -1n) return trap('integer overflow');
      return i64(a / b); // BigInt division truncates toward zero, as wasm's
    case BinaryOp.DivUI64:
      if (b === 0n) return trap('integer divide by zero');
      return i64(ua / ub);
    case BinaryOp.RemSI64:
      if (b === 0n) return trap('integer divide by zero');
      return i64(a % b); // the dividend's sign, as wasm's
    case BinaryOp.RemUI64:
      if (b === 0n) return trap('integer divide by zero');
      return i64(ua % ub);
    case BinaryOp.AndI64:
      return i64(a & b);
    case BinaryOp.OrI64:
      return i64(a | b);
    case BinaryOp.XorI64:
      return i64(a ^ b);
    case BinaryOp.ShlI64:
      return i64(a << (ub & 63n));
    case BinaryOp.ShrSI64:
      return i64(a >> (ub & 63n));
    case BinaryOp.ShrUI64:
      return i64(ua >> (ub & 63n));
    case BinaryOp.RotlI64: {
      const s = ub & 63n;
      return i64(s === 0n ? a : (ua << s) | (ua >> (64n - s)));
    }
    case BinaryOp.RotrI64: {
      const s = ub & 63n;
      return i64(s === 0n ? a : (ua >> s) | (ua << (64n - s)));
    }
    case BinaryOp.EqI64:
      return bool(a === b);
    case BinaryOp.NeI64:
      return bool(a !== b);
    case BinaryOp.LtSI64:
      return bool(a < b);
    case BinaryOp.LtUI64:
      return bool(ua < ub);
    case BinaryOp.LeSI64:
      return bool(a <= b);
    case BinaryOp.LeUI64:
      return bool(ua <= ub);
    case BinaryOp.GtSI64:
      return bool(a > b);
    case BinaryOp.GtUI64:
      return bool(ua > ub);
    case BinaryOp.GeSI64:
      return bool(a >= b);
    case BinaryOp.GeUI64:
      return bool(ua >= ub);
    default:
      return null;
  }
}

function binaryF32(
  op: BinaryOp,
  ab: number,
  bb: number,
  a: number,
  b: number,
): NumericResult | null {
  switch (op) {
    case BinaryOp.AddF32:
      return f32(Math.fround(a + b));
    case BinaryOp.SubF32:
      return f32(Math.fround(a - b));
    case BinaryOp.MulF32:
      return f32(Math.fround(a * b));
    case BinaryOp.DivF32:
      return f32(Math.fround(a / b));
    case BinaryOp.MinF32:
      return f32(Math.min(a, b));
    case BinaryOp.MaxF32:
      return f32(Math.max(a, b));
    case BinaryOp.CopySignF32:
      return f32Bits((ab & 0x7fffffff) | (bb & 0x80000000));
    case BinaryOp.EqF32:
      return bool(a === b);
    case BinaryOp.NeF32:
      return bool(a !== b);
    case BinaryOp.LtF32:
      return bool(a < b);
    case BinaryOp.LeF32:
      return bool(a <= b);
    case BinaryOp.GtF32:
      return bool(a > b);
    case BinaryOp.GeF32:
      return bool(a >= b);
    default:
      return null;
  }
}

function binaryF64(
  op: BinaryOp,
  ab: bigint,
  bb: bigint,
  a: number,
  b: number,
): NumericResult | null {
  switch (op) {
    case BinaryOp.AddF64:
      return f64(a + b);
    case BinaryOp.SubF64:
      return f64(a - b);
    case BinaryOp.MulF64:
      return f64(a * b);
    case BinaryOp.DivF64:
      return f64(a / b);
    case BinaryOp.MinF64:
      return f64(Math.min(a, b));
    case BinaryOp.MaxF64:
      return f64(Math.max(a, b));
    case BinaryOp.CopySignF64:
      return f64Bits((ab & 0x7fffffffffffffffn) | (bb & 0x8000000000000000n));
    case BinaryOp.EqF64:
      return bool(a === b);
    case BinaryOp.NeF64:
      return bool(a !== b);
    case BinaryOp.LtF64:
      return bool(a < b);
    case BinaryOp.LeF64:
      return bool(a <= b);
    case BinaryOp.GtF64:
      return bool(a > b);
    case BinaryOp.GeF64:
      return bool(a >= b);
    default:
      return null;
  }
}
