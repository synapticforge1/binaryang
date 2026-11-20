// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Inlining over a call chain whose callees come FIRST in the module. Upstream does not inline a
// function something was already inlined into this iteration (`inlinedInto`); without that, each
// caller copied the whole tail already inlined into its callee: 400 links took 7 s and 2.7 GB at
// -O2, 3000 never finished (security review, round 2).

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { MAX_NESTING_DEPTH, nestingDepth } from '../../../src/ir/nesting.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

/** `$f0` calls `$f1` … `$f(n-1)`; the functions are laid out callee first. */
function chainWat(n: number): string {
  const fs: string[] = [];
  for (let i = 0; i < n; i++) {
    const body = i === n - 1
      ? '(local.get 0)'
      : `(call $f${i + 1} (i32.add (local.get 0) (i32.const ${i % 7 + 1})))`;
    fs.unshift(`(func $f${i} (param i32) (result i32) ${body})`);
  }
  return `(module ${
    fs.join('\n')
  } (func (export "run") (param i32) (result i32) (call $f0 (local.get 0))))`;
}

async function run(b: Uint8Array, a: number): Promise<number> {
  const { instance } = await WebAssembly.instantiate(b as BufferSource);
  return (instance.exports['run'] as (a: number) => number)(a);
}

describe('inlining: a chain with the callees first', () => {
  it('-O2 over 1,500 links finishes, stays within the depth limit and behaves the same', async () => {
    const before = wat2wasm(chainWat(1500), { textForm: false }).binary;
    const m = readForPasses(before);
    const t = performance.now();
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    const ms = performance.now() - t;
    const after = writeWasm(m);
    // Measured 2026-11-20: ~0.5 s here; 400 links took 7 s before, so 1,500 ran for minutes.
    expect(ms).toBeLessThan(30_000);
    expect(wasmValidate(after, { features: allFeatures() }).errors.map((e) => e.message)).toEqual(
      [],
    );
    for (const f of m.functions) {
      expect(nestingDepth(f.body, MAX_NESTING_DEPTH)).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
    }
    for (const a of [0, 1, -5, 123456]) expect(await run(after, a)).toBe(await run(before, a));
  });

  it('one Inlining run takes one link per function, as upstream does', () => {
    // A deterministic measure of the work (no clock): callee-first, the old code grew the first
    // function's body to the nesting limit in ONE run; one link per iteration leaves it small.
    const m = readForPasses(wat2wasm(chainWat(300), { textForm: false }).binary);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).add('Inlining').run();
    let deepest = 0;
    for (const f of m.functions) deepest = Math.max(deepest, nestingDepth(f.body));
    expect(deepest).toBeLessThan(64);
  });
});
