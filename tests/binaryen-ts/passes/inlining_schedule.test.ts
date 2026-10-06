// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Inlining at upstream's rules and schedule (open-work 2, step 5): what is
// inlined at each level, and that the default -O2 / -Oz schedule inlines and
// cleans up after it. Every case that inlines RUNS the module before and after.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { type PassOptions, PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

/** The module before and after `Inlining` alone (or the default schedule), and the functions left. */
function inline(wat: string, opts: Partial<PassOptions>, defaults = false) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  const r = new PassRunner(m, opts);
  if (defaults) r.addDefaultOptimizationPasses();
  else r.add('Inlining').add('RemoveUnusedModuleElements');
  r.run();
  const after = writeWasm(m);
  const { errors } = wasmValidate(after, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { before, after, names: m.functions.map((f) => f.name), size: after.length };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[]) {
  const run = async (b: Uint8Array, a: number) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource);
    return (instance.exports.run as (a: number) => number)(a);
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

/** A function of 30-odd nodes, called from ONE place. */
const ONE_CALLER_BIG = `(module
  (func $big (param i32) (result i32) (local i32)
    (local.set 1 (i32.mul (local.get 0) (i32.const 3)))
    (local.set 1 (i32.add (local.get 1) (i32.xor (local.get 0) (i32.const 0x55))))
    (local.set 1 (i32.sub (local.get 1) (i32.shl (local.get 0) (i32.const 2))))
    (local.set 1 (i32.add (local.get 1) (i32.rotl (local.get 0) (i32.const 7))))
    (i32.add (local.get 1) (i32.and (local.get 0) (i32.const 0xff))))
  (func (export "run") (param i32) (result i32) (call $big (local.get 0))))`;

/** A small leaf WITH A LOOP, called from two places. */
const TWO_CALLERS_LOOP = `(module
  (func $sum (param i32) (result i32) (local i32)
    (block $done (loop $l
      (br_if $done (i32.eqz (local.get 0)))
      (local.set 1 (i32.add (local.get 1) (local.get 0)))
      (local.set 0 (i32.sub (local.get 0) (i32.const 1)))
      (br $l)))
    (local.get 1))
  (func (export "run") (param i32) (result i32)
    (i32.add (call $sum (i32.and (local.get 0) (i32.const 15))) (call $sum (i32.const 3)))))`;

/** A small leaf without loops or calls, called from two places. */
const TWO_CALLERS_LEAF = `(module
  (func $f (param i32) (result i32) (i32.add (i32.mul (local.get 0) (i32.const 7)) (i32.const 1)))
  (func (export "run") (param i32) (result i32)
    (i32.add (call $f (local.get 0)) (call $f (i32.const 3)))))`;

describe('what is inlined, by upstream rules', () => {
  it('a function with one caller, at ANY size (upstream: unlimited)', async () => {
    const { before, after, names } = inline(ONE_CALLER_BIG, { optimizeLevel: 2, shrinkLevel: 2 });
    expect(names).not.toContain('$big');
    await same(before, after, [0, 1, -1, 1234567]);
  });

  it('…unless `one-caller-inline-max-size` limits it', () => {
    const { names } = inline(ONE_CALLER_BIG, {
      optimizeLevel: 2,
      shrinkLevel: 2,
      passArgs: { 'one-caller-inline-max-size': '10' },
    });
    expect(names).toContain('$big');
  });

  it('several callers: -O3 inlines a small leaf', async () => {
    const { before, after, names } = inline(TWO_CALLERS_LEAF, { optimizeLevel: 3, shrinkLevel: 0 });
    expect(names).not.toContain('$f');
    await same(before, after, [0, 5, -9]);
  });

  it('several callers: NOT when shrinking, even at level 3', () => {
    const { names } = inline(TWO_CALLERS_LEAF, { optimizeLevel: 3, shrinkLevel: 1 });
    expect(names).toContain('$f');
  });

  it('🔧 several callers: -O3 NOT a function with a loop (was `!calls || !loops`)', () => {
    const { names } = inline(TWO_CALLERS_LOOP, { optimizeLevel: 3, shrinkLevel: 0 });
    expect(names).toContain('$sum');
  });
});

describe('a return_call inside a try is not inlined', () => {
  it('🔧 the callee throws PAST the try (spec legacy try_catch.wast return-call-in-try-catch)', async () => {
    const wat = `(module
      (tag $e)
      (func $t (result i32) (throw $e))
      (func (export "run") (param i32) (result i32)
        (block $h (try_table (catch $e $h) (return_call $t)))
        (i32.const 99)))`;
    const before = wat2wasm(wat, { textForm: false }).binary;
    const m = readForPasses(before);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 2 }).addDefaultOptimizationPasses().run();
    const after = writeWasm(m);
    const outcome = async (b: Uint8Array) => {
      const { instance } = await WebAssembly.instantiate(b as BufferSource);
      try {
        return `returned ${(instance.exports.run as (a: number) => number)(0)}`;
      } catch (e) {
        return `threw ${(e as Error).constructor.name}`;
      }
    };
    expect(await outcome(before)).toMatch(/^threw/);
    expect(await outcome(after)).toBe(await outcome(before));
  });
});

describe('the default schedule inlines and cleans up after it', () => {
  it('-Oz: the one-caller function is gone, and the result is unchanged', async () => {
    const def = inline(ONE_CALLER_BIG, { optimizeLevel: 2, shrinkLevel: 2 }, true);
    expect(def.names).toHaveLength(1);
    await same(def.before, def.after, [0, 1, -1, 1234567]);
  });

  it('-O2 matches -Oz here: the round after inlining ends in a Vacuum', () => {
    const o2 = inline(ONE_CALLER_BIG, { optimizeLevel: 2, shrinkLevel: 0 }, true);
    const oz = inline(ONE_CALLER_BIG, { optimizeLevel: 2, shrinkLevel: 2 }, true);
    expect(o2.size).toBe(oz.size);
  });
});
