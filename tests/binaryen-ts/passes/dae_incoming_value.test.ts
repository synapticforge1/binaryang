// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// DeadArgumentElimination, open-work 31: a parameter whose INCOMING value nothing reads (the
// function writes it before any read, along its straight-line start) goes, and rounds repeat so a
// parameter passed on only to one that went goes too. Each case RUNS the module before and after
// the pass alone, and asserts which parameters remain.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

type Fn = (...a: number[]) => unknown;

function dae(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('DeadArgumentElimination').run();
  const after = writeWasm(m);
  expect(wasmValidate(after, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  const params = (name: string) => m.functions.find((f) => f.name === name)!.sig.params.length;
  return { before, after, params };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    return String(((instance.exports as Record<string, unknown>)['f'] as Fn)(...a));
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

const INPUTS = [[0, 0], [1, 2], [7, -3]];

describe('a parameter whose incoming value nothing reads goes', () => {
  it('written before any read', async () => {
    const { before, after, params } = dae(`(module
      (func $c (param i32 i32) (result i32)
        (local.set 0 (i32.mul (local.get 1) (i32.const 3)))
        (i32.add (local.get 0) (local.get 1)))
      (func (export "f") (param i32 i32) (result i32) (call $c (local.get 0) (local.get 1))))`);
    expect(params('$c')).toBe(1);
    await same(before, after, INPUTS);
  });

  it('and one passed on only to it goes in the next round', async () => {
    const { before, after, params } = dae(`(module
      (func $inner (param i32 i32) (result i32)
        (local.set 0 (i32.const 5))
        (i32.add (local.get 0) (local.get 1)))
      (func $outer (param i32 i32) (result i32) (call $inner (local.get 0) (local.get 1)))
      (func (export "f") (param i32 i32) (result i32) (call $outer (local.get 0) (local.get 1))))`);
    expect(params('$inner')).toBe(1);
    expect(params('$outer')).toBe(1);
    await same(before, after, INPUTS);
  });
});

describe('a parameter whose incoming value may be read stays', () => {
  it('read by the very write that replaces it', async () => {
    const { before, after, params } = dae(`(module
      (func $c (param i32 i32) (result i32)
        (local.set 0 (i32.add (local.get 0) (i32.const 1)))
        (i32.add (local.get 0) (local.get 1)))
      (func (export "f") (param i32 i32) (result i32) (call $c (local.get 0) (local.get 1))))`);
    expect(params('$c')).toBe(2);
    await same(before, after, INPUTS);
  });

  it('written only inside an if: when it is not taken, the caller’s value is read', async () => {
    const { before, after, params } = dae(`(module
      (func $c (param i32 i32) (result i32)
        (if (local.get 1) (then (local.set 0 (i32.const 9))))
        (i32.add (local.get 0) (local.get 1)))
      (func (export "f") (param i32 i32) (result i32) (call $c (local.get 0) (local.get 1))))`);
    expect(params('$c')).toBe(2);
    await same(before, after, INPUTS);
  });
});
