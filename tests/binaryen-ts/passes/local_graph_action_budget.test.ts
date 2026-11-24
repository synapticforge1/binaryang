// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The LocalGraph budget counted blocks and definitions but not the work of each set and read:
// every one of them is a pass over a bitset of definitions / 32 words, so n sets of one local
// in ONE block cost n² / 32 whatever the blocks. SSANoMerge alone on `x = x + i` (Bun): 50,000
// sets 1.6 s, 200,000 sets 17.8 s, with a read each 33.4 s (round 3 review, 2026-11-20). The
// budget now includes (sets + reads) × words, against four times LOCAL_GRAPH_MAX_WORDS.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { LOCAL_GRAPH_MAX_WORDS, localGraphSummary } from '../../../src/passes/local-graph.ts';
import { ssaNoMerge } from '../../../src/passes/ssa-nomerge.ts';

const rep = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => f(i)).join('\n');

/** `x = x + i`, n times, in one block. */
const plusWat = (n: number) =>
  `(module (func (export "f") (param i32) (result i32) (local i32) (local.set 1 (local.get 0))
  ${rep(n, (i) => `(local.set 1 (i32.add (local.get 1) (i32.const ${i})))`)} (local.get 1)))`;

const fnOf = (wat: string) =>
  readForPasses(wat2wasm(wat, { textForm: false }).binary).functions[0]!;

describe('the local graph budget counts the work of each set and read', () => {
  it('3,000 sets of one local in one block: solved', () => {
    expect(localGraphSummary(fnOf(plusWat(3000)), LOCAL_GRAPH_MAX_WORDS)).toBeDefined();
  });

  it('60,000 sets in one block (60,000 sets and reads over 1,876 words): given up at once', () => {
    const fn = fnOf(plusWat(60_000));
    const t = performance.now();
    expect(localGraphSummary(fn, LOCAL_GRAPH_MAX_WORDS)).toBeUndefined(); // it was solved, ~4 s
    expect(ssaNoMerge(fn)).toBe(false); // so SSANoMerge leaves the function
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
