// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.14 — twelve GC operand checks that a sibling handler already had.
//
// Every one of these is a FALSE ACCEPT: our validator said Ok, and V8 and
// Wasmtime 47.0.3 both reject. They fall into four roots, and each root is the
// same shape the campaign keeps finding — a check that exists for one member
// of an instruction family and silently does nothing for its siblings:
//
//   1. `popAnyRef` asked only "is this SOME reference", so `ref.test` /
//      `ref.cast` / `array.len` never compared the operand to anything.
//      `onBrOnCast` in shared-validator.ts has checked `to <: from` since
//      T9.x — its two siblings were never given the equivalent.
//   2. `ref.i31` / `i31.get_*` / `ref.is_null` popped with a bare
//      `dropTypes(1)`: no check at all. `ref.as_non_null`, three lines below
//      `onRefIsNull`, peeks its operand first.
//   3. `ref.as_non_null` PEEKED but did not CHECK — `nonNullable` returns a
//      non-reference unchanged, so an i32 was popped and pushed straight back.
//      It only looked correct while the declared result type disagreed with
//      the operand; make them agree and the hole appears.
//   4. `struct.get` / `array.get` ignored packed-field signedness.
//      `onStructGet` declared the flag as `_signed` and dropped it, and
//      `onArrayGet` did not take it at all. Same shape as T9.11's ten unused
//      `offset` parameters.
//
// Note the rule for root 1 is SHARED HIERARCHY, not subtyping: both engines
// accept a widening cast, so a subtype test in either direction is wrong. The
// `still accepts` cases below are the guard against over-correcting.
//
// Campaign metrics were blind to all twelve: validator agreement counts only
// false REJECTIONS, and no spec-testsuite or wasmtk-corpus module contains
// these shapes.

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

function v8Accepts(binary: Uint8Array): boolean {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

function ourVerdict(binary: Uint8Array): Result {
  return wasmValidate(binary, { features: allFeatures() }).result;
}

const STRUCT = '(type $s (struct (field i32)))';
const PACKED_STRUCT = '(type $ps (struct (field i8)))';
const ARRAY = '(type $a (array (mut i32)))';
const PACKED_ARRAY = '(type $pa (array (mut i8)))';

/** Modules the spec calls invalid. V8 and Wasmtime both reject every one. */
const INVALID: [string, string][] = [
  // --- root 1: cross-hierarchy ref.test / ref.cast -------------------------
  [
    'ref.test funcref against (ref null any)',
    '(module (func (param funcref) (result i32) (ref.test (ref null any) (local.get 0))))',
  ],
  [
    'ref.test externref against (ref null any)',
    '(module (func (param externref) (result i32) (ref.test (ref null any) (local.get 0))))',
  ],
  [
    'ref.test anyref against (ref null func)',
    '(module (func (param anyref) (result i32) (ref.test (ref null func) (local.get 0))))',
  ],
  [
    'ref.cast externref to (ref null i31)',
    '(module (func (param externref) (result i31ref) (ref.cast (ref null i31) (local.get 0))))',
  ],
  // --- root 1: array.len wants an ARRAY reference, not any reference -------
  [
    'array.len on a struct reference',
    `(module ${STRUCT} (func (param (ref $s)) (result i32) (array.len (local.get 0))))`,
  ],
  [
    'array.len on a funcref',
    '(module (func (param funcref) (result i32) (array.len (local.get 0))))',
  ],
  // --- root 2: unchecked pops ---------------------------------------------
  [
    'i31.get_s on anyref',
    '(module (func (param anyref) (result i32) (i31.get_s (local.get 0))))',
  ],
  [
    'i31.get_s on funcref',
    '(module (func (param funcref) (result i32) (i31.get_s (local.get 0))))',
  ],
  [
    'ref.i31 on an i64',
    '(module (func (param i64) (result i31ref) (ref.i31 (local.get 0))))',
  ],
  [
    'ref.is_null on an i32',
    '(module (func (param i32) (result i32) (ref.is_null (local.get 0))))',
  ],
  // --- root 3: ref.as_non_null peeked but did not check --------------------
  [
    'ref.as_non_null on an i32 whose result type agrees',
    '(module (func (param i32) (result i32) (ref.as_non_null (local.get 0))))',
  ],
  // --- root 4: packed-field signedness ------------------------------------
  [
    'struct.get on a packed i8 field',
    `(module ${PACKED_STRUCT}
       (func (param (ref $ps)) (result i32) (struct.get $ps 0 (local.get 0))))`,
  ],
  [
    'struct.get_u on a non-packed i32 field',
    `(module ${STRUCT} (func (param (ref $s)) (result i32) (struct.get_u $s 0 (local.get 0))))`,
  ],
  [
    'array.get on a packed i8 element',
    `(module ${PACKED_ARRAY}
       (func (param (ref $pa)) (result i32) (array.get $pa (local.get 0) (i32.const 0))))`,
  ],
  [
    'array.get_u on a non-packed i32 element',
    `(module ${ARRAY}
       (func (param (ref $a)) (result i32) (array.get_u $a (local.get 0) (i32.const 0))))`,
  ],
];

/**
 * Modules that were already valid and must STAY valid. These are the guard
 * against over-correcting root 1 into a subtype test — widening is legal.
 */
const VALID: [string, string][] = [
  [
    'ref.cast narrowing anyref to a defined struct type',
    `(module ${STRUCT}
       (func (param anyref) (result (ref null $s)) (ref.cast (ref null $s) (local.get 0))))`,
  ],
  [
    'ref.cast WIDENING a defined struct type to (ref null any)',
    `(module ${STRUCT}
       (func (param (ref $s)) (result anyref) (ref.cast (ref null any) (local.get 0))))`,
  ],
  [
    'ref.test WIDENING a defined struct type against (ref null any)',
    `(module ${STRUCT} (func (param (ref $s)) (result i32) (ref.test (ref null any) (local.get 0))))`,
  ],
  [
    'ref.test funcref against a defined func type',
    `(module (type $f (func))
       (func (param funcref) (result i32) (ref.test (ref null $f) (local.get 0))))`,
  ],
  [
    'array.len on a defined array type',
    `(module ${ARRAY} (func (param (ref $a)) (result i32) (array.len (local.get 0))))`,
  ],
  [
    'array.len on the abstract arrayref',
    '(module (func (param arrayref) (result i32) (array.len (local.get 0))))',
  ],
  [
    'i31.get_s on i31ref',
    '(module (func (param i31ref) (result i32) (i31.get_s (local.get 0))))',
  ],
  [
    'ref.i31 on an i32',
    '(module (func (param i32) (result i31ref) (ref.i31 (local.get 0))))',
  ],
  [
    'ref.is_null on a funcref',
    '(module (func (param funcref) (result i32) (ref.is_null (local.get 0))))',
  ],
  [
    'ref.as_non_null on a nullable reference',
    `(module ${STRUCT}
       (func (param (ref null $s)) (result (ref $s)) (ref.as_non_null (local.get 0))))`,
  ],
  [
    'struct.get_s on a packed i8 field',
    `(module ${PACKED_STRUCT}
       (func (param (ref $ps)) (result i32) (struct.get_s $ps 0 (local.get 0))))`,
  ],
  [
    'struct.get on a non-packed i32 field',
    `(module ${STRUCT} (func (param (ref $s)) (result i32) (struct.get $s 0 (local.get 0))))`,
  ],
  [
    'array.get_s on a packed i8 element',
    `(module ${PACKED_ARRAY}
       (func (param (ref $pa)) (result i32) (array.get_s $pa (local.get 0) (i32.const 0))))`,
  ],
  [
    'array.get on a non-packed i32 element',
    `(module ${ARRAY}
       (func (param (ref $a)) (result i32) (array.get $a (local.get 0) (i32.const 0))))`,
  ],
];

describe('T13.14 — GC instructions check their operands, not just their shape', () => {
  for (const [name, wat] of INVALID) {
    it(`rejects ${name}`, () => {
      const binary = compile(wat);
      // V8 is the oracle: it must agree this is invalid, or the fixture is
      // wrong. Every case here was also confirmed against Wasmtime 47.0.3,
      // which is the authority where engines disagree.
      assertEquals(v8Accepts(binary), false, `V8 accepts "${name}" — check the fixture`);
      assertEquals(ourVerdict(binary), Result.Error, `we accepted "${name}"`);
    });
  }

  for (const [name, wat] of VALID) {
    it(`still accepts ${name}`, () => {
      const binary = compile(wat);
      assertEquals(v8Accepts(binary), true, `V8 rejects "${name}" — check the fixture`);
      const { result, errors } = wasmValidate(binary, { features: allFeatures() });
      assertEquals(result, Result.Ok, `we rejected "${name}":\n${formatErrors(errors)}`);
    });
  }

  it('reports a message on every rejection, not a bare Result.Error', () => {
    // A validator failure that returns Error and says nothing is the T9.x
    // silent-path bug: `wasm-validate` exits non-zero printing nothing, and a
    // caller testing hasErrors(errors) concludes the module is fine.
    for (const [name, wat] of INVALID) {
      const { result, errors } = wasmValidate(compile(wat), { features: allFeatures() });
      assertEquals(result, Result.Error, name);
      assert(hasErrors(errors), `"${name}" was rejected with no diagnostic`);
    }
  });
});
