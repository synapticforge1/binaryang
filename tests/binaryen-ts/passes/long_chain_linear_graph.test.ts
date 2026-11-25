// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The LocalGraph's clients (SSANoMerge, MergeLocals, Local2Stack) are linear in a long flat chain
// (2026-11-20, found testing long inputs; README "Limits on untrusted input"). On n sequential
// `if (x > i) x += i` the graph kept a Set of reaching definitions per read: n² entries, 27 s and
// 2.4 GB at -O3, n = 3,000 (upstream's wasm-opt is quadratic here too: 12 s). Now it is kept as
// counts, and a function whose bitsets would pass LOCAL_GRAPH_MAX_WORDS is left as it is. Each
// case asserts a bound the old code misses by a wide margin, and RUNS the module before and after.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { ssaNoMerge } from '../../../src/passes/ssa-nomerge.ts';
import { LOCAL_GRAPH_MAX_WORDS, localGraphSummary } from '../../../src/passes/local-graph.ts';
import process from 'node:process';

/** CPU time of this process, in ms: the bounds below are on work, not on how busy the machine
 * is (a wall-clock bound failed under the gate's load, 2026-11-25; Q-H5's method). */
const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

type Fn = (a: number) => number;

const rep = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => f(i)).join('\n');

/** `if (x > i) x += i`, n times, x starting as the argument. */
const ifsWat = (n: number) =>
  `(module (func (export "f") (param $a i32) (result i32) (local $x i32) (local.set $x (local.get $a))
  ${
    rep(
      n,
      (i) =>
        `(if (i32.gt_u (local.get $x) (i32.const ${i})) (then (local.set $x (i32.add (local.get $x) (i32.const ${i})))))`,
    )
  } (local.get $x)))`;

/** `x = i; if (x) nop`, n times: every set is renamed (no read merges two). */
const renameWat = (n: number) =>
  `(module (func (export "f") (param $a i32) (result i32) (local $x i32)
  ${rep(n, (i) => `(local.set $x (i32.const ${i})) (if (local.get $x) (then (nop)))`)}
  (i32.add (local.get $x) (local.get $a))))`;

const bytesOf = (wat: string) => wat2wasm(wat, { textForm: false }).binary;
const exportOf = async (b: Uint8Array) =>
  (await WebAssembly.instantiate(b as BufferSource)).instance.exports['f'] as Fn;

function runPass(wat: string, pass: string) {
  const before = bytesOf(wat);
  const m = readForPasses(before);
  const declared = m.functions[0]!.locals.length;
  const t = cpuMs();
  new PassRunner(m, {}).add(pass).run();
  const ms = cpuMs() - t;
  return { before, after: writeWasm(m), ms, added: m.functions[0]!.locals.length - declared };
}

async function same(before: Uint8Array, after: Uint8Array) {
  const [f0, f1] = [await exportOf(before), await exportOf(after)];
  for (const a of [0, 1, 4, 5, 100, -1, 0x7fffffff]) expect(f1(a)).toBe(f0(a));
}

describe('the local graph on a long flat chain', () => {
  it('SSANoMerge: n = 6,000 sequential ifs, under 3 s', async () => {
    const { before, after, ms } = runPass(ifsWat(6000), 'SSANoMerge');
    expect(ms).toBeLessThan(3000); // measured ~0.3 s; the Sets took ~12 s and 4 GB
    await same(before, after);
  });

  it('SSANoMerge: n = 3,000 renamed sets: one new local per set', async () => {
    const { before, after, added } = runPass(renameWat(3000), 'SSANoMerge');
    expect(added).toBe(3000);
    await same(before, after);
  });

  it('SSANoMerge: a function past the graph budget is left as it is', async () => {
    // 14,000 sets and 14,000 branches: (4 blocks + locals) × definitions / 32 passes 2^25 words.
    const { before, after, added } = runPass(renameWat(14000), 'SSANoMerge');
    expect(added).toBe(0);
    expect(ssaNoMerge(readForPasses(before).functions[0]!)).toBe(false); // nothing moved
    await same(before, after);
  });

  it('the graph summary holds one entry per read, not one per (read, definition)', () => {
    const m = readForPasses(bytesOf(ifsWat(3000)));
    const g = localGraphSummary(m.functions[0]!, LOCAL_GRAPH_MAX_WORDS)!;
    expect(g.reads.size).toBe(6002); // 3,000 conditions, 3,000 adds, the tail read, the copy of $a
    // (the count is the point: 6,002 entries, not ~4.5 million)
  });

  it('-O3 over n = 3,000 sequential ifs: finishes, and runs the same', async () => {
    // No time bound (round 7): CPU time grew about 4x beside a gate, past a bound that could
    // still catch the old 27 s. The quadratic is held twice above: the COUNT test (one summary
    // entry per read, 6,002 here, not ~4.5 million) for the graph itself, and the SSANoMerge
    // case's own bound (6,000 ifs, 3 s against ~0.3 s; the old code took several seconds) for
    // the pass that runs at -O3 (round 8). This case keeps the whole pipeline honest.
    const before = bytesOf(ifsWat(3000));
    const after = await wasmOpt(before, {
      optimizeLevel: 3,
      shrinkLevel: 0,
      passes: [],
      output: '-',
    }) as Uint8Array;
    await same(before, after);
  });
});
