// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.6 — module-level checks the validator simply did not have.
//
// T9.5 left 205 `assert_invalid` modules accepted. Splitting them by whether
// V8 ALSO accepts them showed 74 are not ours — those spec tests predate
// proposals that legalised what they assert against — leaving 131. Five
// categories of the 131 are closed here:
//
//   * ALIGNMENT on SIMD memory ops. The validator carried its own partial
//     natural-alignment table which had no SIMD entries, so it returned 0 and
//     the check was skipped entirely. `core/opcode.ts` already owns the
//     canonical table — CLAUDE.md says not to duplicate it, and this is what
//     duplicating it cost.
//   * LANE INDICES on `i8x16.shuffle` (mask bytes select from two vectors
//     concatenated, so each must be < 32) and on `v128.load*_lane` /
//     `store*_lane`. Neither was checked; `onSimdLaneOp` already checked the
//     extract/replace family, which is why this looked done.
//   * IMMUTABILITY. `struct.set`, `array.set`, `array.fill`, `array.copy` and
//     `array.init_*` may not write an immutable field or element.
//   * UNKNOWN TYPE INDICES in value types. `heapSatisfies` treats an unknown
//     index as "accept" so it does not emit a second error for a cause
//     reported elsewhere — but nothing reported it, so
//     `(array (mut (ref null 10)))` in a one-type module validated clean.
//   * FINAL SUPERTYPES. A type may not extend a final one, and an absent
//     `(sub …)` means implicitly final — so `(type (func))` followed by
//     `(type (sub 0 (func)))` is invalid with no `final` keyword in sight.
//   * CONSTANT EXPRESSIONS. Only `*.const`, `ref.null` / `ref.func`,
//     `global.get`, extended-const arithmetic and the GC allocation forms are
//     allowed; `(data (offset i32.const 0 i32.ctz) "")` was accepted.
//
// assert_invalid correctly rejected: 2532 -> 2579 of 2737. Agreement with V8
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

describe('T9.6 — alignment on SIMD memory ops', () => {
  it('rejects an alignment larger than natural', () => {
    rejects('(module (memory 1) (func (result v128) (v128.load8_splat align=2 (i32.const 0))))');
    rejects('(module (memory 1) (func (result v128) (v128.load16_splat align=4 (i32.const 0))))');
    rejects('(module (memory 1) (func (result v128) (v128.load32_zero align=8 (i32.const 0))))');
  });

  it('accepts natural and smaller', () => {
    accepts('(module (memory 1) (func (result v128) (v128.load8_splat align=1 (i32.const 0))))');
    accepts('(module (memory 1) (func (result v128) (v128.load32_zero align=4 (i32.const 0))))');
    accepts('(module (memory 1) (func (result v128) (v128.load32_zero align=1 (i32.const 0))))');
  });

  it('and still checks the core loads it always checked', () => {
    rejects('(module (memory 1) (func (result i32) (i32.load8_u align=2 (i32.const 0))))');
  });
});

describe('T9.6 — SIMD lane immediates', () => {
  it('a shuffle mask byte must be under 32', () => {
    rejects(`(module (func (result v128)
      (i8x16.shuffle 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 255
        (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0))))`);
  });

  it('32 exactly is out of range, 31 is fine', () => {
    const mask = (last: number) =>
      `(module (func (result v128)
        (i8x16.shuffle 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 ${last}
          (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0))))`;
    rejects(mask(32));
    accepts(mask(31));
  });

  it('a load_lane index must be under the lane count', () => {
    rejects(
      '(module (memory 1) (func (param v128) (result v128) (v128.load8_lane 16 (i32.const 0) (local.get 0))))',
    );
    accepts(
      '(module (memory 1) (func (param v128) (result v128) (v128.load8_lane 15 (i32.const 0) (local.get 0))))',
    );
    rejects(
      '(module (memory 1) (func (param v128) (result v128) (v128.load64_lane 2 (i32.const 0) (local.get 0))))',
    );
  });
});

describe('T9.6 — writes to immutable fields and elements', () => {
  it('struct.set on an immutable field', () => {
    rejects(`(module
      (type $s (struct (field i32)))
      (func (param (ref $s)) (struct.set $s 0 (local.get 0) (i32.const 1))))`);
  });

  it('array.set / fill / copy on an immutable element', () => {
    rejects(`(module
      (type $a (array i8))
      (func (param (ref $a)) (array.set $a (local.get 0) (i32.const 0) (i32.const 0))))`);
    rejects(`(module
      (type $a (array i8))
      (func (param (ref $a)) (array.fill $a (local.get 0) (i32.const 0) (i32.const 0) (i32.const 0))))`);
    rejects(`(module
      (type $a (array i8))
      (type $b (array (mut i8)))
      (func (param (ref $a) (ref $b))
        (array.copy $a $b (local.get 0) (i32.const 0) (local.get 1) (i32.const 0) (i32.const 0))))`);
  });

  it('but a mutable one is fine', () => {
    accepts(`(module
      (type $s (struct (field (mut i32))))
      (func (param (ref $s)) (struct.set $s 0 (local.get 0) (i32.const 1))))`);
    accepts(`(module
      (type $a (array (mut i8)))
      (func (param (ref $a)) (array.set $a (local.get 0) (i32.const 0) (i32.const 0))))`);
  });
});

describe('T9.6 — type-index and supertype validity', () => {
  it('a heap-type index past the type section is unknown', () => {
    rejects('(module (type $a (array (mut (ref null 10)))))');
    rejects('(module (type $f (func (param (ref 7)))))');
  });

  it('a forward reference INSIDE a rec group is still fine', () => {
    // Only within the group: a plain forward reference across groups is
    // itself invalid, which V8 confirmed when this test first used one.
    accepts('(module (rec (type $a (struct (field (ref null 1)))) (type $b (struct))))');
  });

  it('a cross-group forward reference is rejected (closed in T9.7)', () => {
    // This was a documented gap when T9.6 landed — the index check asked
    // "does this type exist" rather than "was it in scope yet". T9.7 gave
    // each type a scope bound of "everything before it, plus the rest of its
    // own rec group", which is what makes the rec-group case above legal and
    // this one not.
    rejects('(module (type $a (struct (field (ref null 1)))) (type $b (struct)))');
  });

  it('a type may not extend a FINAL type', () => {
    // No `final` keyword appears here — an absent `(sub …)` is implicitly it.
    rejects('(module (type $a (func)) (type $b (sub 0 (func))))');
    rejects('(module (type $a (sub final (func))) (type $b (sub 0 (func))))');
  });

  it('extending a non-final type works', () => {
    accepts('(module (type $a (sub (func))) (type $b (sub 0 (func))))');
  });
});

describe('T9.6 — constant expressions', () => {
  it('a non-constant instruction is rejected', () => {
    rejects('(module (memory 1) (data (offset i32.const 0 i32.ctz) ""))');
    rejects('(module (global i32 (i32.const 1) (i32.ctz))) ');
  });

  it('the const family, ref forms and global.get are allowed', () => {
    accepts('(module (memory 1) (data (offset (i32.const 0)) "abc"))');
    accepts('(module (global $g (import "m" "g") i32) (global i32 (global.get $g)))');
    accepts('(module (global funcref (ref.null func)))');
  });

  it('extended-const arithmetic is allowed', () => {
    accepts('(module (global i32 (i32.add (i32.const 1) (i32.const 2))))');
    accepts('(module (global i64 (i64.mul (i64.const 3) (i64.const 4))))');
  });

  it('but non-extended arithmetic is not', () => {
    rejects('(module (global i32 (i32.div_s (i32.const 6) (i32.const 2))))');
  });
});
