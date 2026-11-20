// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// PrecomputePropagate is linear in a long flat chain (2026-11-20, found testing long inputs;
// README "Limits on untrusted input"). On `x = x + 1; if (x == k) br $out` repeated n times in one
// block, n = 750 / 1500 / 3000 took 1.9 / 5.7 / 19.7 s at -O2 on Bun (26 s on 3,000):
// ConstantPropagation's worklist was a FIFO queue, so the block after `$out`, with n predecessors,
// ran once per predecessor and each run met all n. Now blocks run in reverse postorder: once.
// (Upstream's wasm-opt 133: 0.7 s.) The case asserts a time bound the quadratic code misses by a
// wide margin, and RUNS the module before and after.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';

type Fn = (a: number) => number;

const rep = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => f(i)).join('\n');

/** `x = x + 1; if (x == i + 5) br $out`, n times, in one block. */
const brWat = (n: number) =>
  `(module (func (export "f") (param $a i32) (result i32) (local $x i32)
  (block $out ${
    rep(
      n,
      (i) =>
        `(local.set $x (i32.add (local.get $x) (i32.const 1))) (if (i32.eq (local.get $x) (i32.const ${
          i + 5
        })) (then (br $out)))`,
    )
  }) (i32.add (local.get $x) (local.get $a))))`;

const bytesOf = (wat: string) => wat2wasm(wat, { textForm: false }).binary;
const exportOf = async (b: Uint8Array) =>
  (await WebAssembly.instantiate(b as BufferSource)).instance.exports['f'] as Fn;

function runPass(wat: string, pass: string) {
  const before = bytesOf(wat);
  const m = readForPasses(before);
  const declared = m.functions[0]!.locals.length;
  const t = performance.now();
  new PassRunner(m, {}).add(pass).run();
  const ms = performance.now() - t;
  return { before, after: writeWasm(m), ms, added: m.functions[0]!.locals.length - declared };
}

async function same(before: Uint8Array, after: Uint8Array) {
  const [f0, f1] = [await exportOf(before), await exportOf(after)];
  for (const a of [0, 1, 4, 5, 100, -1, 0x7fffffff]) expect(f1(a)).toBe(f0(a));
}

describe('PrecomputePropagate on a long flat chain', () => {
  it('PrecomputePropagate: n = 6,000 `if (x == k) br` in one block, under 4 s', async () => {
    const { before, after, ms } = runPass(brWat(6000), 'PrecomputePropagate');
    expect(ms).toBeLessThan(4000); // measured ~1.1 s; the FIFO worklist took ~9 s
    await same(before, after);
  });
});
