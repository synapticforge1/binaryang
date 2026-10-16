// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Local2Stack, open-work 31 (`passes/stack-ir.ts`, upstream's StackIR): the writer leaves out a
// `local.set` and its one `local.get` when the value can stay on the stack between them. Each case
// writes the SAME tree with and without `stackIR`, asserts the bytes saved (4 per pair: two
// opcodes, two indices), and RUNS both — results, traps, and the exported global.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

type Fn = (...a: number[]) => unknown;

function both(wat: string) {
  const bin = wat2wasm(wat, { textForm: false }).binary;
  const plain = writeWasm(readForPasses(bin));
  const m = readForPasses(bin);
  m.optimizeStack = true;
  const stacked = writeWasm(m);
  expect(wasmValidate(stacked, { features: allFeatures() }).errors.map((e) => e.message)).toEqual(
    [],
  );
  return { plain, stacked, saved: plain.length - stacked.length };
}

async function same(a: Uint8Array, b: Uint8Array, inputs: number[][]) {
  const run = async (bytes: Uint8Array, args: number[]) => {
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
    const ex = instance.exports as Record<string, unknown>;
    const g = () => (ex['g'] instanceof WebAssembly.Global ? ` g=${ex['g'].value}` : '');
    try {
      return `${args} -> ${String((ex['f'] as Fn)(...args))}${g()}`;
    } catch (e) {
      return `${args} -> trap: ${(e as Error).message}${g()}`;
    }
  };
  for (const args of inputs) expect(await run(b, args)).toBe(await run(a, args));
}

const HEAD = `(module (memory 1) (global $g (export "g") (mut i32) (i32.const 0))`;
const IN = [[0, 1], [4, 9], [70000, 2]];

describe('the pair goes, the value stays on the stack', () => {
  it('across a statement that leaves the stack as it found it', async () => {
    const { plain, stacked, saved } = both(`${HEAD}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (local.set $x (i32.load (local.get 0)))
        (global.set $g (local.get 1))
        (i32.add (local.get $x) (i32.const 1))))`);
    expect(saved).toBe(4);
    await same(plain, stacked, IN);
  });

  it('two in a row, used in order: both pairs, the operands keep their order', async () => {
    const { plain, stacked, saved } = both(`${HEAD}
      (func (export "f") (param i32 i32) (result i32) (local $a i32) (local $b i32)
        (local.set $a (i32.mul (local.get 0) (i32.const 3)))
        (local.set $b (i32.add (local.get 1) (i32.const 5)))
        (i32.sub (local.get $a) (local.get $b))))`);
    expect(saved).toBe(8);
    await same(plain, stacked, IN);
  });

  it('into the condition of an if', async () => {
    const { plain, stacked, saved } = both(`${HEAD}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (local.set $x (i32.lt_u (local.get 0) (local.get 1)))
        (if (result i32) (local.get $x) (then (i32.const 10)) (else (i32.const 20)))))`);
    expect(saved).toBe(4);
    await same(plain, stacked, IN);
  });
});

describe('when the writer does it', () => {
  it('after an optimizing run at -O3, -Os or -Oz, as upstream; not -O1 or -O2', () => {
    const bin = wat2wasm('(module (func (export "f") (result i32) (i32.const 1)))', {
      textForm: false,
    }).binary;
    const asked = (optimizeLevel: 0 | 1 | 2 | 3 | 4, shrinkLevel: 0 | 1 | 2) => {
      const m = readForPasses(bin);
      new PassRunner(m, { optimizeLevel, shrinkLevel }).addDefaultOptimizationPasses().run();
      return m.optimizeStack === true;
    };
    expect([asked(1, 0), asked(2, 0), asked(3, 0), asked(2, 1), asked(2, 2)])
      .toEqual([false, false, true, true, true]);
    expect(readForPasses(bin).optimizeStack).toBeUndefined(); // a plain read and write: no
  });
});

describe('the pair stays', () => {
  it('when the local is read again', async () => {
    const { plain, stacked, saved } = both(`${HEAD}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (local.set $x (i32.add (local.get 0) (local.get 1)))
        (global.set $g (local.get $x))
        (i32.add (local.get $x) (i32.const 1))))`);
    expect(saved).toBe(0);
    await same(plain, stacked, IN);
  });

  it('when another write may reach the read', async () => {
    const { plain, stacked, saved } = both(`${HEAD}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (local.set $x (i32.add (local.get 0) (i32.const 1)))
        (if (local.get 1) (then (local.set $x (i32.const 77))))
        (local.get $x)))`);
    expect(saved).toBe(0);
    await same(plain, stacked, IN);
  });

  it('when an actual value is pushed before the read', async () => {
    const { plain, stacked, saved } = both(`${HEAD}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (local.set $x (i32.add (local.get 0) (i32.const 1)))
        (i32.sub (local.get 1) (local.get $x))))`);
    expect(saved).toBe(0);
    await same(plain, stacked, IN);
  });

  it('when the read is inside a block: the stack before it is out of reach', async () => {
    const { plain, stacked, saved } = both(`${HEAD}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (local.set $x (i32.add (local.get 0) (i32.const 1)))
        (block (result i32) (i32.add (local.get $x) (local.get 1)))))`);
    expect(saved).toBe(0);
    await same(plain, stacked, IN);
  });
});
