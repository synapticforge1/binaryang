// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedBrs, open-work 2 step 3c: a tail `return`, `if (c) br` →
// `br_if`, and a cheap `if` → `select`. Each case RUNS the module before and
// after the pass alone, and asserts whether the rewrite happened.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { None } from '../../../src/binaryen-ts/ir/types.ts';

type Fn = (...a: number[]) => unknown;

function rub(wat: string, after: string[] = []) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  const runner = new PassRunner(m, {}).add('RemoveUnusedBrs');
  for (const p of after) runner.add(p);
  runner.run();
  const out = writeWasm(m);
  const { errors } = wasmValidate(out, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text, m };
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

const INPUTS = [[0], [1], [-1], [42]];

describe('a return at the end of the body', () => {
  it('with a value becomes the value; without one, goes', async () => {
    const { before, after, text } = rub(`(module
      (global $s (mut i32) (i32.const 0))
      (func (export "v") (param i32) (result i32)
        (global.set $s (local.get 0))
        (return (i32.add (local.get 0) (i32.const 1))))
      (func (export "n") (param i32)
        (global.set $s (local.get 0))
        (return)))`);
    expect(text).not.toContain('return');
    await same(before, after, 'v', INPUTS);
    await same(before, after, 'n', INPUTS);
  });

  it('🔧 NOT when it also discards values left on the stack (spec unwind.wast)', async () => {
    const { before, after, text } = rub(`(module
      (func (export "f") (result i32)
        (i32.const 3)
        (i64.const 1)
        (return (i32.const 9))))`);
    expect(text).toContain('return');
    await same(before, after, 'f', [[]]);
  });
});

describe('if (c) br is br_if', () => {
  // A second branch to `$out` in each fixture keeps the block: with only the
  // one, step 6b turns the whole block into an `if` on the negated condition
  // (`remove_unused_brs_6b.test.ts`), and the `br_if` this step makes is gone.
  it('to an outer label', async () => {
    const { before, after, text } = rub(`(module
      (func (export "f") (param i32) (result i32)
        (block $out
          (if (local.get 0) (then (br $out)))
          (br_if $out (i32.eq (local.get 0) (i32.const -1)))
          (return (i32.const 7)))
        (i32.const 9)))`);
    expect(text).toContain('br_if');
    expect(text).not.toContain('(if');
    await same(before, after, 'f', INPUTS);
  });

  it('and with no other branch, the block then becomes an if (6b)', async () => {
    const { before, after, text } = rub(`(module
      (func (export "f") (param i32) (result i32)
        (block $out
          (if (local.get 0) (then (br $out)))
          (return (i32.const 7)))
        (i32.const 9)))`);
    expect(text).not.toContain('br_if');
    expect(text).not.toContain('block');
    expect(text).toContain('i32.eqz');
    await same(before, after, 'f', INPUTS);
  });

  it('the br_if falls through — DCE after it keeps what follows', async () => {
    // Typed as the `br` it came from (`unreachable`), the code after it reads
    // as dead to every later pass.
    const { before, after, text, m } = rub(
      `(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "f") (param i32)
        (block $out
          (if (local.get 0) (then (br $out)))
          (br_if $out (i32.eq (local.get 0) (i32.const -1)))
          (global.set $g (i32.const 77)))))`,
      ['DCE'],
    );
    expect(text).toContain('br_if');
    await same(before, after, 'f', INPUTS);
    // Nothing reads a valueless br_if's stored type today (DCE asks the
    // structure); the IR's invariant is that it is right all the same.
    const types: unknown[] = [];
    walkExpression(m.functions[0]!.body, (e) => {
      if (e.kind === ExpressionKind.Break && e.condition !== undefined) types.push(e.type);
    });
    expect(types).toEqual([None, None]); // the made one and the fixture's own
  });

  it('NOT to the if itself (its label is not in scope outside it)', async () => {
    const { before, after, text } = rub(`(module
      (func (export "f") (param i32) (result i32)
        (if $me (local.get 0) (then (br $me)))
        (i32.const 9)))`);
    expect(text).not.toContain('br_if');
    await same(before, after, 'f', INPUTS);
  });
});

describe('a cheap if is a select', () => {
  it('constants and reads in its arms', async () => {
    const { before, after, text } = rub(`(module
      (global $k i32 (i32.const 3))
      (func (export "f") (param i32 i32) (result i32)
        (if (result i32) (local.get 0)
          (then (local.get 1)) (else (global.get $k)))))`);
    expect(text).toContain('select');
    expect(text).not.toContain('(if');
    await same(before, after, 'f', INPUTS.map(([v]) => [v, 11]));
  });

  it('NOT when the condition writes a local an arm reads', async () => {
    const { before, after, text } = rub(`(module
      (func (export "f") (param i32 i32) (result i32)
        (if (result i32) (local.tee 1 (local.get 0))
          (then (local.get 1)) (else (i32.const 5)))))`);
    expect(text).not.toContain('select');
    await same(before, after, 'f', INPUTS.map(([v]) => [v, 11]));
  });

  it('NOT when the condition calls code that writes a global an arm reads', async () => {
    const { before, after, text } = rub(`(module
      (global $g (export "g") (mut i32) (i32.const 1))
      (func $set (result i32) (global.set $g (i32.const 50)) (i32.const 1))
      (func (export "f") (result i32)
        (if (result i32) (call $set)
          (then (global.get $g)) (else (i32.const 5)))))`);
    expect(text).not.toContain('select');
    await same(before, after, 'f', [[]]);
  });

  it('NOT for a reference type (an untyped select takes numbers only)', () => {
    const { text } = rub(`(module
      (func $h)
      (func (export "f") (param i32 funcref funcref) (result funcref)
        (if (result funcref) (local.get 0)
          (then (local.get 1)) (else (local.get 2)))))`);
    expect(text).not.toContain('select');
  });

  it('NOT when an arm does more than read', async () => {
    const { before, after, text } = rub(`(module
      (global $g (export "g") (mut i32) (i32.const 0))
      (func $bump (result i32) (global.set $g (i32.add (global.get $g) (i32.const 1))) (global.get $g))
      (func (export "f") (param i32) (result i32)
        (if (result i32) (local.get 0)
          (then (call $bump)) (else (i32.const 5)))))`);
    expect(text).not.toContain('select');
    await same(before, after, 'f', INPUTS);
  });
});
