// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 23, stage E1: the evaluator's numeric core against V8, operator by
// operator. A wrong evaluator is a SILENT miscompile once Precompute folds with
// it, so the oracle is an engine, not a second reading of the spec by the same
// hand.
//
// The operators come from D1 (`src/definitions/opcodes.json`): every scalar
// numeric instruction. So the test also asserts COVERAGE — an operator the core
// answers `null` for fails here rather than being silently left unfolded.
//
// Operands cross the JS boundary as integer BITS and are reinterpreted inside
// the module: a float passed as a JS number may lose a NaN's payload on the way.
//
// Where a NaN may legitimately differ: the spec lets an arithmetic operator
// return ANY arithmetic NaN (quiet bit set), and engines propagate payloads
// while the core returns the canonical one. There both must be NaN, and the
// core's must be quiet. `abs`, `neg`, `copysign` and the reinterpretations are
// exact on the bits — no tolerance there.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import opcodes from '../../../src/definitions/opcodes.json' with { type: 'json' };
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import {
  evalBinary,
  evalUnary,
  isNaNLiteral,
  type NumericResult,
} from '../../../src/binaryen-ts/interp/numeric.ts';
import type { Literal } from '../../../src/binaryen-ts/ir/expressions.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

type T = 'i32' | 'i64' | 'f32' | 'f64';
interface Op {
  name: string;
  code: number;
  params: T[];
  result: T;
}

const SCALAR = new Set(['i32', 'i64', 'f32', 'f64']);
const OPS: Op[] = opcodes.entries.flatMap((e) => {
  const sig = e.signature as { params: string[]; results: string[] } | null;
  if (!sig || e.immediates.length !== 0 || !String(e.class).startsWith('numeric-')) return [];
  if (sig.results.length !== 1 || sig.params.length < 1 || sig.params.length > 2) return [];
  if (![...sig.params, ...sig.results].every((t) => SCALAR.has(t))) return [];
  const code = e.prefix === null ? e.opcode : (Number(e.prefix) << 16) | e.opcode;
  return [{ name: e.name, code, params: sig.params as T[], result: sig.results[0] as T }];
});

/** Operators exact on the bits, NaN payload included. */
const BITWISE = /\.(abs|neg|copysign|reinterpret_[if](32|64))$/;

// ---------------------------------------------------------------------------
// Operands, as bits: i32 / f32 as a JS int32, i64 / f64 as a BigInt
// ---------------------------------------------------------------------------

let seed = 0x2545f491;
const rnd32 = (): number => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed | 0;
};
const rnd64 = (): bigint =>
  BigInt.asIntN(64, (BigInt(rnd32() >>> 0) << 32n) | BigInt(rnd32() >>> 0));
const f32b = (n: number): number => {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, n);
  return v.getInt32(0);
};
const f64b = (n: number): bigint => {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, n);
  return v.getBigInt64(0);
};

const FLOATS = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  1.5,
  2.5,
  -2.5,
  3.5,
  0.49999997,
  Infinity,
  -Infinity,
  2 ** 31,
  -(2 ** 31),
  2 ** 31 - 1,
  -(2 ** 31) - 1,
  2 ** 31 - 0.5,
  -(2 ** 31) - 0.5,
  2 ** 32,
  2 ** 32 - 1,
  2 ** 32 - 0.5,
  2 ** 52,
  2 ** 52 + 0.5,
  2 ** 53 + 2,
  2 ** 63,
  -(2 ** 63),
  2 ** 64,
  1e-40,
  3.4028234663852886e38,
  1e300,
  -1e-310,
  Math.PI,
];

const EDGE: Record<T, (number | bigint)[]> = {
  i32: [
    0,
    1,
    -1,
    2,
    -2,
    7,
    31,
    32,
    33,
    0x7f,
    0x80,
    0xff,
    0x7fff,
    0x8000,
    0xffff,
    0x7fffffff,
    -0x80000000,
    -0x7fffffff,
    123456789,
  ],
  i64: [
    0n,
    1n,
    -1n,
    2n,
    -2n,
    63n,
    64n,
    65n,
    0x7fn,
    0x80n,
    0x7fffffffn,
    0x80000000n,
    0xffffffffn,
    0x100000000n,
    -0x80000000n,
    2n ** 53n + 1n,
    2n ** 53n + 3n,
    2n ** 62n + 2n ** 38n + 1n,
    2n ** 63n - 1n,
    -(2n ** 63n),
    -(2n ** 63n) + 1n,
    0x100000000000007fn,
  ],
  f32: [
    ...FLOATS.map(f32b),
    0x7fc00000,
    0xffc00000 | 0,
    0x7fa00001, // signalling, with a payload
    0xff800123 | 0,
    1, // the smallest subnormal
    0x7f7fffff,
    0x4effffff,
    0xcf000001 | 0,
  ],
  f64: [
    ...FLOATS.map(f64b),
    0x7ff8000000000000n,
    BigInt.asIntN(64, 0xfff8000000000000n),
    0x7ff4000000000001n,
    1n,
    0x41dfffffffffffffn,
    BigInt.asIntN(64, 0xc1e0000000200000n),
  ],
};
const random = (t: T): number | bigint => (t === 'i32' || t === 'f32' ? rnd32() : rnd64());

function operandLists(op: Op): (number | bigint)[][] {
  const [p, q] = op.params;
  const lists: (number | bigint)[][] = [];
  if (q === undefined) {
    for (const a of EDGE[p!]) lists.push([a]);
    for (let i = 0; i < 400; i++) lists.push([random(p!)]);
  } else {
    for (const a of EDGE[p!]) for (const b of EDGE[q]) lists.push([a, b]);
    for (let i = 0; i < 400; i++) lists.push([random(p!), random(q)]);
  }
  return lists;
}

const toLiteral = (t: T, bits: number | bigint): Literal => {
  switch (t) {
    case 'i32':
      return { type: ValType.I32, value: Number(bits) | 0 };
    case 'i64':
      return { type: ValType.I64, value: BigInt(bits) };
    case 'f32':
      return { type: ValType.F32, bits: Number(bits) >>> 0 };
    case 'f64':
      return { type: ValType.F64, bits: BigInt.asUintN(64, BigInt(bits)) };
  }
};
const bitsOf = (lit: Literal): number | bigint => {
  switch (lit.type) {
    case ValType.I32:
      return lit.value | 0;
    case ValType.I64:
      return BigInt.asIntN(64, lit.value);
    case ValType.F32:
      return lit.bits | 0;
    case ValType.F64:
      return BigInt.asIntN(64, lit.bits);
    default:
      throw new Error('not a scalar');
  }
};

// ---------------------------------------------------------------------------
// The oracle module: one export per operator, bits in, bits out
// ---------------------------------------------------------------------------

const bitsType = (t: T): string => (t === 'f32' ? 'i32' : t === 'f64' ? 'i64' : t);
const fromBits = (t: T, get: string): string =>
  t === 'f32' ? `(f32.reinterpret_i32 ${get})` : t === 'f64' ? `(f64.reinterpret_i64 ${get})` : get;
const toBits = (t: T, e: string): string =>
  t === 'f32' ? `(i32.reinterpret_f32 ${e})` : t === 'f64' ? `(i64.reinterpret_f64 ${e})` : e;

const wat = `(module\n${
  OPS.map((op, i) => {
    const params = op.params.map((t) => `(param ${bitsType(t)})`).join(' ');
    const args = op.params.map((t, j) => fromBits(t, `(local.get ${j})`)).join(' ');
    return `(func (export "o${i}") ${params} (result ${bitsType(op.result)}) ${
      toBits(op.result, `(${op.name} ${args})`)
    })`;
  }).join('\n')
}\n)`;
const { instance } = await WebAssembly.instantiate(
  wat2wasm(wat, { textForm: false }).binary as BufferSource,
);
const exported = instance.exports as Record<string, (...a: (number | bigint)[]) => number | bigint>;

describe('the numeric core agrees with V8 on every scalar operator', () => {
  it('D1 lists the scalar numeric operators, and the core evaluates every one', () => {
    expect(OPS.length).toBe(136);
    const missing = OPS.filter((op) => {
      const args = op.params.map((t) => toLiteral(t, 0));
      return (args.length === 1
        ? evalUnary(op.code, args[0]!)
        : evalBinary(op.code, args[0]!, args[1]!)) === null;
    }).map((op) => op.name);
    expect(missing).toEqual([]);
  });

  for (const [i, op] of OPS.entries()) {
    it(op.name, () => {
      const exact = BITWISE.test(op.name);
      const isFloat = op.result === 'f32' || op.result === 'f64';
      const bad: string[] = [];
      for (const args of operandLists(op)) {
        let engine: { bits: number | bigint } | { trap: string };
        try {
          engine = { bits: exported[`o${i}`]!(...args) };
        } catch (e) {
          if (!(e instanceof WebAssembly.RuntimeError)) throw e;
          engine = { trap: e.message };
        }
        const lits = args.map((a, j) => toLiteral(op.params[j]!, a));
        const ours: NumericResult = lits.length === 1
          ? evalUnary(op.code, lits[0]!)!
          : evalBinary(op.code, lits[0]!, lits[1]!)!;
        const show = `${op.name}(${args.join(', ')})`;
        if ('trap' in engine) {
          if (!('trap' in ours)) {
            bad.push(`${show}: V8 traps (${engine.trap}), core gives ${bitsOf(ours.value)}`);
          }
          continue;
        }
        if ('trap' in ours) {
          bad.push(`${show}: core traps (${ours.trap}), V8 gives ${engine.bits}`);
          continue;
        }
        const got = bitsOf(ours.value);
        if (got === engine.bits) continue;
        if (isFloat && !exact) {
          const theirs = toLiteral(op.result, engine.bits);
          const quiet = op.result === 'f32'
            ? ((got as number) & 0x400000) !== 0
            : (BigInt(got) & 0x8000000000000n) !== 0n;
          if (isNaNLiteral(ours.value) && isNaNLiteral(theirs) && quiet) continue;
        }
        bad.push(`${show}: core ${got}, V8 ${engine.bits}`);
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }
});

describe("a trap is a result, in the spec testsuite's words", () => {
  const r = (x: NumericResult | null) => (x !== null && 'trap' in x ? x.trap : null);
  const I32 = (v: number): Literal => ({ type: ValType.I32, value: v });
  const F64 = (n: number): Literal => ({ type: ValType.F64, bits: BigInt.asUintN(64, f64b(n)) });
  it('division', () => {
    expect(r(evalBinary(0x6d, I32(1), I32(0)))).toBe('integer divide by zero');
    expect(r(evalBinary(0x6d, I32(-0x80000000), I32(-1)))).toBe('integer overflow');
    expect(r(evalBinary(0x6f, I32(-0x80000000), I32(-1)))).toBe(null); // rem_s: 0, no trap
  });
  it('conversion', () => {
    expect(r(evalUnary(0xaa, F64(NaN)))).toBe('invalid conversion to integer');
    expect(r(evalUnary(0xaa, F64(2 ** 31)))).toBe('integer overflow');
    expect(r(evalUnary(0xaa, F64(-(2 ** 31) - 0.5)))).toBe(null); // truncates to INT_MIN
  });
});
