// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedBrs and the nesting limit. Merging adjacent `br_if`s to one label builds an
// `i32.or` chain, one level per branch merged: a VALID flat run of 255 of them left a module 258
// deep, and the pass runner's re-check refused it ("NestingLimitError (after RemoveUnusedBrs)"),
// so `-O2` could not optimize a valid program. The merge now stops where the function would pass
// MAX_NESTING_DEPTH (the branches stay flat, and the tail ones become drops, as upstream's output
// does). Below the limit the merge is exactly what it was.
//
// Each case RUNS the module before and after, and reads the result back to measure its depth. The
// guard sweep holds the same class for every optimizer level over many flat shapes: no flat valid
// input is refused after a pass.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { MAX_NESTING_DEPTH, nestingDepth } from '../../../src/ir/nesting.ts';
import { allFeatures } from '../../../src/core/feature.ts';

const wasmOf = (wat: string) => wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;

function depthOf(bytes: Uint8Array): number {
  return Math.max(...readForPasses(bytes).functions.map((f) => nestingDepth(f.body)));
}

function rubAlone(bytes: Uint8Array): Uint8Array {
  const m = readForPasses(bytes);
  new PassRunner(m, {}).add('RemoveUnusedBrs').run();
  return writeWasm(m);
}

type F = (p: number) => unknown;
async function result(bytes: Uint8Array, p: number): Promise<string> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
  try {
    return String((instance.exports['f'] as F)(p));
  } catch (e) {
    return `trap: ${(e as Error).message}`;
  }
}

const rep = (n: number, f: (k: number) => string) =>
  Array.from({ length: n }, (_, k) => f(k)).join('\n');

/** n branches out of one block, each on a pure condition, with nothing between them. */
const brIfRun = (n: number) =>
  `(module (func (export "f") (param $p i32) (result i32) (local $x i32)
    (block $out ${rep(n, (k) => `(br_if $out (i32.eq (local.get $p) (i32.const ${k + 7})))`)})
    (local.get $x)))`;

/** The same as `if … (then (br $out))`. */
const ifBrRun = (n: number) =>
  `(module (func (export "f") (param $p i32) (result i32) (local $x i32)
    (block $out ${
    rep(n, (k) => `(if (i32.eq (local.get $p) (i32.const ${k + 7})) (then (br $out)))`)
  })
    (local.get $x)))`;

const RUNS = [['br_if', brIfRun], ['if … br', ifBrRun]] as const;
const INPUTS = [0, 7, 8, 100, 1006, 5000];

describe('a flat run of branches is optimized, whatever its length', () => {
  for (const [name, make] of RUNS) {
    for (const n of [1000, 3000]) {
      for (const [lvl, shrink] of [[2, 0], [3, 0], [2, 2]] as const) {
        it(`${name} x ${n} at -O${lvl}${shrink === 2 ? ' (-Oz)' : ''}`, async () => {
          const before = wasmOf(make(n));
          const after = (await wasmOpt(before, {
            optimizeLevel: lvl,
            shrinkLevel: shrink,
          })) as Uint8Array;
          expect(depthOf(after)).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
          for (const p of INPUTS) expect(await result(after, p)).toBe(await result(before, p));
        });
      }
    }
  }

  it('RemoveUnusedBrs alone leaves a run of 1000 flat, and it still runs the same', async () => {
    const before = wasmOf(brIfRun(1000));
    const after = rubAlone(before);
    expect(depthOf(after)).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
    for (const p of INPUTS) expect(await result(after, p)).toBe(await result(before, p));
  });
});

describe('the bound is exact', () => {
  // n branches merge into a chain n + 3 deep (the block, the drop, n - 1 `i32.or`s, and the
  // comparison with its operand): 253 reach 256 exactly and all merge. A 254th would make 257, so
  // it stays a branch of its own: 252 `i32.or`s, the same depth.
  for (const [name, make] of RUNS) {
    for (const n of [253, 254]) {
      it(`${name}: ${n} give a chain of exactly ${MAX_NESTING_DEPTH}, merged as far as it goes`, async () => {
        const before = wasmOf(make(n));
        const after = rubAlone(before);
        expect(depthOf(after)).toBe(MAX_NESTING_DEPTH);
        expect(wasm2wat(after).text.split('i32.or').length - 1).toBe(252);
        for (const p of INPUTS) expect(await result(after, p)).toBe(await result(before, p));
      });
    }
  }

  it('a run deeper in the tree, where even a shorter chain would pass, is left unmerged', async () => {
    // Five blocks above the run: the chain of 250 would be 251 high under a branch at level 6.
    const wat = brIfRun(250)
      .replace('(block $out', '(block (block (block (block (block $out')
      .replace('(local.get $x)', ')))) (local.get $x)');
    const before = wasmOf(wat);
    const after = rubAlone(before);
    expect(depthOf(after)).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
    const text = wasm2wat(after).text;
    expect(text).not.toContain('i32.or');
    // The rest of the pass still ran: the last `br_if` to its own block's end became a drop.
    expect(text.split('br_if').length - 1).toBe(249);
    for (const p of INPUTS) expect(await result(after, p)).toBe(await result(before, p));
  });
});

// Flat valid shapes that a pass might nest: every optimizer level must take each of them, at a
// length past the limit, without a NestingLimitError. (n = 300 > 256.)
const E = (k: number) => `(i32.eq (local.get $p) (i32.const ${k}))`;
const ADD = `(local.set $x (i32.add (local.get $x) (i32.const 1)))`;
const fn = (n: number, body: (k: number) => string, wrap = (s: string) => s) =>
  `(module (func $g (param i32) (result i32) (i32.add (local.get 0) (i32.const 1)))
    (func (export "f") (param $p i32) (result i32) (local $x i32) (local $y i32)
    ${wrap(rep(n, body))}
    (local.get $x)))`;
const inBlock = (s: string) => `(block $out ${s})`;

const SHAPES: Record<string, (n: number) => string> = {
  'br_if run': brIfRun,
  'if/br run': ifBrRun,
  'set; if/br': (n) => fn(n, (k) => `${ADD} (if ${E(k + 7)} (then (br $out)))`, inBlock),
  'set; br_if': (n) => fn(n, (k) => `${ADD} (br_if $out ${E(k + 7)})`, inBlock),
  'br_if run, two labels': (n) =>
    fn(n, (k) => `(br_if ${k % 2 ? '$a' : '$b'} ${E(k)})`, (s) => `(block $a (block $b ${s}))`),
  'if/else chain': (n) =>
    fn(n, (k) => `(if ${E(k)} (then ${ADD}) (else (local.set $x (i32.const ${k}))))`),
  'if/else br chain': (n) => fn(n, (k) => `(if ${E(k)} (then (br $out)) (else ${ADD}))`, inBlock),
  'select chain': (n) =>
    fn(n, (k) => `(local.set $x (select (local.get $x) (i32.const ${k}) ${E(k)}))`),
  'if result chain': (n) =>
    fn(
      n,
      (k) => `(local.set $x (if (result i32) ${E(k)} (then (i32.const 1)) (else (local.get $x))))`,
    ),
  'blocks in sequence': (n) => fn(n, () => `(block $b ${ADD} (br_if $b (local.get $p)) ${ADD})`),
  'blocks ending in br': (n) =>
    fn(n, () => `(block $b ${ADD} (br_if $b (local.get $p)) ${ADD} (br $b))`),
  'leading br_if blocks': (n) => fn(n, (k) => `(block $b (br_if $b ${E(k)}) ${ADD})`),
  'loops in sequence': (n) =>
    fn(n, () => `(loop $l ${ADD} (br_if $l (i32.lt_u (local.get $x) (local.get $p))))`),
  'br_table run': (n) =>
    fn(
      n,
      () =>
        `(block $a (block $b (br_table $a $b $out (i32.and (local.get $p) (i32.const 3)))) ${ADD})`,
      inBlock,
    ),
  'drop/tee run': (n) =>
    fn(n, () => `(drop (local.tee $x (i32.add (local.get $x) (local.get $p))))`),
  'call run': (n) => fn(n, () => `(local.set $x (call $g (local.get $x)))`),
  'local copies': (n) =>
    fn(
      n,
      (k) =>
        k % 2
          ? `(local.set $x (local.get $y))`
          : `(local.set $y (i32.add (local.get $x) (i32.const 1)))`,
    ),
  'dependent sets': (n) => fn(n, () => `(local.set $x (i32.add (local.get $x) (local.get $p)))`),
  'if return run': (n) => fn(n, (k) => `(if ${E(k)} (then (return (i32.const ${k}))))`),
  'if run': (n) => fn(n, (k) => `(if (i32.gt_u (local.get $p) (i32.const ${k})) (then ${ADD}))`),
};

describe('no flat valid input is refused after a pass, at any optimizer level', () => {
  for (const [name, make] of Object.entries(SHAPES)) {
    it(name, async () => {
      const before = wasmOf(make(300));
      for (const [lvl, shrink] of [[1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2]] as const) {
        const after = (await wasmOpt(before, {
          optimizeLevel: lvl,
          shrinkLevel: shrink,
        })) as Uint8Array;
        expect(depthOf(after)).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
        for (const p of [0, 3, 100, 299, 301]) {
          expect(await result(after, p)).toBe(await result(before, p));
        }
      }
    });
  }
});
