// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T7.12 — `br_on_null` / `br_on_non_null` carrying branch values.
//
// Operands are `[t* ref]` with the tested ref on TOP, and the branch target
// may take `t*` as well. The IR held a single `value`, so
//
//   (br_on_null $l (local.get $n) (local.get $r))
//
// tested `$n` (the BOTTOM operand) as if it were the ref and dropped `$r`
// entirely. Same swap `br_if` had before v1.3.4, one instruction over.
//
// The field is now `ref` rather than `value`: sitting next to `values`, a
// one-letter difference is too easy to misread at a call site.
//
// br_on_non_null differs from br_on_null in what the TARGET takes: the branch
// carries `t*` plus the now-non-null ref, so when the reader pops carried
// values it must count one fewer than the label's result arity.
//
// Spec testsuite: V8-valid 255 -> 257 — every module in all 257 files now
// encodes to wasm V8 accepts.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
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

// br_on_null.wast's own module, plus its assert_return expectations:
// `args-null` branches (the ref is null) and the carried `$n` becomes the
// block result; `args-f` falls through and call_ref squares it.
const BR_ON_NULL = `(module
  (type $t (func (param i32) (result i32)))
  (elem func $f)
  (func $f (param i32) (result i32) (i32.mul (local.get 0) (local.get 0)))
  (func $a (param $n i32) (param $r (ref null $t)) (result i32)
    (block $l (result i32)
      (return (call_ref $t (br_on_null $l (local.get $n) (local.get $r))))))
  (func (export "args-null") (param $n i32) (result i32)
    (call $a (local.get $n) (ref.null $t)))
  (func (export "args-f") (param $n i32) (result i32)
    (call $a (local.get $n) (ref.func $f))))`;

describe('T7.12 — br_on_null carries branch values', () => {
  it('runs the spec module to the spec answers', async () => {
    const { instance } = await WebAssembly.instantiate(toBuf(compile(BR_ON_NULL)));
    const argsNull = instance.exports['args-null'] as (n: number) => number;
    const argsF = instance.exports['args-f'] as (n: number) => number;
    // assert_return (invoke "args-null" (i32.const 3)) (i32.const 3)
    assertEquals(argsNull(3), 3);
    // assert_return (invoke "args-f" (i32.const 3)) (i32.const 9)
    assertEquals(argsF(3), 9);
  });

  it('the ref is the TOP operand, carried values sit below it', () => {
    const { module, errors } = parseWatModule(`(module
      (type $t (func (param i32) (result i32)))
      (func (param $n i32) (param $r (ref null $t)) (result i32)
        (block $l (result i32)
          (return (call_ref $t (br_on_null $l (local.get $n) (local.get $r)))))))`);
    assert(!hasErrors(errors), formatErrors(errors));
    const body = module.funcs[0]!.body;
    // block > return > call_ref > br_on_null
    const block = body[0]!;
    assert(block.kind === 'block');
    const ret = block.body[0]!;
    assert(ret.kind === 'return');
    const callRef = ret.values[0]!;
    assert(callRef.kind === 'call_ref');
    const bon = callRef.callee;
    assert(bon.kind === 'br_on_null', `expected br_on_null, got ${bon.kind}`);
    // $r is local 1 — the ref. $n is local 0 — the carried value.
    assert(bon.ref.kind === 'local.get');
    assertEquals(bon.ref.var, { kind: 'index', value: 1 });
    assertEquals(bon.values.length, 1);
    const carried = bon.values[0]!;
    assert(carried.kind === 'local.get');
    assertEquals(carried.var, { kind: 'index', value: 0 });
  });

  it('a plain br_on_null with no carried value still works', async () => {
    const wat = `(module
      (type $t (func))
      (func (export "f") (param $r (ref null $t)) (result i32)
        (block $l
          (br_on_null $l (local.get $r))
          (drop)
          (return (i32.const 1)))
        (i32.const 0)))`;
    const { instance } = await WebAssembly.instantiate(toBuf(compile(wat)));
    const f = instance.exports.f as (r: unknown) => number;
    assertEquals(f(null), 0);
  });

  it('br_on_non_null carries values too', async () => {
    // Branch target takes [i32, (ref $t)] — the carried i32 plus the
    // now-non-null ref. Falling through means the ref was null.
    const wat = `(module
      (type $t (func (param i32) (result i32)))
      (elem func $sq)
      (func $sq (param i32) (result i32) (i32.mul (local.get 0) (local.get 0)))
      (func $a (param $n i32) (param $r (ref null $t)) (result i32)
        (block $l (result i32 (ref $t))
          (br_on_non_null $l (local.get $n) (local.get $r))
          (return (local.get $n)))
        (call_ref $t))
      (func (export "null") (param $n i32) (result i32)
        (call $a (local.get $n) (ref.null $t)))
      (func (export "some") (param $n i32) (result i32)
        (call $a (local.get $n) (ref.func $sq))))`;
    const { instance } = await WebAssembly.instantiate(toBuf(compile(wat)));
    assertEquals((instance.exports.null as (n: number) => number)(4), 4);
    assertEquals((instance.exports.some as (n: number) => number)(4), 16);
  });

  it('still computes the same answers after a wasm2wat round-trip', async () => {
    // NOT byte-identical, and it cannot be: `local.get $n` is BOTH a value
    // carried to the branch and the operand `call_ref` consumes on the
    // fallthrough path. A tree gives it one parent, so the decoder hands
    // call_ref a `Nop` and the re-encode carries one extra `nop`. Inert — the
    // nop sits where the operand stack is empty — but it is why this asserts
    // behaviour rather than bytes. Tracked as T10.5.
    const first = compile(BR_ON_NULL);
    const { text, errors } = wasm2wat(first);
    assert(!hasErrors(errors) && text, formatErrors(errors));
    const second = compile(text);
    const { instance } = await WebAssembly.instantiate(toBuf(second));
    assertEquals((instance.exports['args-null'] as (n: number) => number)(3), 3);
    assertEquals((instance.exports['args-f'] as (n: number) => number)(3), 9);
  });
});
