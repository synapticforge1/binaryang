// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Branches carrying MULTIPLE values were truncated to the first.
//
// `BrExpr.value?: Expr` and `BrIfExpr.value?: Expr` held a single operand, so
// a branch to a label with N results emitted one value and V8 rejected the
// function with "expected N elements on the stack". Exactly the defect
// `ReturnExpr.values: Expr[]` already fixed for `return`; both now use
// `values: Expr[]` in stack order.
//
// `br_table` had a related but distinct bug. Its index is the TOP operand and
// carried values sit below it, but the node took `op0()` as the index -- so
// the FOLDED form `(br_table $a $b (i32.const 7) (local.get 0))` put the
// carried value in the index slot and dropped the real index. The linear form
// happened to work, which is why the existing br_table test passed. It now
// takes the LAST operand as the index and keeps the rest in `values`.
//
// The operand-order invariants these tests guard were established in v1.3.4
// (`br_if` cond is the top operand; `br_table` consumes exactly one index)
// and must survive this change.
//
// Spec testsuite: fully V8-valid 200 -> 214, and the stack-arity cluster went
// from 14 files to 4.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

async function run(wat: string, arg?: number): Promise<unknown> {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  assert(WebAssembly.validate(buf), 'V8 rejected the module');
  const { instance } = await WebAssembly.instantiate(buf);
  return (instance.exports.f as (a?: number) => unknown)(arg);
}

/** wasm2wat then wat2wasm again. */
function roundTrips(wat: string): boolean {
  const { text, errors } = wasm2wat(compile(wat));
  if (hasErrors(errors) || !text) return false;
  return !hasErrors(wat2wasm(text).errors);
}

describe('br carrying multiple values', () => {
  it('a function-level multi-value br returns every value', async () => {
    // The exact shape from func.wast that was failing.
    const wat = '(module (func (export "f") (result i32 f64) (br 0 (i32.const 79) (f64.const 8))))';
    assertEquals(await run(wat), [79, 8]);
    assert(roundTrips(wat));
  });

  it('a multi-value br to a block label', async () => {
    const wat = `(module (func (export "f") (result i32 i32)
      (block $l (result i32 i32) (br $l (i32.const 3) (i32.const 4)))))`;
    assertEquals(await run(wat), [3, 4]);
  });

  it('three values', async () => {
    const wat = `(module (func (export "f") (result i32 i64 f32)
      (br 0 (i32.const 1) (i64.const 2) (f32.const 3))))`;
    assertEquals(await run(wat), [1, 2n, 3]);
  });

  it('single-value br still works', async () => {
    assertEquals(await run('(module (func (export "f") (result i32) (br 0 (i32.const 5))))'), 5);
  });

  it('void br still works', async () => {
    assertEquals(await run('(module (func (export "f") (block $l (br $l))))'), undefined);
  });
});

describe('br_if carrying multiple values', () => {
  it('both paths yield every value', async () => {
    // br_if leaves its values on the stack when NOT taken, so they are the
    // block result either way -- nothing may follow inside the block.
    const wat = `(module (func (export "f") (param i32) (result i32 f64)
      (block $l (result i32 f64)
        (br_if $l (i32.const 79) (f64.const 8) (local.get 0)))))`;
    assertEquals(await run(wat, 1), [79, 8], 'taken');
    assertEquals(await run(wat, 0), [79, 8], 'not taken');
  });

  it('v1.3.4 invariant holds: cond is the TOP operand, not the value', async () => {
    // If cond and value were swapped the block would yield 1, not 9.
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l (result i32) (br_if $l (local.get 0) (i32.const 1)))))`;
    assertEquals(await run(wat, 9), 9);
  });

  it('void target keeps the value slot empty', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l
        (br_if $l (local.get 0))
        (return (i32.const 100)))
      (i32.const 200)))`;
    assertEquals(await run(wat, 1), 200);
    assertEquals(await run(wat, 0), 100);
  });
});

describe('br_table index is the top operand', () => {
  it('FOLDED form: value carried, index selects the target', async () => {
    // Previously the first child landed in the index slot and the real index
    // was dropped. $b is targets[0], $a the default.
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $a (result i32) (block $b (result i32)
        (br_table $b $a (i32.const 7) (local.get 0))))))`;
    assertEquals(await run(wat, 0), 7);
    assertEquals(await run(wat, 1), 7);
  });

  it('LINEAR form still works', async () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l (result i32)
        i32.const 7 local.get 0 br_table $l $l
        i32.const -1)))`;
    assertEquals(await run(wat, 0), 7);
    assertEquals(await run(wat, 1), 7);
  });

  it('void br_table dispatches by index', async () => {
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
