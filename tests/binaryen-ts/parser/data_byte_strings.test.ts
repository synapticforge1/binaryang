// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A WAT string literal is a BYTE STRING, not text.
//
// ⚠️ `parseData` took the tokenizer's DECODED text and ran it through
// `TextEncoder`, which UTF-8 encodes it. Every escape above 0x7f was therefore
// silently widened into two bytes: `\f0` became `\c3\b0`, `\f8` became
// `\c3\b8`. Any data segment holding a float, a pointer, or packed binary came
// out CORRUPTED — and the module still validated, because data segments are
// opaque bytes. The program simply read the wrong numbers. 47 corpus modules
// carried mangled data and nothing reported it.
//
// 🔑 **The boundary is 0x7f, and that is why it survived.** Everything ASCII
// round-trips through UTF-8 unchanged, so a fixture using readable strings —
// which is what a data-segment test naturally looks like — passes either way.
// The tests below therefore assert on bytes at and above 0x80, and read them
// back out of MEMORY rather than trusting the encoder.
//
// The fix decodes from the RAW token, which is the only place the distinction
// still exists: an ESCAPE is one byte, while a literal non-ASCII character in
// the source is its UTF-8 bytes, and the decoded text has already lost which
// was which. `\u{...}` is the one escape that legitimately expands, because it
// names a code point rather than a byte.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** A module whose `f` reads byte `off` of a data segment written at address 0. */
const readByte = (data: string, off: number) =>
  `(module (memory 1) (data (i32.const 0) "${data}")
    (func (export "f") (result i32) (i32.load8_u (i32.const ${off}))))`;

/** Build with both toolchains, run both, and require them to agree with `want`. */
function bothRead(wat: string, want: number): void {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the fixture');
  const run = (bytes: Uint8Array) =>
    (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports.f as () => number)();
  assertEquals(run(ref.binary), want, 'wabt-ts');
  assertEquals(run(encodeWasm(parseWat(wat))), want, 'binaryen-ts');
}

describe('WAT parser — a data string is bytes, not text', () => {
  // At and above 0x80 is where UTF-8 widening bites.
  it('a hex escape above 0x7f is ONE byte', () => {
    bothRead(readByte(String.raw`\f0\00`, 0), 0xf0);
    bothRead(readByte(String.raw`\ff\00`, 0), 0xff);
    bothRead(readByte(String.raw`\80\00`, 0), 0x80);
  });

  // The byte AFTER a high escape is the real proof: if `\f0` widened to two
  // bytes, everything downstream shifted by one.
  it('a high byte does not shift the bytes after it', () => {
    bothRead(readByte(String.raw`\f0\41`, 1), 0x41);
    bothRead(readByte(String.raw`\ff\ff\41`, 2), 0x41);
  });

  it('0x7f is the boundary and is unchanged', () => {
    bothRead(readByte(String.raw`\7f\00`, 0), 0x7f);
  });

  // A real payload: f64 1.0 is 00 00 00 00 00 00 f0 3f, and `?` is 0x3f.
  it('an f64 constant in a data segment survives intact', () => {
    const wat = `(module (memory 1)
      (data (i32.const 0) "${String.raw`\00\00\00\00\00\00\f0?`}")
      (func (export "f") (result i32)
        (i32.add (i32.mul (i32.load8_u (i32.const 6)) (i32.const 1000))
                 (i32.load8_u (i32.const 7)))))`;
    bothRead(wat, 0xf0 * 1000 + 0x3f);
  });

  it('the escapes that were already right stay right', () => {
    bothRead(readByte(String.raw`\n\00`, 0), 0x0a);
    bothRead(readByte(String.raw`\t\00`, 0), 0x09);
    bothRead(readByte(String.raw`\00\41`, 1), 0x41);
    bothRead(readByte(String.raw`\\\00`, 0), 0x5c);
  });

  it('plain ASCII is unchanged — the control that hid this', () => {
    bothRead(readByte('AB', 0), 0x41);
    bothRead(readByte('AB', 1), 0x42);
  });

  // `\u{...}` names a CODE POINT, so expanding it to UTF-8 is correct — the one
  // escape where the old behaviour was the right behaviour.
  it('a \\u{...} escape DOES expand to its UTF-8 bytes', () => {
    // U+00E9 is 0xc3 0xa9 in UTF-8.
    bothRead(readByte(String.raw`\u{e9}\00`, 0), 0xc3);
    bothRead(readByte(String.raw`\u{e9}\00`, 1), 0xa9);
  });

  it('several string operands concatenate without corruption', () => {
    const wat = `(module (memory 1)
      (data (i32.const 0) "${String.raw`\f0`}" "${String.raw`\ff`}" "A")
      (func (export "f") (result i32) (i32.load8_u (i32.const 2))))`;
    bothRead(wat, 0x41);
  });
});
