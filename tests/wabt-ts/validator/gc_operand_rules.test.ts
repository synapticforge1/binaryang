// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.9 — five more rules, all of the same shape: a relationship between two
// IMMEDIATES, or between an immediate and a declaration, that the operand
// stack cannot see.
//
//   * `br_on_cast` narrows a reference, so rt2 must be a SUBTYPE of rt1. The
//     two immediates were never compared to each other.
//   * `table.copy` needs the source table's element assignable to the
//     destination's, and `table.init` the segment's element assignable to the
//     table's. Both only carry indices and a count on the stack.
//   * `array.new_data` / `array.init_data` copy raw BYTES, so the element must
//     be numeric or vector; `array.new_elem` / `array.init_elem` copy element
//     expressions, so it must be a reference.
//   * A global's initializer may only name globals declared BEFORE it.
//     `(global $g i32 (global.get 0))` names ITSELF — index 0 is not in scope
//     until its own initializer finishes. Only the MVP imported-global rule
//     was checked, so the relaxed extended-const/GC path let it through.
//
// assert_invalid correctly rejected: 2641 -> 2654 of 2737. Agreement with V8
// on valid modules stayed 2120/2120 throughout.

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

describe('T9.9 — br_on_cast narrows, it cannot widen', () => {
  it('a nullable rt2 under a non-nullable rt1 is rejected', () => {
    rejects(`(module
      (type $s (struct))
      (func (param (ref any)) (result (ref null $s))
        (block $l (result (ref any))
          (br_on_cast $l (ref any) (ref null $s) (local.get 0)))
        (unreachable)))`);
  });

  it('a genuine narrowing is accepted', () => {
    accepts(`(module
      (type $s (struct))
      (func (param (ref any)) (result i32)
        (block $l (result (ref $s))
          (br_on_cast $l (ref any) (ref $s) (local.get 0))
          (return (i32.const 0)))
        (drop) (i32.const 1)))`);
  });
});

describe('T9.9 — table.copy and table.init element types', () => {
  it('copying an externref table into a funcref table is rejected', () => {
    rejects(`(module
      (table $a 1 funcref)
      (table $b 1 externref)
      (func (table.copy $a $b (i32.const 0) (i32.const 0) (i32.const 0))))`);
  });

  it('matching element types copy fine', () => {
    accepts(`(module
      (table $a 1 funcref)
      (table $b 1 funcref)
      (func (table.copy $a $b (i32.const 0) (i32.const 0) (i32.const 0))))`);
  });

  it('an externref segment into a funcref table is rejected', () => {
    rejects(`(module
      (table 1 funcref)
      (elem $e externref (ref.null extern))
      (func (table.init $e (i32.const 0) (i32.const 0) (i32.const 0))))`);
  });
});

describe('T9.9 — array data/elem segment ops need the right element kind', () => {
  it('array.init_data on a reference array is rejected', () => {
    rejects(`(module
      (type $a (array (mut funcref)))
      (data $d "abc")
      (func (param (ref $a))
        (array.init_data $a $d (local.get 0) (i32.const 0) (i32.const 0) (i32.const 0))))`);
  });

  it('array.init_elem on a numeric array is rejected', () => {
    rejects(`(module
      (type $a (array (mut i8)))
      (elem $e funcref)
      (func (param (ref $a))
        (array.init_elem $a $e (local.get 0) (i32.const 0) (i32.const 0) (i32.const 0))))`);
  });

  it('array.new_data on a reference array is rejected', () => {
    rejects(`(module
      (type $a (array (mut funcref)))
      (data $d "abc")
      (func (result (ref $a)) (array.new_data $a $d (i32.const 0) (i32.const 0))))`);
  });

  it('the matching combinations are accepted', () => {
    accepts(`(module
      (type $a (array (mut i8)))
      (data $d "abc")
      (func (param (ref $a))
        (array.init_data $a $d (local.get 0) (i32.const 0) (i32.const 0) (i32.const 0))))`);
    accepts(`(module
      (type $a (array (mut funcref)))
      (elem $e funcref)
      (func (param (ref $a))
        (array.init_elem $a $e (local.get 0) (i32.const 0) (i32.const 0) (i32.const 0))))`);
  });
});

describe('T9.9 — a global initializer may only name earlier globals', () => {
  it('a global naming ITSELF is rejected', () => {
    rejects('(module (global $g i32 (global.get 0)))');
  });

  it('naming a LATER global is rejected', () => {
    rejects('(module (global i32 (global.get 1)) (global $later i32 (i32.const 1)))');
  });

  it('naming an earlier one is fine', () => {
    accepts('(module (global $a i32 (i32.const 1)) (global $b i32 (global.get $a)))');
  });

  it('and an imported global is fine', () => {
    accepts('(module (global $i (import "m" "g") i32) (global i32 (global.get $i)))');
  });
});
