// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// DeadArgumentElimination (open-work 2, step 4b). Changing a signature is
// where a call site left behind or a local renumbered wrong yields a module
// that is VALID and computes something else, so every case RUNS the module
// before and after the pass alone — and asserts the parameter count, so a
// case where nothing was removed proves nothing.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

type Fn = (...a: number[]) => unknown;

/** The module before and after DAE, and each function's param count after, by name. */
function dae(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('DeadArgumentElimination').run();
  const params = Object.fromEntries(m.functions.map((f) => [f.name, f.sig.params.length]));
  const after = writeWasm(m);
  const { errors } = wasmValidate(after, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { before, after, params };
}

async function same(before: Uint8Array, after: Uint8Array, name: string, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource);
    const ex = instance.exports as Record<string, unknown>;
    let r: string;
    try {
      r = String((ex[name] as Fn)(...a));
    } catch (e) {
      r = `trap: ${(e as Error).message}`;
    }
    const g = ex.g instanceof WebAssembly.Global ? ` g=${ex.g.value}` : '';
    return `${a} -> ${r}${g}`;
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

const INPUTS = [[0], [1], [-1], [7], [0x7fffffff]];

describe('a parameter nothing reads goes', () => {
  it('and every call loses its operand', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param i32 i32) (result i32) (i32.mul (local.get 1) (i32.const 3)))
      (func (export "run") (param i32) (result i32)
        (i32.add (call $f (local.get 0) (local.get 0)) (call $f (i32.const 9) (local.get 0)))))`);
    expect(params.$f).toBe(1);
    await same(before, after, 'run', INPUTS);
  });

  it('a call nested in the operand of another changed call loses its operand too', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param i32 i32) (result i32) (i32.add (local.get 0) (i32.const 1)))
      (func $g (param i32 i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))
      (func (export "run") (param i32) (result i32)
        (call $g (call $f (local.get 0) (local.get 0)) (local.get 0))))`);
    expect([params.$f, params.$g]).toEqual([1, 1]);
    await same(before, after, 'run', INPUTS);
  });

  it('the middle one, with locals after it renumbered', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param i32 i32 i32) (result i32) (local i32)
        (local.set 3 (i32.sub (local.get 0) (local.get 2)))
        (i32.mul (local.get 3) (local.get 2)))
      (func (export "run") (param i32) (result i32)
        (call $f (local.get 0) (i32.const 1000) (i32.add (local.get 0) (i32.const 5)))))`);
    expect(params.$f).toBe(2);
    await same(before, after, 'run', INPUTS);
  });

  it('one only WRITTEN goes too, and the write stays valid', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param i32 i32) (result i32)
        (local.set 1 (i32.const 4))
        (i32.add (local.get 0) (i32.const 1)))
      (func (export "run") (param i32) (result i32)
        (call $f (local.get 0) (local.get 0))))`);
    expect(params.$f).toBe(1);
    await same(before, after, 'run', INPUTS);
  });

  it('NOT when an operand has an effect (it would be lost)', async () => {
    const { before, after, params } = dae(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func $bump (result i32) (global.set $g (i32.add (global.get $g) (i32.const 1))) (global.get $g))
      (func $f (param i32 i32) (result i32) (local.get 0))
      (func (export "run") (param i32) (result i32)
        (call $f (local.get 0) (call $bump))))`);
    expect(params.$f).toBe(2);
    await same(before, after, 'run', INPUTS);
  });
});

describe('a parameter always passed the same constant becomes a local set to it', () => {
  it('read in the body; the constant arrives', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
      (func (export "run") (param i32) (result i32)
        (i32.mul (call $f (local.get 0) (i32.const 40)) (call $f (i32.const 2) (i32.const 40)))))`);
    expect(params.$f).toBe(1);
    await same(before, after, 'run', INPUTS);
  });

  it('NOT when the constants differ', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param i32) (result i32) (local.get 0))
      (func (export "run") (result i32)
        (i32.add (call $f (i32.const 1)) (call $f (i32.const 2)))))`);
    expect(params.$f).toBe(1);
    await same(before, after, 'run', [[]]);
  });

  it('NOT for -0 and 0, which compare equal and are not the same', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param f64) (result f64) (f64.div (f64.const 1) (local.get 0)))
      (func (export "run") (result f64)
        (f64.add (call $f (f64.const 0)) (call $f (f64.const -0)))))`);
    expect(params.$f).toBe(1);
    await same(before, after, 'run', [[]]);
  });

  it('a recursive function, its own call included', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param i32 i32) (result i32)
        (if (result i32) (i32.eqz (local.get 0))
          (then (local.get 1))
          (else (i32.add (local.get 1) (call $f (i32.sub (local.get 0) (i32.const 1)) (i32.const 3))))))
      (func (export "run") (param i32) (result i32)
        (call $f (i32.and (local.get 0) (i32.const 15)) (i32.const 3))))`);
    expect(params.$f).toBe(1);
    await same(before, after, 'run', INPUTS);
  });

  it('through a return_call', async () => {
    const { before, after, params } = dae(`(module
      (func $f (param i32 i32) (result i32) (i32.sub (local.get 0) (local.get 1)))
      (func (export "run") (param i32) (result i32)
        (return_call $f (local.get 0) (i32.const 8))))`);
    expect(params.$f).toBe(1);
    await same(before, after, 'run', INPUTS);
  });
});

describe('a function reached other than by a direct call keeps its signature', () => {
  it('exported', () => {
    const { params } = dae(`(module
      (func $f (export "f") (param i32) (result i32) (i32.const 1))
      (func (export "run") (result i32) (call $f (i32.const 2))))`);
    expect(params.$f).toBe(1);
  });

  it('in a table, called indirectly', async () => {
    const { before, after, params } = dae(`(module
      (type $t (func (param i32 i32) (result i32)))
      (table 1 funcref) (elem (i32.const 0) $f)
      (func $f (type $t) (i32.add (local.get 0) (i32.const 1)))
      (func (export "run") (param i32) (result i32)
        (i32.add (call $f (local.get 0) (i32.const 5))
          (call_indirect (type $t) (local.get 0) (i32.const 5) (i32.const 0)))))`);
    expect(params.$f).toBe(2);
    await same(before, after, 'run', INPUTS);
  });

  it('named by a ref.func', () => {
    const { params } = dae(`(module
      (func $f (param i32) (result i32) (i32.const 1))
      (elem declare func $f)
      (func (export "run") (result i32)
        (drop (ref.func $f))
        (call $f (i32.const 2))))`);
    expect(params.$f).toBe(1);
  });
});
