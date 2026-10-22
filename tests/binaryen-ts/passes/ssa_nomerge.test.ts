// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// SSANoMerge, open-work 31 step 16: a local reused for several values becomes one local per
// value, where no read can see two of them. The shape that pays is Zig's debug output: one local
// reused across panic checks, so equal panic calls read different locals and cannot fold until
// CoalesceLocals re-assigns them.
//
// Each case RUNS the module before and after. The controls are what the pass must leave: a read
// two sets can reach (a merge, after an `if`) keeps both sets on the old local; a local already
// in SSA form; a read no path reaches (its local stays whole); a function with a `try_table`.

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

function run(wat: string) {
  const before = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
  const m = readForPasses(before);
  const declared = m.functions[0]!.locals.length;
  new PassRunner(m, {}).add('SSANoMerge').run();
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return {
    before,
    after: out,
    text: wasm2wat(out).text,
    added: m.functions[0]!.locals.length - declared,
  };
}

async function same(before: Uint8Array, after: Uint8Array) {
  const call = async (b: Uint8Array, x: number, y: number) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    try {
      return String(((instance.exports as Record<string, unknown>)['f'] as Fn)(x, y));
    } catch (e) {
      return `${e instanceof WebAssembly.RuntimeError ? 'trap' : 'threw'}: ${(e as Error).message}`;
    }
  };
  for (const [x, y] of [[0, 0], [3, 4], [7, 0], [-1, 9]] as const) {
    expect(await call(after, x, y)).toBe(await call(before, x, y));
  }
}

const count = (text: string, s: string) => text.split(s).length - 1;

describe('each value of a reused local gets its own local', () => {
  it('two values, one after the other: the second moves', async () => {
    const { before, after, text, added } = run(`(module
      (func (export "f") (param i32 i32) (result i32) (local i32 i32)
        (local.set 2 (i32.add (local.get 0) (local.get 1)))
        (local.set 3 (i32.mul (local.get 2) (local.get 2)))
        (local.set 2 (i32.sub (local.get 0) (local.get 1)))
        (i32.add (local.get 3) (i32.mul (local.get 2) (local.get 2)))))`);
    // Local 2's two values each get a fresh local (4 and 5); local 3, set once, stays.
    expect(added).toBe(2);
    expect(count(text, 'local.get 2')).toBe(0);
    expect(count(text, 'local.get 4')).toBe(2);
    expect(count(text, 'local.get 5')).toBe(2);
    expect(count(text, 'local.get 3')).toBe(1);
    await same(before, after);
  });

  it('a tee is a value too', async () => {
    const { before, after, text, added } = run(`(module
      (func (export "f") (param i32 i32) (result i32) (local i32)
        (drop (i32.add (local.tee 2 (local.get 0)) (local.get 2)))
        (i32.mul (local.tee 2 (local.get 1)) (local.get 2))))`);
    expect(added).toBe(2);
    expect(count(text, 'local.tee 2')).toBe(0);
    await same(before, after);
  });

  it('a parameter written again: the later value moves, the argument stays', async () => {
    const { before, after, text, added } = run(`(module
      (func (export "f") (param i32 i32) (result i32)
        (local.set 1 (i32.add (local.get 0) (local.get 1)))
        (i32.mul (local.get 1) (local.get 1))))`);
    expect(added).toBe(1);
    // The argument is read once, by the add; the new value twice, from the fresh local.
    expect(count(text, 'local.get 1')).toBe(1);
    expect(count(text, 'local.get 2')).toBe(2);
    await same(before, after);
  });
});

describe('what stays on the old local', () => {
  it('a merge: the two arms set what one read sees, so both sets stay', async () => {
    const { before, after, text, added } = run(`(module
      (func (export "f") (param i32 i32) (result i32) (local i32 i32)
        (if (local.get 0)
          (then (local.set 2 (local.get 1)))
          (else (local.set 2 (i32.const 5))))
        (local.set 3 (local.get 2))
        (local.set 2 (i32.const 9))
        (i32.add (local.get 3) (local.get 2))))`);
    // Only the third set, which no merged read sees, moves. (Local 3, set once, is SSA already;
    // a parameter written here would move too, its argument being a second value.)
    expect(added).toBe(1);
    expect(count(text, 'local.set 2')).toBe(2);
    expect(count(text, 'local.get 2')).toBe(1);
    await same(before, after);
  });

  it('a read the entry value and a set both reach is a merge too', async () => {
    const { before, after, added } = run(`(module
      (func (export "f") (param i32 i32) (result i32) (local i32)
        (if (local.get 0) (then (local.set 2 (local.get 1))))
        (local.get 2)))`);
    expect(added).toBe(0);
    await same(before, after);
  });

  it('a local in SSA form already is left as it is', () => {
    const { added } = run(`(module
      (func (export "f") (param i32 i32) (result i32) (local i32)
        (local.set 2 (i32.add (local.get 0) (local.get 1)))
        (i32.mul (local.get 2) (local.get 2))))`);
    expect(added).toBe(0);
  });

  it('a declared local read before its set: the entry zero is a value, the set moves', async () => {
    const { before, after, added } = run(`(module
      (func (export "f") (param i32 i32) (result i32) (local i32 i32)
        (local.set 3 (i32.add (local.get 2) (local.get 1)))
        (local.set 2 (local.get 0))
        (i32.add (local.get 3) (local.get 2))))`);
    expect(added).toBe(1);
    await same(before, after);
  });

  it('a read no path reaches keeps its local whole', async () => {
    const { before, after, added } = run(`(module
      (func (export "f") (param i32 i32) (result i32) (local i32)
        (local.set 2 (local.get 0))
        (local.set 1 (local.get 2))
        (local.set 2 (local.get 1))
        (block (br 0) (drop (local.get 2)))
        (local.get 2)))`);
    expect(added).toBe(0);
    await same(before, after);
  });

  it('a function with a try_table is left alone', async () => {
    const { before, after, added } = run(`(module
      (func (export "f") (param i32 i32) (result i32) (local i32)
        (local.set 2 (local.get 0))
        (local.set 1 (local.get 2))
        (local.set 2 (local.get 1))
        (block (try_table (catch_all 0) (nop)))
        (local.get 2)))`);
    expect(added).toBe(0);
    await same(before, after);
  });
});
