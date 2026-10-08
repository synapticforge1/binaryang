// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 23, stage E3e: the evaluator's `v128` core against V8, operator by
// operator, as `numeric_differential.test.ts` does for the scalars. A wrong
// lane is a SILENT miscompile once Precompute folds with it, so the oracle is
// an engine.
//
// The operators come from D1 (`src/definitions/opcodes.json`): every SIMD
// instruction that is not a memory access (those are the interpreter's, run by
// `deno task interp`) or `v128.const`. So the test also asserts COVERAGE — an
// operator the core answers `null` for fails here.
//
// A `v128` cannot cross the JS boundary, so each operator's export takes and
// returns every vector as TWO i64 lanes (`i64x2.splat` + `replace_lane` in,
// `extract_lane` out, a multi-value result), as the behaviour differential's
// wrappers do. Scalars cross as bits.
//
// Where a lane may legitimately differ: a float-ARITHMETIC operator may give
// any arithmetic NaN — both must be NaN and ours quiet. Everything else is
// exact to the bit. The RELAXED operators are implementation-defined, so V8 is
// not their oracle: the spec testsuite's `either` lists judge them (through
// `deno task interp`); here they are only required to evaluate.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import opcodes from '../../../src/definitions/opcodes.json' with { type: 'json' };
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import {
  evalBinary,
  evalUnary,
  foldedLiteral,
  type NumericResult,
} from '../../../src/binaryen-ts/interp/numeric.ts';
import {
  fma,
  isRelaxed,
  simdExtract,
  simdReplace,
  simdShuffle,
  simdTernary,
} from '../../../src/binaryen-ts/interp/simd.ts';
import type { Literal } from '../../../src/binaryen-ts/ir/expressions.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

type T = 'i32' | 'i64' | 'f32' | 'f64' | 'v128';
interface Op {
  name: string;
  code: number;
  params: T[];
  result: T;
  /** `laneidx`, `lane16`, or nothing. */
  immediate: string | undefined;
}

const OPS: Op[] = opcodes.entries.flatMap((e) => {
  const sig = e.signature as { params: string[]; results: string[] } | null;
  if (e.prefix !== '0xfd' || e.class !== 'simd' || !sig) return [];
  if (e.name === 'v128.const' || sig.results.length !== 1) return [];
  if (
    e.immediates.length > 1 ||
    (e.immediates[0] !== undefined && !['laneidx', 'lane16'].includes(e.immediates[0]))
  ) return [];
  return [{
    name: e.name,
    code: (0xfd << 16) | e.opcode,
    params: sig.params as T[],
    result: sig.results[0] as T,
    immediate: e.immediates[0],
  }];
});

/** Lanes of `name` (`i8x16.add` → 16), for lane immediates. */
const laneCount = (name: string): number => Number(name.match(/x(\d+)\./)![1]);

// ---------------------------------------------------------------------------
// Operands
// ---------------------------------------------------------------------------

let seed = 0x9e3779b9;
const rnd32 = (): number => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed | 0;
};
const rnd64 = (): bigint =>
  BigInt.asIntN(64, (BigInt(rnd32() >>> 0) << 32n) | BigInt(rnd32() >>> 0));

const bytesOf = (fill: (v: DataView) => void): Uint8Array => {
  const b = new Uint8Array(16);
  fill(new DataView(b.buffer));
  return b;
};
const ofI8 = (...xs: number[]) => bytesOf((v) => xs.forEach((x, i) => v.setInt8(i, x)));
const ofI16 = (...xs: number[]) => bytesOf((v) => xs.forEach((x, i) => v.setInt16(2 * i, x, true)));
const ofI32 = (...xs: number[]) => bytesOf((v) => xs.forEach((x, i) => v.setInt32(4 * i, x, true)));
const ofI64 = (...xs: bigint[]) =>
  bytesOf((v) => xs.forEach((x, i) => v.setBigInt64(8 * i, x, true)));
const ofF32 = (...xs: number[]) =>
  bytesOf((v) => xs.forEach((x, i) => v.setFloat32(4 * i, x, true)));
const ofF64 = (...xs: number[]) =>
  bytesOf((v) => xs.forEach((x, i) => v.setFloat64(8 * i, x, true)));
const ofU32 = (...xs: number[]) =>
  bytesOf((v) => xs.forEach((x, i) => v.setUint32(4 * i, x, true)));

/** Vectors at the edges of every lane interpretation. */
const EDGE_VECTORS: Uint8Array[] = [
  new Uint8Array(16),
  new Uint8Array(16).fill(0xff),
  new Uint8Array(16).fill(0x80),
  new Uint8Array(16).fill(0x7f),
  new Uint8Array(16).fill(1),
  ofI8(0, 1, -1, 2, -2, 127, -128, 100, -100, 15, 16, 17, 31, 32, 0x55, 0x2a),
  ofI8(-128, -128, 127, 127, 64, -64, 0, 0, 1, 1, -1, -1, 50, -50, 99, -99),
  ofI16(0, 1, -1, 32767, -32768, 0x7fff, 0x100, -0x100),
  ofI16(-32768, 32767, 16384, -16384, 0x4000, 0xc000 | 0, 3, -3),
  ofI32(0, 1, -1, 0x7fffffff),
  ofI32(-0x80000000, 0x7fffffff, 0x10000, -0x10000),
  ofI32(31, 32, 33, 64),
  ofI64(0n, -1n),
  ofI64(2n ** 63n - 1n, -(2n ** 63n)),
  ofI64(0x100000000n, -0x100000000n),
  ofF32(0, -0, 1, -1),
  ofF32(0.5, 1.5, 2.5, -2.5),
  ofF32(Infinity, -Infinity, NaN, -NaN),
  ofF32(3.4028234663852886e38, -3.4028234663852886e38, 1e-40, 2 ** 31),
  ofF32(2 ** 32, -(2 ** 31) - 1, 0.49999997, 2 ** 24 + 1),
  ofU32(0x7fa00001, 0xff800123, 0x7fc00000, 0xffc00000), // NaNs with payloads
  ofF64(0, -0),
  ofF64(1.5, -2.5),
  ofF64(Infinity, NaN),
  ofF64(2 ** 31, -(2 ** 31) - 0.5),
  ofF64(1e300, -1e-310),
  ofF64(2 ** 53 + 2, 2 ** 64),
  bytesOf((v) => {
    v.setBigUint64(0, 0x7ff4000000000001n, true);
    v.setBigUint64(8, 0xfff8000000000000n, true);
  }),
];
const randomVector = (): Uint8Array => ofI64(rnd64(), rnd64());

/** Shift counts and scalar operands, as bits. */
const EDGE_SCALARS: Record<Exclude<T, 'v128'>, (number | bigint)[]> = {
  i32: [
    0,
    1,
    -1,
    7,
    8,
    15,
    16,
    31,
    32,
    33,
    63,
    64,
    65,
    0x7f,
    0x80,
    0xff,
    0x7fff,
    0x8000,
    0x7fffffff,
    -0x80000000,
  ],
  i64: [0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n), 0x123456789n],
  f32: [0, 0x80000000 | 0, 0x3f800000, 0x7fc00000, 0x7fa00001, 0x7f800000],
  f64: [0n, 0x3ff0000000000000n, 0x7ff8000000000000n, 0x7ff4000000000001n],
};
const randomScalar = (t: Exclude<T, 'v128'>): number | bigint =>
  t === 'i32' || t === 'f32' ? rnd32() : rnd64();

type Operand = Uint8Array | number | bigint;

function operandLists(op: Op): Operand[][] {
  const pool = (t: T, n: number): Operand[] =>
    t === 'v128'
      ? [...EDGE_VECTORS, ...Array.from({ length: n }, randomVector)]
      : [...EDGE_SCALARS[t], ...Array.from({ length: n }, () => randomScalar(t))];
  const [p, q, r] = op.params;
  if (q === undefined) return pool(p!, 300).map((a) => [a]);
  if (r === undefined) {
    const lists: Operand[][] = [];
    const as = pool(p!, 0), bs = pool(q, 0);
    for (const a of as) for (const b of bs) lists.push([a, b]);
    for (let i = 0; i < 300; i++) lists.push([pool(p!, 1).at(-1)!, pool(q, 1).at(-1)!]);
    return lists;
  }
  const lists: Operand[][] = [];
  const small = EDGE_VECTORS.filter((_, i) => i % 3 === 0);
  for (const a of small) for (const b of small) for (const c of small) lists.push([a, b, c]);
  for (let i = 0; i < 300; i++) lists.push([randomVector(), randomVector(), randomVector()]);
  return lists;
}

const toLiteral = (t: T, x: Operand): Literal => {
  switch (t) {
    case 'i32':
      return { type: ValType.I32, value: Number(x) | 0 };
    case 'i64':
      return { type: ValType.I64, value: BigInt(x as bigint) };
    case 'f32':
      return { type: ValType.F32, bits: Number(x) >>> 0 };
    case 'f64':
      return { type: ValType.F64, bits: BigInt.asUintN(64, x as bigint) };
    case 'v128':
      return { type: ValType.V128, bytes: x as Uint8Array };
  }
};
const halves = (b: Uint8Array): [bigint, bigint] => {
  const v = new DataView(b.buffer, b.byteOffset, 16);
  return [v.getBigInt64(0, true), v.getBigInt64(8, true)];
};
/** A result's bits, as the oracle returns them: a v128 as its two halves. */
const bitsOf = (lit: Literal): string => {
  switch (lit.type) {
    case ValType.I32:
      return String(lit.value | 0);
    case ValType.I64:
      return String(BigInt.asIntN(64, lit.value));
    case ValType.F32:
      return String(lit.bits | 0);
    case ValType.F64:
      return String(BigInt.asIntN(64, lit.bits));
    case ValType.V128:
      return halves(lit.bytes).join(',');
    default:
      throw new Error('not a value');
  }
};

// ---------------------------------------------------------------------------
// The oracle module: one export per operator (and lane), vectors as i64 pairs
// ---------------------------------------------------------------------------

const bitsType = (t: T): string => (t === 'f32' ? 'i32' : t === 'f64' ? 'i64' : t);
const fromBits = (t: T, get: string): string =>
  t === 'f32' ? `(f32.reinterpret_i32 ${get})` : t === 'f64' ? `(f64.reinterpret_i64 ${get})` : get;

interface Variant {
  op: Op;
  lanes: number[];
  export: string;
}
const VARIANTS: Variant[] = OPS.flatMap((op, i) => {
  if (op.immediate === 'laneidx') {
    const n = laneCount(op.name);
    return [...new Set([0, 1, n - 1])].map((l) => ({ op, lanes: [l], export: `o${i}_${l}` }));
  }
  if (op.immediate === 'lane16') {
    const masks = [
      Array.from({ length: 16 }, (_, k) => k),
      Array.from({ length: 16 }, (_, k) => 31 - k),
      [0, 16, 1, 17, 2, 18, 3, 19, 4, 20, 5, 21, 6, 22, 7, 23],
      [31, 0, 15, 16, 8, 24, 7, 23, 3, 3, 3, 3, 30, 29, 28, 27],
    ];
    return masks.map((m, k) => ({ op, lanes: m, export: `o${i}_${k}` }));
  }
  return [{ op, lanes: [], export: `o${i}` }];
});

const wat = `(module\n${
  VARIANTS.map((v) => {
    const { op } = v;
    let params = '', args = '', k = 0;
    for (const t of op.params) {
      if (t === 'v128') {
        params += ' (param i64 i64)';
        args += ` (i64x2.replace_lane 1 (i64x2.splat (local.get ${k})) (local.get ${k + 1}))`;
        k += 2;
      } else {
        params += ` (param ${bitsType(t)})`;
        args += ` ${fromBits(t, `(local.get ${k})`)}`;
        k += 1;
      }
    }
    const imm = v.lanes.length > 0 ? ` ${v.lanes.join(' ')}` : '';
    const call = `(${op.name}${imm}${args})`;
    const body = op.result === 'v128'
      ? `(local.set ${k} ${call}) (i64x2.extract_lane 0 (local.get ${k})) (i64x2.extract_lane 1 (local.get ${k}))`
      : op.result === 'f32'
      ? `(i32.reinterpret_f32 ${call})`
      : op.result === 'f64'
      ? `(i64.reinterpret_f64 ${call})`
      : call;
    const results = op.result === 'v128' ? '(result i64 i64)' : `(result ${bitsType(op.result)})`;
    const local = op.result === 'v128' ? ' (local v128)' : '';
    return `(func (export "${v.export}")${params} ${results}${local} ${body})`;
  }).join('\n')
}\n)`;
const { instance } = await WebAssembly.instantiate(
  wat2wasm(wat, { textForm: false }).binary as BufferSource,
);
const exported = instance.exports as Record<
  string,
  (...a: (number | bigint)[]) => number | bigint | (number | bigint)[]
>;

/** Our evaluation of `v` on `args`. */
function ours(v: Variant, args: Literal[]): NumericResult | null {
  const { op } = v;
  const vec = (l: Literal) => (l as { bytes: Uint8Array }).bytes;
  if (op.immediate === 'laneidx') {
    return args.length === 1
      ? simdExtract(op.code, vec(args[0]!), v.lanes[0]!)
      : simdReplace(op.code, vec(args[0]!), v.lanes[0]!, args[1]!);
  }
  if (op.immediate === 'lane16') {
    return simdShuffle(vec(args[0]!), vec(args[1]!), new Uint8Array(v.lanes));
  }
  if (args.length === 1) return evalUnary(op.code, args[0]!);
  if (args.length === 2) return evalBinary(op.code, args[0]!, args[1]!);
  return simdTernary(op.code, vec(args[0]!), vec(args[1]!), vec(args[2]!));
}

/** Operators whose float lanes are arithmetic: a NaN lane may differ in payload. */
const FLOAT_ARITH =
  /^f(32x4|64x2)\.(sqrt|ceil|floor|trunc|nearest|add|sub|mul|div|min|max|demote.*|promote.*|convert.*)$/;

const isNaN32 = (bits: number) => (bits & 0x7f800000) === 0x7f800000 && (bits & 0x7fffff) !== 0;
const isNaN64 = (bits: bigint) =>
  (bits & 0x7ff0000000000000n) === 0x7ff0000000000000n && (bits & 0xfffffffffffffn) !== 0n;
const quiet32 = (bits: number) => (bits & 0x400000) !== 0;
const quiet64 = (bits: bigint) => (bits & 0x8000000000000n) !== 0n;

/** Whether two vectors agree lane by lane, NaN lanes allowed to differ in payload if ours is quiet. */
function agreeFloatLanes(got: Uint8Array, want: Uint8Array, wide: boolean): boolean {
  const g = new DataView(got.buffer, got.byteOffset, 16),
    w = new DataView(want.buffer, want.byteOffset, 16);
  if (wide) {
    return [0, 8].every((at) => {
      const a = g.getBigUint64(at, true), b = w.getBigUint64(at, true);
      return a === b || (isNaN64(a) && isNaN64(b) && quiet64(a));
    });
  }
  return [0, 4, 8, 12].every((at) => {
    const a = g.getUint32(at, true), b = w.getUint32(at, true);
    return a === b || (isNaN32(a) && isNaN32(b) && quiet32(a));
  });
}

describe('the v128 core agrees with V8 on every SIMD operator', () => {
  it('D1 lists the SIMD operators, and the core evaluates every one', () => {
    expect(OPS.length).toBe(234 - 1); // every `simd`-class entry but `v128.const`
    const missing = VARIANTS.filter((v) => {
      const args = v.op.params.map((t) => toLiteral(t, t === 'v128' ? new Uint8Array(16) : 0n));
      return ours(v, args) === null;
    }).map((v) => `${v.op.name} ${v.lanes.join(' ')}`);
    expect(missing).toEqual([]);
  });

  it('every relaxed operator is marked, and nothing else', () => {
    const relaxed = OPS.filter((op) => isRelaxed(op.code)).map((op) => op.name);
    expect(relaxed.length).toBe(20);
    expect(relaxed.every((n) => n.includes('relaxed_'))).toBe(true);
    expect(OPS.filter((op) => op.name.includes('relaxed_')).length).toBe(20);
  });

  for (const v of VARIANTS) {
    const { op } = v;
    if (isRelaxed(op.code)) continue;
    it(`${op.name}${v.lanes.length > 0 ? ' ' + v.lanes.join(' ') : ''}`, () => {
      const arith = FLOAT_ARITH.test(op.name);
      const bad: string[] = [];
      for (const args of operandLists(op)) {
        const flat = args.flatMap((a) => (a instanceof Uint8Array ? halves(a) : [a]));
        const raw = exported[v.export]!(...flat);
        const engine = Array.isArray(raw) ? raw.join(',') : String(raw);
        const lits = args.map((a, j) => toLiteral(op.params[j]!, a));
        const r = ours(v, lits);
        const show = `${op.name}(${
          args.map((a) => (a instanceof Uint8Array ? halves(a).join('|') : a)).join(', ')
        })`;
        if (r === null || 'trap' in r) {
          bad.push(`${show}: core gave ${r === null ? 'null' : 'a trap'}`);
          continue;
        }
        const got = bitsOf(r.value);
        if (got === engine) continue;
        if (arith && r.value.type === ValType.V128 && Array.isArray(raw)) {
          const want = ofI64(BigInt(raw[0]!), BigInt(raw[1]!));
          if (agreeFloatLanes(r.value.bytes, want, op.name.startsWith('f64x2'))) continue;
        }
        bad.push(`${show}: core ${got}, V8 ${engine}`);
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }
});

describe('relaxed SIMD in the deterministic profile', () => {
  it('relaxed_madd is FUSED: one rounding', () => {
    // (1 + 2^-23)(1 − 2^-23) − 1 = −2^-46 exactly; rounding the product first gives 0.
    const a = 1 + 2 ** -23, b = 1 - 2 ** -23;
    expect(fma(a, b, -1, true)).toBe(-(2 ** -46));
    expect(Math.fround(Math.fround(a * b) - 1)).toBe(0);
    // The spec suite's own case: FLT_MAX × 2 − FLT_MAX is FLT_MAX fused, ∞ unfused.
    const max = 3.4028234663852886e38;
    expect(fma(max, 2, -max, true)).toBe(max);
    expect(fma(max, 2, -max, false)).toBe(max * 2 - max);
    // Signs of zero, infinities, NaN.
    expect(Object.is(fma(-0, 1, -0, false), -0)).toBe(true);
    expect(Object.is(fma(-0, 1, 0, false), 0)).toBe(true);
    expect(Object.is(fma(1, 1, -1, false), 0)).toBe(true);
    expect(fma(Infinity, 0, 1, false)).toBeNaN();
    expect(fma(Infinity, 1, -Infinity, false)).toBeNaN();
    expect(fma(Infinity, 1, 1, false)).toBe(Infinity);
    expect(fma(1, 1, -Infinity, false)).toBe(-Infinity);
    // Subnormal results round once too.
    expect(fma(2 ** -1000, 2 ** -60, 0, false)).toBe(2 ** -1060);
    // 2^-1075 + 2^-1074 is a tie between 2^-1074 and 2^-1073: to even, 2^-1073.
    expect(fma(2 ** -1000, 2 ** -75, 2 ** -1074, false)).toBe(2 ** -1073);
  });

  it('a relaxed operator is never folded; an exact SIMD result is; a NaN lane from arithmetic is not', () => {
    const v = (b: Uint8Array): Literal => ({ type: ValType.V128, bytes: b });
    const ones = ofF32(1, 2, 3, 4);
    const relaxedMin = (0xfd << 16) | 0x10d;
    expect(evalBinary(relaxedMin, v(ones), v(ones))).not.toBeNull();
    expect(foldedLiteral(relaxedMin, evalBinary(relaxedMin, v(ones), v(ones)))).toBeNull();
    const add = (0xfd << 16) | 0xe4; // f32x4.add
    expect(foldedLiteral(add, evalBinary(add, v(ones), v(ones)))).not.toBeNull();
    expect(foldedLiteral(add, evalBinary(add, v(ofF32(NaN, 0, 0, 0)), v(ones)))).toBeNull();
    const neg = (0xfd << 16) | 0xe1; // f32x4.neg: exact on the bits
    expect(foldedLiteral(neg, evalUnary(neg, v(ofF32(NaN, 0, 0, 0))))).not.toBeNull();
    const eq = (0xfd << 16) | 0x37; // i32x4.eq: integer lanes that LOOK like NaNs
    expect(foldedLiteral(eq, evalBinary(eq, v(ones), v(ones)))).not.toBeNull();
  });
});
