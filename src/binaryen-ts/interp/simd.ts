/**
 * @module binaryen-ts/interp/simd
 *
 * The evaluator's `v128` core (open-work 23, stage E3e): every SIMD operator
 * on 16-byte vectors, as the WebAssembly spec defines it — the unary, binary
 * and ternary operators, the splats, lane extraction and replacement, and
 * `i8x16.shuffle`. `numeric.ts` dispatches here for a `v128` operand or a
 * splat, so OptimizeInstructions, Precompute and the interpreter all compute a
 * vector the same way.
 *
 * **Lanes are little-endian views over the bytes.** Where the spec defines a
 * lane operation as the scalar one — float arithmetic, comparisons,
 * conversions, `nearest`, the saturating truncations — each lane goes through
 * `numeric.ts`'s scalar operator, so there is ONE semantics for `f32.add` and
 * `f32x4.add`'s lanes. What has no scalar twin (saturating integer arithmetic,
 * `avgr_u`, `q15mulr_sat_s`, `dot`, `extmul`, `extadd_pairwise`, `narrow`,
 * `extend`, `bitmask`, `all_true` / `any_true`, `swizzle`, `pmin` / `pmax`,
 * the bitwise operators) is here.
 *
 * **No SIMD operator traps**, so every result is a value. A float lane that
 * is NaN comes out canonical, as a scalar one does; `isNaNLane` tells a
 * folding pass whether a result holds one (see `foldedLiteral`).
 *
 * **Relaxed SIMD is computed in the spec's DETERMINISTIC profile** (owner,
 * 2026-10-07): the first of the alternatives the spec lists for each operator
 * — `relaxed_swizzle` as `swizzle`, the relaxed truncations as the saturating
 * ones, `relaxed_madd` / `nmadd` as a FUSED multiply-add (one rounding, exact
 * through `bigint`), `relaxed_laneselect` as `bitselect`, `relaxed_min` /
 * `max` as `min` / `max`, `relaxed_q15mulr_s` as `q15mulr_sat_s`, and the
 * relaxed dot products with every lane signed. An engine may pick another
 * alternative, so {@link isRelaxed} marks them and a folding pass never folds
 * one.
 *
 * `null` means "not a SIMD operator this core evaluates" — never a guess.
 *
 * @license MIT
 */

import {
  BinaryOp,
  type Literal,
  literalFloat,
  SIMDExtractOp,
  SIMDReplaceOp,
  SIMDTernaryOp,
  UnaryOp,
} from '../ir/expressions.ts';
import { ValType } from '../ir/types.ts';
import { evalBinary, evalUnary, type NumericResult } from './numeric.ts';

/** The `v128` literal. */
export type V128Literal = Extract<Literal, { type: typeof ValType.V128 }>;

/** A SIMD sub-opcode as the IR's opcode (the `0xfd` prefix in the high half). */
const S = (sub: number): number => (0xfd << 16) | sub;

/** Whether `op` is a relaxed-SIMD operator: its result is implementation-defined. */
export function isRelaxed(op: number): boolean {
  return op >= S(0x100) && op <= S(0x113);
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

type Bits = 8 | 16 | 32;

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, 16);

/** The integer lanes of `b`, `bits` wide, as numbers. */
function ints(b: Uint8Array, bits: Bits, signed: boolean): number[] {
  const v = view(b);
  const out: number[] = [];
  for (let i = 0; i < 128 / bits; i++) {
    out.push(
      bits === 8
        ? (signed ? v.getInt8(i) : v.getUint8(i))
        : bits === 16
        ? (signed ? v.getInt16(2 * i, true) : v.getUint16(2 * i, true))
        : (signed ? v.getInt32(4 * i, true) : v.getUint32(4 * i, true)),
    );
  }
  return out;
}

/** Lanes `bits` wide from numbers, each WRAPPED to the lane (a true two's-complement store). */
function fromInts(bits: Bits, lanes: readonly number[]): Uint8Array {
  const b = new Uint8Array(16);
  const v = view(b);
  for (let i = 0; i < lanes.length; i++) {
    const x = lanes[i]!;
    if (bits === 8) v.setUint8(i, x & 0xff);
    else if (bits === 16) v.setUint16(2 * i, x & 0xffff, true);
    else v.setUint32(4 * i, x >>> 0, true);
  }
  return b;
}

function longs(b: Uint8Array, signed: boolean): bigint[] {
  const v = view(b);
  return [0, 8].map((at) => signed ? v.getBigInt64(at, true) : v.getBigUint64(at, true));
}

function fromLongs(lanes: readonly bigint[]): Uint8Array {
  const b = new Uint8Array(16);
  const v = view(b);
  v.setBigUint64(0, BigInt.asUintN(64, lanes[0]!), true);
  v.setBigUint64(8, BigInt.asUintN(64, lanes[1]!), true);
  return b;
}

/** The four `f32` lanes as literals (bits, never a number — a NaN keeps its payload). */
function f32s(b: Uint8Array): Literal[] {
  const v = view(b);
  return [0, 4, 8, 12].map((at) => ({ type: ValType.F32, bits: v.getUint32(at, true) }));
}
function f64s(b: Uint8Array): Literal[] {
  const v = view(b);
  return [0, 8].map((at) => ({ type: ValType.F64, bits: v.getBigUint64(at, true) }));
}
/** Scalar results back into lanes: an `i32` / `f32` as 32 bits, an `i64` / `f64` as 64. */
function fromScalars(lanes: readonly Literal[]): Uint8Array {
  const b = new Uint8Array(16);
  const v = view(b);
  let at = 0;
  for (const l of lanes) {
    switch (l.type) {
      case ValType.I32:
        v.setInt32(at, l.value | 0, true);
        at += 4;
        break;
      case ValType.F32:
        v.setUint32(at, l.bits >>> 0, true);
        at += 4;
        break;
      case ValType.I64:
        v.setBigInt64(at, BigInt.asIntN(64, l.value), true);
        at += 8;
        break;
      case ValType.F64:
        v.setBigUint64(at, BigInt.asUintN(64, l.bits), true);
        at += 8;
        break;
      default:
        throw new Error('simd: a lane must be a scalar');
    }
  }
  return b;
}

const v128 = (bytes: Uint8Array): NumericResult => ({ value: { type: ValType.V128, bytes } });
const i32 = (v: number): NumericResult => ({ value: { type: ValType.I32, value: v | 0 } });
const bool = (b: boolean): NumericResult => i32(b ? 1 : 0);
const I32 = (value: number): Literal => ({ type: ValType.I32, value: value | 0 });
const I64 = (value: bigint): Literal => ({ type: ValType.I64, value: BigInt.asIntN(64, value) });

/** A scalar operator's value — SIMD lanes never trap, so a trap here is a bug. */
function scalar(r: NumericResult | null): Literal {
  if (r === null || 'trap' in r) throw new Error('simd: a lane operator gave no value');
  return r.value;
}
const lane1 = (op: number, a: Literal): Literal => scalar(evalUnary(op, a));
const lane2 = (op: number, a: Literal, b: Literal): Literal => scalar(evalBinary(op, a, b));

/** Whether any float lane of `bytes`, read as `f32x4` or `f64x2` per `wide`, is NaN. */
export function isNaNLane(bytes: Uint8Array, wide: boolean): boolean {
  const v = view(bytes);
  if (wide) {
    return [0, 8].some((at) => {
      const b = v.getBigUint64(at, true);
      return (b & 0x7ff0000000000000n) === 0x7ff0000000000000n && (b & 0xfffffffffffffn) !== 0n;
    });
  }
  return [0, 4, 8, 12].some((at) => {
    const b = v.getUint32(at, true);
    return (b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0;
  });
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const satS = (bits: Bits, x: number): number => clamp(x, -(2 ** (bits - 1)), 2 ** (bits - 1) - 1);
const satU = (bits: Bits, x: number): number => clamp(x, 0, 2 ** bits - 1);

// ---------------------------------------------------------------------------
// Fused multiply-add, exact (relaxed_madd / nmadd in the deterministic profile)
// ---------------------------------------------------------------------------

/** A finite non-zero double as `m × 2^e`, `m` a signed integer. */
function decompose(x: number): { m: bigint; e: number } {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  const bits = v.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  const m = exp === 0 ? frac : frac | (1n << 52n);
  return { m: x < 0 ? -m : m, e: exp === 0 ? -1074 : exp - 1075 };
}

/**
 * `m × 2^e` rounded ONCE to the nearest `f32` (or `f64`), ties to even, with
 * the format's subnormal range and overflow. `m` is non-zero.
 */
function roundTo(m: bigint, e: number, f32: boolean): number {
  const neg = m < 0n;
  let mag = neg ? -m : m;
  const p = f32 ? 24 : 53, qmin = f32 ? -149 : -1074;
  const len = mag.toString(2).length;
  const q = Math.max(e + len - p, qmin);
  const shift = q - e;
  let r: number;
  if (shift <= 0) r = Number(mag) * 2 ** e;
  else {
    const s = BigInt(shift);
    const kept = mag >> s;
    const rem = mag & ((1n << s) - 1n);
    const half = 1n << (s - 1n);
    mag = rem > half || (rem === half && (kept & 1n) === 1n) ? kept + 1n : kept;
    r = Number(mag) * 2 ** q;
  }
  if (f32) r = Math.fround(r);
  return neg ? -r : r;
}

/** `a × b + c` with ONE rounding — IEEE 754 `fusedMultiplyAdd` — in f32 or f64. */
export function fma(a: number, b: number, c: number, f32: boolean): number {
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) return NaN;
  const p = a * b; // only its class and sign are used below where it is not exact
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    if (Number.isNaN(p)) return NaN; // 0 × ∞
    if (!Number.isFinite(c) && c !== p) return NaN; // ∞ − ∞
    return p;
  }
  if (!Number.isFinite(c)) return c;
  // A zero OPERAND: the sum is `(±0) + c`, which JS computes exactly, sign rules
  // included. A zero addend: the product correctly rounded is the answer.
  // 🔧 `p === 0` was tested too, and a product that UNDERFLOWS to zero
  // (2^-1000 × 2^-75) then lost its contribution to the sum — a tie the exact
  // path rounds to even; found when the unit test's expected value, itself
  // computed with an underflowing `2 ** -1075`, was rewritten by hand.
  if (a === 0 || b === 0) return f32 ? Math.fround(p + c) : p + c;
  if (c === 0) return f32 ? Math.fround(p) : p;
  const A = decompose(a), B = decompose(b), C = decompose(c);
  const ep = A.e + B.e;
  const e = Math.min(ep, C.e);
  const sum = (A.m * B.m << BigInt(ep - e)) + (C.m << BigInt(C.e - e));
  // An exact zero from operands of opposite sign is +0 under round-to-nearest.
  if (sum === 0n) return 0;
  return roundTo(sum, e, f32);
}

// ---------------------------------------------------------------------------
// Unary
// ---------------------------------------------------------------------------

/** `*.splat`: `a` in every lane. `null` for an operator that is not a splat. */
export function simdSplat(op: UnaryOp, a: Literal): NumericResult | null {
  switch (op) {
    case UnaryOp.SplatVecI8x16:
      return a.type === ValType.I32 ? v128(fromInts(8, new Array<number>(16).fill(a.value))) : null;
    case UnaryOp.SplatVecI16x8:
      return a.type === ValType.I32 ? v128(fromInts(16, new Array<number>(8).fill(a.value))) : null;
    case UnaryOp.SplatVecI32x4:
      return a.type === ValType.I32 ? v128(fromInts(32, new Array<number>(4).fill(a.value))) : null;
    case UnaryOp.SplatVecI64x2:
      return a.type === ValType.I64 ? v128(fromLongs([a.value, a.value])) : null;
    case UnaryOp.SplatVecF32x4:
      return a.type === ValType.F32 ? v128(fromScalars([a, a, a, a])) : null;
    case UnaryOp.SplatVecF64x2:
      return a.type === ValType.F64 ? v128(fromScalars([a, a])) : null;
    default:
      return null;
  }
}

const extend = (
  a: Uint8Array,
  to: Bits,
  signed: boolean,
  high: boolean,
): Uint8Array => {
  const from = ints(a, (to / 2) as Bits, signed);
  return fromInts(to, high ? from.slice(from.length / 2) : from.slice(0, from.length / 2));
};
const extendTo64 = (a: Uint8Array, signed: boolean, high: boolean): Uint8Array => {
  const from = ints(a, 32, signed);
  return fromLongs((high ? from.slice(2) : from.slice(0, 2)).map(BigInt));
};
const extaddPairwise = (a: Uint8Array, to: Bits, signed: boolean): Uint8Array => {
  const from = ints(a, (to / 2) as Bits, signed);
  const out: number[] = [];
  for (let i = 0; i < from.length; i += 2) out.push(from[i]! + from[i + 1]!);
  return fromInts(to, out);
};
const bitmask = (lanes: readonly number[]): number =>
  lanes.reduce((m, x, i) => (x < 0 ? m | (1 << i) : m), 0);
const popcnt8 = (x: number): number => {
  let n = 0;
  for (let v = x & 0xff; v !== 0; v &= v - 1) n++;
  return n;
};
/** Lanes 0 and 1 from `lanes`, then zero lanes to fill the vector (`*_zero`). */
const lowThenZero = (lanes: Literal[], zero: Literal): Literal[] => [...lanes, zero, zero];

/** Evaluates a SIMD unary operator on a vector; `null` when `op` is not one. */
export function simdUnary(op: UnaryOp, a: Uint8Array): NumericResult | null {
  switch (op) {
    case UnaryOp.NotVec128:
      return v128(a.map((x) => ~x & 0xff));
    case UnaryOp.AnyTrueVec128:
      return bool(a.some((x) => x !== 0));
    case UnaryOp.AllTrueVecI8x16:
      return bool(ints(a, 8, false).every((x) => x !== 0));
    case UnaryOp.AllTrueVecI16x8:
      return bool(ints(a, 16, false).every((x) => x !== 0));
    case UnaryOp.AllTrueVecI32x4:
      return bool(ints(a, 32, false).every((x) => x !== 0));
    case UnaryOp.AllTrueVecI64x2:
      return bool(longs(a, false).every((x) => x !== 0n));
    case UnaryOp.BitmaskVecI8x16:
      return i32(bitmask(ints(a, 8, true)));
    case UnaryOp.BitmaskVecI16x8:
      return i32(bitmask(ints(a, 16, true)));
    case UnaryOp.BitmaskVecI32x4:
      return i32(bitmask(ints(a, 32, true)));
    case UnaryOp.BitmaskVecI64x2:
      return i32(longs(a, true).reduce((m, x, i) => (x < 0n ? m | (1 << i) : m), 0));

    // Integer lanes: abs and neg WRAP (abs of the minimum is itself).
    case UnaryOp.AbsVecI8x16:
      return v128(fromInts(8, ints(a, 8, true).map(Math.abs)));
    case UnaryOp.AbsVecI16x8:
      return v128(fromInts(16, ints(a, 16, true).map(Math.abs)));
    case UnaryOp.AbsVecI32x4:
      return v128(fromInts(32, ints(a, 32, true).map(Math.abs)));
    case UnaryOp.AbsVecI64x2:
      return v128(fromLongs(longs(a, true).map((x) => (x < 0n ? -x : x))));
    case UnaryOp.NegVecI8x16:
      return v128(fromInts(8, ints(a, 8, true).map((x) => -x)));
    case UnaryOp.NegVecI16x8:
      return v128(fromInts(16, ints(a, 16, true).map((x) => -x)));
    case UnaryOp.NegVecI32x4:
      return v128(fromInts(32, ints(a, 32, true).map((x) => -x)));
    case UnaryOp.NegVecI64x2:
      return v128(fromLongs(longs(a, true).map((x) => -x)));
    case UnaryOp.PopcntVecI8x16:
      return v128(fromInts(8, ints(a, 8, false).map(popcnt8)));

    case UnaryOp.ExtendLowSVecI8x16ToI16x8:
      return v128(extend(a, 16, true, false));
    case UnaryOp.ExtendHighSVecI8x16ToI16x8:
      return v128(extend(a, 16, true, true));
    case UnaryOp.ExtendLowUVecI8x16ToI16x8:
      return v128(extend(a, 16, false, false));
    case UnaryOp.ExtendHighUVecI8x16ToI16x8:
      return v128(extend(a, 16, false, true));
    case UnaryOp.ExtendLowSVecI16x8ToI32x4:
      return v128(extend(a, 32, true, false));
    case UnaryOp.ExtendHighSVecI16x8ToI32x4:
      return v128(extend(a, 32, true, true));
    case UnaryOp.ExtendLowUVecI16x8ToI32x4:
      return v128(extend(a, 32, false, false));
    case UnaryOp.ExtendHighUVecI16x8ToI32x4:
      return v128(extend(a, 32, false, true));
    case UnaryOp.ExtendLowSVecI32x4ToI64x2:
      return v128(extendTo64(a, true, false));
    case UnaryOp.ExtendHighSVecI32x4ToI64x2:
      return v128(extendTo64(a, true, true));
    case UnaryOp.ExtendLowUVecI32x4ToI64x2:
      return v128(extendTo64(a, false, false));
    case UnaryOp.ExtendHighUVecI32x4ToI64x2:
      return v128(extendTo64(a, false, true));
    case UnaryOp.ExtaddPairwiseSVecI8x16ToI16x8:
      return v128(extaddPairwise(a, 16, true));
    case UnaryOp.ExtaddPairwiseUVecI8x16ToI16x8:
      return v128(extaddPairwise(a, 16, false));
    case UnaryOp.ExtaddPairwiseSVecI16x8ToI32x4:
      return v128(extaddPairwise(a, 32, true));
    case UnaryOp.ExtaddPairwiseUVecI16x8ToI32x4:
      return v128(extaddPairwise(a, 32, false));

    // Float lanes: the scalar operator, lane by lane.
    case UnaryOp.AbsVecF32x4:
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.AbsF32, l))));
    case UnaryOp.NegVecF32x4:
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.NegF32, l))));
    case UnaryOp.SqrtVecF32x4:
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.SqrtF32, l))));
    case UnaryOp.CeilVecF32x4:
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.CeilF32, l))));
    case UnaryOp.FloorVecF32x4:
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.FloorF32, l))));
    case UnaryOp.TruncVecF32x4:
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.TruncF32, l))));
    case UnaryOp.NearestVecF32x4:
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.NearestF32, l))));
    case UnaryOp.AbsVecF64x2:
      return v128(fromScalars(f64s(a).map((l) => lane1(UnaryOp.AbsF64, l))));
    case UnaryOp.NegVecF64x2:
      return v128(fromScalars(f64s(a).map((l) => lane1(UnaryOp.NegF64, l))));
    case UnaryOp.SqrtVecF64x2:
      return v128(fromScalars(f64s(a).map((l) => lane1(UnaryOp.SqrtF64, l))));
    case UnaryOp.CeilVecF64x2:
      return v128(fromScalars(f64s(a).map((l) => lane1(UnaryOp.CeilF64, l))));
    case UnaryOp.FloorVecF64x2:
      return v128(fromScalars(f64s(a).map((l) => lane1(UnaryOp.FloorF64, l))));
    case UnaryOp.TruncVecF64x2:
      return v128(fromScalars(f64s(a).map((l) => lane1(UnaryOp.TruncF64, l))));
    case UnaryOp.NearestVecF64x2:
      return v128(fromScalars(f64s(a).map((l) => lane1(UnaryOp.NearestF64, l))));

    // Conversions.
    case UnaryOp.DemoteZeroVecF64x2ToF32x4:
      return v128(fromScalars(lowThenZero(
        f64s(a).map((l) => lane1(UnaryOp.DemoteF64, l)),
        { type: ValType.F32, bits: 0 },
      )));
    case UnaryOp.PromoteLowVecF32x4ToF64x2:
      return v128(fromScalars(f32s(a).slice(0, 2).map((l) => lane1(UnaryOp.PromoteF32, l))));
    case UnaryOp.TruncSatSVecF32x4ToI32x4:
    case S(0x101): // i32x4.relaxed_trunc_f32x4_s: the saturating one, deterministically
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.TruncSatSF32ToI32, l))));
    case UnaryOp.TruncSatUVecF32x4ToI32x4:
    case S(0x102):
      return v128(fromScalars(f32s(a).map((l) => lane1(UnaryOp.TruncSatUF32ToI32, l))));
    case UnaryOp.TruncSatSVecF64x2ToI32x4Zero:
    case S(0x103):
      return v128(fromScalars(lowThenZero(
        f64s(a).map((l) => lane1(UnaryOp.TruncSatSF64ToI32, l)),
        I32(0),
      )));
    case UnaryOp.TruncSatUVecF64x2ToI32x4Zero:
    case S(0x104):
      return v128(fromScalars(lowThenZero(
        f64s(a).map((l) => lane1(UnaryOp.TruncSatUF64ToI32, l)),
        I32(0),
      )));
    case UnaryOp.ConvertSVecI32x4ToF32x4:
      return v128(
        fromScalars(ints(a, 32, true).map((x) => lane1(UnaryOp.ConvertSI32ToF32, I32(x)))),
      );
    case UnaryOp.ConvertUVecI32x4ToF32x4:
      return v128(
        fromScalars(ints(a, 32, true).map((x) => lane1(UnaryOp.ConvertUI32ToF32, I32(x)))),
      );
    case UnaryOp.ConvertLowSVecI32x4ToF64x2:
      return v128(fromScalars(
        ints(a, 32, true).slice(0, 2).map((x) => lane1(UnaryOp.ConvertSI32ToF64, I32(x))),
      ));
    case UnaryOp.ConvertLowUVecI32x4ToF64x2:
      return v128(fromScalars(
        ints(a, 32, true).slice(0, 2).map((x) => lane1(UnaryOp.ConvertUI32ToF64, I32(x))),
      ));
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Binary
// ---------------------------------------------------------------------------

type Int2 = (x: number, y: number) => number;

const zipInts = (
  bits: Bits,
  signed: boolean,
  a: Uint8Array,
  b: Uint8Array,
  f: Int2,
): Uint8Array => {
  const xs = ints(a, bits, signed), ys = ints(b, bits, signed);
  return fromInts(bits, xs.map((x, i) => f(x, ys[i]!)));
};
const zipLongs = (
  signed: boolean,
  a: Uint8Array,
  b: Uint8Array,
  f: (x: bigint, y: bigint) => bigint,
): Uint8Array => {
  const xs = longs(a, signed), ys = longs(b, signed);
  return fromLongs(xs.map((x, i) => f(x, ys[i]!)));
};
/** A comparison's lane: all ones for true, zero for false. */
const mask = (c: boolean): number => (c ? -1 : 0);
const cmpInts = (
  bits: Bits,
  signed: boolean,
  a: Uint8Array,
  b: Uint8Array,
  f: (x: number, y: number) => boolean,
) => zipInts(bits, signed, a, b, (x, y) => mask(f(x, y)));
const cmpLongs = (a: Uint8Array, b: Uint8Array, f: (x: bigint, y: bigint) => boolean) =>
  zipLongs(true, a, b, (x, y) => (f(x, y) ? -1n : 0n));
/** A float comparison's lanes, through the scalar comparison. */
const cmpF32 = (op: number, a: Uint8Array, b: Uint8Array): Uint8Array => {
  const xs = f32s(a), ys = f32s(b);
  return fromInts(
    32,
    xs.map((x, i) => mask((lane2(op, x, ys[i]!) as { value: number }).value !== 0)),
  );
};
const cmpF64 = (op: number, a: Uint8Array, b: Uint8Array): Uint8Array => {
  const xs = f64s(a), ys = f64s(b);
  return fromLongs(
    xs.map((x, i) => ((lane2(op, x, ys[i]!) as { value: number }).value !== 0 ? -1n : 0n)),
  );
};
const zipF32 = (op: number, a: Uint8Array, b: Uint8Array): Uint8Array => {
  const ys = f32s(b);
  return fromScalars(f32s(a).map((x, i) => lane2(op, x, ys[i]!)));
};
const zipF64 = (op: number, a: Uint8Array, b: Uint8Array): Uint8Array => {
  const ys = f64s(b);
  return fromScalars(f64s(a).map((x, i) => lane2(op, x, ys[i]!)));
};
/** `pmin` / `pmax`: `b < a ? b : a` / `a < b ? b : a` — one operand's bits, exactly. */
const pminmax = (
  a: Uint8Array,
  b: Uint8Array,
  wide: boolean,
  max: boolean,
): Uint8Array => {
  const xs = wide ? f64s(a) : f32s(a), ys = wide ? f64s(b) : f32s(b);
  return fromScalars(xs.map((x, i) => {
    const y = ys[i]!;
    const fx = literalFloat(x), fy = literalFloat(y);
    return (max ? fx < fy : fy < fx) ? y : x;
  }));
};
/** `narrow`: each wide lane saturated to the narrow one; `a`'s lanes then `b`'s. */
const narrow = (bits: Bits, signed: boolean, a: Uint8Array, b: Uint8Array): Uint8Array => {
  const wide = (bits * 2) as Bits;
  const sat = (x: number) => (signed ? satS(bits, x) : satU(bits, x));
  return fromInts(bits, [...ints(a, wide, true), ...ints(b, wide, true)].map(sat));
};
/** `extmul_{low,high}`: the half's lanes, extended, multiplied into the wider lane. */
const extmul = (
  to: Bits,
  signed: boolean,
  high: boolean,
  a: Uint8Array,
  b: Uint8Array,
): Uint8Array => {
  const from = (to / 2) as Bits;
  const half = (x: number[]) => (high ? x.slice(x.length / 2) : x.slice(0, x.length / 2));
  const xs = half(ints(a, from, signed)), ys = half(ints(b, from, signed));
  return fromInts(to, xs.map((x, i) => x * ys[i]!));
};
const extmul64 = (signed: boolean, high: boolean, a: Uint8Array, b: Uint8Array): Uint8Array => {
  const half = (x: number[]) => (high ? x.slice(2) : x.slice(0, 2));
  const xs = half(ints(a, 32, signed)), ys = half(ints(b, 32, signed));
  return fromLongs(xs.map((x, i) => BigInt(x) * BigInt(ys[i]!)));
};
/** `i8x16.swizzle`: lane `i` is `a[s[i]]`, or 0 for an index past the vector. */
const swizzle = (a: Uint8Array, s: Uint8Array): Uint8Array =>
  s.map((idx) => (idx < 16 ? a[idx]! : 0));
/** `i16x8.q15mulr_sat_s`'s lane: `(x × y + 2^14) >> 15`, saturated. */
const q15 = (x: number, y: number): number => satS(16, (x * y + 0x4000) >> 15);
/** The signed i8 × i7 dot product into i16 lanes — relaxed, every lane read signed. */
const dotI8 = (a: Uint8Array, b: Uint8Array): number[] => {
  const xs = ints(a, 8, true), ys = ints(b, 8, true);
  const out: number[] = [];
  for (let i = 0; i < 16; i += 2) out.push(xs[i]! * ys[i]! + xs[i + 1]! * ys[i + 1]!);
  return out;
};
/** A lane shift's count: the `i32` modulo the lane width. */
const count = (b: Literal, bits: number): number => {
  if (b.type !== ValType.I32) throw new Error('simd: a shift count must be an i32');
  return b.value & (bits - 1);
};

/**
 * Evaluates a SIMD binary operator: two vectors, or a vector and an `i32`
 * shift count. `null` when `op` is not one.
 */
export function simdBinary(op: BinaryOp, a: Uint8Array, b: Literal): NumericResult | null {
  // The shifts take an i32 on the right; everything else a vector.
  switch (op) {
    case BinaryOp.ShlVecI8x16:
      return v128(fromInts(8, ints(a, 8, true).map((x) => x << count(b, 8))));
    case BinaryOp.ShrSVecI8x16:
      return v128(fromInts(8, ints(a, 8, true).map((x) => x >> count(b, 8))));
    case BinaryOp.ShrUVecI8x16:
      return v128(fromInts(8, ints(a, 8, false).map((x) => x >>> count(b, 8))));
    case BinaryOp.ShlVecI16x8:
      return v128(fromInts(16, ints(a, 16, true).map((x) => x << count(b, 16))));
    case BinaryOp.ShrSVecI16x8:
      return v128(fromInts(16, ints(a, 16, true).map((x) => x >> count(b, 16))));
    case BinaryOp.ShrUVecI16x8:
      return v128(fromInts(16, ints(a, 16, false).map((x) => x >>> count(b, 16))));
    case BinaryOp.ShlVecI32x4:
      return v128(fromInts(32, ints(a, 32, true).map((x) => x << count(b, 32))));
    case BinaryOp.ShrSVecI32x4:
      return v128(fromInts(32, ints(a, 32, true).map((x) => x >> count(b, 32))));
    case BinaryOp.ShrUVecI32x4:
      return v128(fromInts(32, ints(a, 32, false).map((x) => x >>> count(b, 32))));
    case BinaryOp.ShlVecI64x2:
      return v128(fromLongs(longs(a, true).map((x) => x << BigInt(count(b, 64)))));
    case BinaryOp.ShrSVecI64x2:
      return v128(fromLongs(longs(a, true).map((x) => x >> BigInt(count(b, 64)))));
    case BinaryOp.ShrUVecI64x2:
      return v128(fromLongs(longs(a, false).map((x) => x >> BigInt(count(b, 64)))));
  }
  if (b.type !== ValType.V128) return null;
  const y = b.bytes;
  switch (op) {
    case BinaryOp.SwizzleVecI8x16:
    case S(0x100): // i8x16.relaxed_swizzle: `swizzle`, deterministically
      return v128(swizzle(a, y));
    case BinaryOp.AndVec128:
      return v128(a.map((x, i) => x & y[i]!));
    case BinaryOp.OrVec128:
      return v128(a.map((x, i) => x | y[i]!));
    case BinaryOp.XorVec128:
      return v128(a.map((x, i) => x ^ y[i]!));
    case BinaryOp.AndNotVec128:
      return v128(a.map((x, i) => x & ~y[i]! & 0xff));

    // Integer comparisons.
    case BinaryOp.EqVecI8x16:
      return v128(cmpInts(8, true, a, y, (p, q) => p === q));
    case BinaryOp.NeVecI8x16:
      return v128(cmpInts(8, true, a, y, (p, q) => p !== q));
    case BinaryOp.LtSVecI8x16:
      return v128(cmpInts(8, true, a, y, (p, q) => p < q));
    case BinaryOp.LtUVecI8x16:
      return v128(cmpInts(8, false, a, y, (p, q) => p < q));
    case BinaryOp.GtSVecI8x16:
      return v128(cmpInts(8, true, a, y, (p, q) => p > q));
    case BinaryOp.GtUVecI8x16:
      return v128(cmpInts(8, false, a, y, (p, q) => p > q));
    case BinaryOp.LeSVecI8x16:
      return v128(cmpInts(8, true, a, y, (p, q) => p <= q));
    case BinaryOp.LeUVecI8x16:
      return v128(cmpInts(8, false, a, y, (p, q) => p <= q));
    case BinaryOp.GeSVecI8x16:
      return v128(cmpInts(8, true, a, y, (p, q) => p >= q));
    case BinaryOp.GeUVecI8x16:
      return v128(cmpInts(8, false, a, y, (p, q) => p >= q));
    case BinaryOp.EqVecI16x8:
      return v128(cmpInts(16, true, a, y, (p, q) => p === q));
    case BinaryOp.NeVecI16x8:
      return v128(cmpInts(16, true, a, y, (p, q) => p !== q));
    case BinaryOp.LtSVecI16x8:
      return v128(cmpInts(16, true, a, y, (p, q) => p < q));
    case BinaryOp.LtUVecI16x8:
      return v128(cmpInts(16, false, a, y, (p, q) => p < q));
    case BinaryOp.GtSVecI16x8:
      return v128(cmpInts(16, true, a, y, (p, q) => p > q));
    case BinaryOp.GtUVecI16x8:
      return v128(cmpInts(16, false, a, y, (p, q) => p > q));
    case BinaryOp.LeSVecI16x8:
      return v128(cmpInts(16, true, a, y, (p, q) => p <= q));
    case BinaryOp.LeUVecI16x8:
      return v128(cmpInts(16, false, a, y, (p, q) => p <= q));
    case BinaryOp.GeSVecI16x8:
      return v128(cmpInts(16, true, a, y, (p, q) => p >= q));
    case BinaryOp.GeUVecI16x8:
      return v128(cmpInts(16, false, a, y, (p, q) => p >= q));
    case BinaryOp.EqVecI32x4:
      return v128(cmpInts(32, true, a, y, (p, q) => p === q));
    case BinaryOp.NeVecI32x4:
      return v128(cmpInts(32, true, a, y, (p, q) => p !== q));
    case BinaryOp.LtSVecI32x4:
      return v128(cmpInts(32, true, a, y, (p, q) => p < q));
    case BinaryOp.LtUVecI32x4:
      return v128(cmpInts(32, false, a, y, (p, q) => p < q));
    case BinaryOp.GtSVecI32x4:
      return v128(cmpInts(32, true, a, y, (p, q) => p > q));
    case BinaryOp.GtUVecI32x4:
      return v128(cmpInts(32, false, a, y, (p, q) => p > q));
    case BinaryOp.LeSVecI32x4:
      return v128(cmpInts(32, true, a, y, (p, q) => p <= q));
    case BinaryOp.LeUVecI32x4:
      return v128(cmpInts(32, false, a, y, (p, q) => p <= q));
    case BinaryOp.GeSVecI32x4:
      return v128(cmpInts(32, true, a, y, (p, q) => p >= q));
    case BinaryOp.GeUVecI32x4:
      return v128(cmpInts(32, false, a, y, (p, q) => p >= q));
    case BinaryOp.EqVecI64x2:
      return v128(cmpLongs(a, y, (p, q) => p === q));
    case BinaryOp.NeVecI64x2:
      return v128(cmpLongs(a, y, (p, q) => p !== q));
    case BinaryOp.LtSVecI64x2:
      return v128(cmpLongs(a, y, (p, q) => p < q));
    case BinaryOp.GtSVecI64x2:
      return v128(cmpLongs(a, y, (p, q) => p > q));
    case BinaryOp.LeSVecI64x2:
      return v128(cmpLongs(a, y, (p, q) => p <= q));
    case BinaryOp.GeSVecI64x2:
      return v128(cmpLongs(a, y, (p, q) => p >= q));

    // Float comparisons, through the scalar ones (NaN compares false, `ne` true).
    case BinaryOp.EqVecF32x4:
      return v128(cmpF32(BinaryOp.EqF32, a, y));
    case BinaryOp.NeVecF32x4:
      return v128(cmpF32(BinaryOp.NeF32, a, y));
    case BinaryOp.LtVecF32x4:
      return v128(cmpF32(BinaryOp.LtF32, a, y));
    case BinaryOp.GtVecF32x4:
      return v128(cmpF32(BinaryOp.GtF32, a, y));
    case BinaryOp.LeVecF32x4:
      return v128(cmpF32(BinaryOp.LeF32, a, y));
    case BinaryOp.GeVecF32x4:
      return v128(cmpF32(BinaryOp.GeF32, a, y));
    case BinaryOp.EqVecF64x2:
      return v128(cmpF64(BinaryOp.EqF64, a, y));
    case BinaryOp.NeVecF64x2:
      return v128(cmpF64(BinaryOp.NeF64, a, y));
    case BinaryOp.LtVecF64x2:
      return v128(cmpF64(BinaryOp.LtF64, a, y));
    case BinaryOp.GtVecF64x2:
      return v128(cmpF64(BinaryOp.GtF64, a, y));
    case BinaryOp.LeVecF64x2:
      return v128(cmpF64(BinaryOp.LeF64, a, y));
    case BinaryOp.GeVecF64x2:
      return v128(cmpF64(BinaryOp.GeF64, a, y));

    // Integer arithmetic: wrapping, saturating, min / max, averages.
    case BinaryOp.AddVecI8x16:
      return v128(zipInts(8, true, a, y, (p, q) => p + q));
    case BinaryOp.SubVecI8x16:
      return v128(zipInts(8, true, a, y, (p, q) => p - q));
    case BinaryOp.AddSatSVecI8x16:
      return v128(zipInts(8, true, a, y, (p, q) => satS(8, p + q)));
    case BinaryOp.AddSatUVecI8x16:
      return v128(zipInts(8, false, a, y, (p, q) => satU(8, p + q)));
    case BinaryOp.SubSatSVecI8x16:
      return v128(zipInts(8, true, a, y, (p, q) => satS(8, p - q)));
    case BinaryOp.SubSatUVecI8x16:
      return v128(zipInts(8, false, a, y, (p, q) => satU(8, p - q)));
    case BinaryOp.MinSVecI8x16:
      return v128(zipInts(8, true, a, y, Math.min));
    case BinaryOp.MinUVecI8x16:
      return v128(zipInts(8, false, a, y, Math.min));
    case BinaryOp.MaxSVecI8x16:
      return v128(zipInts(8, true, a, y, Math.max));
    case BinaryOp.MaxUVecI8x16:
      return v128(zipInts(8, false, a, y, Math.max));
    case BinaryOp.AvgrUVecI8x16:
      return v128(zipInts(8, false, a, y, (p, q) => (p + q + 1) >> 1));
    case BinaryOp.NarrowSVecI16x8ToI8x16:
      return v128(narrow(8, true, a, y));
    case BinaryOp.NarrowUVecI16x8ToI8x16:
      return v128(narrow(8, false, a, y));

    case BinaryOp.AddVecI16x8:
      return v128(zipInts(16, true, a, y, (p, q) => p + q));
    case BinaryOp.SubVecI16x8:
      return v128(zipInts(16, true, a, y, (p, q) => p - q));
    case BinaryOp.MulVecI16x8:
      return v128(zipInts(16, true, a, y, (p, q) => p * q));
    case BinaryOp.AddSatSVecI16x8:
      return v128(zipInts(16, true, a, y, (p, q) => satS(16, p + q)));
    case BinaryOp.AddSatUVecI16x8:
      return v128(zipInts(16, false, a, y, (p, q) => satU(16, p + q)));
    case BinaryOp.SubSatSVecI16x8:
      return v128(zipInts(16, true, a, y, (p, q) => satS(16, p - q)));
    case BinaryOp.SubSatUVecI16x8:
      return v128(zipInts(16, false, a, y, (p, q) => satU(16, p - q)));
    case BinaryOp.MinSVecI16x8:
      return v128(zipInts(16, true, a, y, Math.min));
    case BinaryOp.MinUVecI16x8:
      return v128(zipInts(16, false, a, y, Math.min));
    case BinaryOp.MaxSVecI16x8:
      return v128(zipInts(16, true, a, y, Math.max));
    case BinaryOp.MaxUVecI16x8:
      return v128(zipInts(16, false, a, y, Math.max));
    case BinaryOp.AvgrUVecI16x8:
      return v128(zipInts(16, false, a, y, (p, q) => (p + q + 1) >> 1));
    case BinaryOp.Q15MulrSatSVecI16x8:
    case S(0x111): // i16x8.relaxed_q15mulr_s: the saturating one, deterministically
      return v128(zipInts(16, true, a, y, q15));
    case BinaryOp.NarrowSVecI32x4ToI16x8:
      return v128(narrow(16, true, a, y));
    case BinaryOp.NarrowUVecI32x4ToI16x8:
      return v128(narrow(16, false, a, y));
    case BinaryOp.ExtmulLowSVecI8x16ToI16x8:
      return v128(extmul(16, true, false, a, y));
    case BinaryOp.ExtmulHighSVecI8x16ToI16x8:
      return v128(extmul(16, true, true, a, y));
    case BinaryOp.ExtmulLowUVecI8x16ToI16x8:
      return v128(extmul(16, false, false, a, y));
    case BinaryOp.ExtmulHighUVecI8x16ToI16x8:
      return v128(extmul(16, false, true, a, y));
    case S(0x112): // i16x8.relaxed_dot_i8x16_i7x16_s: both signed, deterministically
      return v128(fromInts(16, dotI8(a, y)));

    case BinaryOp.AddVecI32x4:
      return v128(zipInts(32, true, a, y, (p, q) => p + q));
    case BinaryOp.SubVecI32x4:
      return v128(zipInts(32, true, a, y, (p, q) => p - q));
    case BinaryOp.MulVecI32x4:
      return v128(zipInts(32, true, a, y, Math.imul));
    case BinaryOp.MinSVecI32x4:
      return v128(zipInts(32, true, a, y, Math.min));
    case BinaryOp.MinUVecI32x4:
      return v128(zipInts(32, false, a, y, Math.min));
    case BinaryOp.MaxSVecI32x4:
      return v128(zipInts(32, true, a, y, Math.max));
    case BinaryOp.MaxUVecI32x4:
      return v128(zipInts(32, false, a, y, Math.max));
    case BinaryOp.DotSVecI16x8ToI32x4: {
      const xs = ints(a, 16, true), ys = ints(y, 16, true);
      const out: number[] = [];
      for (let i = 0; i < 8; i += 2) out.push(xs[i]! * ys[i]! + xs[i + 1]! * ys[i + 1]!);
      return v128(fromInts(32, out));
    }
    case BinaryOp.ExtmulLowSVecI16x8ToI32x4:
      return v128(extmul(32, true, false, a, y));
    case BinaryOp.ExtmulHighSVecI16x8ToI32x4:
      return v128(extmul(32, true, true, a, y));
    case BinaryOp.ExtmulLowUVecI16x8ToI32x4:
      return v128(extmul(32, false, false, a, y));
    case BinaryOp.ExtmulHighUVecI16x8ToI32x4:
      return v128(extmul(32, false, true, a, y));

    case BinaryOp.AddVecI64x2:
      return v128(zipLongs(true, a, y, (p, q) => p + q));
    case BinaryOp.SubVecI64x2:
      return v128(zipLongs(true, a, y, (p, q) => p - q));
    case BinaryOp.MulVecI64x2:
      return v128(zipLongs(true, a, y, (p, q) => p * q));
    case BinaryOp.ExtmulLowSVecI32x4ToI64x2:
      return v128(extmul64(true, false, a, y));
    case BinaryOp.ExtmulHighSVecI32x4ToI64x2:
      return v128(extmul64(true, true, a, y));
    case BinaryOp.ExtmulLowUVecI32x4ToI64x2:
      return v128(extmul64(false, false, a, y));
    case BinaryOp.ExtmulHighUVecI32x4ToI64x2:
      return v128(extmul64(false, true, a, y));

    // Float arithmetic, through the scalar operators.
    case BinaryOp.AddVecF32x4:
      return v128(zipF32(BinaryOp.AddF32, a, y));
    case BinaryOp.SubVecF32x4:
      return v128(zipF32(BinaryOp.SubF32, a, y));
    case BinaryOp.MulVecF32x4:
      return v128(zipF32(BinaryOp.MulF32, a, y));
    case BinaryOp.DivVecF32x4:
      return v128(zipF32(BinaryOp.DivF32, a, y));
    case BinaryOp.MinVecF32x4:
    case S(0x10d): // f32x4.relaxed_min: `min`, deterministically
      return v128(zipF32(BinaryOp.MinF32, a, y));
    case BinaryOp.MaxVecF32x4:
    case S(0x10e):
      return v128(zipF32(BinaryOp.MaxF32, a, y));
    case BinaryOp.PminVecF32x4:
      return v128(pminmax(a, y, false, false));
    case BinaryOp.PmaxVecF32x4:
      return v128(pminmax(a, y, false, true));
    case BinaryOp.AddVecF64x2:
      return v128(zipF64(BinaryOp.AddF64, a, y));
    case BinaryOp.SubVecF64x2:
      return v128(zipF64(BinaryOp.SubF64, a, y));
    case BinaryOp.MulVecF64x2:
      return v128(zipF64(BinaryOp.MulF64, a, y));
    case BinaryOp.DivVecF64x2:
      return v128(zipF64(BinaryOp.DivF64, a, y));
    case BinaryOp.MinVecF64x2:
    case S(0x10f):
      return v128(zipF64(BinaryOp.MinF64, a, y));
    case BinaryOp.MaxVecF64x2:
    case S(0x110):
      return v128(zipF64(BinaryOp.MaxF64, a, y));
    case BinaryOp.PminVecF64x2:
      return v128(pminmax(a, y, true, false));
    case BinaryOp.PmaxVecF64x2:
      return v128(pminmax(a, y, true, true));
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Ternary, lanes, shuffle
// ---------------------------------------------------------------------------

const bitselect = (a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array =>
  a.map((x, i) => (x & c[i]!) | (b[i]! & ~c[i]! & 0xff));
/** `relaxed_madd` (`neg` false) / `relaxed_nmadd` (`neg` true): fused, lane by lane. */
const madd = (a: Uint8Array, b: Uint8Array, c: Uint8Array, wide: boolean, neg: boolean) => {
  const [xs, ys, zs] = wide ? [f64s(a), f64s(b), f64s(c)] : [f32s(a), f32s(b), f32s(c)];
  return fromScalars(xs.map((x, i) => {
    const fx = literalFloat(x), fy = literalFloat(ys[i]!), fz = literalFloat(zs[i]!);
    const r = fma(neg ? -fx : fx, fy, fz, !wide);
    // An arithmetic NaN is written canonical, as `numeric.ts` writes one.
    return wide
      ? { type: ValType.F64, bits: Number.isNaN(r) ? 0x7ff8000000000000n : bitsF64(r) }
      : { type: ValType.F32, bits: Number.isNaN(r) ? 0x7fc00000 : bitsF32(r) };
  }));
};
const BITS = new DataView(new ArrayBuffer(8));
const bitsF32 = (n: number): number => {
  BITS.setFloat32(0, n, true);
  return BITS.getUint32(0, true);
};
const bitsF64 = (n: number): bigint => {
  BITS.setFloat64(0, n, true);
  return BITS.getBigUint64(0, true);
};

/** Evaluates a SIMD ternary operator (`bitselect` and the relaxed ones); `null` when `op` is not one. */
export function simdTernary(
  op: SIMDTernaryOp,
  a: Uint8Array,
  b: Uint8Array,
  c: Uint8Array,
): NumericResult | null {
  switch (op) {
    case SIMDTernaryOp.Bitselect:
    case S(0x109): // *.relaxed_laneselect: `bitselect`, deterministically
    case S(0x10a):
    case S(0x10b):
    case S(0x10c):
      return v128(bitselect(a, b, c));
    case S(0x105): // f32x4.relaxed_madd
      return v128(madd(a, b, c, false, false));
    case S(0x106): // f32x4.relaxed_nmadd
      return v128(madd(a, b, c, false, true));
    case S(0x107): // f64x2.relaxed_madd
      return v128(madd(a, b, c, true, false));
    case S(0x108): // f64x2.relaxed_nmadd
      return v128(madd(a, b, c, true, true));
    case S(0x113): { // i32x4.relaxed_dot_i8x16_i7x16_add_s: the i16 dot, pairs added, plus c
      const dot = dotI8(a, b);
      const zs = ints(c, 32, true);
      const out: number[] = [];
      for (let i = 0; i < 8; i += 2) {
        // The intermediate lanes are i16: wrapped, as the deterministic dot is.
        const lo = (dot[i]! << 16) >> 16, hi = (dot[i + 1]! << 16) >> 16;
        out.push(lo + hi + zs[i / 2]!);
      }
      return v128(fromInts(32, out));
    }
    default:
      return null;
  }
}

/** `*.extract_lane`: lane `lane` of `a` as its scalar. `null` when `op` is not one. */
export function simdExtract(op: SIMDExtractOp, a: Uint8Array, lane: number): NumericResult | null {
  switch (op) {
    case SIMDExtractOp.ExtractLaneSVecI8x16:
      return i32(ints(a, 8, true)[lane]!);
    case SIMDExtractOp.ExtractLaneUVecI8x16:
      return i32(ints(a, 8, false)[lane]!);
    case SIMDExtractOp.ExtractLaneSVecI16x8:
      return i32(ints(a, 16, true)[lane]!);
    case SIMDExtractOp.ExtractLaneUVecI16x8:
      return i32(ints(a, 16, false)[lane]!);
    case SIMDExtractOp.ExtractLaneVecI32x4:
      return i32(ints(a, 32, true)[lane]!);
    case SIMDExtractOp.ExtractLaneVecI64x2:
      return { value: I64(longs(a, true)[lane]!) };
    case SIMDExtractOp.ExtractLaneVecF32x4:
      return { value: f32s(a)[lane]! };
    case SIMDExtractOp.ExtractLaneVecF64x2:
      return { value: f64s(a)[lane]! };
    default:
      return null;
  }
}

/** `*.replace_lane`: `a` with lane `lane` set to `value`. `null` when `op` is not one. */
export function simdReplace(
  op: SIMDReplaceOp,
  a: Uint8Array,
  lane: number,
  value: Literal,
): NumericResult | null {
  const out = a.slice();
  const v = view(out);
  switch (op) {
    case SIMDReplaceOp.ReplaceLaneVecI8x16:
      if (value.type !== ValType.I32) return null;
      v.setUint8(lane, value.value & 0xff);
      return v128(out);
    case SIMDReplaceOp.ReplaceLaneVecI16x8:
      if (value.type !== ValType.I32) return null;
      v.setUint16(2 * lane, value.value & 0xffff, true);
      return v128(out);
    case SIMDReplaceOp.ReplaceLaneVecI32x4:
      if (value.type !== ValType.I32) return null;
      v.setInt32(4 * lane, value.value | 0, true);
      return v128(out);
    case SIMDReplaceOp.ReplaceLaneVecI64x2:
      if (value.type !== ValType.I64) return null;
      v.setBigInt64(8 * lane, BigInt.asIntN(64, value.value), true);
      return v128(out);
    case SIMDReplaceOp.ReplaceLaneVecF32x4:
      if (value.type !== ValType.F32) return null;
      v.setUint32(4 * lane, value.bits >>> 0, true);
      return v128(out);
    case SIMDReplaceOp.ReplaceLaneVecF64x2:
      if (value.type !== ValType.F64) return null;
      v.setBigUint64(8 * lane, BigInt.asUintN(64, value.bits), true);
      return v128(out);
    default:
      return null;
  }
}

/** `i8x16.shuffle`: byte `i` is byte `lanes[i]` of `a ++ b` (0–15 from `a`, 16–31 from `b`). */
export function simdShuffle(
  a: Uint8Array,
  b: Uint8Array,
  lanes: Uint8Array,
): { readonly value: V128Literal } {
  const both = new Uint8Array(32);
  both.set(a);
  both.set(b, 16);
  return { value: { type: ValType.V128, bytes: lanes.map((idx) => both[idx & 31]!) } };
}
