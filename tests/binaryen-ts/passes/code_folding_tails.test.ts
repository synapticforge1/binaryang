// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// CodeFolding, open-work 30 step 2: what several places end with before an `unreachable` (Zig's
// debug builds end every failed check with `(call $panic …) (unreachable)`) is written once, at the
// function's end. Each case RUNS the module before and after the pass alone — the result, or the
// trap and how far the side effects got — and asserts whether the fold happened.

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

function fold(wat: string) {
  const before = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('CodeFolding').run();
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out, { features: allFeatures() }).text };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[]) {
  const run = async (b: Uint8Array, a: number) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    const ex = instance.exports as Record<string, unknown>;
    let r: string;
    try {
      r = String((ex['f'] as Fn)(a));
    } catch (e) {
      r = `${e instanceof WebAssembly.RuntimeError ? 'trap' : 'threw'}: ${(e as Error).message}`;
    }
    return `${a} -> ${r} g=${(ex['g'] as WebAssembly.Global).value}`;
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

const count = (text: string, s: string) => text.split(s).length - 1;

/** `$p` records its argument in `g` (so how far a run got is visible) and returns. */
const PANIC = `(global $g (export "g") (mut i32) (i32.const 0))
  (func $p (param i32 i32) (global.set $g (i32.add (local.get 0) (local.get 1))))`;

describe('identical terminating tails are written once', () => {
  it('three failed checks calling the same panic', async () => {
    const { before, after, text } = fold(`(module ${PANIC}
      (func (export "f") (param i32) (result i32)
        (if (i32.eq (local.get 0) (i32.const 1))
          (then (call $p (local.get 0) (i32.const 100)) (unreachable)))
        (if (i32.eq (local.get 0) (i32.const 2))
          (then (global.set $g (i32.const 5)) (call $p (local.get 0) (i32.const 100)) (unreachable)))
        (block $b
          (br_if $b (i32.ne (local.get 0) (i32.const 3)))
          (call $p (local.get 0) (i32.const 100))
          (unreachable))
        (i32.mul (local.get 0) (i32.const 10))))`);
    // Names do not survive an optimizing run without `debugInfo`: count instructions.
    expect(count(text, 'call ')).toBe(1);
    expect(count(text, 'unreachable')).toBe(1);
    await same(before, after, [0, 1, 2, 3, 4]);
  });

  it('the body itself may be one of the tails', async () => {
    const { before, after, text } = fold(`(module ${PANIC}
      (func (export "f") (param i32)
        (if (local.get 0) (then (call $p (local.get 0) (i32.const 7)) (unreachable)))
        (if (i32.eqz (local.get 0)) (then (call $p (local.get 0) (i32.const 7)) (unreachable)))
        (call $p (local.get 0) (i32.const 7))
        (unreachable)))`);
    expect(count(text, 'call ')).toBe(1);
    await same(before, after, [0, 1, 2]);
  });
});

describe('not folded', () => {
  it('when it does not pay: two one-node tails', async () => {
    const { before, after, text } = fold(`(module ${PANIC}
      (func (export "f") (param i32) (result i32)
        (if (local.get 0) (then (global.set $g (i32.const 1)) (unreachable)))
        (if (i32.eqz (local.get 0)) (then (global.set $g (i32.const 2)) (unreachable)))
        (i32.const 9)))`);
    expect(count(text, 'unreachable')).toBe(2);
    await same(before, after, [0, 1]);
  });

  it('an item that branches out of itself stays where its label is', async () => {
    const { before, after, text } = fold(`(module ${PANIC}
      (func (export "f") (param i32) (result i32)
        (block $out
          (if (i32.eq (local.get 0) (i32.const 1))
            (then (block (br_if $out (i32.const 1)) (call $p (local.get 0) (i32.const 1))) (unreachable)))
          (if (i32.eq (local.get 0) (i32.const 2))
            (then (block (br_if $out (i32.const 1)) (call $p (local.get 0) (i32.const 1))) (unreachable)))
          (if (i32.eq (local.get 0) (i32.const 3))
            (then (block (br_if $out (i32.const 1)) (call $p (local.get 0) (i32.const 1))) (unreachable))))
        (i32.const 9)))`);
    expect(count(text, 'br_if ')).toBe(3);
    await same(before, after, [0, 1, 2, 3]);
  });

  it('inside a function with a try_table: a call moved out would no longer be caught', async () => {
    const { before, after, text } = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (tag $e)
      (func $t (param i32 i32) (global.set $g (local.get 0)) (throw $e))
      (func (export "f") (param i32) (result i32)
        (block $h
          (try_table (catch_all $h)
            (if (i32.eq (local.get 0) (i32.const 1))
              (then (call $t (local.get 0) (local.get 0)) (unreachable)))
            (if (i32.eq (local.get 0) (i32.const 2))
              (then (call $t (local.get 0) (local.get 0)) (unreachable)))
            (if (i32.eq (local.get 0) (i32.const 3))
              (then (call $t (local.get 0) (local.get 0)) (unreachable))))
          (return (i32.const 0)))
        (i32.const 7)))`);
    expect(count(text, 'call ')).toBe(3);
    await same(before, after, [0, 1, 2, 3]);
  });
});
