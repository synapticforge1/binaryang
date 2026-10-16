// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// MergeSimilarFunctions, open-work 30 step 4: functions the same but for some constants become one
// shared function taking them as parameters, each original a thunk. Each case RUNS every export
// before and after the pass alone, and asserts whether the merge happened (and how many
// parameters the shared function takes).

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

type Fn = (...a: number[]) => unknown;

function msf(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('MergeSimilarFunctions').run();
  const after = writeWasm(m);
  expect(wasmValidate(after, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  const shared = m.functions.filter((f) => f.name.startsWith('mgfn-shared$'));
  for (const f of m.functions) expect(f.locals.length).toBeGreaterThanOrEqual(f.sig.params.length);
  return { before, after, shared };
}

async function same(before: Uint8Array, after: Uint8Array, names: string[], inputs: number[][]) {
  const run = async (b: Uint8Array) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    const ex = instance.exports as Record<string, unknown>;
    const out: string[] = [];
    for (const n of names) {
      for (const a of inputs) {
        try {
          out.push(
            `${n}(${a}) -> ${String((ex[n] as Fn)(...a))} g=${
              (ex['g'] as WebAssembly.Global).value
            }`,
          );
        } catch (e) {
          out.push(`${n}(${a}) -> trap: ${(e as Error).message}`);
        }
      }
    }
    return out;
  };
  expect(await run(after)).toEqual(await run(before));
}

/** A body big enough to pay: two locals past the parameters, a loop, a branch to the frame. */
const body = (a: number, b: number) => `
    (local $s i32) (local $i i32)
    (local.set $i (local.get 0))
    (block $done
      (loop $l
        (br_if $done (i32.ge_s (local.get $i) (i32.add (local.get 1) (i32.const ${a}))))
        (local.set $s (i32.add (local.get $s) (i32.mul (local.get $i) (i32.const ${b}))))
        (global.set $g (i32.xor (global.get $g) (local.get $s)))
        (if (i32.gt_s (local.get $s) (i32.const 100000)) (then (return (i32.const -1))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (i32.add (local.get $s) (i32.const ${a}))`;

const G = '(global $g (export "g") (mut i32) (i32.const 0))';
const INPUTS = [[0, 3], [2, 10], [-5, 5], [0, 400]];

describe('functions differing only in constants share one body', () => {
  it('three of them: one shared function with two extra parameters, locals moved up', async () => {
    const { before, after, shared } = msf(`(module ${G}
      (func (export "a") (param i32 i32) (result i32) ${body(1, 2)})
      (func (export "b") (param i32 i32) (result i32) ${body(3, 7)})
      (func (export "c") (param i32 i32) (result i32) ${body(5, 2)}))`);
    expect(shared.length).toBe(1);
    expect(shared[0]!.sig.params.length).toBe(4);
    await same(before, after, ['a', 'b', 'c'], INPUTS);
  });

  it('a constant that differs the same way twice is one parameter', async () => {
    const { before, after, shared } = msf(`(module ${G}
      (func (export "a") (param i32 i32) (result i32) ${body(4, 4)})
      (func (export "b") (param i32 i32) (result i32) ${body(9, 9)}))`);
    expect(shared.length).toBe(1);
    expect(shared[0]!.sig.params.length).toBe(3);
    await same(before, after, ['a', 'b'], INPUTS);
  });
});

describe('not merged', () => {
  it('when the glue would cost more than the body saves', async () => {
    const { before, after, shared } = msf(`(module ${G}
      (func (export "a") (param i32) (result i32) (i32.add (local.get 0) (i32.const 1)))
      (func (export "b") (param i32) (result i32) (i32.add (local.get 0) (i32.const 2))))`);
    expect(shared.length).toBe(0);
    await same(before, after, ['a', 'b'], [[0], [5]]);
  });

  it('when an instruction differs, or a constant has another type', async () => {
    const other = body(1, 2).replace('i32.mul', 'i32.sub');
    const wide = body(1, 2).replace(
      '(i32.add (local.get $s) (i32.const 1))',
      '(i32.wrap_i64 (i64.add (i64.extend_i32_s (local.get $s)) (i64.const 1)))',
    );
    expect(wide).toContain('i64.const');
    const { before, after, shared } = msf(`(module ${G}
      (func (export "a") (param i32 i32) (result i32) ${body(1, 2)})
      (func (export "b") (param i32 i32) (result i32) ${other})
      (func (export "c") (param i32 i32) (result i32) ${wide}))`);
    expect(shared.length).toBe(0);
    await same(before, after, ['a', 'b', 'c'], INPUTS);
  });

  it('when only a constant TYPE differs (one parameter cannot take both)', async () => {
    const tail = (t: string) =>
      body(1, 2).replace(
        '(local.set $i (local.get 0))',
        `(drop (${t}.const 7)) (local.set $i (local.get 0))`,
      );
    const { before, after, shared } = msf(`(module ${G}
      (func (export "a") (param i32 i32) (result i32) ${tail('i32')})
      (func (export "b") (param i32 i32) (result i32) ${tail('i64')}))`);
    expect(shared.length).toBe(0);
    await same(before, after, ['a', 'b'], INPUTS);
  });
});
