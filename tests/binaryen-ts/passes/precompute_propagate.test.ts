// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// PrecomputePropagate, open-work 31 step 8: ConstantPropagation and Precompute alternate until
// neither changes anything. Two fixed rounds (the schedule before) stopped partway along a longer
// chain, and the next -Oz run finished it. Each case RUNS the module before and after the pass
// alone and compares the results.

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

function run(wat: string, ...passes: string[]) {
  const before = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
  const m = readForPasses(before);
  const runner = new PassRunner(m, {});
  for (const p of passes) runner.add(p);
  runner.run();
  const after = writeWasm(m);
  expect(wasmValidate(after, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after, text: wasm2wat(after).text };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[]) {
  const call = async (b: Uint8Array, a: number) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    return String(((instance.exports as Record<string, unknown>)['f'] as Fn)(a));
  };
  for (const a of inputs) expect(await call(after, a)).toBe(await call(before, a));
}

/** Each link needs the one before it computed, then its constant propagated: four rounds. */
const CHAIN = `(module
  (func (export "f") (param i32) (result i32) (local i32 i32 i32 i32)
    (local.set 1 (i32.const 3))
    (local.set 2 (i32.add (local.get 1) (i32.const 1)))
    (local.set 3 (i32.mul (local.get 2) (i32.const 5)))
    (local.set 4 (i32.sub (local.get 3) (i32.const 6)))
    (i32.add (local.get 0) (local.get 4))))`;

describe('ConstantPropagation and Precompute, to the fixed point', () => {
  it('a chain of four links folds in one pass', async () => {
    const { before, after, text } = run(CHAIN, 'PrecomputePropagate');
    expect(text).not.toContain('i32.mul');
    expect(text).not.toContain('i32.sub');
    expect(text).toContain('i32.const 14');
    await same(before, after, [0, 1, -20]);
  });

  it('two fixed rounds of each stop partway (what the schedule did before)', () => {
    const { text } = run(
      CHAIN,
      'ConstantPropagation',
      'Precompute',
      'ConstantPropagation',
      'Precompute',
    );
    expect(text).toContain('i32.sub');
  });

  it('a decided `if` removes a merge, and the local it wrote is one constant again', async () => {
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32) (result i32) (local i32 i32)
          (local.set 1 (i32.const 1))
          (if (local.get 1)
            (then (local.set 2 (i32.const 7)))
            (else (local.set 2 (i32.const 9))))
          (i32.mul (local.get 0) (local.get 2))))`,
      'PrecomputePropagate',
    );
    expect(text).not.toContain('if');
    expect(text).not.toContain('local.get 2');
    await same(before, after, [0, 1, 6]);
  });

  it('a parameter is never a constant: nothing folds through it', async () => {
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32) (result i32) (local i32)
          (local.set 1 (i32.add (local.get 0) (i32.const 2)))
          (i32.mul (local.get 1) (i32.const 3))))`,
      'PrecomputePropagate',
    );
    expect(text).toContain('i32.add');
    await same(before, after, [0, 5, -1]);
  });
});
