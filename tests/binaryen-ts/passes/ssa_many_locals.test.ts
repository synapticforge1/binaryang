// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// SSANoMerge gives each set its own local, and a function past the cap of CoalesceLocals
// (COALESCE_MAX_REFERENCED_LOCALS, 20,000) is not coalesced, so those locals stayed: SimplifyLocals
// (every node checked against every waiting set of another local) and LocalCSE were then quadratic
// in them. 22,000 `x = a + i` at -O3: more than 100 s (round 3 review, 2026-11-20; at -O2, 1.1 s).
// SSANoMerge now refuses a function whose renaming would pass the cap, and SimplifyLocals finds the
// waiting sets that a node conflicts with by the locals they touch, not by going through all.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { COALESCE_MAX_REFERENCED_LOCALS } from '../../../src/passes/coalesce-locals.ts';
import { ssaNoMerge } from '../../../src/passes/ssa-nomerge.ts';
import process from 'node:process';

/** CPU time of this process, in ms: the bounds below are on work, not on how busy the machine
 * is (a wall-clock bound failed under the gate's load, 2026-11-25; Q-H5's method). */
const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

const rep = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => f(i)).join('\n');
const bytesOf = (wat: string) => wat2wasm(wat, { textForm: false }).binary;
const call = async (b: Uint8Array, a: number) =>
  ((await WebAssembly.instantiate(b as BufferSource)).instance.exports['f'] as (
    a: number,
  ) => number)(
    a,
  );

/** `x = a + i`, n times, one local, one block. */
const straightWat = (n: number) =>
  `(module (func (export "f") (param i32) (result i32) (local i32)
  ${rep(n, (i) => `(local.set 1 (i32.add (local.get 0) (i32.const ${i})))`)} (local.get 1)))`;

/** n different locals, each set once from the parameter and never read. */
const distinctWat = (n: number) =>
  `(module (func (export "f") (param i32) (result i32) (local ${'i32 '.repeat(n)})
  ${
    rep(n, (i) =>
      `(local.set ${i + 1} (i32.add (local.get 0) (i32.const ${i})))`)
  } (local.get 0)))`;

describe('SSANoMerge and the locals CoalesceLocals will not take back', () => {
  it('5,000 sets of one local: renamed', () => {
    const fn = readForPasses(bytesOf(straightWat(5000))).functions[0]!;
    expect(ssaNoMerge(fn)).toBe(true);
    expect(fn.locals.length).toBeGreaterThan(5000); // each set a local of its own
  });

  it('21,000 sets of one local: past the cap, left as it is', async () => {
    const before = bytesOf(straightWat(21_000));
    const m = readForPasses(before);
    expect(21_000).toBeGreaterThan(COALESCE_MAX_REFERENCED_LOCALS);
    expect(ssaNoMerge(m.functions[0]!)).toBe(false);
    expect(m.functions[0]!.locals.length).toBe(2); // the parameter and x
    expect(await call(writeWasm(m), 7)).toBe(await call(before, 7));
  });

  it('SimplifyLocals over 30,000 sets of different locals: under 4 s', () => {
    const m = readForPasses(bytesOf(distinctWat(30_000)));
    const t = cpuMs();
    new PassRunner(m, {}).add('SimplifyLocals').run();
    expect(cpuMs() - t).toBeLessThan(4000); // measured ~0.8 s; going through every waiting set: minutes
  });
});
