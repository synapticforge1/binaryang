// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The default schedule re-runs the passes whose work the later ones expose
// (open-work 2, step 4a): CoalesceLocals after SimplifyLocals / LocalCSE, and
// SimplifyLocals after Inlining. Each is asserted against the schedule
// WITHOUT it, on a function where it pays, and the output is RUN.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

const WAT = `(module
  (func $sq (param i32) (result i32) (i32.mul (local.get 0) (local.get 0)))
  (func (export "f") (param i32 i32) (result i32) (local i32 i32 i32)
    (local.set 2 (i32.add (local.get 0) (local.get 1)))
    (local.set 3 (i32.sub (local.get 2) (i32.const 1)))
    (local.set 4 (i32.mul (local.get 3) (local.get 2)))
    (i32.add (local.get 4) (call $sq (local.get 3)))))`;

const BEFORE_4A_O2 = [
  'RemoveUnusedModuleElements',
  'DCE',
  'PickLoadSigns',
  'Vacuum',
  'RemoveUnusedBrs',
  'RemoveUnusedNames',
  'OptimizeInstructions',
  'CoalesceLocals',
  'SimplifyLocals',
  'LocalCSE',
  'RemoveUnusedModuleElements',
  'RemoveUnusedTypes',
];
/** -O3 with step 4a's second CoalesceLocals, but no SimplifyLocals after Inlining. */
const NO_SL_AFTER_INLINING_O3 = [
  ...BEFORE_4A_O2.slice(0, 10),
  'CoalesceLocals',
  'Inlining',
  'OptimizeInstructions',
  'CoalesceLocals',
  ...BEFORE_4A_O2.slice(10),
];

function optimize(optimizeLevel: 2 | 3, passes?: string[]) {
  const m = readForPasses(wat2wasm(WAT).binary);
  const r = new PassRunner(m, { optimizeLevel, shrinkLevel: 0 });
  if (passes) { for (const p of passes) r.add(p); }
  else r.addDefaultOptimizationPasses();
  r.run();
  return writeWasm(m);
}

async function f(bytes: Uint8Array, a: number, b: number) {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  return (instance.exports.f as (a: number, b: number) => number)(a, b);
}

const want = (a: number, b: number) => {
  const s = (a + b) | 0, t = (s - 1) | 0;
  return (Math.imul(t, s) + Math.imul(t, t)) | 0;
};

describe('the default schedule re-runs what later passes expose', () => {
  it('-O2: CoalesceLocals again after SimplifyLocals', async () => {
    const now = optimize(2), then = optimize(2, BEFORE_4A_O2);
    expect(now.length).toBeLessThan(then.length);
    for (const [a, b] of [[3, 4], [0, 0], [-1, 0x7fffffff]]) {
      expect(await f(now, a!, b!)).toBe(want(a!, b!));
    }
  });

  it('-O3: SimplifyLocals after Inlining', async () => {
    const now = optimize(3), then = optimize(3, NO_SL_AFTER_INLINING_O3);
    expect(now.length).toBeLessThan(then.length);
    for (const [a, b] of [[3, 4], [0, 0], [-1, 0x7fffffff]]) {
      expect(await f(now, a!, b!)).toBe(want(a!, b!));
    }
  });
});
