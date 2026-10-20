// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// MergeLocals, open-work 31 step 15: after a copy `local.set $b (local.get $a)`, a read of `$b`
// that only the copy feeds reads `$a`, where `$a` still holds the copied value. The shape that
// pays is Zig's debug output: a local reused for several values, copied, then compared with the
// original in a check that guards a panic — always false, so -Oz drops the check.
//
// Each case RUNS the module before and after. The controls are what the pass must refuse: `$a`
// written between the copy and the read (also on one arm only), a read `$b`'s other write can also
// reach (before the copy, and after it on one arm), a copy between locals of different types, and
// a function with a `try_table`.

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

function run(wat: string, passes: string[] | 'Oz') {
  const before = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
  const m = readForPasses(before);
  const r = new PassRunner(m, passes === 'Oz' ? { optimizeLevel: 2, shrinkLevel: 2 } : {});
  if (passes === 'Oz') r.addDefaultOptimizationPasses();
  else for (const p of passes) r.add(p);
  r.run();
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: [number, number][]) {
  const call = async (b: Uint8Array, x: number, y: number) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    try {
      return String(((instance.exports as Record<string, unknown>)['f'] as Fn)(x, y));
    } catch (e) {
      return `${e instanceof WebAssembly.RuntimeError ? 'trap' : 'threw'}: ${(e as Error).message}`;
    }
  };
  for (const [x, y] of inputs) expect(await call(after, x, y)).toBe(await call(before, x, y));
}

const count = (text: string, s: string) => text.split(s).length - 1;
const INPUTS: [number, number][] = [[0, 0], [3, 4], [7, 0], [-1, 9]];

// Local 2 is reused: written before the copy and after the check, as Zig's debug output does.
const PANIC_CHECK = `(module
  (func (export "f") (param i32 i32) (result i32) (local i32)
    (local.set 2 (i32.add (local.get 0) (local.get 1)))
    (local.set 1 (i32.mul (local.get 2) (i32.const 3)))
    (local.set 2 (local.get 0))
    (if (i32.ne (local.get 2) (local.get 0)) (then (unreachable)))
    (local.set 2 (i32.sub (local.get 1) (local.get 2)))
    (local.get 2)))`;

describe('a read of a copy reads the original', () => {
  it('the reused local: the read after the copy reads $a', async () => {
    const { before, after, text } = run(PANIC_CHECK, ['MergeLocals']);
    // The check and the `i32.sub` read local 0 now (with the `i32.add` and the copy: five); local
    // 2 is read by the `i32.mul`, before the copy, and at the end.
    expect(count(text, 'local.get 2')).toBe(2);
    expect(count(text, 'local.get 0')).toBe(5);
    await same(before, after, INPUTS);
  });

  it('at -Oz the check is gone', async () => {
    const { before, after, text } = run(PANIC_CHECK, 'Oz');
    expect(count(text, 'unreachable')).toBe(0);
    await same(before, after, INPUTS);
  });

  it('a tee is a copy too', async () => {
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32 i32) (result i32) (local i32)
          (local.set 2 (i32.const 5))
          (drop (local.get 2))
          (drop (local.tee 2 (local.get 0)))
          (i32.add (local.get 2) (local.get 1))))`,
      ['MergeLocals'],
    );
    expect(count(text, 'local.get 2')).toBe(1); // the drop's, before the copy
    await same(before, after, INPUTS);
  });
});

describe('refused', () => {
  it('$a written between the copy and the read (control)', async () => {
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32 i32) (result i32) (local i32)
          (local.set 2 (local.get 0))
          (local.set 0 (i32.const 9))
          (i32.sub (local.get 2) (local.get 0))))`,
      ['MergeLocals'],
    );
    expect(count(text, 'local.get 2')).toBe(1);
    await same(before, after, INPUTS);
  });

  it('$a written on one arm only (control)', async () => {
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32 i32) (result i32) (local i32)
          (local.set 2 (local.get 0))
          (if (local.get 1) (then (local.set 0 (i32.const 9))))
          (i32.sub (local.get 2) (local.get 0))))`,
      ['MergeLocals'],
    );
    expect(count(text, 'local.get 2')).toBe(1);
    await same(before, after, INPUTS);
  });

  it("a read $b's other write can also reach (control)", async () => {
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32 i32) (result i32) (local i32)
          (if (local.get 1)
            (then (local.set 2 (local.get 0)))
            (else (local.set 2 (i32.const 5))))
          (i32.add (local.get 2) (local.get 0))))`,
      ['MergeLocals'],
    );
    expect(count(text, 'local.get 2')).toBe(1);
    await same(before, after, INPUTS);
  });

  it('$b written again after the copy, on one arm (control)', async () => {
    // $a still holds the copied value at the read, so the second graph would accept it: only the
    // first guard, ONE reaching write of $b, sees the `5`.
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32 i32) (result i32) (local i32)
          (local.set 2 (local.get 0))
          (if (local.get 1) (then (local.set 2 (i32.const 5))))
          (i32.add (local.get 2) (local.get 0))))`,
      ['MergeLocals'],
    );
    expect(count(text, 'local.get 2')).toBe(1);
    await same(before, after, INPUTS);
  });

  it('a copy between locals of different types (control)', async () => {
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32 i32) (result i32) (local eqref anyref)
          (if (local.get 0) (then (local.set 2 (ref.i31 (local.get 1)))))
          (local.set 3 (local.get 2))
          (i32.add (ref.is_null (local.get 3)) (local.get 1))))`,
      ['MergeLocals'],
    );
    expect(count(text, 'local.get 3')).toBe(1);
    await same(before, after, INPUTS);
  });

  it('a function with a try_table (control)', async () => {
    const { before, after, text } = run(
      `(module
        (func (export "f") (param i32 i32) (result i32) (local i32)
          (block $h
            (try_table (catch_all $h)
              (local.set 2 (local.get 0))
              (local.set 1 (i32.add (local.get 2) (local.get 1)))))
          (local.get 1)))`,
      ['MergeLocals'],
    );
    expect(count(text, 'local.get 2')).toBe(1);
    await same(before, after, INPUTS);
  });
});
