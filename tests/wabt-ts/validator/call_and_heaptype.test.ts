// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.10 — the last invalid modules V8 rejects that we did not.
//
//   * `call_ref` / `return_call_ref` expected the callee to be any `funcref`
//     instead of `(ref null $t)` for the NAMED type, so a plain funcref
//     operand passed.
//   * `call_indirect` / `return_call_indirect` accepted a table of ANY
//     reference type. It has to hold FUNCTION references — `(table 10
//     externref)` backed a call. `return_call_indirect` also still hard-coded
//     an i32 index, missed when call_indirect got table64 in T9.2.
//   * `array.new_elem` / `array.init_elem` never compared the elem SEGMENT's
//     element type to the ARRAY's.
//   * A bare abstract heap keyword (`any`, `eq`, `i31`, `none`, `nofunc`,
//     `noextern`, `noexn`) was lexed as a VALUE type, on a comment claiming
//     "the WAT spec also permits these in value-type slots". It does not — the
//     value type is the `…ref` spelling, and the bare keyword is legal only in
//     `(ref [null] H)`, `ref.null H` and cast immediates. They now have their
//     own token type, so `(result any)` / `(param any)` / `(global any …)`
//     fail to parse.
//
// The last one was a genuine ENCODER bug, and it is the interesting one: the
// binary writer emitted a select's result annotation with
// `this.s.writeU8(t as number)`. A `(ref $t)` annotation is an OBJECT, so the
// cast wrote 0x00 — every typed-ref `select (result …)` was mis-encoded, and
// the invalid case could not be caught because the type never survived to the
// validator. Same class as the type-key stringification logged in T10.7: a
// site the T7.4 ValueType refactor did not reach.
//
// I also misread this one at first, taking our own `wasm2wat` rendering of
// the module (`select (result any)`) for its source (`select (result (ref 1))`)
// — the rendering was itself a symptom of the encoder bug.
//
// assert_invalid 2658 -> 2664 of 2737, and every one of the 73 still accepted
// is a module V8 accepts too. Agreement on valid modules stayed 2120/2120.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { isRefValueType } from '../../src/ir/ir.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';

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

describe('T9.10 — call_ref takes the NAMED reference type', () => {
  it('a plain funcref operand is rejected', () => {
    rejects('(module (type $t (func)) (func (param funcref) (call_ref $t (local.get 0))))');
  });

  it('the right typed reference is accepted', () => {
    accepts('(module (type $t (func)) (func (param (ref null $t)) (call_ref $t (local.get 0))))');
  });
});

describe('T9.10 — indirect calls need a table of functions', () => {
  it('call_indirect through an externref table is rejected', () => {
    rejects(
      '(module (type $t (func)) (table 10 externref) (func (call_indirect (type $t) (i32.const 0))))',
    );
  });

  it('and so is return_call_indirect', () => {
    rejects(`(module (type $t (func)) (table 10 externref)
      (func (return_call_indirect (type $t) (i32.const 0))))`);
  });

  it('a funcref table works for both', () => {
    accepts(
      '(module (type $t (func)) (table 10 funcref) (func (call_indirect (type $t) (i32.const 0))))',
    );
    accepts(`(module (type $t (func)) (table 10 funcref)
      (func (return_call_indirect (type $t) (i32.const 0))))`);
  });

  it('a (ref null $t) table of a func type works too', () => {
    accepts(`(module
      (type $t (func))
      (table 10 (ref null $t))
      (func (call_indirect (type $t) (i32.const 0))))`);
  });

  it('return_call_indirect indexes a 64-bit table with i64', () => {
    accepts(`(module (type $t (func)) (table i64 10 funcref)
      (func (return_call_indirect (type $t) (i64.const 0))))`);
  });
});

describe('T9.10 — array elem-segment element types', () => {
  it('an externref segment into a funcref array is rejected', () => {
    rejects(`(module
      (type $a (array (mut funcref)))
      (elem $e externref)
      (func (param (ref $a))
        (array.init_elem $a $e (local.get 0) (i32.const 0) (i32.const 0) (i32.const 0))))`);
  });

  it('a matching segment is accepted', () => {
    accepts(`(module
      (type $a (array (mut funcref)))
      (elem $e funcref)
      (func (param (ref $a))
        (array.init_elem $a $e (local.get 0) (i32.const 0) (i32.const 0) (i32.const 0))))`);
  });
});

describe('T9.10 — a bare heap keyword is not a value type', () => {
  const badSlots = [
    '(module (func (result any) (unreachable)))',
    '(module (func (param any) (unreachable)))',
    '(module (global any (ref.null any)))',
    '(module (func (local eq) (unreachable)))',
    '(module (table 1 nofunc))',
  ];
  for (const wat of badSlots) {
    it(`rejects ${wat.slice(8, 40)}…`, () => {
      const { errors } = parseWatModule(wat);
      assert(hasErrors(errors), `parsed a bare heap keyword as a value type: ${wat}`);
    });
  }

  it('the …ref spellings still work everywhere', () => {
    accepts('(module (func (result anyref) (unreachable)))');
    accepts('(module (func (param eqref) (unreachable)))');
    accepts('(module (global anyref (ref.null any)))');
    accepts('(module (table 1 nullfuncref))');
  });

  it('and the bare keyword still works where it belongs', () => {
    accepts('(module (func (result anyref) (ref.null any)))');
    accepts('(module (func (param anyref) (result i32) (ref.test (ref null i31) (local.get 0))))');
    accepts('(module (func (param anyref) (result (ref i31)) (ref.cast (ref i31) (local.get 0))))');
  });
});

describe('T9.10 — a select result annotation is encoded as a value type', () => {
  it('a typed-ref annotation survives the round-trip', () => {
    // `writeU8(t as number)` wrote 0x00 for the OBJECT, so this came back as
    // an invalid value type — every typed-ref select was mis-encoded.
    const wat = `(module
      (type $t (func))
      (func (param (ref null $t) (ref null $t) i32) (result (ref null $t))
        (select (result (ref null $t)) (local.get 0) (local.get 1) (local.get 2))))`;
    const back = readBinaryIr(compile(wat), makeErrorList(), {});
    const body = JSON.stringify(back.funcs[0]!.body);
    assert(body.includes('"kind":"ref"'), `select annotation lost: ${body}`);
    accepts(wat);
  });

  it('an out-of-range type index in the annotation is rejected', () => {
    rejects('(module (type $t (func)) (func (drop (select (result (ref 1)) (unreachable)))))');
  });

  it('an abstract annotation still round-trips', () => {
    const back = readBinaryIr(
      compile(
        '(module (func (param funcref funcref i32) (result funcref) (select (result funcref) (local.get 0) (local.get 1) (local.get 2))))',
      ),
      makeErrorList(),
      {},
    );
    const sel = JSON.stringify(back.funcs[0]!.body);
    assert(sel.includes('112') || sel.includes('"kind":"ref"'), sel);
  });

  it('and isRefValueType still tells the two apart', () => {
    const m = parseWatModule(
      '(module (type $t (func)) (func (param (ref null $t)) (unreachable)))',
    );
    assert(isRefValueType(m.module.funcs[0]!.sig.params[0]!));
  });
});
