// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// CodeFolding, open-work 31: what every way into a block's `end` ends with — its fall-through and
// each plain `br` to it — is written once, after the block (upstream's CodeFolding `visitBlock`;
// six real-compiler modules -Oz −298 bytes). Each case RUNS the module before and after the pass
// alone and asserts whether the fold happened; the controls are the ways in whose tail cannot be
// cut (a `br_if`), a tail that branches out, a shadowed label, and a `try`.

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
/** The shared tail: two statements, so the fold is visible as one copy of each. */
const T = `(global.set $g (i32.add (global.get $g) (i32.const 40)))
           (global.set $g (i32.mul (global.get $g) (i32.const 3)))`;

describe('the tails before the branches to a block', () => {
  it('a br and the fall-through, the same tail: written once, after the block', async () => {
    const { before, after, text } = fold(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          (if (local.get 0) (then (global.set $g (i32.const 1)) ${T} (br $b)))
          (global.set $g (i32.const 2))
          ${T})
        (global.get $g)))`);
    expect(count(text, 'i32.const 40')).toBe(1);
    await same(before, after, [0, 1]);
  });

  it('two brs, no fall-through', async () => {
    const { before, after, text } = fold(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          (if (i32.eq (local.get 0) (i32.const 1))
            (then (global.set $g (i32.const 1)) ${T} (br $b)))
          (if (i32.eq (local.get 0) (i32.const 2))
            (then (global.set $g (i32.const 2)) ${T} (br $b)))
          (unreachable))
        (global.get $g)))`);
    expect(count(text, 'i32.const 40')).toBe(1);
    await same(before, after, [0, 1, 2]);
  });

  it('a br_if to the block: a way in whose tail cannot be cut (control)', async () => {
    const { before, after, text } = fold(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          (br_if $b (i32.eq (local.get 0) (i32.const 7)))
          (if (local.get 0) (then (global.set $g (i32.const 1)) ${T} (br $b)))
          (global.set $g (i32.const 2))
          ${T})
        (global.get $g)))`);
    expect(count(text, 'i32.const 40')).toBe(2);
    await same(before, after, [0, 1, 7]);
  });

  it('a tail statement that branches out stays (control)', async () => {
    const { before, after, text } = fold(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $out
          (block $b
            (if (local.get 0)
              (then (global.set $g (i32.const 1)) (br_if $out (i32.eq (local.get 0) (i32.const 5)))
                (br $b)))
            (global.set $g (i32.const 2))
            (br_if $out (i32.eq (local.get 0) (i32.const 5))))
          (global.set $g (i32.const 9)))
        (global.get $g)))`);
    expect(count(text, 'i32.const 5')).toBe(2);
    await same(before, after, [0, 1, 5]);
  });

  it('a shadowed label is left alone (control)', async () => {
    const { before, after, text } = fold(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          (block $b
            (if (local.get 0) (then (global.set $g (i32.const 1)) ${T} (br $b)))
            (global.set $g (i32.const 2))
            ${T})
          (global.set $g (i32.add (global.get $g) (i32.const 1))))
        (global.get $g)))`);
    expect(count(text, 'i32.const 40')).toBe(2);
    await same(before, after, [0, 1]);
  });

  it('not in a function holding a try (control)', async () => {
    const { before, after, text } = fold(`(module ${G} (tag $e)
      (func (export "f") (param i32) (result i32)
        (block (try_table (catch_all 0) (nop)))
        (block $b
          (if (local.get 0) (then (global.set $g (i32.const 1)) ${T} (br $b)))
          (global.set $g (i32.const 2))
          ${T})
        (global.get $g)))`);
    expect(count(text, 'i32.const 40')).toBe(2);
    await same(before, after, [0, 1]);
  });
});
