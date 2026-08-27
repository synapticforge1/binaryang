// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T7.7 — relaxed SIMD encoded as completely different instructions.
//
// wabt-ts packs a prefixed opcode into one number as `(prefix << N) | sub`.
// N was 8, which allows only a one-BYTE sub-opcode — but the relaxed-SIMD set
// lives at sub-opcodes 0x100-0x113 and is LEB128-encoded in the binary.
//
// The overflow does not reach the next prefix: `(0xfd << 8) | 0x100` is
// 0xfd00, not 0xfe00, because bit 8 is ALREADY set by the prefix and the OR
// changes nothing. It ALIASES onto the low SIMD opcodes instead:
//
//   i8x16.relaxed_swizzle       0x100 -> 0xfd00 = v128.load
//   i32x4.relaxed_trunc_f32x4_s 0x101 -> 0xfd01 = v128.load8x8_s
//   i16x8.relaxed_q15mulr_s     0x111 -> 0xfd11 = i32x4.splat
//
// which is exactly what V8 reported: "reached end while decoding offset"
// (v128.load has a memarg that was never emitted) and "splat expected type
// i32, found local.get of type v128".
//
// The packing is now `(prefix << 16) | sub`. A core (unprefixed) opcode is
// unaffected: `(0 << 16) | n === n`, exactly as before.
//
// Two follow-on details this exposed:
//
//   * `isReplaceLaneOpcode` compared against PACKED literals (`0xfd17`).
//     Those silently stopped matching when the width changed, and every
//     `*.replace_lane` lost its scalar operand. It now derives the
//     sub-opcode, so it is independent of the packing width.
//   * The opcode NAME table omitted the relaxed set entirely — a deliberate
//     choice while they could not be keyed. wasm2wat printed
//     `<opcode:0xfd0100>` and could not round-trip. The names are now
//     generated from the lexer's own table so the two cannot drift.
//
// Spec testsuite: fully V8-valid 222 -> 229.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import {
  anyOpcodeName,
  PREFIX_MISC,
  PREFIX_SIMD,
  PREFIX_THREADS,
} from '../../../src/wabt-ts/core/opcode.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
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

function hasSeq(b: Uint8Array, ...bytes: number[]): boolean {
  outer: for (let i = 0; i + bytes.length <= b.length; i++) {
    for (let j = 0; j < bytes.length; j++) if (b[i + j] !== bytes[j]) continue outer;
    return true;
  }
  return false;
}

function roundTripsExactly(wat: string): boolean {
  const first = compile(wat);
  const { text, errors } = wasm2wat(first);
  if (hasErrors(errors) || !text) return false;
  const second = compile(text);
  return first.length === second.length && first.every((b, i) => b === second[i]);
}

describe('opcode packing holds a 16-bit sub-opcode', () => {
  it('a sub-opcode >= 0x100 does not collide with the next prefix', () => {
    // The exact arithmetic that produced the bug: with `<< 8` the sub-opcode
    // aliases onto a LOW sub-opcode of the SAME prefix, because bit 8 is
    // already set by the prefix.
    assertEquals((0xfd << 8) | 0x100, (0xfd << 8) | 0x00, 'relaxed 0x100 aliased onto v128.load');
    assertEquals((0xfd << 8) | 0x111, (0xfd << 8) | 0x11, 'relaxed 0x111 aliased onto i32x4.splat');
    // With `<< 16` the prefix survives and the sub-opcode is recoverable.
    const packed = (PREFIX_SIMD << 16) | 0x100;
    assertEquals((packed >>> 16) & 0xff, PREFIX_SIMD);
    assertEquals(packed & 0xffff, 0x100);
  });

  it('core opcodes are unchanged by the wider shift', () => {
    // (0 << 16) | n === n, so an unprefixed opcode keeps its value.
    for (const n of [0x00, 0x0b, 0x41, 0xd0, 0xff]) assertEquals((0 << 16) | n, n);
  });

  it('every prefix round-trips through pack/unpack', () => {
    for (const p of [PREFIX_SIMD, PREFIX_MISC, PREFIX_THREADS]) {
      for (const sub of [0x00, 0x0f, 0xff, 0x100, 0x113, 0xffff]) {
        const packed = (p << 16) | sub;
        assertEquals((packed >>> 16) & 0xff, p, `prefix for ${p}/${sub}`);
        assertEquals(packed & 0xffff, sub, `sub for ${p}/${sub}`);
      }
    }
  });
});

describe('relaxed SIMD encodes its real opcodes', () => {
  // Sub-opcodes >= 0x100 are LEB128: 0x100 -> 80 02, 0x113 -> 93 02.
  const cases: ReadonlyArray<readonly [string, string, number[]]> = [
    [
      'i8x16.relaxed_swizzle',
      '(module (func (param v128 v128) (result v128) (i8x16.relaxed_swizzle (local.get 0) (local.get 1))))',
      [0xfd, 0x80, 0x02],
    ],
    [
      'i32x4.relaxed_trunc_f32x4_s',
      '(module (func (param v128) (result v128) (i32x4.relaxed_trunc_f32x4_s (local.get 0))))',
      [0xfd, 0x81, 0x02],
    ],
    [
      'f32x4.relaxed_madd',
      '(module (func (param v128 v128 v128) (result v128) (f32x4.relaxed_madd (local.get 0) (local.get 1) (local.get 2))))',
      [0xfd, 0x85, 0x02],
    ],
    [
      'i8x16.relaxed_laneselect',
      '(module (func (param v128 v128 v128) (result v128) (i8x16.relaxed_laneselect (local.get 0) (local.get 1) (local.get 2))))',
      [0xfd, 0x89, 0x02],
    ],
    [
      'i16x8.relaxed_q15mulr_s',
      '(module (func (param v128 v128) (result v128) (i16x8.relaxed_q15mulr_s (local.get 0) (local.get 1))))',
      [0xfd, 0x91, 0x02],
    ],
    [
      'i32x4.relaxed_dot_i8x16_i7x16_add_s',
      '(module (func (param v128 v128 v128) (result v128) (i32x4.relaxed_dot_i8x16_i7x16_add_s (local.get 0) (local.get 1) (local.get 2))))',
      [0xfd, 0x93, 0x02],
    ],
  ];
  for (const [name, wat, bytes] of cases) {
    it(`${name} emits ${bytes.map((b) => b.toString(16)).join(' ')}`, () => {
      const binary = compile(wat);
      assert(hasSeq(binary, ...bytes), `wrong opcode bytes for ${name}`);
      // And specifically NOT a bare one-byte sub-opcode, which is what the
      // aliased low-SIMD encoding would have produced.
      assert(
        !hasSeq(binary, 0xfd, bytes[1]! & 0x7f, 0x0b),
        `${name} looks like an aliased low SIMD opcode`,
      );
      assert(v8Accepts(binary), `V8 rejected ${name}`);
      assert(roundTripsExactly(wat), `${name} did not round-trip byte-identically`);
    });
  }

  it('wasm2wat names them instead of printing a raw opcode', () => {
    const { text } = wasm2wat(compile(
      '(module (func (param v128 v128) (result v128) (i8x16.relaxed_swizzle (local.get 0) (local.get 1))))',
    ));
    assert(text);
    assert(text.includes('i8x16.relaxed_swizzle'), `not named:\n${text}`);
    assert(!/<opcode:/.test(text), `printed a raw opcode:\n${text}`);
  });

  it('the name table covers the whole relaxed set', () => {
    for (let sub = 0x100; sub <= 0x113; sub++) {
      const nm = anyOpcodeName((PREFIX_SIMD << 16) | sub);
      assert(nm && nm.includes('relaxed'), `missing name for sub 0x${sub.toString(16)}: ${nm}`);
    }
  });
});

describe('ordinary prefixed opcodes are unaffected', () => {
  const cases: ReadonlyArray<readonly [string, string, number[]]> = [
    [
      'plain SIMD i32x4.add',
      '(module (func (param v128 v128) (result v128) (i32x4.add (local.get 0) (local.get 1))))',
      [0xfd, 0xae, 0x01],
    ],
    [
      'replace_lane keeps its scalar operand',
      '(module (func (param v128 i32) (result v128) (i32x4.replace_lane 0 (local.get 0) (local.get 1))))',
      [0xfd, 0x1c],
    ],
    [
      'misc memory.copy',
      '(module (memory 1) (func (memory.copy (i32.const 0) (i32.const 0) (i32.const 0))))',
      [0xfc, 0x0a],
    ],
  ];
  for (const [name, wat, bytes] of cases) {
    it(name, () => {
      const binary = compile(wat);
      assert(hasSeq(binary, ...bytes), `wrong bytes for ${name}`);
      assert(v8Accepts(binary), `V8 rejected ${name}`);
    });
  }
});
