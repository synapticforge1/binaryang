// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedBrs, open-work 2 step 6b: a block whose only branch is a `br_if`
// to itself as its first statement — bare, or at the head of the loop it
// wraps — becomes an `if` on the negated condition. Each case RUNS the module
// before and after the pass alone, and asserts whether the rewrite happened.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

type Fn = (...a: number[]) => unknown;
function rub(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('RemoveUnusedBrs').run();
  const out = writeWasm(m);
  const { errors } = wasmValidate(out, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text };
}
async function same(before: Uint8Array, after: Uint8Array, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource);
    const ex = instance.exports as Record<string, unknown>;
    try {
      return String((ex.f as Fn)(...a));
    } catch (e) {
      return `trap: ${(e as Error).message}`;
    }
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}
const INPUTS = [[0], [1], [3], [-1], [10]];

describe('a block opening with a br_if to itself becomes an if', () => {
  it('a bare block', async () => {
    const { before, after, text } = rub(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (block $b
          (br_if $b (i32.eqz (local.get 0)))
          (local.set 1 (i32.add (local.get 0) (i32.const 100)))
          (local.set 1 (i32.mul (local.get 1) (i32.const 2))))
        (local.get 1)))`);
    expect(text).not.toContain('block');
    expect(text).toContain('if');
    expect(text).toContain('i32.eqz\n        (i32.eqz');
    await same(before, after, INPUTS);
  });

  it('the loop it wraps: the exit test at the head of the body', async () => {
    const { before, after, text } = rub(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (block $out
          (loop $in
            (br_if $out (i32.ge_s (local.get 1) (local.get 0)))
            (local.set 1 (i32.add (local.get 1) (i32.const 1)))
            (br $in)))
        (local.get 1)))`);
    expect(text).not.toContain('block');
    expect(text).toContain('loop');
    expect(text).toContain('(if');
    expect(text).toContain('br 1'); // the back edge, now from inside the if
    await same(before, after, INPUTS);
  });

  it('NOT when something else branches to the block, or the block carries a value', async () => {
    const other = rub(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (block $b
          (br_if $b (i32.eqz (local.get 0)))
          (local.set 1 (i32.const 5))
          (br_if $b (i32.eq (local.get 0) (i32.const 3)))
          (local.set 1 (i32.const 9)))
        (local.get 1)))`);
    expect(other.text).toContain('block');
    expect(other.text).not.toContain('(if');
    await same(other.before, other.after, INPUTS);
    const loop = rub(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (block $out
          (loop $in
            (br_if $out (i32.ge_s (local.get 1) (local.get 0)))
            (local.set 1 (i32.add (local.get 1) (i32.const 1)))
            (br_if $out (i32.eq (local.get 1) (i32.const 3)))
            (br $in)))
        (local.get 1)))`);
    expect(loop.text).toContain('block');
    await same(loop.before, loop.after, INPUTS);
    const value = rub(`(module
      (func (export "f") (param i32) (result i32)
        (block $b (result i32)
          (local.get 0)
          (br_if $b (i32.eqz (local.get 0)))
          (drop)
          (i32.const 7))))`);
    expect(value.text).toContain('block');
    await same(value.before, value.after, INPUTS);
  });

  // Through the runner this never reaches the pass: `lowerBlockParams` turns a
  // carrier's parameters into locals first, so the block below arrives with a
  // `local.set` ahead of its `br_if`. The pass guards the shape all the same
  // for a caller that hands it a tree directly; this case holds the pipeline's
  // behaviour (a mutant of the guard alone is unobservable here, by design).
  it('NOT a block with a parameter: the branch discards it, an if would leave it', async () => {
    const { before, after, text } = rub(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (i32.const 9)
        (block $b (param i32)
          (br_if $b (local.get 0))
          (local.set 1)
          (local.set 1 (i32.add (local.get 1) (i32.const 1))))
        (local.get 1)))`);
    expect(text).toContain('block');
    expect(text).not.toContain('(if');
    await same(before, after, INPUTS);
  });
});
