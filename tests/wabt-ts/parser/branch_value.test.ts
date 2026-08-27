// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression: `br_if` / `br_table` that carry a branch VALUE were mis-encoded.
//
// The stack order for `br_if` is `[value?] [cond]` — the i32 condition is the
// TOP operand, and the optional branch value (present only when the target
// label has a result) sits below it. The parser read `cond` from the bottom
// operand and `value` from the top, swapping them: `(br_if $l (local.get 0)
// (i32.const 1))` branched with the condition (1) instead of the value (9),
// and with code after the branch produced a stack V8 rejected. `br_table` had
// a parallel bug: it was classified as variable-arity and drained the WHOLE
// surrounding stack, keeping only the bottom operand as its index and dropping
// the real index — so a br_table whose target carries a value emitted the
// branch value in place of the index.
//
// Surfaced by wasmtk's WASM-spec-testsuite runner (~34 failures isolated to
// two root causes; this is one of them). V8 executes the fixed binaries with
// the spec-mandated results below.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

async function run(wat: string, arg?: number): Promise<number> {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary, 'expected a binary');
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  const { instance } = await WebAssembly.instantiate(buf);
  return (instance.exports.f as (a?: number) => number)(arg);
}

describe('br_if with a carried value', () => {
  it('folded: block result is the value, not the condition', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l (result i32) (br_if $l (local.get 0) (i32.const 1)))))`;
    assertEquals(await run(wat, 9), 9);
  });

  it('linear: block result is the value, not the condition', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l (result i32) local.get 0 i32.const 1 br_if $l)))`;
    assertEquals(await run(wat, 9), 9);
  });

  it('taken vs fallthrough with code after the branch (drop form)', async () => {
    // Branch taken (cond != 0) yields the carried value; fallthrough drops it
    // and runs the trailing code.
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l (result i32)
        (drop (br_if $l (i32.const 1) (local.get 0)))
        (i32.const 7))))`;
    assertEquals(await run(wat, 9), 1);
    assertEquals(await run(wat, 0), 7);
  });

  it('spec br_if.wast as-block-first shape (return after branch)', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block (result i32)
        (br_if 0 (i32.const 2) (local.get 0))
        (return (i32.const 3)))))`;
    assertEquals(await run(wat, 9), 2);
    assertEquals(await run(wat, 0), 3);
  });

  it('void target: condition is honored, no stray value', async () => {
    // br_if to a void block; the carried value slot must stay empty.
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l
        (br_if $l (local.get 0))
        (return (i32.const 100)))
      (i32.const 200)))`;
    assertEquals(await run(wat, 1), 200); // branch taken -> falls out of block
    assertEquals(await run(wat, 0), 100); // not taken -> return 100
  });
});

describe('br_table with a carried value', () => {
  it('index is the top operand; the value is carried, not the index', async () => {
    // Stack: [value=7] [index]. br_table pops the index; the block result is 7.
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l (result i32)
        i32.const 7 local.get 0 br_table $l $l
        i32.const -1)))`;
    assertEquals(await run(wat, 0), 7);
    assertEquals(await run(wat, 1), 7);
  });

  it('void br_table still dispatches by index', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $default
        (block $b1
          (block $b0
            local.get 0
            br_table $b0 $b1 $default)
          (return (i32.const 10)))
        (return (i32.const 20)))
      (i32.const 30)))`;
    assertEquals(await run(wat, 0), 10);
    assertEquals(await run(wat, 1), 20);
    assertEquals(await run(wat, 5), 30);
  });
});
