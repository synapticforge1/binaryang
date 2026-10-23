// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RelaxedSimdLowering (open-work 34, owner decision 2): the relaxed-SIMD instructions become plain
// SIMD-128 with the specification's DETERMINISTIC-PROFILE result (exec/numerics.rst: every relaxed
// parameter is 0, so `relaxed(R)[A0, …] = A0`). The expected values are computed below from the
// spec's definitions, independently of the pass, on the edge inputs where hardware differs: NaN,
// out-of-range floats, -0, swizzle indices >= 16, mixed laneselect masks, -128 bytes, and the inputs
// where a FUSED multiply-add or an UNWRAPPED dot intermediate would give a different answer.
//
// No engine is the oracle for all of them: wasmtime's `relaxed-simd-deterministic` and WasmEdge do
// not wrap the dot-add's i16 intermediate, and wasmtime and binaryang's interpreter fuse madd
// (measured 2026-10-23, cmem/portability.md). So the spec is the oracle; binaryang's interpreter,
// running the ORIGINAL, is a second witness on the instructions where it implements the profile.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures, defaultFeatures } from '../../../src/core/feature.ts';
import { interpModule } from '../../../src/tools/wasm-interp.ts';

type V = Uint8Array;
const v = (fill: (d: DataView) => void): V => {
  const b = new Uint8Array(16);
  fill(new DataView(b.buffer));
  return b;
};
const f32 = (...x: number[]) => v((d) => x.forEach((n, i) => d.setFloat32(i * 4, n, true)));
const f64 = (...x: number[]) => v((d) => x.forEach((n, i) => d.setFloat64(i * 8, n, true)));
const i8 = (...x: number[]) => v((d) => x.forEach((n, i) => d.setInt8(i, n)));
const i16 = (...x: number[]) => v((d) => x.forEach((n, i) => d.setInt16(i * 2, n, true)));
const i32 = (...x: number[]) => v((d) => x.forEach((n, i) => d.setInt32(i * 4, n, true)));
const lanes = (b: V, n: number, get: (d: DataView, i: number) => number) => {
  const d = new DataView(b.buffer, b.byteOffset, 16);
  return Array.from({ length: n }, (_, i) => get(d, i));
};
const F32 = (b: V) => lanes(b, 4, (d, i) => d.getFloat32(i * 4, true));
const F64 = (b: V) => lanes(b, 2, (d, i) => d.getFloat64(i * 8, true));
const I8 = (b: V) => lanes(b, 16, (d, i) => d.getInt8(i));
const I16 = (b: V) => lanes(b, 8, (d, i) => d.getInt16(i * 2, true));
const I32 = (b: V) => lanes(b, 4, (d, i) => d.getInt32(i * 4, true));

// --- The spec's deterministic results ---
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const truncSat = (
  x: number,
  lo: number,
  hi: number,
) => (Number.isNaN(x) ? 0 : clamp(Math.trunc(x), lo, hi));
const fr = Math.fround;
type Shape = 'int' | 'f32' | 'f64';
type Case = { op: string; inputs: V[]; expect: V; shape: Shape };
const CASES: Case[] = [];
const add = (op: string, shape: Shape, ref: (...x: V[]) => V, ...sets: V[][]) =>
  sets.forEach((inputs) => CASES.push({ op, inputs, expect: ref(...inputs), shape }));

const E32 = 2 ** -23, E64 = 2 ** -52;
add(
  'i8x16.relaxed_swizzle',
  'int',
  (a, s) => Uint8Array.from(s!, (x) => (x < 16 ? a![x]! : 0)),
  [
    Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i),
    Uint8Array.from([0, 15, 16, 255, 128, 31, 1, 17, 7, 8, 0x7f, 0x80, 3, 200, 14, 2]),
  ],
);
const S32: [number, number] = [-(2 ** 31), 2 ** 31 - 1], U32: [number, number] = [0, 2 ** 32 - 1];
add('i32x4.relaxed_trunc_f32x4_s', 'int', (a) => i32(...F32(a!).map((x) => truncSat(x, ...S32))), [
  f32(NaN, 3e9, -3e9, -1.9),
], [f32(-0.5, 2147483520, Infinity, -Infinity)]);
add(
  'i32x4.relaxed_trunc_f32x4_u',
  'int',
  (a) => i32(...F32(a!).map((x) => truncSat(x, ...U32) | 0)),
  [
    f32(NaN, 5e9, -1, 3.7),
  ],
  [f32(-0.9, 4294967040, Infinity, -Infinity)],
);
add(
  'i32x4.relaxed_trunc_f64x2_s_zero',
  'int',
  (a) => i32(...F64(a!).map((x) => truncSat(x, ...S32)), 0, 0),
  [
    f64(NaN, 1e10),
  ],
  [f64(-1e10, -2.5)],
);
add(
  'i32x4.relaxed_trunc_f64x2_u_zero',
  'int',
  (a) => i32(...F64(a!).map((x) => truncSat(x, ...U32) | 0), 0, 0),
  [
    f64(NaN, 1e10),
  ],
  [f64(-1, 4294967295.9)],
);
// madd is UNFUSED in the profile ("the unfused behaviour is used"): round(round(a·b) + c). The 1±ε
// lanes give 0 unfused but ±ε² fused; 1e30·1e10 + -inf gives NaN unfused (the product overflows
// first) but -inf fused.
const madd32 = (neg: boolean) => (a?: V, b?: V, c?: V) => {
  const [x, y, z] = [F32(a!), F32(b!), F32(c!)];
  return f32(...x.map((xi, i) => fr(fr((neg ? -xi : xi) * y[i]!) + z[i]!)));
};
const madd64 = (neg: boolean) => (a?: V, b?: V, c?: V) => {
  const [x, y, z] = [F64(a!), F64(b!), F64(c!)];
  return f64(...x.map((xi, i) => (neg ? -xi : xi) * y[i]! + z[i]!));
};
add('f32x4.relaxed_madd', 'f32', madd32(false), [
  f32(1 + E32, NaN, Infinity, 2),
  f32(1 - E32, 1, 0, 3),
  f32(-1, 1, 1, 4),
], [
  f32(1e30, -0, 3, -2),
  f32(1e10, 5, 1e-45, 2),
  f32(-Infinity, 0, 0, 4),
]);
add('f32x4.relaxed_nmadd', 'f32', madd32(true), [
  f32(1 + E32, NaN, Infinity, 2),
  f32(1 - E32, 1, 0, 3),
  f32(1, 1, 1, 4),
], [
  f32(1e30, -0, 3, -2),
  f32(1e10, 5, 1e-45, 2),
  f32(Infinity, 0, -0, 4),
]);
add('f64x2.relaxed_madd', 'f64', madd64(false), [
  f64(1 + E64, 1e300),
  f64(1 - E64, 1e10),
  f64(-1, -Infinity),
], [
  f64(NaN, 2),
  f64(1, 3),
  f64(1, 4),
]);
add('f64x2.relaxed_nmadd', 'f64', madd64(true), [
  f64(1 + E64, 1e300),
  f64(1 - E64, 1e10),
  f64(1, Infinity),
], [
  f64(NaN, 2),
  f64(1, 3),
  f64(1, 4),
]);
// laneselect is bitselect: bit by bit, so a mask lane with mixed bits is where hardware differs.
const SEL_IN = [
  Uint8Array.from({ length: 16 }, (_, i) => 0x11 * i),
  Uint8Array.from({ length: 16 }, (_, i) => 0xee - i),
  Uint8Array.from([
    0x00,
    0xff,
    0x80,
    0x7f,
    0x0f,
    0xf0,
    0x01,
    0xfe,
    0xff,
    0xff,
    0x00,
    0x80,
    0xff,
    0xff,
    0xff,
    0x7f,
  ]),
];
const sel = (a?: V, b?: V, m?: V) =>
  Uint8Array.from(a!, (x, i) => (x & m![i]!) | (b![i]! & ~m![i]!));
for (const w of ['i8x16', 'i16x8', 'i32x4', 'i64x2']) {
  add(`${w}.relaxed_laneselect`, 'int', sel, SEL_IN);
}
// min / max are the regular ones: NaN propagates, -0 < +0 (as JavaScript's Math.min / max).
const pick32 = (f: (x: number, y: number) => number) => (a?: V, b?: V) =>
  f32(...F32(a!).map((x, i) => f(x, F32(b!)[i]!)));
const pick64 = (f: (x: number, y: number) => number) => (a?: V, b?: V) =>
  f64(...F64(a!).map((x, i) => f(x, F64(b!)[i]!)));
const MM32 = [[f32(NaN, -0, 0, -Infinity), f32(1, 0, -0, 5)], [
  f32(2, 3, NaN, 1),
  f32(1, Infinity, NaN, -1),
]];
const MM64 = [[f64(NaN, -0), f64(1, 0)], [f64(0, 3), f64(-0, -Infinity)]];
add('f32x4.relaxed_min', 'f32', pick32(Math.min), ...MM32);
add('f32x4.relaxed_max', 'f32', pick32(Math.max), ...MM32);
add('f64x2.relaxed_min', 'f64', pick64(Math.min), ...MM64);
add('f64x2.relaxed_max', 'f64', pick64(Math.max), ...MM64);
add(
  'i16x8.relaxed_q15mulr_s',
  'int',
  (a, b) =>
    i16(
      ...I16(a!).map((x, i) =>
        clamp(Math.floor((x * I16(b!)[i]! + 0x4000) / 0x8000), -32768, 32767)
      ),
    ),
  [
    i16(-32768, -32768, 16384, -1, 32767, 1, 100, -100),
    i16(-32768, 32767, 16384, 1, 32767, 16384, 200, 300),
  ],
);
// dot is ivdot: BOTH operands signed (sx2 = relaxed[S, U] at 0), and the i16 pair sums WRAP; the
// dot-add widens THOSE wrapped lanes pairwise and adds c (spec 3.2-numerics.vector.spectec).
const wrap16 = (x: number) => (x << 16) >> 16;
const dot = (a: V, b: V) => {
  const [x, y] = [I8(a), I8(b)];
  return Array.from(
    { length: 8 },
    (_, k) => wrap16(x[2 * k]! * y[2 * k]! + x[2 * k + 1]! * y[2 * k + 1]!),
  );
};
const DOT_IN = [
  [
    i8(-128, -128, 127, 127, -1, 1, 0, 5, 100, -100, -128, 127, 3, -3, -128, 1),
    i8(-128, -128, 127, 127, -128, -1, 9, 7, -128, 100, 127, -128, -7, 7, -1, -128),
  ],
  [
    i8(1, 2, 3, 4, -5, -6, 7, 8, 9, 10, -11, 12, 13, 14, 15, -16),
    i8(127, 64, 63, 1, 0, 100, 127, 127, 2, 3, 4, 5, 6, 7, 8, 9),
  ],
];
add('i16x8.relaxed_dot_i8x16_i7x16_s', 'int', (a, b) => i16(...dot(a!, b!)), ...DOT_IN);
add(
  'i32x4.relaxed_dot_i8x16_i7x16_add_s',
  'int',
  (a, b, c) => {
    const d = dot(a!, b!);
    return i32(...I32(c!).map((z, j) => (d[2 * j]! + d[2 * j + 1]! + z) | 0));
  },
  ...DOT_IN.map(([a, b]) => [a!, b!, i32(2 ** 31 - 1, -(2 ** 31), 1000, -7)]),
);

// --- The module: case k is export `c<k>`, its inputs in mutable globals (nothing to constant-fold),
// returning its result's two i64 lanes. ---
const hex = (b: V) => [...b].map((x) => `0x${x.toString(16).padStart(2, '0')}`).join(' ');
const WAT = `(module\n${
  CASES.map((c, k) => {
    const g = c.inputs.map((b, i) => `(global $c${k}_${i} (mut v128) (v128.const i8x16 ${hex(b)}))`)
      .join('\n');
    const gets = c.inputs.map((_, i) => `global.get $c${k}_${i}`).join(' ');
    return `${g}\n(func (export "c${k}") (result i64 i64) (local v128)
  ${gets} ${c.op} local.tee 0 i64x2.extract_lane 0 local.get 0 i64x2.extract_lane 1)`;
  }).join('\n')
})`;
const original = () => wat2wasm(WAT, { textForm: false, features: allFeatures() }).binary;

/** Equal under the spec: bit-exact, except that a NaN lane matches any NaN (NaN bits are not fixed). */
function same(got: V, want: V, shape: Shape): boolean {
  if (shape === 'int') return got.every((x, i) => x === want[i]);
  const [g, w] = shape === 'f32' ? [F32(got), F32(want)] : [F64(got), F64(want)];
  const bits = (
    b: V,
    i: number,
  ) => (shape === 'f32' ? b.subarray(i * 4, i * 4 + 4) : b.subarray(i * 8, i * 8 + 8));
  return g.every((x, i) =>
    (Number.isNaN(x) && Number.isNaN(w[i]!)) || bits(got, i).every((y, j) => y === bits(want, i)[j])
  );
}
const fromLanes = (lo: bigint, hi: bigint) =>
  v((d) => {
    d.setBigInt64(0, lo, true);
    d.setBigInt64(8, hi, true);
  });
const show = (b: V) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function lowered(): Uint8Array {
  const m = readForPasses(original());
  new PassRunner(m, {}).add('RelaxedSimdLowering').run();
  return writeWasm(m);
}

describe('RelaxedSimdLowering', () => {
  it('leaves no relaxed instruction: the output validates with relaxed SIMD OFF', () => {
    // The check bites: the original does NOT validate without the proposal.
    expect(wasmValidate(original(), { features: defaultFeatures() }).errors.length).toBeGreaterThan(
      0,
    );
    expect(wasmValidate(lowered(), { features: defaultFeatures() }).errors.map((e) => e.message))
      .toEqual([]);
  });

  it("every result is the spec's deterministic profile, over the edges", async () => {
    const { instance } = await WebAssembly.instantiate(lowered() as BufferSource, {});
    const ex = instance.exports as Record<string, () => [bigint, bigint]>;
    CASES.forEach((c, k) => {
      const got = fromLanes(...ex[`c${k}`]!());
      expect(
        same(got, c.expect, c.shape),
        `${c.op} case ${k}: got ${show(got)}, spec ${show(c.expect)}`,
      ).toBe(true);
    });
  });

  it("agrees with binaryang's interpreter running the ORIGINAL, where it implements the profile", () => {
    const m = readForPasses(original());
    CASES.forEach((c, k) => {
      // The interpreter FUSES madd / nmadd — a result the spec allows (R = 1), not the profile's.
      if (c.op.includes('madd')) return;
      const [inv] = interpModule(m, { runExport: `c${k}`, args: [] });
      const o = inv!.outcome;
      if (!('values' in o)) throw new Error(`c${k}: ${JSON.stringify(o)}`);
      const [lo, hi] = o.values.map((x) => ('value' in x ? BigInt(x.value) : NaN));
      const got = fromLanes(BigInt.asIntN(64, lo as bigint), BigInt.asIntN(64, hi as bigint));
      expect(same(got, c.expect, c.shape), `interp ${c.op} case ${k}: got ${show(got)}`).toBe(true);
    });
  });

  it('adds the dot helper once, only when a dot is used', () => {
    const count = (wat: string) => {
      const m = readForPasses(wat2wasm(wat, { textForm: false, features: allFeatures() }).binary);
      const before = m.functions.length;
      new PassRunner(m, {}).add('RelaxedSimdLowering').run();
      return m.functions.length - before;
    };
    expect(count(WAT)).toBe(1);
    expect(count(`(module (func (export "f") (param v128 v128) (result v128)
      local.get 0 local.get 1 f32x4.relaxed_min))`)).toBe(0);
    expect(count('(module (func (export "g") (result i64) i64.const 1))')).toBe(0);
  });
});
