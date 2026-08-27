// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T5.1 — the GC proposal's conversions between the `extern` and `any`
// hierarchies: `any.convert_extern` (0xfb 0x1a) and `extern.convert_any`
// (0xfb 0x1b). One operand, no immediates.
//
// T8.3 — a pre-existing WAT-writer bug these surfaced. `writeInitExpr` wrapped
// a constant expression's WHOLE instruction list in one paren. The expression
// visitor emits LINEAR (post-order) instructions, not folded s-expressions, so
// a tree of more than one instruction came out as `(i32.const 1 ref.i31)`,
// which reads as a folded `i32.const` with a bogus operand and fails to
// reparse. Nothing caught it because the round-trip tests only asked "does the
// text parse", and every previously-exercised init expression was a single
// instruction. Confirmed pre-existing: `(global anyref (ref.i31 (i32.const 1)))`
// fails identically, and ref.i31 has been supported since v1.1.9.
//
// The fix distinguishes three positions that are NOT interchangeable:
//   * a global initializer takes bare `instr*` — no wrapper
//   * a data/elem OFFSET needs `(offset instr*)`; the parser identifies it by
//     the leading paren, and `(offset …)` wraps a whole sequence
//   * an element EXPRESSION needs `(item instr*)`; the bare folded
//     abbreviation only works for a single instruction

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';
import { GcOpcode, PREFIX_GC } from '../../src/core/opcode.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(wat: string): boolean {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

/** Encode → text → encode; asserts the bytes are IDENTICAL, not just valid. */
function roundTripsExactly(wat: string): boolean {
  const first = compile(wat);
  const { text, errors } = wasm2wat(first);
  if (hasErrors(errors) || !text) return false;
  const second = compile(text);
  return first.length === second.length && first.every((b, i) => b === second[i]);
}

function hasSeq(b: Uint8Array, ...bytes: number[]): boolean {
  outer: for (let i = 0; i + bytes.length <= b.length; i++) {
    for (let j = 0; j < bytes.length; j++) if (b[i + j] !== bytes[j]) continue outer;
    return true;
  }
  return false;
}

describe('extern ⇄ any conversions', () => {
  it('any.convert_extern encodes 0xfb 0x1a and V8 accepts it', () => {
    const wat =
      '(module (func (param externref) (result anyref) (any.convert_extern (local.get 0))))';
    assert(hasSeq(compile(wat), PREFIX_GC, GcOpcode.AnyConvertExtern));
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('extern.convert_any encodes 0xfb 0x1b and V8 accepts it', () => {
    const wat =
      '(module (func (param anyref) (result externref) (extern.convert_any (local.get 0))))';
    assert(hasSeq(compile(wat), PREFIX_GC, GcOpcode.ExternConvertAny));
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('the two compose and round-trip', () => {
    const wat = `(module (func (param externref) (result externref)
      (extern.convert_any (any.convert_extern (local.get 0)))))`;
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('works in a global initializer', () => {
    const wat = '(module (global externref (extern.convert_any (ref.null any))))';
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('V8 rejects the wrong direction (our validator does not — known gap)', () => {
    // `extern.convert_any` takes an ANYref. Applying it to an externref is a
    // type error and V8 says so. wabt-ts's own validator accepts it: the
    // type-checker coarsens reference types, so externref and anyref are not
    // distinguished on its operand stack. Asserting the LOOSE behaviour
    // records the gap honestly rather than pretending it is checked — if the
    // validator is ever tightened this test should start failing, and the
    // assertion should be flipped rather than deleted.
    const { binary, errors } = wat2wasm(
      '(module (func (param externref) (result externref) (extern.convert_any (local.get 0))))',
    );
    assert(!hasErrors(errors), 'validator is expected to be permissive here');
    assert(binary);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    assert(!WebAssembly.validate(buf), 'V8 must reject the wrong direction');
  });
});

describe('constant expressions round-trip exactly', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['global, one instruction', '(module (global i32 (i32.const 1)))'],
    ['global, two instructions', '(module (global anyref (ref.i31 (i32.const 1))))'],
    ['global, convert', '(module (global externref (extern.convert_any (ref.null any))))'],
    [
      'global via another global',
      '(module (global $a i32 (i32.const 1)) (global i32 (global.get $a)))',
    ],
    ['data offset', '(module (memory 1) (data (i32.const 0) "ab"))'],
    [
      'data offset via global',
      '(module (import "e" "g" (global $g i32)) (memory 1) (data (global.get $g) "x"))',
    ],
    ['passive data', '(module (memory 1) (data "passive"))'],
    ['elem offset + expressions', '(module (func $f) (table 2 funcref) (elem (i32.const 0) $f))'],
    [
      'elem expression list',
      '(module (func $f) (table 2 funcref) (elem (i32.const 0) funcref (ref.func $f) (ref.null func)))',
    ],
    [
      'struct.new_default global',
      '(module (type $s (struct)) (global (ref null $s) (struct.new_default $s)))',
    ],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      assert(roundTripsExactly(wat), `bytes changed across wasm2wat for: ${wat}`);
    });
  }

  it('a two-instruction global emits NO wrapping paren', () => {
    // The specific malformation: `(i32.const 1 ref.i31)`.
    const { text } = wasm2wat(compile('(module (global anyref (ref.i31 (i32.const 1))))'));
    assert(text);
    assert(!/\(i32\.const 1 ref\.i31\)/.test(text), `re-introduced the bad wrapper:\n${text}`);
  });

  it('a data offset keeps an explicit (offset …)', () => {
    const { text } = wasm2wat(compile('(module (memory 1) (data (i32.const 0) "ab"))'));
    assert(text);
    assert(/\(offset /.test(text), `data offset must be wrapped:\n${text}`);
  });

  it('element expressions keep an explicit (item …)', () => {
    // An all-`ref.func` list is emitted with the `func $f …` SHORTHAND, which
    // needs no item wrapper. A list containing anything else uses element
    // expressions, and those do.
    const { text } = wasm2wat(compile(
      '(module (func $f) (table 2 funcref) (elem (i32.const 0) funcref (ref.func $f) (ref.null func)))',
    ));
    assert(text);
    assert(/\(item /.test(text), `element expression must be wrapped:\n${text}`);
  });

  it('assertEquals sanity: exact means byte-for-byte', () => {
    const a = compile('(module (global i32 (i32.const 1)))');
    const b = compile(wasm2wat(a).text!);
    assertEquals([...a], [...b]);
  });
});
