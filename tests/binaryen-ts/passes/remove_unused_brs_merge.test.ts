// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedBrs, open-work 31 step 14: two ways upstream needs fewer branches than ours did.
//
//   - A block that is the last statement of a void block ends where that block ends: its branches
//     go to the outer label (upstream merges the names), and the inner block is left unnamed.
//   - Adjacent `br_if`s to one label are one `br_if` on `i32.or` of their conditions — and so is a
//     `br_if` followed by an `if` holding only a `br_if` to the same label, with a `select`. The
//     second condition then runs even when the first held, so it must do nothing and not trap.
//
// Each block starts with a statement, so the older rule that turns a block starting with a `br_if`
// into an `if` leaves the shape under test alone. Each case RUNS the module before and after the
// pass alone; the controls are an inner block
// that is not last, a second condition with a side effect or a possible trap, and an impure `if`.

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

function rub(wat: string) {
  const before = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('RemoveUnusedBrs').run();
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text };
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
const G = '(global $g (export "g") (mut i32) (i32.const 0))';
const BUMP = '(global.set $g (i32.add (global.get $g) (i32.const 1)))';
const EQ = (n: number) => `(i32.eq (local.get 0) (i32.const ${n}))`;

describe('a block that ends where its parent ends', () => {
  it('its branches go to the parent', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $a
          ${BUMP}
          (block $b
            ${BUMP}
            (br_if $b ${EQ(1)})
            ${BUMP}))
        (global.get $g)))`);
    expect(count(text, 'br_if 1')).toBe(1); // to $a, past the now unnamed inner block
    await same(before, after, [0, 1]);
  });

  it('not when something follows it in the parent (control)', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $a
          (block $b
            ${BUMP}
            (br_if $b ${EQ(1)})
            ${BUMP})
          ${BUMP})
        (global.get $g)))`);
    expect(count(text, 'br_if 0')).toBe(1);
    await same(before, after, [0, 1]);
  });
});

describe('adjacent br_ifs to one label', () => {
  it('become one, on i32.or', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $l
          ${BUMP}
          (br_if $l ${EQ(1)})
          (br_if $l ${EQ(2)})
          ${BUMP})
        (global.get $g)))`);
    expect(count(text, 'br_if')).toBe(1);
    expect(count(text, 'i32.or')).toBe(1);
    await same(before, after, [0, 1, 2, 3]);
  });

  it('and an if holding only such a br_if, through a select', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $l
          ${BUMP}
          (br_if $l ${EQ(1)})
          (if (i32.gt_u (local.get 0) (i32.const 4)) (then (br_if $l ${EQ(7)})))
          ${BUMP})
        (global.get $g)))`);
    expect(count(text, 'br_if')).toBe(1);
    expect(count(text, 'select')).toBe(1);
    await same(before, after, [0, 1, 3, 5, 7]);
  });

  it('not when they go to different labels (control)', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $m
          (block $l
            ${BUMP}
            (br_if $l ${EQ(1)})
            (br_if $m ${EQ(2)})
            ${BUMP})
          ${BUMP})
        (global.get $g)))`);
    expect(count(text, 'i32.or')).toBe(0);
    await same(before, after, [0, 1, 2]);
  });

  it('not when the second condition has an effect (control)', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func $side (result i32) ${BUMP} (i32.const 0))
      (func (export "f") (param i32) (result i32)
        (block $l
          ${BUMP}
          (br_if $l ${EQ(1)})
          (br_if $l (call $side))
          ${BUMP})
        (global.get $g)))`);
    expect(count(text, 'br_if')).toBe(2);
    await same(before, after, [0, 1]);
  });

  it('not when the second condition may trap (control)', async () => {
    const { before, after, text } = rub(`(module ${G} (memory 1)
      (func (export "f") (param i32) (result i32)
        (block $l
          ${BUMP}
          (br_if $l ${EQ(1)})
          (br_if $l (i32.load (i32.mul (local.get 0) (i32.const 65536))))
          ${BUMP})
        (global.get $g)))`);
    expect(count(text, 'br_if')).toBe(2);
    await same(before, after, [0, 1]);
  });

  it('not when the if condition has an effect (control)', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func $side (result i32) ${BUMP} (i32.const 1))
      (func (export "f") (param i32) (result i32)
        (block $l
          ${BUMP}
          (br_if $l ${EQ(1)})
          (if (call $side) (then (br_if $l ${EQ(7)}))))
        (global.get $g)))`);
    expect(count(text, 'select')).toBe(0);
    await same(before, after, [0, 1, 7]);
  });
});
