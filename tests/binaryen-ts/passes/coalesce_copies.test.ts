// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 2, step 1: CoalesceLocals learns what upstream's already does —
// a COPY (`local.set x (local.get y)`) does not make x and y interfere, a
// variable may take a PARAM's slot, and a copy onto itself once coalesced goes.
// An inline leaves exactly such copies (`local.set 1 (local.get 0)` for each
// parameter); before this they survived every level.
//
// The other direction matters as much: a copy must NOT share a slot when one
// side is written while the other still holds the old value — a merge there is
// a silent miscompile, so those cases RUN the module.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm, writeWat } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

function coalesce(wat: string) {
  const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
  new PassRunner(m, {}).add('CoalesceLocals').run();
  return m;
}
async function run(wat: string, ...args: number[]): Promise<number> {
  const bytes = writeWasm(coalesce(wat));
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  return (instance.exports.f as (...a: number[]) => number)(...args);
}

describe('a copy shares its source slot and disappears', () => {
  it('a variable copied from a param takes the param slot: no local, no copy', () => {
    const m = coalesce(`(module (func (export "f") (param i32) (result i32) (local i32)
      (local.set 1 (local.get 0))
      (i32.add (local.get 1) (local.get 1))))`);
    const f = m.functions[0]!;
    expect(f.locals.length).toBe(1); // the param alone
    expect(writeWat(m)).not.toContain('local.set');
  });

  it('a copy whose SOURCE is still read after it: the copy alone does not interfere', async () => {
    // Both are live after the copy, holding one value — only the copy exemption merges them.
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (local.set 1 (local.get 0))
      (i32.add (local.get 1) (local.get 0))))`;
    const m = coalesce(wat);
    expect(m.functions[0]!.locals.length).toBe(1);
    expect(writeWat(m)).not.toContain('local.set');
    expect(await run(wat, 5)).toBe(10);
  });

  it('a copy between two variables — both into the dead param slot', async () => {
    // The param is not read after the multiply, so all three share its slot:
    // one local, one set, and the copy is gone.
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32 i32)
      (local.set 1 (i32.mul (local.get 0) (i32.const 3)))
      (local.set 2 (local.get 1))
      (i32.add (local.get 2) (i32.const 1))))`;
    const m = coalesce(wat);
    expect(m.functions[0]!.locals.length).toBe(1);
    expect(writeWat(m).match(/local\.set/g)?.length).toBe(1);
    expect(await run(wat, 5)).toBe(16);
  });
});

describe('a copy does NOT merge when either side changes while the other is live', () => {
  it('the source is overwritten while the copy is still read', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (local.set 1 (local.get 0))
      (local.set 0 (i32.const 100))
      (i32.add (local.get 1) (local.get 0))))`;
    expect(await run(wat, 5)).toBe(105);
  });

  it('the copy is overwritten while the source is still read', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (local.set 1 (local.get 0))
      (local.set 1 (i32.add (local.get 1) (i32.const 1)))
      (i32.mul (local.get 1) (local.get 0))))`;
    expect(await run(wat, 5)).toBe(30);
  });

  it('across a loop: the copy holds the previous iteration', async () => {
    // prev = cur; cur = cur + 1 … — prev and cur differ on every back-edge.
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32 i32)
      (loop $l
        (local.set 2 (local.get 1))
        (local.set 1 (i32.add (local.get 1) (i32.const 1)))
        (br_if $l (i32.lt_u (local.get 1) (local.get 0))))
      (i32.add (i32.mul (local.get 2) (i32.const 1000)) (local.get 1))))`;
    expect(await run(wat, 4)).toBe(3004);
  });

  it('a zero-initialised variable does not take a live param slot', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (i32.add (local.get 1) (local.get 0))))`;
    expect(await run(wat, 7)).toBe(7);
  });
});

describe('a tee of its own slot is the read', () => {
  it('local.tee x (local.get y) with x, y coalesced', () => {
    const m = coalesce(`(module (func (export "f") (param i32) (result i32) (local i32)
      (i32.add (local.tee 1 (local.get 0)) (local.get 1))))`);
    expect(writeWat(m)).not.toContain('local.tee');
  });
});
