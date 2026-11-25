// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// PrecomputePropagate is linear in a long flat chain (2026-11-20, found testing long inputs;
// README "Limits on untrusted input"). On `x = x + 1; if (x == k) br $out` repeated n times in one
// block, n = 750 / 1500 / 3000 took 1.9 / 5.7 / 19.7 s at -O2 on Bun (26 s on 3,000):
// ConstantPropagation's worklist was a FIFO queue, so the block after `$out`, with n predecessors,
// ran once per predecessor and each run met all n. Now blocks run in reverse postorder: once.
// (Upstream's wasm-opt 133: 0.7 s.) The case bounds the WORK, the predecessor states met
// (`propagationWork`), which no load on the machine can move: a time bound failed twice beside a
// gate (review round 6). It also RUNS the module before and after.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { propagationWork } from '../../../src/passes/constant-propagation.ts';
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

/** Runs `pass` once; the module before and after, and the predecessor states it met. */
function runPass(wat: string, pass: string) {
  const before = bytesOf(wat);
  const m = readForPasses(before);
  const at = propagationWork.meets;
  new PassRunner(m, {}).add(pass).run();
  return { before, after: writeWasm(m), meets: propagationWork.meets - at };
}

async function same(before: Uint8Array, after: Uint8Array) {
  const [f0, f1] = [await exportOf(before), await exportOf(after)];
  for (const a of [0, 1, 4, 5, 100, -1, 0x7fffffff]) expect(f1(a)).toBe(f0(a));
}

describe('PrecomputePropagate on a long flat chain', () => {
  it('PrecomputePropagate: n = 6,000 `if (x == k) br` in one block, linear work', async () => {
    const n = 6000;
    const { before, after, meets } = runPass(brWat(n), 'PrecomputePropagate');
    // Measured (round 6): 191 meets per statement at n = 1,500 / 3,000 / 6,000, linear. The FIFO
    // order met 70.9M / 285.8M / 1,147.6M, quadratic: about 190 times this bound at 6,000.
    expect(meets).toBeLessThan(1000 * n);
    await same(before, after);
  });
});
