// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedBrs, open-work 31: a branch that goes where falling through would go anyway — the
// last statement of an arm, a loop body or a block in tail position, up to the block it names.
// A `br` there goes, a `br_if` keeps only its condition, and `(br_if $a x) (br $b)` with `$a`
// reached by falling through is `(br_if $b (i32.eqz x))` (six real-compiler modules -Oz −104
// bytes). Each case RUNS the module before and after the pass alone; the controls are a loop's
// back edge, a label a loop shadows, and a block with a result.

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
    return `${a} -> ${(ex['f'] as Fn)(a)} g=${(ex['g'] as WebAssembly.Global).value}`;
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

const count = (text: string, s: string) => text.split(s).length - 1;
const G = '(global $g (export "g") (mut i32) (i32.const 0))';
const BUMP = '(global.set $g (i32.add (global.get $g) (i32.const 1)))';

describe('branches that go where falling through would', () => {
  it("a br ending an arm of the block's last if goes", async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          ${BUMP}
          (if (local.get 0) (then ${BUMP} (br $b)) (else ${BUMP} ${BUMP})))
        (global.get $g)))`);
    expect(count(text, '(br ')).toBe(0);
    await same(before, after, [0, 1]);
  });

  it('a br ending a loop body leaves the loop the same way', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          (loop $l
            ${BUMP}
            (br_if $l (i32.lt_u (global.get $g) (local.get 0)))
            (br $b)))
        (global.get $g)))`);
    expect(count(text, '(br ')).toBe(0);
    await same(before, after, [0, 3]);
  });

  it('(br_if $a x) (br $b), $a reached by falling through: one br_if to $b', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          (block $a
            (if (i32.ne (local.get 0) (i32.const 0))
              (then ${BUMP} (br_if $a (i32.eq (local.get 0) (i32.const 2))) (br $b))))
          (global.set $g (i32.add (global.get $g) (i32.const 10))))
        (global.get $g)))`);
    expect(count(text, 'br_if')).toBe(1);
    expect(count(text, '(br ')).toBe(0);
    await same(before, after, [0, 1, 2]);
  });

  it('a br_if there keeps its condition, side effects and all', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func $side (result i32) ${BUMP} (global.get $g))
      (func (export "f") (param i32) (result i32)
        (block $b
          (if (local.get 0) (then (br_if $b (call $side)))))
        (global.get $g)))`);
    expect(count(text, 'br_if')).toBe(0);
    expect(count(text, 'call')).toBe(1);
    await same(before, after, [0, 1]);
  });

  it("a loop's back edge stays (control)", async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          (loop $l
            ${BUMP}
            (if (i32.lt_u (global.get $g) (local.get 0)) (then (br $l)))))
        (global.get $g)))`);
    // The `if` becomes a `br_if` (an older rule); the branch itself stays.
    expect(count(text, '(br')).toBe(1);
    await same(before, after, [0, 4]);
  });

  it("a label a loop shadows is the loop's (control)", async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b
          (loop $b
            ${BUMP}
            (if (i32.lt_u (global.get $g) (local.get 0)) (then (br $b)))))
        (global.get $g)))`);
    expect(count(text, '(br')).toBe(1);
    await same(before, after, [0, 5]);
  });

  // The pass also refuses to pass a VALUED block's end down to its statements. No valid module
  // can reach that guard — a void list cannot end in a valued block, and a valueless `br` to a
  // valued block does not validate — so no test here can fail without it (a mutant removing it
  // survives); it stands for a tree a pass builds by hand.
  it('a block with a result keeps its branches (control)', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $b (result i32)
          (if (local.get 0) (then ${BUMP} (br $b (i32.const 7))))
          (i32.const 8))))`);
    expect(count(text, '(br ')).toBe(1);
    await same(before, after, [0, 1]);
  });
});
