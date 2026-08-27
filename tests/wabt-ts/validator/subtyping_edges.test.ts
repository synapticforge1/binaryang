// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.4 — the ten valid modules T9.3's precise lattice wrongly rejected.
//
// T9.3 traded 10 false rejections for 28 more real errors caught. Every one of
// the 10 turned out to be a place where the OLD coarse lattice had been
// hiding a second bug, not a case the new lattice got wrong:
//
//   * `array.new_elem` still reported the bare `Type.Ref` placeholder as its
//     result — the one producer the T9.3 sweep missed. Five modules.
//   * `br_on_null` skipped pushing its result when the stack was polymorphic.
//     The spec's rule is `[t* (ref null ht)] -> [t* (ref ht)]`: it ALWAYS
//     pushes. Skipping it left the stack one short, so a following `return`
//     compared the label's own type against the function's result.
//   * The canonical key rendered a supertype declared INSIDE the same rec
//     group by index instead of by position, so two structurally identical
//     rec groups keyed differently.
//   * `br_on_cast_fail` passed `rt1` through as the branch type. The branch
//     carries `rt1 \ rt2`, and a NULLABLE rt2 absorbs the null case — so the
//     difference is non-nullable. That is why
//     `br_on_cast_fail $l (ref null any) (ref null struct)` targets a label
//     typed `(ref any)`.
//
// Both directions, measured:
//
//   modules V8 accepts that we accept   2110 -> 2120 / 2120
//   assert_invalid modules we reject    1834 / 2737  (unchanged, still +28
//                                       over the pre-T9.3 1806)
//
// So T9.3 + T9.4 together catch 28 more real errors with no false rejections.

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

function accepts(wat: string): void {
  const bin = compile(wat);
  assert(WebAssembly.validate(toBuf(bin)), `V8 rejected — bad test input:\n${wat}`);
  const v = wasmValidate(bin, { features: allFeatures() });
  assert(!hasErrors(v.errors), `V8 accepted it but we did not: ${formatErrors(v.errors)}`);
}

function rejects(wat: string): void {
  const bin = compile(wat);
  assert(!WebAssembly.validate(toBuf(bin)), `V8 ACCEPTED this — bad test input:\n${wat}`);
  assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Error);
}

describe('T9.4 — array.new_elem reports its real result type', () => {
  it('feeds a (ref $a) slot', () => {
    accepts(`(module
      (type $arr (array i31ref))
      (elem $e i31ref (ref.i31 (i32.const 1)))
      (func (param i32 i32) (result (ref $arr))
        (array.new_elem $arr $e (local.get 0) (local.get 1))))`);
  });

  it('and array.new_data does too', () => {
    accepts(`(module
      (type $arr (array i8))
      (data $d "abc")
      (func (param i32 i32) (result (ref $arr))
        (array.new_data $arr $d (local.get 0) (local.get 1))))`);
  });

  it('but not a slot of a DIFFERENT array type', () => {
    rejects(`(module
      (type $a (array i8))
      (type $b (array i64))
      (data $d "abc")
      (func (param i32 i32) (result (ref $b))
        (array.new_data $a $d (local.get 0) (local.get 1))))`);
  });
});

describe('T9.4 — br_on_null keeps the stack height in unreachable code', () => {
  it('the unreached-valid.wast shape validates', () => {
    accepts(`(module (func (result (ref func))
      (block (result funcref)
        (unreachable)
        (br_on_null 0)
        (return))
      (unreachable)))`);
  });

  it('the externref twin validates', () => {
    accepts(`(module (func (result (ref extern))
      (block (result externref)
        (unreachable)
        (br_on_null 0)
        (return))
      (unreachable)))`);
  });

  it('and a REACHABLE br_on_null still pushes the non-null ref', () => {
    // The label carries `t*` — nothing here — and the FALLTHROUGH gets the
    // non-null ref, which `return` then takes as the function result.
    accepts(`(module (type $t (func))
      (func (param (ref null $t)) (result (ref $t))
        (block $l
          (return (br_on_null $l (local.get 0))))
        (unreachable)))`);
  });
});

describe('T9.4 — rec-group supertypes are keyed by position', () => {
  it('two structurally identical rec groups are the same types', () => {
    // type-subtyping.wast. `$f12` names `$f11` as its supertype from INSIDE
    // the group; keying that by index made the two groups differ.
    accepts(`(module
      (rec (type $f11 (sub (func (result (ref func)))))
           (type $f12 (sub $f11 (func (result (ref $f11))))))
      (rec (type $f21 (sub (func (result (ref func)))))
           (type $f22 (sub $f21 (func (result (ref $f21))))))
      (func $f11 (type $f11) (unreachable))
      (func $f12 (type $f12) (unreachable))
      (elem declare func $f11 $f12)
      (global (ref $f21) (ref.func $f11))
      (global (ref $f22) (ref.func $f12)))`);
  });

  it('rec groups that differ are still different types', () => {
    rejects(`(module
      (rec (type $a1 (sub (func (result i32))))
           (type $a2 (sub $a1 (func (result (ref $a1))))))
      (rec (type $b1 (sub (func (result i64))))
           (type $b2 (sub $b1 (func (result (ref $b1))))))
      (func $f (type $a1) (unreachable))
      (elem declare func $f)
      (global (ref $b1) (ref.func $f)))`);
  });
});

describe('T9.4 — br_on_cast carries rt1 \\ rt2, not rt1', () => {
  it('a nullable rt2 makes the difference non-nullable', () => {
    // br_on_cast_fail.wast's "null-diff": the label is `(ref any)` — NOT
    // `(ref null any)` — precisely because `(ref null struct)` absorbs null.
    accepts(`(module
      (table 10 anyref)
      (func (param $i i32) (result i32)
        (block $l (result (ref any))
          (block (result (ref null struct))
            (br_on_cast_fail $l (ref null any) (ref null struct) (table.get (local.get $i))))
          (return (i32.const 1)))
        (return (i32.const 0))))`);
  });

  it('a NON-nullable rt2 leaves rt1 nullable', () => {
    // Nothing absorbs the null case here, so the branch keeps `anyref`.
    accepts(`(module
      (table 10 anyref)
      (func (param $i i32) (result i32)
        (block $l (result anyref)
          (br_on_cast_fail $l anyref (ref i31) (table.get (local.get $i)))
          (return (i31.get_u)))
        (return (i32.const -1))))`);
  });

  it('the same rule applies to br_on_cast fallthrough', () => {
    accepts(`(module
      (table 10 anyref)
      (func (param $i i32) (result i32)
        (block $l (result (ref i31))
          (br_on_cast $l anyref (ref i31) (table.get (local.get $i)))
          (return (i32.const -1)))
        (i31.get_u)))`);
  });

  it('a label typed for the WRONG side is rejected', () => {
    // The branch of a plain br_on_cast carries rt2 = (ref i31); a label
    // wanting the fallthrough type must not be accepted.
    rejects(`(module
      (table 10 anyref)
      (func (param $i i32) (result i32)
        (block $l (result (ref func))
          (br_on_cast $l anyref (ref i31) (table.get (local.get $i)))
          (return (i32.const -1)))
        (drop) (i32.const 0)))`);
  });
});
