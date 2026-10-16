// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Effects, open-work 31: two expressions that may both trap change places only when both can trap
// only as "out of bounds memory access" (plain loads and stores): the kind a run reports is then
// the same whichever traps first. Upstream lets any two implicit traps change places; a trap's
// KIND is observable here (wasmtk's runner checks it). Seen through SimplifyLocals, which sinks a
// `local.set` past what lies between it and its read. Each case RUNS the module before and after,
// trap messages included, with inputs that make each access trap.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

type Fn = (...a: number[]) => unknown;

function sl(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('SimplifyLocals').run();
  const after = writeWasm(m);
  expect(wasmValidate(after, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after, text: wasm2wat(after).text };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    const ex = instance.exports as Record<string, unknown>;
    const g = () => (ex['g'] instanceof WebAssembly.Global ? ` g=${ex['g'].value}` : '');
    try {
      return `${a} -> ${String((ex['f'] as Fn)(...a))}${g()}`;
    } catch (e) {
      return `${a} -> trap: ${(e as Error).message}${g()}`;
    }
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

const count = (text: string, s: string) => text.split(s).length - 1;
const OOB = 70000; // past the one page

describe('a value that may trap moves past', () => {
  it('another plain load: both can only trap out of bounds', async () => {
    const { before, after, text } = sl(`(module (memory 1)
      (func (export "f") (param i32 i32) (result i32) (local $a i32) (local $b i32)
        (local.set $a (i32.load (local.get 0)))
        (local.set $b (i32.load (local.get 1)))
        (i32.add (local.get $b) (local.get $a))))`);
    expect(count(text, 'local.set')).toBe(0);
    await same(before, after, [[0, 4], [OOB, 4], [0, OOB], [OOB, OOB]]);
  });
});

describe('a value that may trap does NOT move past', () => {
  it('a division: it traps with another kind', async () => {
    const { before, after, text } = sl(`(module (memory 1)
      (func (export "f") (param i32 i32) (result i32) (local $a i32) (local $b i32)
        (local.set $a (i32.load (local.get 0)))
        (local.set $b (i32.div_u (i32.const 100) (local.get 1)))
        (i32.add (local.get $b) (local.get $a))))`);
    expect(count(text, 'local.set')).toBe(1); // $b sinks into its read; $a may not pass it
    await same(before, after, [[0, 4], [OOB, 4], [0, 0], [OOB, 0]]);
  });

  // A global, not a store: a store would also conflict with the load through memory, and that
  // conflict alone would hold the load back.
  it('a global write: a trap after it would show it', async () => {
    const { before, after, text } = sl(`(module (memory 1)
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "f") (param i32 i32) (result i32) (local $a i32)
        (local.set $a (i32.load (local.get 0)))
        (global.set $g (local.get 1))
        (local.get $a)))`);
    expect(count(text, 'local.set')).toBe(1);
    await same(before, after, [[0, 4], [OOB, 4]]);
  });
});
