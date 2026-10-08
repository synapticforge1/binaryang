// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Vacuum, open-work 2 step 6a: an UNNAMED, parameterless block in a sequence
// is spliced into it — nothing can branch to it, so it is only a boundary
// that hides straight-line code from the passes and costs `block … end` in
// the binary. A named block, or one with parameters, stays. Each case RUNS
// the module before and after.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

type Fn = (...a: number[]) => unknown;
/** RemoveUnusedNames (the reader names every block), then Vacuum. */
function vac(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('RemoveUnusedNames').add('Vacuum').run();
  const out = writeWasm(m);
  const { errors } = wasmValidate(out, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text };
}
async function same(before: Uint8Array, after: Uint8Array, inputs: number[][]) {
  const run = async (b: Uint8Array, a: number[]) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource);
    const ex = instance.exports as Record<string, unknown>;
    try {
      return String((ex.f as Fn)(...a));
    } catch (e) {
      return `trap: ${(e as Error).message}`;
    }
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}
const blocks = (text: string) => (text.match(/\(block/g) ?? []).length;

describe('an unnamed block in a sequence is spliced into it', () => {
  it('in the function body, and in a named block — the named one stays', async () => {
    const { before, after, text } = vac(`(module
      (func (export "f") (param i32) (result i32) (local i32)
        (block
          (local.set 1 (i32.add (local.get 0) (i32.const 1)))
          (local.set 1 (i32.mul (local.get 1) (i32.const 3))))
        (block $out
          (block
            (br_if $out (i32.eqz (local.get 0)))
            (local.set 1 (i32.sub (local.get 1) (i32.const 7)))))
        (local.get 1)))`);
    expect(blocks(text)).toBe(1); // $out alone
    await same(before, after, [[0], [1], [-1], [42]]);
  });

  it('a block whose result the sequence takes: the last child provides it', async () => {
    const { before, after, text } = vac(`(module
      (func (export "f") (param i32) (result i32)
        (i32.add
          (local.get 0)
          (block (result i32)
            (local.set 0 (i32.mul (local.get 0) (i32.const 2)))
            (local.get 0)))))`);
    // The block was an operand, not a sequence child — it stays an operand
    // (Vacuum's single-child rule does not apply either: two children).
    expect(blocks(text)).toBe(1);
    await same(before, after, [[0], [1], [-1], [42]]);
    const tail = vac(`(module
      (func (export "f") (param i32) (result i32)
        (local.set 0 (i32.add (local.get 0) (i32.const 1)))
        (block (result i32)
          (local.set 0 (i32.mul (local.get 0) (i32.const 2)))
          (local.get 0))))`);
    expect(blocks(tail.text)).toBe(0);
    await same(tail.before, tail.after, [[0], [1], [-1], [42]]);
  });

  it('a branch target keeps its block, even when the branch is inside', async () => {
    const { before, after, text } = vac(`(module
      (func (export "f") (param i32) (result i32)
        (block $b
          (br_if $b (local.get 0))
          (local.set 0 (i32.const 100)))
        (local.get 0)))`);
    expect(blocks(text)).toBe(1);
    await same(before, after, [[0], [1], [-1], [42]]);
  });
});
