// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.5 — modules the spec says are INVALID that we were validating clean.
//
// The survey that opened T9.5 was itself wrong, and the correction matters
// more than the fixes. It asked `hasErrors(result.errors)`; the validator
// signals failure through `result`, and `dropTypes` returned `Result.Error`
// WITHOUT recording a message. So every stack underflow read as "accepted" to
// the harness — and to any caller testing the errors list. `wasm-validate`
// itself exited non-zero and printed nothing.
//
// Fixing the report first moved the real number from "903 missed" to "314
// missed" before a single check was added. Measure the field the code
// actually sets.
//
// Three real gaps then came out of the corrected survey:
//
//   * `checkSignature` peeked without checking ARITY. `peekType` answers
//     `Type.Any` for anything below the frame's base and `Type.Any` satisfies
//     everything, so a signature check against a too-short stack passed. `br`
//     only peeks, which is why `(block (result i32) (br 0))` validated. +102.
//   * A 32-bit memory's page limit is 65536, not 2^32-1. `(memory 65537)` was
//     accepted.
//   * A memarg `offset=N` must fit the memory's index type. This became
//     reachable only when T9.2 widened the reader from u32 to u64 for
//     memory64 — before that the reader threw and the module never arrived.
//
// assert_invalid correctly rejected: 2395 (end of T9.2) -> 2423 (T9.3+T9.4)
// -> 2532 of 2737. Agreement with V8 on valid modules stayed 2120/2120
// throughout — none of this cost a false rejection.

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

/**
 * We must reject `wat`, AND say why. Both halves matter: reporting through
 * `result` alone is what hid every underflow for the whole campaign.
 */
function rejects(wat: string): void {
  const bin = compile(wat);
  assert(!WebAssembly.validate(toBuf(bin)), `V8 ACCEPTED this — bad test input:\n${wat}`);
  const v = wasmValidate(bin, { features: allFeatures() });
  assertEquals(v.result, Result.Error, `we accepted a module V8 rejects:\n${wat}`);
  assert(hasErrors(v.errors), `rejected but reported nothing — silent failure:\n${wat}`);
}

function accepts(wat: string): void {
  const bin = compile(wat);
  assert(WebAssembly.validate(toBuf(bin)), `V8 rejected — bad test input:\n${wat}`);
  assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Ok);
}

describe('T9.5 — a rejection always carries a message', () => {
  it('an empty body under a declared result reports, not just fails', () => {
    // `result: Error, errors: []` was the old behaviour. The assertion inside
    // `rejects` on hasErrors is the point of this case.
    rejects('(module (func (result i32)))');
  });

  it('a missing operand reports', () => {
    rejects('(module (func (result i32) (i32.add (i32.const 1))))');
  });
});

describe('T9.5 — stack arity is checked, not assumed', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['empty function body', '(module (func (result i32)))'],
    ['empty block under a result', '(module (func (result i32) (block)))'],
    [
      'block declaring a result it never produces',
      '(module (func (result i32) (block (result i32))))',
    ],
    [
      'br to a label with nothing to carry',
      '(module (func (result i32) (block (result i32) (br 0))))',
    ],
    [
      'br_if to a label with nothing to carry',
      '(module (func (result i32) (block (result i32) (br_if 0 (i32.const 1)) (i32.const 0))))',
    ],
    ['return with no value', '(module (func (result i32) (return)))'],
    ['too few call arguments', '(module (func $g (param i32 i32)) (func (call $g (i32.const 1))))'],
  ];
  for (const [name, wat] of cases) {
    it(name, () => rejects(wat));
  }

  it('but unreachable code stays polymorphic', () => {
    // The exemption has to survive: below `unreachable` the missing operands
    // really are polymorphic, and tightening arity must not break that.
    accepts('(module (func (result i32) (unreachable)))');
    accepts('(module (func (result i32) (block (result i32) (unreachable))))');
    accepts('(module (func (result i32) (unreachable) (i32.add)))');
  });
});

describe('T9.5 — memory limits and memarg offsets', () => {
  it('a 32-bit memory may not exceed 65536 pages', () => {
    rejects('(module (memory 65537))');
    rejects('(module (memory 2147483648))');
  });

  it('but 65536 pages exactly is fine', () => {
    accepts('(module (memory 65536))');
  });

  it('a memarg offset must fit the memory index type', () => {
    rejects('(module (memory 1) (func (drop (i32.load offset=0xffffffffffffffff (i32.const 0)))))');
  });

  it('and a 64-bit memory accepts what a 32-bit one cannot', () => {
    accepts('(module (memory i64 1) (func (drop (i32.load offset=0x100000000 (i64.const 0)))))');
  });
});
