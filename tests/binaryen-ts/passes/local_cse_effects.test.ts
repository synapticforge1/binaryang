// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// LocalCSE on the shared effect analysis (open-work 3–5, 2026-10-06). A reuse
// past a write to what the expression reads yields a VALID module computing
// something else, so every case RUNS the module before and after the pass
// alone, and asserts whether the reuse happened.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

function cse(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, { shrinkLevel: 0 }).add('LocalCSE').run();
  const after = writeWasm(m);
  const { errors } = wasmValidate(after, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  const text = wasm2wat(after).text;
  return { before, after, tees: (text.match(/local\.tee/g) ?? []).length };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource);
    try {
      return String((instance.exports.f as (...x: number[]) => unknown)(...a));
    } catch (e) {
      return `trap: ${(e as Error).message}`;
    }
  };
  for (const a of inputs) {
    expect(`${a} -> ${await run(after, a)}`).toBe(`${a} -> ${await run(before, a)}`);
  }
}

const INPUTS = [[0], [1], [3], [-1]];

describe('what LocalCSE reuses', () => {
  it('index arithmetic — the shape upstream found most', async () => {
    const { before, after, tees } = cse(`(module (memory 1)
      (func (export "f") (param i32) (result i32)
        (i32.store (i32.add (i32.shl (local.get 0) (i32.const 2)) (i32.const 64)) (i32.const 5))
        (i32.load (i32.add (i32.shl (local.get 0) (i32.const 2)) (i32.const 64)))))`);
    expect(tees).toBe(1);
    await same(before, after, [[0], [1], [3]]);
  });

  it('a load, with no write between', async () => {
    const { before, after, tees } = cse(`(module (memory 1) (data (i32.const 8) "\\07\\00\\00\\00")
      (func (export "f") (param i32) (result i32)
        (i32.add (i32.load offset=8 (i32.and (local.get 0) (i32.const 0)))
                 (i32.load offset=8 (i32.and (local.get 0) (i32.const 0))))))`);
    expect(tees).toBe(1);
    await same(before, after, INPUTS);
  });

  it('a trapping division: the first evaluation traps, or neither does', async () => {
    const { before, after, tees } = cse(`(module
      (func (export "f") (param i32) (result i32)
        (i32.add (i32.div_s (i32.const 100) (local.get 0))
                 (i32.div_s (i32.const 100) (local.get 0)))))`);
    expect(tees).toBe(1);
    await same(before, after, INPUTS);
  });
});

describe('what it does NOT reuse past', () => {
  it('a store, for a load', async () => {
    const { before, after, tees } = cse(`(module (memory 1)
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.load (i32.const 8)))
        (i32.store (i32.const 8) (i32.add (local.get 0) (i32.const 1)))
        (i32.add (local.get 1) (i32.load (i32.const 8)))))`);
    expect(tees).toBe(0);
    await same(before, after, INPUTS);
  });

  it('memory.grow, for memory.size', async () => {
    const { before, after, tees } = cse(`(module (memory 1)
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.add (memory.size) (i32.const 1)))
        (drop (memory.grow (i32.const 1)))
        (i32.add (local.get 1) (i32.add (memory.size) (i32.const 1)))))`);
    expect(tees).toBe(0);
    await same(before, after, [[0]]);
  });

  it('a write of a local it reads — inside the same expression too', async () => {
    const { before, after } = cse(`(module
      (func (export "f") (param i32) (result i32)
        (i32.add
          (i32.add (i32.mul (local.get 0) (i32.const 3)) (local.tee 0 (i32.const 9)))
          (i32.mul (local.get 0) (i32.const 3)))))`);
    await same(before, after, INPUTS);
  });

  it('a call that writes a global it reads', async () => {
    const { before, after, tees } = cse(`(module
      (global $g (mut i32) (i32.const 5))
      (func $bump (global.set $g (i32.add (global.get $g) (i32.const 1))))
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.mul (global.get $g) (local.get 0)))
        (call $bump)
        (i32.add (local.get 1) (i32.mul (global.get $g) (local.get 0)))))`);
    expect(tees).toBe(0);
    await same(before, after, INPUTS);
  });

  it('an allocation: two struct.new are two objects', async () => {
    const { before, after, tees } = cse(`(module
      (type $s (struct (field i32)))
      (func (export "f") (param i32) (result i32)
        (ref.eq (struct.new $s (local.get 0)) (struct.new $s (local.get 0)))))`);
    expect(tees).toBe(0);
    await same(before, after, INPUTS);
  });

  it('from an if arm to after the if (the arm may not have run)', async () => {
    const { before, after, tees } = cse(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (if (local.get 0) (then (local.set 1 (i32.mul (local.get 0) (i32.const 7)))))
        (i32.add (local.get 1) (i32.mul (local.get 0) (i32.const 7)))))`);
    expect(tees).toBe(0);
    await same(before, after, INPUTS);
  });

  it('from the then arm into the else arm (on that path the then arm never ran)', async () => {
    const { before, after, tees } = cse(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (if (local.get 0)
          (then (local.set 1 (i32.mul (local.get 0) (i32.const 7))))
          (else (local.set 1 (i32.add (i32.mul (local.get 0) (i32.const 7)) (i32.const 1)))))
        (local.get 1)))`);
    expect(tees).toBe(0);
    await same(before, after, INPUTS);
  });

  it('from a legacy try body into its catch (the body may have thrown first)', async () => {
    const { before, after, tees } = cse(`(module
      (tag $e)
      (func $t (param i32) (if (local.get 0) (then (throw $e))))
      (func (export "f") (param i32) (result i32) (local i32)
        (try
          (do (call $t (local.get 0)) (local.set 1 (i32.mul (local.get 0) (i32.const 7))))
          (catch $e (local.set 1 (i32.add (i32.mul (local.get 0) (i32.const 7)) (i32.const 1)))))
        (local.get 1)))`);
    expect(tees).toBe(0);
    await same(before, after, INPUTS);
  });

  it('from a try body into its handler (the body may have thrown first)', async () => {
    const { before, after, tees } = cse(`(module
      (tag $e)
      (func $t (param i32) (if (local.get 0) (then (throw $e))))
      (func (export "f") (param i32) (result i32) (local i32)
        (block $h
          (try_table (catch $e $h)
            (call $t (local.get 0))
            (local.set 1 (i32.mul (local.get 0) (i32.const 7)))))
        (i32.add (local.get 1) (i32.mul (local.get 0) (i32.const 7)))))`);
    expect(tees).toBe(0);
    await same(before, after, INPUTS);
  });
});
