// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// ConstantPropagation, open-work 31 (upstream's rse, for constants): a write of the constant the
// local already holds on every path that reaches it changes nothing — a set goes, a tee is its
// constant. Each case RUNS the module before and after the pass alone, and counts the writes left.

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

function cp(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('ConstantPropagation').add('Vacuum').run();
  const after = writeWasm(m);
  expect(wasmValidate(after, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after, text: wasm2wat(after).text };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    const ex = instance.exports as Record<string, unknown>;
    return `${a} -> ${String((ex['f'] as Fn)(...a))} g=${(ex['g'] as WebAssembly.Global).value}`;
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

const count = (text: string, s: string) => text.split(s).length - 1;
const G = '(global $g (export "g") (mut i32) (i32.const 0))';
const IN = [[0, 0], [1, 5], [7, 0]];

describe('a write of the constant the local already holds goes', () => {
  it('written twice with nothing writing it between, a branch out notwithstanding', async () => {
    const { before, after, text } = cp(`(module ${G}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (local.set $x (i32.const 3))
        (block $out
          (br_if $out (local.get 0))
          (global.set $g (local.get 1)))
        (local.set $x (i32.const 3))
        (global.set $g (i32.add (global.get $g) (local.get $x)))
        (local.get 1)))`);
    expect(count(text, 'local.set')).toBe(1);
    await same(before, after, IN);
  });

  it('a declared local starts at zero: writing zero first changes nothing; a tee is its constant', async () => {
    const { before, after, text } = cp(`(module ${G}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (global.set $g (local.tee $x (i32.const 0)))
        (i32.add (local.get 0) (local.get 1))))`);
    expect(count(text, 'local.tee')).toBe(0);
    await same(before, after, IN);
  });
});

describe('a write stays', () => {
  // 🔧 The -Oz fuzz, seed 163: the first version found redundant writes by their CONSTANT node,
  // and one constant node can be the value of two writes — here a redundant write to $x and a
  // needed one to $y share it, and both went.
  it('when its constant node is shared with a redundant write of another local', async () => {
    const before = wat2wasm(
      `(module ${G}
      (func (export "f") (param i32 i32) (result i32) (local $x i32) (local $y i32)
        (local.set $y (local.get 0))
        (local.set $x (i32.const 3))
        (local.set $x (i32.const 3))
        (local.set $y (i32.const 3))
        (global.set $g (local.get $x))
        (local.get $y)))`,
      { textForm: false },
    ).binary;
    const m = readForPasses(before);
    const body = m.functions[0]!.body.children as { value?: unknown }[];
    body[3]!.value = body[2]!.value; // the write to $y now SHARES the redundant write's constant
    new PassRunner(m, {}).add('ConstantPropagation').add('Vacuum').run();
    const after = writeWasm(m);
    expect(count(wasm2wat(after).text, 'local.set')).toBe(3); // only the second $x write went
    await same(before, after, IN);
  });

  it('when a path wrote another value', async () => {
    const { before, after, text } = cp(`(module ${G}
      (func (export "f") (param i32 i32) (result i32) (local $x i32)
        (local.set $x (i32.const 3))
        (if (local.get 0) (then (local.set $x (local.get 1))))
        (local.set $x (i32.const 3))
        (global.set $g (local.get $x))
        (local.get 1)))`);
    expect(count(text, 'local.set')).toBe(3);
    await same(before, after, IN);
  });

  it('of a parameter: it holds whatever the caller passed', async () => {
    const { before, after, text } = cp(`(module ${G}
      (func (export "f") (param i32 i32) (result i32)
        (local.set 0 (i32.const 0))
        (global.set $g (local.get 1))
        (i32.add (local.get 0) (local.get 1))))`);
    expect(count(text, 'local.set')).toBe(1);
    await same(before, after, IN);
  });
});
