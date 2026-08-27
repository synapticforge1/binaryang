// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.5 — a wasm NAME must be valid UTF-8, and neither path checked.
//
// Both decoders were lenient (`TextDecoder` without `fatal`), which silently
// substitutes U+FFFD for an invalid sequence. So an invalid import or export
// name became a DIFFERENT, valid-looking name — and a name is the module's
// public contract, the one thing a host links against.
//
// The tranche entry ranked this last of the wrong-value work, as "name
// mangled", on the strength of its 186 quoted cases. It turned out to be the
// highest-leverage item in T12 by a wide margin, because **the same rule holds
// on both sides of the pipeline**: utf8-import-module.wast, utf8-import-field
// .wast and utf8-custom-section-id.wast are 176 BINARY cases each.
//
//   assert_malformed (quoted)   869 -> 1045 / 1229
//   assert_malformed (binary)   110 ->  638 /  711
//
// The exemption matters as much as the rule: DATA SEGMENTS are arbitrary bytes.
// `(data "\ff")` is legal and goes through `parseTextList`, which is
// deliberately not checked — only `parseQuotedText`, the name path, is.
//
// And `ignoreBOM: true` is load-bearing on the strict decoder. Without it
// TextDecoder STRIPS a leading U+FEFF, which silently renames the export; that
// is T7.13, and leaving it off dropped V8-valid from 257 to 256 the moment the
// decoder was introduced.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';

const BS = String.fromCharCode(92); // a literal backslash, for WAT escapes

function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}

/** A minimal binary whose single import carries `nameBytes` as its module name. */
function importModuleNamed(nameBytes: number[]): Uint8Array {
  const u32 = (n: number): number[] => {
    const o: number[] = [];
    do {
      let b = n & 0x7f;
      n >>>= 7;
      if (n) b |= 0x80;
      o.push(b);
    } while (n);
    return o;
  };
  const sec = (id: number, b: number[]) => [id, ...u32(b.length), ...b];
  const imports = [
    1,
    ...u32(nameBytes.length),
    ...nameBytes,
    1,
    0x66, // field "f"
    0x03,
    0x7f,
    0x00, // global i32 immutable
  ];
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sec(2, imports)]);
}

function binaryRejects(nameBytes: number[]): boolean {
  const errs = makeErrorList();
  try {
    readBinaryIr(importModuleNamed(nameBytes), errs);
  } catch {
    return true;
  }
  return hasErrors(errs);
}

const INVALID: [string, string, number[]][] = [
  ['a lone continuation byte', BS + '80', [0x80]],
  ['a truncated 2-byte sequence', BS + 'c2', [0xc2]],
  ['an overlong encoding', BS + 'c0' + BS + '80', [0xc0, 0x80]],
  ['a truncated 3-byte sequence', BS + 'e0' + BS + 'a0', [0xe0, 0xa0]],
  ['a lone surrogate', BS + 'ed' + BS + 'a0' + BS + '80', [0xed, 0xa0, 0x80]],
  ['a byte above the max code point', BS + 'f5' + BS + '80' + BS + '80' + BS + '80', [
    0xf5,
    0x80,
    0x80,
    0x80,
  ]],
];

describe('T12.5 — an invalid UTF-8 NAME is rejected in the TEXT path', () => {
  for (const [name, esc] of INVALID) {
    it(`rejects an export name with ${name}`, () => {
      assert(!accepts(`(module (func (export "${esc}")))`), `accepted ${name}`);
    });
  }

  it('rejects it in an import module and field name too', () => {
    assert(!accepts(`(module (import "${BS}80" "f" (func)))`));
    assert(!accepts(`(module (import "m" "${BS}80" (func)))`));
  });

  it('says what is wrong', () => {
    const { errors } = wat2wasm(`(module (func (export "${BS}80")))`);
    assert(/malformed UTF-8 encoding/.test(formatErrors(errors)), formatErrors(errors));
  });
});

describe('T12.5 — and in the BINARY path', () => {
  for (const [name, , bytes] of INVALID) {
    it(`rejects an import module name with ${name}`, () => {
      assert(binaryRejects(bytes), `accepted ${name}`);
    });
  }
});

describe('T12.5 — what must still be accepted', () => {
  it('accepts genuine multi-byte UTF-8 in names', () => {
    assert(accepts('(module (func (export "café ☃")))'));
    assert(accepts('(module (import "mód" "fïeld" (func)))'));
    assert(!binaryRejects([0xc2, 0xa2]), 'binary rejected a valid 2-byte sequence');
    assert(!binaryRejects([0xf0, 0x9f, 0x92, 0xa9]), 'binary rejected a valid 4-byte sequence');
  });

  it('leaves DATA SEGMENTS alone — they are arbitrary bytes', () => {
    // The exemption is the point: `(data "\\ff")` is legal wasm. Data goes
    // through parseTextList, names through parseQuotedText.
    for (const esc of [BS + 'ff', BS + '80', BS + '00', BS + 'c0' + BS + '80']) {
      assert(
        accepts(`(module (memory 1) (data (i32.const 0) "${esc}"))`),
        `rejected a legal data segment containing ${esc}`,
      );
    }
  });

  it('keeps a BOM in a name as a CHARACTER, not a marker (T7.13)', () => {
    // `ignoreBOM: true` on the strict decoder. Without it the BOM is stripped
    // and the export is silently renamed.
    const { binary, errors } = wat2wasm(
      `(module (func (export "${BS}ef${BS}bb${BS}bf")) (func (export "")))`,
    );
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const names = WebAssembly.Module.exports(new WebAssembly.Module(buf)).map((e) => e.name);
    assertEquals(names, ['﻿', ''], 'the BOM export lost its name');
  });
});
