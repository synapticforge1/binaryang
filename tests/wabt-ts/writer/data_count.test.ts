// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// W6 (cmem/divergences.md): the DataCount section (id 12) is written when a
// function body names a data segment — and when the module was READ with one.
//
// Both writers emitted it whenever a data segment EXISTED. Upstream `wat2wasm`
// and `wasm-tools` emit it only when code uses a data index (`memory.init`,
// `data.drop`, GC's `array.new_data` / `array.init_data`), which is when the
// format requires it. Over the corpus, 252 modules differed from upstream in
// this section and nothing else; now every module upstream can assemble with
// default features — 400 of 421 — is identical outside the custom sections.
// (The other 21 need exceptions, and differ only in W5's sections.)
//
// A binary that CARRIES a DataCount it does not need keeps it through both
// halves, so a binary round trip still changes nothing.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';

/** Section ids in order, custom sections left out. */
function sectionIds(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id !== 0) out.push(id);
    i += size;
  }
  return out;
}
/** The binary with its custom sections cut out. */
function withoutCustoms(b: Uint8Array): Uint8Array {
  const keep: number[] = [...b.subarray(0, 8)];
  for (let i = 8; i < b.length;) {
    const start = i;
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    i += size;
    if (id !== 0) keep.push(...b.subarray(start, i));
  }
  return new Uint8Array(keep);
}
function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

describe('wat2wasm writes a DataCount exactly when code names a data segment', () => {
  for (
    const [name, wat, expected] of [
      ['an active segment alone', '(module (memory 1) (data (i32.const 0) "x"))', false],
      ['a passive segment alone', '(module (memory 1) (data "x"))', false],
      ['data.drop', '(module (memory 1) (data "x") (func (data.drop 0)))', true],
      [
        'memory.init',
        '(module (memory 1) (data "x") (func (memory.init 0 (i32.const 0) (i32.const 0) (i32.const 1))))',
        true,
      ],
      [
        'array.new_data (GC)',
        '(module (type $a (array i8)) (memory 1) (data "xy") (func (result (ref $a)) (array.new_data $a 0 (i32.const 0) (i32.const 2))))',
        true,
      ],
      [
        'array.init_data (GC)',
        '(module (type $a (array (mut i8))) (memory 1) (data "xy") (func (param (ref $a)) (array.init_data $a 0 (local.get 0) (i32.const 0) (i32.const 0) (i32.const 1))))',
        true,
      ],
    ] as const
  ) {
    it(`${name}: ${expected ? 'written' : 'not written'}`, () => {
      assertEquals(sectionIds(assemble(wat)).includes(12), expected);
    });
  }

  it("upstream wat2wasm's bytes, both ways (wabt 1.0.41; custom sections aside)", () => {
    assertEquals(
      withoutCustoms(assemble(
        '(module (memory 1) (data (i32.const 0) "x") (func (param i32) (drop (i32.load (local.get 0)))))',
      )),
      hex(`00 61 73 6d 01 00 00 00 01 05 01 60 01 7f 00 03 02 01 00 05 03 01 00 01 0a 0a 01 08 00 20
           00 28 02 00 1a 0b 0b 07 01 00 41 00 0b 01 78`),
    );
    assertEquals(
      withoutCustoms(assemble('(module (memory 1) (data "x") (func (data.drop 0)))')),
      hex(`00 61 73 6d 01 00 00 00 01 04 01 60 00 00 03 02 01 00 05 03 01 00 01 0c 01 01 0a 07 01 05
           00 fc 09 00 0b 0b 04 01 01 01 78`),
    );
  });
});

// (module (memory 1) (data (i32.const 0) "x")), by hand, with and without a
// DataCount section it does not need.
const WITH_DC = new Uint8Array([
  ...[0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
  ...[5, 3, 1, 0, 1],
  ...[12, 1, 1],
  ...[11, 7, 1, 0, 0x41, 0, 0x0b, 1, 0x78],
]);
const WITHOUT_DC = new Uint8Array([...WITH_DC.subarray(0, 13), ...WITH_DC.subarray(16)]);

describe('a binary round trip keeps the DataCount the binary had — and adds none', () => {
  it('both inputs are valid', () => {
    assert(WebAssembly.validate(WITH_DC as BufferSource));
    assert(WebAssembly.validate(WITHOUT_DC as BufferSource));
  });

  for (const [label, bytes] of [['with one', WITH_DC], ['without one', WITHOUT_DC]] as const) {
    it(`wabt-ts read → write, ${label}`, () => {
      const errors = makeErrorList();
      const m = readBinaryIr(bytes, errors, {});
      assert(!hasErrors(errors), formatErrors(errors));
      assert(same(writeBinaryIr(m), bytes));
    });

    it(`binaryen-ts decode → encode, ${label}`, () => {
      assert(same(encodeWasm(parseWasm(bytes)), bytes));
    });
  }
});

describe("binaryen-ts's encoder follows the same rule", () => {
  it('a data segment alone: none', () => {
    assert(
      !sectionIds(encodeWasm(parseWat('(module (memory 1) (data (i32.const 0) "x"))'))).includes(
        12,
      ),
    );
  });

  it('a data.drop: written, before the code section', () => {
    const ids = sectionIds(
      encodeWasm(parseWat('(module (memory 1) (data "x") (func (data.drop 0)))')),
    );
    assert(ids.indexOf(12) >= 0 && ids.indexOf(12) < ids.indexOf(10), ids.join(' '));
  });
});
