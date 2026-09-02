// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Two defects that produced modules NO ENGINE WOULD LOAD, found by checking
// that binaryen-ts's re-encode VALIDATES rather than merely not throwing.
//
// ⚠️ The weak metric is the story here. "Re-encodes without throwing" read
// 421/421 while 38 of those modules were rejected by every engine. Swapping the
// check to `WebAssembly.validate` turned a green number into two real bugs.
//
//   1. ALIGNMENT — `align=N` in the text format is a BYTE COUNT, while the IR
//      field and the binary format hold log2 of it. The parser stored the byte
//      count raw, so `i64.store align=4` encoded an exponent of 4 (sixteen
//      bytes): *"invalid alignment; expected maximum alignment is 3, actual
//      alignment is 4"*.
//
//      And the DEFAULT was wrong the other way. Absent `align=`, WAT means the
//      NATURAL alignment, but the parser started at 0 — one byte. That still
//      encodes a VALID module, so nothing rejected it; it silently emitted a
//      weaker hint than the source asked for. `i32.store8` hid the whole thing
//      by having a natural alignment of 1, which is what the wrong default
//      happened to be — so any test using only byte-width accesses would have
//      passed throughout.
//
//   2. MULTI-VALUE — `ReturnExpr.value` and `BreakExpr.value` hold ONE
//      expression, and both parse sites took only the first operand. The rest
//      were silently dropped: *"expected 2 elements on the stack for return,
//      found 1"*. `TupleMake` is the container, and it needed no new machinery —
//      it has no opcode, and the encoder emits its operands in order, which IS
//      the multi-value convention.
//
// Every assertion below is BYTE EQUALITY against wabt-ts's assembly of the same
// source, not just validity. Both bugs had valid-but-different states that a
// validity check alone would have missed.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** binaryen-ts must assemble `wat` to exactly the bytes wabt-ts does. */
function assertSameBytes(wat: string): Uint8Array {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the fixture');
  const got = encodeWasm(parseWat(wat));
  // Validity first: a byte diff on an invalid module buries the real message.
  new WebAssembly.Module(got as BufferSource);
  assertEquals(Array.from(got), Array.from(ref.binary));
  return got;
}

const mem = (body: string) => `(module (memory 1) (func (export "f") ${body}))`;

describe('WAT parser — memarg alignment is an EXPONENT, not a byte count', () => {
  // Natural alignment. `i32.store8` is the control that would pass either way.
  it('an omitted align= means NATURAL alignment, not 1 byte', () => {
    assertSameBytes(mem('(drop (i32.load (i32.const 0)))'));
    assertSameBytes(mem('(drop (i64.load (i32.const 0)))'));
    assertSameBytes(mem('(drop (i64.load32_u (i32.const 0)))'));
    assertSameBytes(mem('(i64.store (i32.const 0) (i64.const 1))'));
  });

  it('a byte-width access is unchanged — the case that hid this', () => {
    assertSameBytes(mem('(i32.store8 (i32.const 0) (i32.const 1))'));
    assertSameBytes(mem('(drop (i32.load8_u (i32.const 0)))'));
  });

  it('an explicit under-alignment converts bytes to the exponent', () => {
    assertSameBytes(mem('(i64.store align=4 (i32.const 0) (i64.const 1))'));
    assertSameBytes(mem('(drop (i32.load align=1 (i32.const 0)))'));
    assertSameBytes(mem('(drop (i32.load align=2 (i32.const 0)))'));
    assertSameBytes(mem('(drop (i32.load align=4 (i32.const 0)))'));
    assertSameBytes(mem('(drop (i64.load32_u align=2 (i32.const 0)))'));
  });

  it('offset= and align= together survive, in either order', () => {
    assertSameBytes(mem('(drop (i32.load offset=8 align=1 (i32.const 0)))'));
    assertSameBytes(mem('(i32.store offset=4 align=2 (i32.const 0) (i32.const 1))'));
  });

  // SIMD natural widths are DERIVED from the opcode name rather than tabulated,
  // so these cover the derivation: the whole vector, the widening NxM forms, the
  // splat/zero forms, and the lane forms.
  it('SIMD memory ops get their natural alignment from the opcode name', () => {
    assertSameBytes(mem('(drop (v128.load (i32.const 0)))'));
    assertSameBytes(mem('(drop (v128.load8x8_u (i32.const 0)))'));
    assertSameBytes(mem('(drop (v128.load32x2_s (i32.const 0)))'));
    assertSameBytes(mem('(drop (v128.load32_splat (i32.const 0)))'));
    assertSameBytes(mem('(drop (v128.load64_zero (i32.const 0)))'));
    assertSameBytes(mem('(v128.store (i32.const 0) (v128.const i32x4 0 0 0 0))'));
  });

  it('SIMD under-alignment and lane ops convert too', () => {
    assertSameBytes(mem('(drop (v128.load align=1 (i32.const 0)))'));
    assertSameBytes(mem('(drop (v128.load8x8_u align=2 (i32.const 0)))'));
    assertSameBytes(mem('(drop (v128.load32_lane 0 (i32.const 0) (v128.const i32x4 0 0 0 0)))'));
    assertSameBytes(mem('(v128.store16_lane 0 (i32.const 0) (v128.const i32x4 0 0 0 0))'));
  });

  it('a non-power-of-two alignment is refused rather than encoded', () => {
    // Fail loud: `align=3` is malformed, and log2 of it is not an integer. The
    // alternative is a fractional exponent silently truncated into a valid-
    // looking module.
    let threw = false;
    try {
      parseWat(mem('(drop (i32.load align=3 (i32.const 0)))'));
    } catch {
      threw = true;
    }
    assert(threw, 'align=3 must be rejected');
  });
});

describe('WAT parser — a branch carries EVERY value, not just the first', () => {
  const run = (bytes: Uint8Array) =>
    (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports.f as () => unknown)();

  it('a multi-value return keeps all of its values', () => {
    const wat =
      '(module (func (export "f") (result i32 i32) (return (i32.const 1) (i32.const 2))))';
    assertEquals(run(assertSameBytes(wat)), [1, 2]);
  });

  it('three values, so a two-slot fix would still be visibly short', () => {
    const wat = `(module (func (export "f") (result i32 i32 i32)
      (return (i32.const 1) (i32.const 2) (i32.const 3))))`;
    assertEquals(run(assertSameBytes(wat)), [1, 2, 3]);
  });

  it('a multi-value br keeps all of its values', () => {
    const wat = `(module (func (export "f") (result i32 i32)
      (block (result i32 i32) (br 0 (i32.const 1) (i32.const 2)))))`;
    assertEquals(run(assertSameBytes(wat)), [1, 2]);
  });

  it('the single-value and bare forms are untouched', () => {
    assertEquals(
      run(assertSameBytes('(module (func (export "f") (result i32) (return (i32.const 7))))')),
      7,
    );
    assertSameBytes(`(module (func (export "f") (param i32) (result i32)
      (block $l (result i32) (br_if $l (i32.const 7) (local.get 0)))))`);
    assertSameBytes('(module (func (export "f") (i32.const 1) (drop) (return)))');
  });
});
