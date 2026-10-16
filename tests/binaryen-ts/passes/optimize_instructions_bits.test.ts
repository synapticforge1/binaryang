// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// OptimizeInstructions, open-work 30: the shapes upstream's pass still found on real compiler
// output (Zig debug builds mask every comparison with `& 1`). Each case RUNS the module before and
// after the pass alone, and asserts whether the rewrite happened.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

type Fn = (...a: number[]) => unknown;

function oi(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('OptimizeInstructions').run();
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    const f = (instance.exports as Record<string, unknown>)['f'] as Fn;
    return String(f(...a));
  };
  for (const a of inputs) {
    expect(`${a} -> ${await run(after, a)}`).toBe(`${a} -> ${await run(before, a)}`);
  }
}

const PAIRS = [[0, 0], [1, 2], [2, 1], [-1, 1], [1, -1], [0x7fffffff, -0x80000000]];

describe('and(x, 2^n - 1) is x when x fits in n bits', () => {
  it('a comparison masked with 1 (the Zig debug shape)', async () => {
    const { before, after, text } = oi(`(module (func (export "f") (param i32 i32) (result i32)
      (i32.and (i32.lt_u (local.get 0) (local.get 1)) (i32.const 1))))`);
    expect(text).not.toContain('i32.and');
    await same(before, after, PAIRS);
  });

  it('the constant on the left, and two comparisons or-ed together', async () => {
    const { before, after, text } = oi(`(module (func (export "f") (param i32 i32) (result i32)
      (i32.and (i32.const 1)
        (i32.or (i32.eqz (local.get 0)) (i32.gt_s (local.get 0) (local.get 1))))))`);
    expect(text).not.toContain('i32.and');
    await same(before, after, PAIRS);
  });

  it('an 8-bit load masked with 255, and a shift that leaves 8 bits', async () => {
    const { before, after, text } = oi(`(module (memory 1) (data (i32.const 0) "\\ff\\80\\01")
      (func (export "f") (param i32 i32) (result i32)
        (i32.add
          (i32.and (i32.load8_u (i32.and (local.get 0) (i32.const 3))) (i32.const 255))
          (i32.and (i32.shr_u (local.get 1) (i32.const 24)) (i32.const 255)))))`);
    expect(text.match(/i32\.and/g)?.length).toBe(1); // only the address mask stays
    await same(before, after, [[0, -1], [1, 0x12345678], [2, 0], [3, -0x80000000]]);
  });

  it('NOT when the value may have more bits than the mask keeps', async () => {
    const { before, after, text } = oi(`(module (func (export "f") (param i32 i32) (result i32)
      (i32.add
        (i32.and (i32.shr_u (local.get 0) (i32.const 23)) (i32.const 255))
        (i32.and (i32.add (i32.eqz (local.get 1)) (i32.const 1)) (i32.const 1)))))`);
    expect(text.match(/i32\.and/g)?.length).toBe(2);
    await same(before, after, [[-1, 0], [-1, 1], [0x7fffffff, 5]]);
  });
});

describe('eqz of a comparison is the inverse comparison', () => {
  it('every integer comparison, i32 and i64', async () => {
    const ops = ['eq', 'ne', 'lt_s', 'lt_u', 'gt_s', 'gt_u', 'le_s', 'le_u', 'ge_s', 'ge_u'];
    for (const op of ops) {
      const { before, after, text } = oi(`(module (func (export "f") (param i32 i32) (result i32)
        (i32.add
          (i32.eqz (i32.${op} (local.get 0) (local.get 1)))
          (i32.mul (i32.const 2)
            (i32.eqz (i64.${op} (i64.extend_i32_s (local.get 0)) (i64.extend_i32_s (local.get 1))))))))`);
      expect(text).not.toContain('eqz');
      await same(before, after, PAIRS);
    }
  });

  it('NOT a float comparison: with a NaN, a < b and a >= b are both false', async () => {
    const { before, after, text } = oi(`(module (func (export "f") (param i32 i32) (result i32)
      (i32.eqz (f32.lt (f32.div (f32.convert_i32_s (local.get 0)) (f32.convert_i32_s (local.get 1)))
                       (f32.const 1)))))`);
    expect(text).toContain('eqz');
    await same(before, after, [[0, 0], [1, 2], [3, 1]]); // 0/0 is NaN
  });
});

describe('a comparison of a local with itself is a constant', () => {
  it('true for eq / le / ge, false for ne / lt / gt', async () => {
    const { before, after, text } = oi(`(module (func (export "f") (param i32) (result i32)
      (i32.add
        (i32.add (i32.le_u (local.get 0) (local.get 0)) (i32.ge_s (local.get 0) (local.get 0)))
        (i32.add (i32.lt_s (local.get 0) (local.get 0)) (i32.ne (local.get 0) (local.get 0))))))`);
    expect(text).not.toMatch(/i32\.(le_u|ge_s|lt_s|ne)/);
    await same(before, after, [[0], [-1], [7]]);
  });
});
