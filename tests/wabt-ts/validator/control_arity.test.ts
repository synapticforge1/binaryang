// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.8 — two control-flow arity rules the validator never applied.
//
//   * A ONE-ARMED `if` falls through producing whatever it was given, so its
//     block type's params and results must match. `(if (result i32) (then …))`
//     with no `else` has nothing to produce on the false path. The missing
//     `else` is not modelled anywhere in the type checker — it only sees the
//     arms it is handed — so this had to be checked from the IR.
//
//   * A `try_table` CATCH CLAUSE hands its target label operands determined by
//     the catch KIND, not by the operand stack:
//
//       catch $tag $l        the tag's params
//       catch_ref $tag $l    the tag's params, plus a NON-NULL (ref exn)
//       catch_all $l         nothing
//       catch_all_ref $l     a non-null (ref exn)
//
//     Only the tag immediate was bounds-checked, so `(catch_ref 0 0)` into a
//     label taking nothing validated clean.
//
// Two things went wrong while adding the catch check, both caught by the
// agreement metric rather than by reasoning:
//
//   1. The catch depths were read AFTER `beginTryTable` pushed the
//      try_table's own label, so every target resolved one level too deep —
//      the same off-by-one T7.6 fixed on the parser side. Six valid modules
//      were rejected. Catches are now checked before the label is pushed.
//   2. `catch_ref` was modelled as producing the NULLABLE `exnref`. It
//      produces `(ref exn)`: there is always an exception when the clause
//      runs. One more valid module rejected.
//
// assert_invalid correctly rejected: 2632 -> 2641 of 2737. Agreement with V8
// on valid modules is back to 2120/2120.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toBuf(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return buf;
}

function rejects(wat: string): void {
  const bin = compile(wat);
  assert(!WebAssembly.validate(toBuf(bin)), `V8 ACCEPTED this — bad test input:\n${wat}`);
  const v = wasmValidate(bin, { features: allFeatures() });
  assertEquals(v.result, Result.Error, `we accepted a module V8 rejects:\n${wat}`);
  assert(hasErrors(v.errors), `rejected but reported nothing:\n${wat}`);
}

function accepts(wat: string): void {
  const bin = compile(wat);
  assert(WebAssembly.validate(toBuf(bin)), `V8 rejected — bad test input:\n${wat}`);
  assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Ok);
}

describe('T9.8 — a one-armed if must start and end with the same arity', () => {
  it('rejects a result with no else', () => {
    rejects('(module (func (result i32) (if (result i32) (i32.const 1) (then (i32.const 0)))))');
  });

  it('rejects a result count mismatch', () => {
    rejects(`(module (func (result i32 i32)
      (i32.const 1)
      (if (param i32) (result i32 i32) (i32.const 1) (then (i32.const 0) (i32.const 0)))))`);
  });

  it('accepts a void one-armed if', () => {
    accepts('(module (func (if (i32.const 1) (then (nop)))))');
  });

  it('accepts one whose params and results match', () => {
    accepts(`(module (func (result i32)
      (i32.const 7)
      (if (param i32) (result i32) (i32.const 1) (then (drop) (i32.const 0)))))`);
  });

  it('and a TWO-armed if with a result is still fine', () => {
    accepts(`(module (func (result i32)
      (if (result i32) (i32.const 1) (then (i32.const 0)) (else (i32.const 1)))))`);
  });
});

describe('T9.8 — try_table catch clauses match their target label', () => {
  it('catch_ref into a label taking nothing is rejected', () => {
    rejects('(module (tag $e) (func (try_table (catch_ref $e 0))))');
  });

  it('catch into a label expecting a value is rejected', () => {
    rejects(`(module
      (tag $e)
      (func (result exnref)
        (block $l (result exnref)
          (try_table (catch $e $l))
          (unreachable))))`);
  });

  it('catch_all_ref hands over a (ref exn), not nothing', () => {
    rejects('(module (func (try_table (catch_all_ref 0))))');
  });

  it('a tag with params must match the label', () => {
    rejects(`(module
      (tag $e (param i32))
      (func (try_table (catch $e 0))))`);
  });

  it('the matching shapes are accepted', () => {
    // catch_all -> nothing.
    accepts('(module (func (try_table (catch_all 0))))');
    // catch $e -> the tag's params.
    accepts(`(module
      (tag $e (param i32))
      (func (result i32)
        (block $l (result i32)
          (try_table (catch $e $l))
          (i32.const 0))))`);
    // catch_ref $e -> params plus a non-null (ref exn).
    accepts(`(module
      (tag $e (param i32))
      (func (result i32)
        (block $l (result i32 (ref exn))
          (try_table (catch_ref $e $l))
          (unreachable))
        (drop)))`);
  });

  it('a catch depth is relative to the ENCLOSING scope', () => {
    // Depth 0 from inside a try_table names the block AROUND it, not the
    // try_table itself. Reading it one level deeper rejected six valid
    // spec-testsuite modules.
    accepts(`(module
      (tag $e (param i32))
      (func (result i32)
        (block $outer (result i32)
          (try_table (catch $e $outer))
          (i32.const 1))))`);
  });

  it('an out-of-range tag is still caught', () => {
    rejects('(module (func (try_table (catch 7 0))))');
  });
});
