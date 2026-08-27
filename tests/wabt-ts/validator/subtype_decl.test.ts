// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.7 — five more categories of invalid module the validator accepted.
//
//   * DECLARED SUBTYPING was never structurally checked. T9.6 added the
//     finality rule, so `(sub $Super)` was rejected only when `$Super` was
//     final — the definitions themselves were never compared. A struct could
//     extend a func; a subtype could drop or retype a field.
//   * `ref.eq` compares references in the EQ hierarchy. `anyref` is a
//     SUPERTYPE of `eqref`, so `(ref any)` does not qualify. The operands
//     were dropped unchecked.
//   * A bare `select` — no `(result …)` — is defined only for NUMERIC and
//     VECTOR operands, and the two must be the SAME type. Neither held:
//     `select` over two `(ref $t)` values, or over an i32 and an i64,
//     validated and reported whichever type happened to be first.
//   * A NON-DEFAULTABLE table element type needs an initializer. `(table 0
//     (ref func))` has no default value to fill from.
//   * `array.copy` needs the source element to be assignable to the
//     destination's. The operand stack cannot see that — both sides are just
//     `(ref $t)` there.
//
// Also closes the cross-group forward reference T9.6 left documented: a type
// may reach everything before it plus the rest of its own rec group, and
// nothing later. The bound was the section SIZE, which is a different
// question.
//
// assert_invalid correctly rejected: 2579 -> 2629 of 2737. Agreement with V8
// on valid modules stayed 2120/2120.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

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

describe('T9.7 — a declared (sub …) must actually hold', () => {
  it('a struct may not extend a func', () => {
    rejects('(module (type $a (sub (func))) (type $b (sub 0 (struct))))');
  });

  it('a subtype may not drop a field', () => {
    rejects(`(module
      (type $a (sub (struct (field i32) (field i32))))
      (type $b (sub 0 (struct (field i32)))))`);
  });

  it('but it may append fields', () => {
    accepts(`(module
      (type $a (sub (struct (field i32))))
      (type $b (sub 0 (struct (field i32) (field i64)))))`);
  });

  it('a MUTABLE field must match exactly', () => {
    // Read AND written through the supertype, so narrowing would break writes.
    rejects(`(module
      (type $a (sub (struct (field (mut anyref)))))
      (type $b (sub 0 (struct (field (mut eqref))))))`);
  });

  it('an IMMUTABLE field may be narrowed', () => {
    accepts(`(module
      (type $a (sub (struct (field anyref))))
      (type $b (sub 0 (struct (field eqref)))))`);
  });

  it('func params are contravariant and results covariant', () => {
    accepts(`(module
      (type $a (sub (func (param eqref) (result anyref))))
      (type $b (sub 0 (func (param anyref) (result eqref)))))`);
    rejects(`(module
      (type $a (sub (func (param anyref) (result eqref))))
      (type $b (sub 0 (func (param eqref) (result anyref)))))`);
  });

  it('arity must match', () => {
    rejects(`(module
      (type $a (sub (func (param i32))))
      (type $b (sub 0 (func (param i32) (param i32)))))`);
  });

  it('an array element follows the field rules', () => {
    accepts('(module (type $a (sub (array anyref))) (type $b (sub 0 (array eqref))))');
    rejects('(module (type $a (sub (array (mut anyref)))) (type $b (sub 0 (array (mut eqref)))))');
  });
});

describe('T9.7 — ref.eq operands', () => {
  it('anyref is a SUPERTYPE of eqref and does not qualify', () => {
    rejects('(module (func (param (ref any)) (result i32) (ref.eq (local.get 0) (local.get 0))))');
  });

  it('eqref and its subtypes do', () => {
    accepts('(module (func (param eqref) (result i32) (ref.eq (local.get 0) (local.get 0))))');
    accepts('(module (func (param i31ref) (result i32) (ref.eq (local.get 0) (local.get 0))))');
  });
});

describe('T9.7 — bare select', () => {
  it('rejects reference operands', () => {
    rejects(`(module
      (type $t (func))
      (func (param (ref $t)) (drop (select (local.get 0) (local.get 0) (i32.const 1)))))`);
    rejects(
      '(module (func (param funcref) (drop (select (local.get 0) (local.get 0) (i32.const 1)))))',
    );
  });

  it('rejects operands of different types', () => {
    rejects('(module (func (drop (select (i32.const 1) (i64.const 1) (i32.const 1)))))');
  });

  it('accepts matching numeric operands', () => {
    accepts('(module (func (drop (select (i32.const 1) (i32.const 2) (i32.const 1)))))');
    accepts('(module (func (drop (select (f64.const 1) (f64.const 2) (i32.const 1)))))');
  });

  it('and the ANNOTATED form still takes references', () => {
    accepts(`(module (func (param funcref)
      (drop (select (result funcref) (local.get 0) (local.get 0) (i32.const 1)))))`);
  });
});

describe('T9.7 — non-defaultable slots and array.copy', () => {
  it('a non-defaultable table needs an initializer', () => {
    rejects('(module (table 0 (ref func)))');
  });

  it('with one it is fine, and a nullable element never needed one', () => {
    accepts('(module (func $f) (table 1 (ref func) (ref.func $f)))');
    accepts('(module (table 0 funcref))');
  });

  it('array.copy needs the source element assignable to the destination', () => {
    rejects(`(module
      (type $dst (array (mut i8)))
      (type $src (array i16))
      (func (param (ref $dst) (ref $src))
        (array.copy $dst $src (local.get 0) (i32.const 0) (local.get 1) (i32.const 0) (i32.const 0))))`);
  });

  it('matching element types copy fine', () => {
    accepts(`(module
      (type $dst (array (mut i8)))
      (type $src (array i8))
      (func (param (ref $dst) (ref $src))
        (array.copy $dst $src (local.get 0) (i32.const 0) (local.get 1) (i32.const 0) (i32.const 0))))`);
  });
});
