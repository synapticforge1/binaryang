// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T7.8 — two ways of naming a signature that both silently resolved to type
// index 0. Different symptoms, one shared cause: the type INDEX SPACE is not
// complete at parse time, and the parser was making decisions that depend on
// it anyway.
//
//   (func $f (type 1))          adopt the signature FROM the referenced type
//   call_indirect (param i32)   the inline signature DEFINES a type
//
// The first appears verbatim in `func.wast`, whose whole point is the
// expansion of inline function types:
//
//   (func $f (result f64) …)   ;; adds implicit type definition
//   (func $g (param i32))      ;; reuses explicit type definition
//   (type $t (func (param i32)))
//   (func $i32->void (type 0))                ;; (param i32)
//   (func $void->f64 (type 1) (f64.const 0))  ;; (result f64)
//
// Note what the comments assert: `$t` is index 0 even though it is written
// third, and `$f`'s implicit `() -> f64` is index 1. EXPLICIT `(type …)`
// fields take the low indices in source order; IMPLICIT types from inline
// signatures are appended after all of them. So `(type 1)` names a type that
// does not exist until `synthesizeTypes` runs — the parser looked it up, got
// nothing, and left the signature empty. `$void->f64` was emitted as
// `() -> ()` with a body that pushes an f64, and V8 rejected the module with
// "expected 0 elements on the stack for fallthru, found 1".
//
// The second is `stack.wast`: `call_indirect (param i32)` names its signature
// inline instead of with a `(type …)`. The parser kept the signature on the
// expression but left `typeVar` at its index-0 default, so the call was
// encoded against whatever type happened to be first.
//
// Both are settled in `synthesizeTypes` rather than at parse time, and the
// ordering rule above is exactly why: interning eagerly would push explicit
// `(type …)` fields off the low indices the source refers to.
//
// Spec testsuite: V8-valid 245 -> 251.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { synthesizeTypes } from '../../src/ir/synthesize-types.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';
import { valueTypeName } from '../../src/ir/ir.ts';

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

function v8Accepts(wat: string): boolean {
  return WebAssembly.validate(toBuf(compile(wat)));
}

/** The final type section, as `(params)->(results)` strings, in index order. */
function typeSection(wat: string): string[] {
  const { module, errors } = parseWatModule(wat);
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  resolveNames(module, makeErrorList());
  synthesizeTypes(module);
  return module.types.map((t) =>
    t.kind === 'func'
      ? `(${t.sig.params.map(valueTypeName).join(',')})->(${
        t.sig.results.map(valueTypeName).join(',')
      })`
      : t.kind
  );
}

describe('T7.8 — a func adopts the signature of its type-use', () => {
  it('resolves an index into the IMPLICIT part of the type space', () => {
    // Straight from func.wast. `(type 1)` is `$f`'s implicit `() -> f64`.
    assert(v8Accepts(`(module
      (func $f (result f64) (f64.const 0))
      (func $g (param i32))
      (type $t (func (param i32)))
      (func $i32->void (type 0))
      (func $void->f64 (type 1) (f64.const 0))
      (func $check
        (call $i32->void (i32.const 0))
        (drop (call $void->f64))))`));
  });

  it('explicit types take the low indices, implicit ones are appended', () => {
    // The ordering the case above depends on — asserted directly so a
    // regression names itself instead of surfacing as a V8 rejection.
    assertEquals(
      typeSection(`(module
        (func $f (result f64) (f64.const 0))
        (func $g (param i32))
        (type $t (func (param i32))))`),
      ['(i32)->()', '()->(f64)'],
    );
  });

  it('resolves a FORWARD named reference', () => {
    assert(v8Accepts(`(module
      (func $f (type $t) (f64.const 0))
      (type $t (func (result f64))))`));
  });

  it('resolves a backward named reference (already worked)', () => {
    assert(v8Accepts(`(module
      (type $t (func (result f64)))
      (func $f (type $t) (f64.const 0)))`));
  });

  it('an inline signature alongside a type-use still wins', () => {
    assert(v8Accepts(`(module
      (type $t (func (param i32) (result i32)))
      (func $f (type $t) (param i32) (result i32) (local.get 0)))`));
  });

  it('an IMPORTED func adopts it too', () => {
    assert(v8Accepts(`(module
      (import "m" "f" (func $f (type 0)))
      (func $g (param i32) (result i32) (local.get 0))
      (func $h (result i32) (call $f (i32.const 1))))`));
  });

  it('the adopted params really are the referenced ones', async () => {
    // A dropped param list would encode `() -> (i32)` and the call below
    // would not type-check.
    const { instance } = await WebAssembly.instantiate(toBuf(compile(`(module
      (func $add (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
      (type $bin (func (param i32 i32) (result i32)))
      (func $use (type 0) (i32.add (local.get 0) (local.get 1)))
      (func (export "f") (result i32) (call $use (i32.const 20) (i32.const 22))))`)));
    assertEquals((instance.exports.f as () => number)(), 42);
  });
});

describe('T7.8 — call_indirect names its signature inline', () => {
  const forms: ReadonlyArray<readonly [string, string]> = [
    [
      'bare',
      '(module (type $p (func)) (table 1 funcref) (func (block i32.const 0 call_indirect)))',
    ],
    [
      '(param i32)',
      '(module (type $p (func)) (table 1 funcref) (func (block i32.const 0 i32.const 0 call_indirect (param i32))))',
    ],
    [
      '(result i32)',
      '(module (type $p (func)) (table 1 funcref) (func (block (result i32) i32.const 0 call_indirect (result i32)) (drop)))',
    ],
    [
      'type-use plus empty inline groups',
      '(module (type $p (func)) (table 1 funcref) (func (block i32.const 0 call_indirect (type $p) (param) (result))))',
    ],
    [
      'repeated empty groups',
      '(module (type $p (func)) (table 1 funcref) (func (block i32.const 0 call_indirect (type $p) (param) (param) (result))))',
    ],
    [
      'return_call_indirect inline',
      '(module (table 1 funcref) (func (param i32) (result i32) (return_call_indirect (param i32) (result i32) (local.get 0) (i32.const 0))))',
    ],
  ];
  for (const [name, wat] of forms) {
    it(name, () => {
      assert(v8Accepts(wat), `V8 rejected ${name}`);
    });
  }

  it('the inline signature is interned, not silently aliased onto type 0', () => {
    // `(param i32)` must produce a SECOND type entry; before the fix the call
    // pointed at type 0 (`() -> ()`) and the pushed i32 was left dangling.
    assertEquals(
      typeSection(
        '(module (type $p (func)) (table 1 funcref) (func (block i32.const 0 i32.const 0 call_indirect (param i32))))',
      ),
      ['()->()', '(i32)->()'],
    );
  });

  it('and the explicit type still holds index 0', () => {
    assertEquals(
      typeSection(
        '(module (table 1 funcref) (func (block i32.const 0 i32.const 0 call_indirect (param i32))) (type $p (func (param f64))))',
      )[0],
      '(f64)->()',
    );
  });

  it('an indirect call actually reaches the right function', async () => {
    const { instance } = await WebAssembly.instantiate(toBuf(compile(`(module
      (table 1 funcref)
      (func $double (param i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))
      (elem (i32.const 0) $double)
      (func (export "f") (result i32)
        (call_indirect (param i32) (result i32) (i32.const 21) (i32.const 0))))`)));
    assertEquals((instance.exports.f as () => number)(), 42);
  });
});
