// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// CodeFolding, open-work 2 step 6c: what both arms of an `if` end with is
// written once, after the `if`. Each case RUNS the module before and after
// the pass alone, and asserts whether the fold happened.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

type Fn = (...a: number[]) => unknown;
function fold(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('CodeFolding').run();
  const out = writeWasm(m);
  const { errors } = wasmValidate(out, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text, bytes: out.length - before.length };
}
async function same(before: Uint8Array, after: Uint8Array, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource);
    const ex = instance.exports as Record<string, unknown>;
    let r: string;
    try {
      r = String((ex.f as Fn)(...a));
    } catch (e) {
      r = `trap: ${(e as Error).message}`;
    }
    const g = ex.g instanceof WebAssembly.Global ? ` g=${ex.g.value}` : '';
    return `${a} -> ${r}${g}`;
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}
const INPUTS = [[0], [1], [2], [-1], [7]];
const count = (text: string, s: string) => text.split(s).length - 1;

describe('the statements both arms end with move after the if', () => {
  it('two equal tail statements, the arms keep what differs', async () => {
    const { before, after, text, bytes } = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "f") (param i32) (result i32) (local i32)
        (if (local.get 0)
          (then
            (local.set 1 (i32.const 10))
            (global.set $g (i32.add (local.get 1) (local.get 0)))
            (local.set 1 (i32.mul (local.get 1) (i32.const 3))))
          (else
            (local.set 1 (i32.const 20))
            (global.set $g (i32.add (local.get 1) (local.get 0)))
            (local.set 1 (i32.mul (local.get 1) (i32.const 3)))))
        (local.get 1)))`);
    expect(count(text, 'global.set')).toBe(1);
    expect(count(text, 'i32.mul')).toBe(1);
    expect(count(text, 'i32.const 10')).toBe(1);
    expect(bytes).toBeLessThan(0);
    await same(before, after, INPUTS);
  });

  it('a tail that is a whole if, or a call: structural equality, not the kind', async () => {
    const { before, after, text } = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func $h (param i32) (global.set $g (i32.add (global.get $g) (local.get 0))))
      (func (export "f") (param i32) (result i32)
        (if (i32.lt_s (local.get 0) (i32.const 3))
          (then
            (call $h (i32.const 1))
            (if (i32.eqz (local.get 0)) (then (call $h (i32.const 100))) (else (call $h (i32.const 7)))))
          (else
            (call $h (i32.const 2))
            (if (i32.eqz (local.get 0)) (then (call $h (i32.const 100))) (else (call $h (i32.const 7))))))
        (global.get $g)))`);
    expect(count(text, 'i32.const 100')).toBe(1);
    expect(count(text, 'i32.const 7')).toBe(1);
    await same(before, after, INPUTS);
  });

  it('NOT when the tails differ, however slightly; NOT an if with a result', async () => {
    const differ = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "f") (param i32)
        (if (local.get 0)
          (then (global.set $g (i32.const 1)))
          (else (global.set $g (i32.const 2))))))`);
    expect(count(differ.text, 'global.set')).toBe(2);
    await same(differ.before, differ.after, INPUTS);
    const result = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "f") (param i32) (result i32)
        (if (result i32) (local.get 0)
          (then (global.set $g (i32.const 1)) (i32.const 5))
          (else (global.set $g (i32.const 2)) (i32.const 5)))))`);
    expect(count(result.text, 'i32.const 5')).toBe(2);
    await same(result.before, result.after, INPUTS);
  });

  it('NOT a tail before a branch to the if; one that branches outward moves; labels by position', async () => {
    // The blocks differ only in their labels' NAMES: structurally one tail,
    // which moves whole — its label and the branch to it inside it.
    const inner = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "f") (param i32)
        (if (local.get 0)
          (then (global.set $g (i32.const 1))
            (block $a (br_if $a (i32.eq (local.get 0) (i32.const 7))) (global.set $g (i32.const 9))))
          (else (global.set $g (i32.const 2))
            (block $b (br_if $b (i32.eq (local.get 0) (i32.const 7))) (global.set $g (i32.const 9)))))))`);
    expect(count(inner.text, 'i32.const 9')).toBe(1);
    expect(count(inner.text, '(block')).toBe(1);
    await same(inner.before, inner.after, INPUTS);
    const self = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "f") (param i32)
        (if $i (local.get 0)
          (then (global.set $g (i32.const 1)) (br_if $i (i32.eq (local.get 0) (i32.const 7))) (global.set $g (i32.const 9)))
          (else (global.set $g (i32.const 2)) (br_if $i (i32.eq (local.get 0) (i32.const 7))) (global.set $g (i32.const 9))))))`);
    expect(count(self.text, 'i32.const 9')).toBe(2);
    await same(self.before, self.after, INPUTS);
    const outward = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "f") (param i32)
        (block $out
          (if (local.get 0)
            (then (global.set $g (i32.const 1)) (br_if $out (i32.eq (local.get 0) (i32.const 7))) (global.set $g (i32.const 9)))
            (else (global.set $g (i32.const 2)) (br_if $out (i32.eq (local.get 0) (i32.const 7))) (global.set $g (i32.const 9))))
          (global.set $g (i32.add (global.get $g) (i32.const 100))))))`);
    expect(count(outward.text, 'i32.const 9')).toBe(1);
    expect(count(outward.text, 'br_if')).toBe(1);
    await same(outward.before, outward.after, INPUTS);
  });

  it('NOT a tail that takes a value an earlier statement of the arm left on the stack', async () => {
    // Linear text: the `i32.const` stays on the stack across the call, so the
    // reader gives the `global.set` a `pop` — both arms end `call $h` then
    // `global.set $g (pop)`, equal. Through the runner the `pop` never reaches
    // the pass: the spill before the passes makes the value a local, one per
    // arm, so the tails then DIFFER and nothing folds. The pass guards a `pop`
    // all the same, for a tree handed to it directly; this case holds the
    // pipeline's behaviour (a mutant of the guard alone is unobservable here).
    const { before, after, text } = fold(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func $h (global.set $g (i32.add (global.get $g) (i32.const 100))))
      (func (export "f") (param i32)
        local.get 0
        if
          i32.const 1
          call $h
          global.set $g
        else
          i32.const 2
          call $h
          global.set $g
        end))`);
    expect(count(text, 'global.set')).toBe(3);
    expect(count(text, 'call 0')).toBe(2);
    await same(before, after, INPUTS);
  });
});
