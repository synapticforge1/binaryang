// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 2: ConstantPropagation — a `local.get` whose only reaching value is
// one constant becomes that constant (owner, 2026-10-06: "Constant propagation
// may go into item 2 now"). The example that priced it, `10b_DynamicArrays.wat`
// $7: `(local.set $12 (local.tee $15 (i32.const 132)))`, and $15 read later.
//
// Replacing a read that can see TWO values is a silent miscompile, so every
// case where a read must be left alone RUNS the module, before and after, on
// inputs that take each path — a text check alone would pass a pass that
// replaced the read with the wrong one of the two.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm, writeWat } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

function propagate(wat: string) {
  const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
  new PassRunner(m, {}).add('ConstantPropagation').run();
  return m;
}
/** The body of the one function `f`, as text: what the pass left. */
function body(wat: string): string {
  return writeWat(propagate(wat));
}
async function call(bytes: Uint8Array, args: number[]): Promise<number | bigint> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  return (instance.exports.f as (...a: number[]) => number | bigint)(...args);
}
/** `f` gives the same result before and after the pass on each argument list. */
async function sameResults(wat: string, ...argLists: number[][]): Promise<void> {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const after = writeWasm(propagate(wat));
  for (const args of argLists) {
    expect(await call(after, args)).toBe(await call(before, args));
  }
}

describe('a read with one constant reaching it becomes the constant', () => {
  it('through a tee and a copy — the example that priced it', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32 i32)
      (local.set 1 (local.tee 2 (i32.const 132)))
      (i32.add (i32.sub (local.get 0) (local.get 1)) (local.get 2))))`;
    const text = body(wat);
    expect(text).not.toContain('local.get 1');
    expect(text).not.toContain('local.get 2');
    expect(text).toContain('local.get 0'); // a parameter is never a constant
    await sameResults(wat, [5], [-1]);
  });

  it("a declared local's zero, as wasm initialises it", async () => {
    const wat = `(module (func (export "f") (result i64) (local i64) (local.get 0)))`;
    expect(body(wat)).toContain('i64.const 0');
    await sameResults(wat, []);
  });

  it('the SAME constant on both arms of an if', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (if (local.get 0) (then (local.set 1 (i32.const 7))) (else (local.set 1 (i32.const 7))))
      (local.get 1)))`;
    expect(body(wat)).not.toContain('local.get 1');
    await sameResults(wat, [0], [1]);
  });

  it('a loop that only copies the value back keeps it', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (local.set 1 (i32.const 5))
      (loop $l (local.set 1 (local.get 1)) (br_if $l (local.tee 0 (i32.sub (local.get 0) (i32.const 1)))))
      (local.get 1)))`;
    expect(body(wat)).not.toContain('local.get 1');
    await sameResults(wat, [1], [3]);
  });

  it('floats compare by BITS: a NaN payload is kept, -0 is not +0', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local f32)
      (if (local.get 0)
        (then (local.set 1 (f32.const -0)))
        (else (local.set 1 (f32.const 0))))
      (i32.reinterpret_f32 (local.get 1))))`;
    expect(body(wat)).toContain('local.get 1');
    await sameResults(wat, [0], [1]);
    const nan = `(module (func (export "f") (result i32) (local f32)
      (local.set 0 (f32.const nan:0x200001))
      (i32.reinterpret_f32 (local.get 0))))`;
    expect(body(nan)).toContain('nan:0x200001');
    await sameResults(nan, []);
  });
});

describe('a read that can see two values is left alone — and the module RUNS the same', () => {
  it('two constants meet at an if', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (if (local.get 0) (then (local.set 1 (i32.const 1))) (else (local.set 1 (i32.const 2))))
      (local.get 1)))`;
    expect(body(wat)).toContain('local.get 1');
    await sameResults(wat, [0], [1]);
  });

  it('a constant on one path, the zero init on the other', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (if (local.get 0) (then (local.set 1 (i32.const 9))))
      (local.get 1)))`;
    expect(body(wat)).toContain('local.get 1');
    await sameResults(wat, [0], [1]);
  });

  it('a value the loop changes on its back edge', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (local.set 1 (i32.const 5))
      (loop $l
        (local.set 1 (i32.add (local.get 1) (i32.const 1)))
        (br_if $l (local.tee 0 (i32.sub (local.get 0) (i32.const 1)))))
      (local.get 1)))`;
    expect(body(wat)).not.toMatch(/i32\.add\s+\(i32\.const 5\)/);
    await sameResults(wat, [1], [4]);
  });

  it('a back edge that changes the value a block PAST the loop head reads', async () => {
    // The `then` arm first sees 5 from the entry; only after the back edge
    // brings 9 to the loop head, and the head is flowed again, does it see both.
    // (Every other loop case here reads in the head itself, which a fixed point
    // reached without that second flow would also have got right.)
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32 i32)
      (local.set 1 (i32.const 5))
      (loop $l
        (if (local.get 0) (then (local.set 2 (i32.add (local.get 2) (local.get 1)))))
        (local.set 1 (i32.const 9))
        (br_if $l (local.tee 0 (i32.sub (local.get 0) (i32.const 1)))))
      (local.get 2)))`;
    expect(body(wat)).toContain('local.get 1');
    await sameResults(wat, [1], [2], [3]);
  });

  it('a branch out of a block past the second set', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (local.set 1 (i32.const 3))
      (block $b
        (br_if $b (local.get 0))
        (local.set 1 (i32.const 4)))
      (local.get 1)))`;
    expect(body(wat)).toContain('local.get 1');
    await sameResults(wat, [0], [1]);
  });

  it('a legacy try: the handler sees the value from BEFORE the throwing call', async () => {
    // The set after the call never lands when it throws: 1 reaches the end by
    // the handler, 2 by the normal path.
    const wat = `(module (tag $e)
      (func $maybe (param i32) (if (local.get 0) (then (throw $e))))
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.const 1))
        (try (do (call $maybe (local.get 0)) (local.set 1 (i32.const 2))) (catch_all))
        (local.get 1)))`;
    expect(body(wat)).toContain('local.get 1');
    await sameResults(wat, [0], [1]);
  });

  it('a try_table: the catch destination sees the value from before the throw', async () => {
    const wat = `(module (tag $e)
      (func $maybe (param i32) (if (local.get 0) (then (throw $e))))
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.const 1))
        (block $h
          (try_table (catch_all $h)
            (call $maybe (local.get 0))
            (local.set 1 (i32.const 2))))
        (local.get 1)))`;
    expect(body(wat)).toContain('local.get 1');
    await sameResults(wat, [0], [1]);
  });

  it('a set BEFORE the throwing call reaches the handler and the end alike', async () => {
    // The other side of the case above: here 2 is the only value either path
    // can carry, and replacing the read is right.
    const wat = `(module (tag $e)
      (func $maybe (param i32) (if (local.get 0) (then (throw $e))))
      (func (export "f") (param i32) (result i32) (local i32)
        (local.set 1 (i32.const 1))
        (try (do (local.set 1 (i32.const 2)) (call $maybe (local.get 0))) (catch_all))
        (local.get 1)))`;
    expect(body(wat)).not.toContain('local.get 1');
    await sameResults(wat, [0], [1]);
  });
});
