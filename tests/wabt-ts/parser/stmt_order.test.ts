// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression: a value-producing instruction at statement position (most
// importantly a void `call`, indistinguishable from a value-returning call
// without the callee's signature) was pushed onto the operand stack and only
// committed to `stmts` by the enclosing block's end-of-body flush — AFTER
// every genuine statement. So a folded `(call $f) … (return X)` sank the call
// past the return, turning a side-effecting call into dead code. The call's
// store never ran, so cross-function state was silently dropped.
//
// Reported via wasmtk's shared-heap stdlib track (the exact W/X/Y cases that
// characterized the bug are reproduced below as runtime checks).

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors } from '../../src/core/error.ts';

async function runTest(wat: string): Promise<number> {
  const r = wat2wasm(wat);
  if (r.result !== Result.Ok) console.log('parse errors:\n' + formatErrors(r.errors));
  assertEquals(r.result, Result.Ok);
  const buf = new ArrayBuffer(r.binary.byteLength);
  new Uint8Array(buf).set(r.binary);
  const inst = (await WebAssembly.instantiate(buf)).instance.exports as {
    test: () => number;
  };
  return inst.test();
}

describe('statement order: side-effecting call before return', () => {
  // Case W — the exact wasic shape: call(arg); local.set; return.
  it('call(arg) executes before an explicit return that reads its effect', async () => {
    const wat = `(module (memory (export "memory") 1)
      (func $wc (param $h i32) (i32.store (i32.const 24) (i32.const 555)))
      (func (export "test") (result i32) (local $v i32)
        (call $wc (i32.const 16))
        (local.set $v (i32.const 99))
        (return (i32.load (i32.const 24)))))`;
    assertEquals(await runTest(wat), 555);
  });

  // Case X — call followed by fallthrough value (no explicit return).
  it('call before a trailing fallthrough result value still executes', async () => {
    const wat = `(module (memory (export "memory") 1)
      (func $wc (i32.store (i32.const 24) (i32.const 555)))
      (func (export "test") (result i32)
        (call $wc)
        (i32.load (i32.const 24))))`;
    assertEquals(await runTest(wat), 555);
  });

  // Case Y — call followed by a non-call statement, then return.
  it('call before a (drop …) statement and an explicit return executes', async () => {
    const wat = `(module (memory (export "memory") 1)
      (func $wc (i32.store (i32.const 24) (i32.const 555)))
      (func (export "test") (result i32)
        (call $wc)
        (drop (i32.const 7))
        (return (i32.load (i32.const 24)))))`;
    assertEquals(await runTest(wat), 555);
  });

  // A void call sitting between two statements keeps its source position.
  it('preserves order of multiple side-effecting calls', async () => {
    const wat = `(module (memory (export "memory") 1)
      (func $a (i32.store (i32.const 24) (i32.const 1)))
      (func $b (i32.store (i32.const 24) (i32.const 2)))
      (func (export "test") (result i32) (local $v i32)
        (call $a)
        (local.set $v (i32.const 0))
        (call $b)
        (return (i32.load (i32.const 24)))))`;
    // $b runs after $a, so the final stored value is 2.
    assertEquals(await runTest(wat), 2);
  });

  // Guard: the multi-value receive idiom (Bug D) must still work — there the
  // call's result IS consumed by the following local.sets, so nothing should
  // be flushed to stmts early.
  it('does not regress the multi-value receive idiom', async () => {
    const wat = `(module
      (func $two (result i32 i32) (i32.const 11) (i32.const 22))
      (func (export "test") (result i32)
        (local $a i32) (local $b i32)
        (call $two)
        (local.set $b)
        (local.set $a)
        (return (i32.add (local.get $a) (local.get $b)))))`;
    assertEquals(await runTest(wat), 33);
  });
});
