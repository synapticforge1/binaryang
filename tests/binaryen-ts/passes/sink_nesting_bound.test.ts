// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// A sink must not build a tree deeper than the nesting limit (wasmtk's letter C48, 2026-11-20).
// `optimize()` at -Oz sank a straight-line chain of dependent `local.set`s into ONE expression as
// deep as the chain was long: past ~1,000 links the optimizer failed on the JavaScript call stack,
// past ~15,000 it filled the heap. Both sinks are bounded now: SimplifyLocals (the tree) and the
// writer's Local2Stack (`stack-ir.ts`, which leaves a value on the stack, so a reader folds it
// back into a tree). A set that would nest past MAX_NESTING_DEPTH stays where it is.
//
// Every case asserts the depth of what comes out as the READER sees it (the bytes read back), and
// RUNS the module before and after. The 20,000-link case (SINK_CHAIN_LONG=1) takes ~20-40 s and several GB (-Oz on 260 KB).

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { MAX_NESTING_DEPTH, nestingDepth } from '../../../src/ir/nesting.ts';

type Fn = (a: number) => number;

/** wasmtk's shape: one function of N statements `x = x * 3 + a - 2;`, then the result. */
function chainWat(n: number): string {
  const step =
    '(local.set $x (i32.sub (i32.add (i32.mul (local.get $x) (i32.const 3)) (local.get $a)) (i32.const 2)))';
  return `(module (func (export "f") (param $a i32) (result i32) (local $x i32)
    ${step.repeat(n)} (local.get $x)))`;
}

/** N temporaries, each read once by the next: every link adds ONE level when sunk. */
function tempsWat(n: number): string {
  const locals = Array.from({ length: n }, (_, i) => `(local $t${i} i32)`).join(' ');
  const sets = Array.from(
    { length: n },
    (_, i) =>
      `(local.set $t${i} (i32.add ${
        i === 0 ? '(local.get $a)' : `(local.get $t${i - 1})`
      } (i32.const 1)))`,
  ).join('\n');
  return `(module (func (export "f") (param $a i32) (result i32) ${locals}
    ${sets} (local.get $t${n - 1})))`;
}

const deepest = (bytes: Uint8Array) => {
  const m = readForPasses(bytes); // throws past the limit: the reader's own bound
  return Math.max(...m.functions.map((f) => nestingDepth(f.body)));
};

async function run(bytes: Uint8Array, a: number): Promise<number> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  return (instance.exports['f'] as Fn)(a);
}

async function same(before: Uint8Array, after: Uint8Array) {
  for (const a of [0, 1, -1, 7, 0x7fffffff]) expect(await run(after, a)).toBe(await run(before, a));
}

const count = (text: string, what: string) => text.split(what).length - 1;

/** SimplifyLocals alone, the bytes written WITHOUT the stack form. */
function simplify(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('SimplifyLocals').run();
  const after = writeWasm(m);
  return { before, after, depth: deepest(after), text: wasm2wat(after).text };
}

describe('SimplifyLocals stops sinking at the nesting limit', () => {
  it('a chain that reaches the limit exactly is sunk completely', async () => {
    // t0 = a + 1 is two levels; each link adds one: 255 links, 256 levels, no set left.
    const { before, after, depth, text } = simplify(tempsWat(MAX_NESTING_DEPTH - 1));
    expect(depth).toBe(MAX_NESTING_DEPTH);
    expect(count(text, 'local.set')).toBe(0);
    await same(before, after);
  });

  it('one link more is left as a set, and the tree stays within the limit', async () => {
    const { before, after, depth, text } = simplify(tempsWat(MAX_NESTING_DEPTH));
    expect(depth).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
    expect(count(text, 'local.set')).toBeGreaterThan(0);
    await same(before, after);
  });

  it("wasmtk's chain of 1,000 dependent sets (each read twice: a tee) stays within the limit", async () => {
    const { before, after, depth, text } = simplify(chainWat(1000));
    expect(depth).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
    expect(depth).toBeGreaterThan(MAX_NESTING_DEPTH - 8); // sunk as far as the bound allows
    expect(count(text, 'local.set')).toBeGreaterThan(0);
    await same(before, after);
  });
});

describe("the writer's stack form stops at the nesting limit", () => {
  /** A run that marks the module for the stack form (-O3), with SimplifyLocals not in it. */
  function stackForm(wat: string) {
    const before = wat2wasm(wat, { textForm: false }).binary;
    const m = readForPasses(before);
    new PassRunner(m, { optimizeLevel: 3 }).add('Vacuum').run();
    const after = writeWasm(m);
    return { before, after, depth: deepest(after), text: wasm2wat(after).text };
  }

  it('a chain well within the limit is all left on the stack', async () => {
    // 254 links: 255 levels. (The bound judges a pair where the set STANDS, one level deeper than
    // where a chain's last link lands, so the very last level is not offered: 255 links, which fit
    // exactly, keep their last pair.)
    const { before, after, depth, text } = stackForm(tempsWat(MAX_NESTING_DEPTH - 2));
    expect(depth).toBe(MAX_NESTING_DEPTH - 1);
    expect(count(text, 'local.set')).toBe(0);
    await same(before, after);
  });

  it('1,000 chained temporaries: some pairs stay, and the bytes read back within the limit', async () => {
    const { before, after, depth, text } = stackForm(tempsWat(1000));
    expect(depth).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
    expect(depth).toBeGreaterThan(MAX_NESTING_DEPTH - 8); // as far as the bound allows
    expect(count(text, 'local.set')).toBeGreaterThan(0);
    await same(before, after);
  });
});

describe('optimize at -Oz of a long chain of dependent sets (letter C48)', () => {
  // The suite's cases are modest: the test files run in parallel, and 20,000 links took ~5 GB of
  // resident memory on Bun (measured 2026-11-20: garbage the collector had not yet taken, not
  // retained: 1.7 GB with a collection after every pass, 90 MB live at the end) and 16-19 s.
  // `SINK_CHAIN_LONG=1` adds the 20,000 case, on demand (not a skip: it is not generated).
  const sizes = [1000, 4000, ...(process.env['SINK_CHAIN_LONG'] ? [20000] : [])];
  for (const n of sizes) {
    it(`${n} chained sets: it completes, reads back within the limit, and computes the same`, async () => {
      const before = wat2wasm(chainWat(n), { textForm: false }).binary;
      const after = await wasmOpt(before, { optimizeLevel: 2, shrinkLevel: 2, output: '-' });
      expect(after).toBeInstanceOf(Uint8Array);
      expect(deepest(after as Uint8Array)).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
      await same(before, after as Uint8Array);
    });
  }
});
