// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// WideArithmeticLowering (open-work 34, owner decision 2): `i64.add128`, `i64.sub128`,
// `i64.mul_wide_s` and `i64.mul_wide_u` become i64 arithmetic, so a module runs on the engines that
// lack the proposal — V8 among them, the referee these tests run on, which cannot even COMPILE the
// original. So the lowered module is run here and compared with exact BigInt arithmetic computed
// below, independently of the pass; binaryang's interpreter, which runs the original, is a second
// witness on the same inputs.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { interpModule } from '../../../src/tools/wasm-interp.ts';

const M64 = (1n << 64n) - 1n;
const u64 = (x: bigint) => x & M64;
const s64 = (x: bigint) => BigInt.asIntN(64, x);
/** A 128-bit value as its (lo, hi) halves, each as a SIGNED i64 — how JS receives an i64. */
const halves = (x: bigint): [bigint, bigint] => [s64(x & M64), s64((x >> 64n) & M64)];
const join = (lo: bigint, hi: bigint) => (u64(hi) << 64n) | u64(lo);
const MOD128 = 1n << 128n;

const ref = {
  add128: (a: bigint, b: bigint, c: bigint, d: bigint) =>
    halves((join(a, b) + join(c, d)) % MOD128),
  sub128: (a: bigint, b: bigint, c: bigint, d: bigint) =>
    halves((((join(a, b) - join(c, d)) % MOD128) + MOD128) % MOD128),
  mul_wide_u: (a: bigint, b: bigint) => halves(u64(a) * u64(b)),
  mul_wide_s: (a: bigint, b: bigint) => halves(((s64(a) * s64(b)) % MOD128 + MOD128) % MOD128),
};

const WAT = `(module
  (func (export "add128") (param i64 i64 i64 i64) (result i64 i64)
    local.get 0 local.get 1 local.get 2 local.get 3 i64.add128)
  (func (export "sub128") (param i64 i64 i64 i64) (result i64 i64)
    local.get 0 local.get 1 local.get 2 local.get 3 i64.sub128)
  (func (export "mul_wide_u") (param i64 i64) (result i64 i64)
    local.get 0 local.get 1 i64.mul_wide_u)
  (func (export "mul_wide_s") (param i64 i64) (result i64 i64)
    local.get 0 local.get 1 i64.mul_wide_s))`;

/** The edges of an i64, and a spread between them. */
const EDGES = [
  0n,
  1n,
  -1n,
  2n,
  0x7fff_ffffn,
  0x8000_0000n,
  0xffff_ffffn,
  0x1_0000_0000n,
  0x7fff_ffff_ffff_ffffn,
  -0x8000_0000_0000_0000n,
  0x1234_5678_9abc_def0n,
  -0x0fed_cba9_8765_4321n,
];

function lowered(): Uint8Array {
  const original = wat2wasm(WAT, { textForm: false, features: allFeatures() }).binary;
  const m = readForPasses(original);
  new PassRunner(m, {}).add('WideArithmeticLowering').run();
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return out;
}

describe('WideArithmeticLowering', () => {
  it('leaves no wide-arithmetic instruction (the bytes 0xfc 0x13 … 0x16)', () => {
    const out = lowered();
    for (let i = 0; i + 1 < out.length; i++) {
      if (out[i] === 0xfc && out[i + 1]! >= 0x13 && out[i + 1]! <= 0x16) {
        // A prefix byte inside an immediate is possible in principle; the module here has none.
        throw new Error(`a wide-arithmetic opcode remains at byte ${i}`);
      }
    }
  });

  it('every result equals exact 128-bit arithmetic, over the edges', async () => {
    const { instance } = await WebAssembly.instantiate(lowered() as BufferSource, {});
    const ex = instance.exports as Record<string, (...a: bigint[]) => [bigint, bigint]>;
    for (const a of EDGES) {
      for (const b of EDGES) {
        expect(ex['mul_wide_u']!(a, b), `mul_wide_u ${a} ${b}`).toEqual(ref.mul_wide_u(a, b));
        expect(ex['mul_wide_s']!(a, b), `mul_wide_s ${a} ${b}`).toEqual(ref.mul_wide_s(a, b));
        for (const c of [0n, 1n, -1n, 0x7fff_ffff_ffff_ffffn]) {
          for (const d of [0n, -1n, 0x8000_0000n]) {
            expect(ex['add128']!(a, b, c, d), `add128 ${a} ${b} ${c} ${d}`).toEqual(
              ref.add128(a, b, c, d),
            );
            expect(ex['sub128']!(a, b, c, d), `sub128 ${a} ${b} ${c} ${d}`).toEqual(
              ref.sub128(a, b, c, d),
            );
          }
        }
      }
    }
  });

  it("agrees with binaryang's interpreter running the ORIGINAL", () => {
    const original = readForPasses(
      wat2wasm(WAT, { textForm: false, features: allFeatures() }).binary,
    );
    const run = (fn: string, args: bigint[]) => {
      const [inv] = interpModule(original, { runExport: fn, args: args.map(String) });
      const o = inv!.outcome;
      if (!('values' in o)) throw new Error(`${fn}: ${JSON.stringify(o)}`);
      return o.values.map((v) => ('value' in v ? BigInt(v.value) : NaN));
    };
    const pick = [0n, -1n, 0x8000_0000n, 0x7fff_ffff_ffff_ffffn, -0x8000_0000_0000_0000n];
    for (const a of pick) {
      for (const b of pick) {
        expect(run('mul_wide_s', [a, b]), `interp mul_wide_s ${a} ${b}`).toEqual(
          ref.mul_wide_s(a, b),
        );
        expect(run('mul_wide_u', [a, b]), `interp mul_wide_u ${a} ${b}`).toEqual(
          ref.mul_wide_u(a, b),
        );
        expect(run('add128', [a, b, b, a]), `interp add128 ${a} ${b}`).toEqual(
          ref.add128(a, b, b, a),
        );
        expect(run('sub128', [a, b, b, a]), `interp sub128 ${a} ${b}`).toEqual(
          ref.sub128(a, b, b, a),
        );
      }
    }
  });

  it('adds one helper per instruction USED, and none for a module without them', () => {
    const only =
      `(module (func (export "f") (param i64 i64) (result i64 i64) local.get 0 local.get 1 i64.mul_wide_u))`;
    const m = readForPasses(wat2wasm(only, { textForm: false, features: allFeatures() }).binary);
    const before = m.functions.length;
    new PassRunner(m, {}).add('WideArithmeticLowering').run();
    expect(m.functions.length).toBe(before + 1);
    const none = readForPasses(
      wat2wasm('(module (func (export "g") (result i64) i64.const 1))', { textForm: false }).binary,
    );
    const n = none.functions.length;
    new PassRunner(none, {}).add('WideArithmeticLowering').run();
    expect(none.functions.length).toBe(n);
  });
});
