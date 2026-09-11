// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// C2 (cmem/divergences.md): `(@custom "name" place? "data"*)` — a custom
// section written in text.
//
// 🔧 The WAT writer printed every custom section as `(@custom …)`, and the
// lexer skipped EVERY annotation at the character level — so `wasm2wat` →
// `wat2wasm` dropped them all, silently: `producers`, `target_features`,
// `dylink.0`, whatever a toolchain had put there. Now the one annotation
// wabt-ts understands is lexed (`LparAnn`) and parsed, and the writer prints
// WHERE the section sat, so the text assembles back to the same bytes.
//
// Placement is `wasm-tools`' syntax and semantics (`(before first)`,
// `(after last)`, `(before|after <section>)`); the expectations below were
// taken from `wasm-tools parse` on the very same text. Upstream wat2wasm
// accepts the syntax but IGNORES the position and appends — which is the
// divergence, and why the writer spells each position in the form BOTH tools
// accept (`(before type)`, never `(before first)`).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';

/**
 * The section sequence: known sections by id, custom sections as
 * `"name"=<payload hex>`.
 */
function layout(b: Uint8Array): string {
  const out: string[] = [];
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id === 0) {
      const n = b[i]!;
      const name = new TextDecoder().decode(b.subarray(i + 1, i + 1 + n));
      const payload = [...b.subarray(i + 1 + n, i + size)]
        .map((x) => x.toString(16).padStart(2, '0')).join('');
      out.push(`"${name}"=${payload}`);
    } else out.push(String(id));
    i += size;
  }
  return out.join(' ');
}

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
/** The layout with the generated `name` section — every text module gets one (N1) — left off. */
function layoutNoNames(wat: string): string {
  return layout(assemble(wat)).replace(/ ?"name"=\S*/g, '');
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

describe('C2 — a custom section survives wasm2wat → wat2wasm, where it stood', () => {
  // Custom sections in three places: before every known section, between the
  // type and function sections, and after the code section.
  const THREE = new Uint8Array([
    ...[0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
    ...[0, 8, 5, 0x66, 0x69, 0x72, 0x73, 0x74, 1, 2], // "first" = 01 02
    ...[1, 4, 1, 0x60, 0, 0],
    ...[0, 12, 10, 0x61, 0x66, 0x74, 0x65, 0x72, 0x2d, 0x74, 0x79, 0x70, 0x65, 3], // "after-type" = 03
    ...[3, 2, 1, 0],
    ...[10, 4, 1, 2, 0, 0x0b],
    ...[0, 8, 4, 0x6c, 0x61, 0x73, 0x74, 0x41, 0x22, 0x5c], // "last" = 41 22 5c
  ]);

  it('the fixture is a valid module with the three sections where they were put', () => {
    assert(WebAssembly.validate(THREE as BufferSource));
    assertEquals(layout(THREE), '"first"=0102 1 "after-type"=03 3 10 "last"=41225c');
  });

  it('wasm2wat prints each one with its position', () => {
    const text = wasm2wat(THREE).text;
    assertEquals(text.split('\n').filter((l) => l.includes('@custom')).map((l) => l.trim()), [
      '(@custom "first" (before type) "\\01\\02")',
      '(@custom "after-type" (after type) "\\03")',
      '(@custom "last" (after code) "A\\22\\5c"))',
    ]);
  });

  it('and wat2wasm puts them back, byte for byte', () => {
    assertEquals(
      layoutNoNames(wasm2wat(THREE).text),
      layout(THREE),
    );
  });

  it("a wabt-ts binary round trip keeps them too (it always did — the text didn't)", () => {
    const errors = makeErrorList();
    const m = readBinaryIr(THREE, errors, { readDebugNames: true });
    assert(!hasErrors(errors), formatErrors(errors));
    assert(same(writeBinaryIr(m), THREE), hex(writeBinaryIr(m)));
  });

  it('and binaryen-ts keeps them now too — C3, fixed', () => {
    // This pinned the DROP until C3: binaryen-ts's decoder collected no custom
    // section, so a decode → encode lost `producers`, `target_features`,
    // `dylink.0` outright. It now restores each one's position, which upstream
    // `wasm-opt` does for `dylink.0` alone (register C6).
    assert(same(encodeWasm(parseWasm(THREE)), THREE), hex(encodeWasm(parseWasm(THREE))));
  });
});

describe('C2 — every placement, against wasm-tools', () => {
  // Each expectation is `wasm-tools parse`'s own section sequence for the WAT
  // beside it (wasm-tools 1.259.0), with our generated `name` section removed.
  for (
    const [name, wat, expected] of [
      [
        '(before type), with a type section',
        '(module (type (func)) (@custom "c" (before type) "x") (func (type 0)))',
        '"c"=78 1 3 10',
      ],
      [
        '(before type), with no type section',
        '(module (memory 1) (@custom "c" (before type) "x"))',
        '"c"=78 5',
      ],
      [
        '(before first) — the same position',
        '(module (func) (@custom "c" (before first) "x"))',
        '"c"=78 1 3 10',
      ],
      [
        '(after last)',
        '(module (func) (@custom "c" (after last) "x") (memory 1))',
        '1 3 5 10 "c"=78',
      ],
      [
        'no placement — the end, as both oracles place it',
        '(module (func) (@custom "c" "x") (memory 1))',
        '1 3 5 10 "c"=78',
      ],
      [
        'no placement, then (after last) — the writing order holds',
        '(module (func) (@custom "a" "x") (@custom "b" (after last) "y"))',
        '1 3 10 "a"=78 "b"=79',
      ],
      [
        '(after func)',
        '(module (func) (table 1 funcref) (@custom "c" (after func) "x"))',
        '1 3 "c"=78 4 10',
      ],
      [
        '(before func)',
        '(module (func) (@custom "c" (before func) "x") (type (func)))',
        '1 "c"=78 3 10',
      ],
      [
        '(after tag)',
        '(module (tag) (@custom "c" (after tag) "x") (global i32 (i32.const 0)))',
        '1 13 "c"=78 6',
      ],
      ['(before tag)', '(module (tag) (@custom "c" (before tag) "x") (memory 1))', '1 5 "c"=78 13'],
      [
        '(before code) — the position after the DataCount section',
        '(module (memory 1) (data "") (func (data.drop 0)) (@custom "c" (before code) "x"))',
        '1 3 5 12 "c"=78 10 11',
      ],
      [
        '(before data)',
        '(module (memory 1) (data "") (@custom "c" (before data) "x") (func))',
        '1 3 5 10 "c"=78 11',
      ],
      [
        'every (after X), one custom each',
        '(module (@custom "t" (after type) "") (@custom "i" (after import) "") ' +
        '(@custom "ta" (after table) "") (@custom "m" (after memory) "") ' +
        '(@custom "g" (after global) "") (@custom "e" (after export) "") ' +
        '(@custom "s" (after start) "") (@custom "el" (after elem) "") ' +
        '(@custom "co" (after code) "") (@custom "d" (after data) "") ' +
        '(type (func)) (import "a" "b" (func)) (table 1 funcref) (memory 1) ' +
        '(global i32 (i32.const 0)) (export "x" (func 0)) (start 0) ' +
        '(elem (i32.const 0) 0) (func) (data (i32.const 0) ""))',
        '1 "t"= 2 "i"= 3 4 "ta"= 5 "m"= 6 "g"= 7 "e"= 8 "s"= 9 "el"= 10 "co"= 11 "d"=',
      ],
      ['the data strings concatenate', '(module (@custom "c" "ab" "cd"))', '"c"=61626364'],
      ['no data string at all', '(module (@custom "c"))', '"c"='],
    ] as const
  ) {
    it(name, () => {
      assertEquals(layoutNoNames(wat), expected);
    });
  }
});

describe('C2 — what is rejected, as wasm-tools rejects it', () => {
  for (
    const [name, wat, message] of [
      // `datacount` names no position either tool will take: wasm-tools has no
      // such keyword, and the position is reachable as `(before code)`.
      [
        '(after datacount)',
        '(module (memory 1) (data "") (func (data.drop 0)) (@custom "c" (after datacount) "x"))',
        'unknown section in custom section placement: after datacount',
      ],
      [
        '(after first) — `first` is a before-position only',
        '(module (@custom "c" (after first) "x"))',
        'unknown section in custom section placement: after first',
      ],
      [
        '(before last) — and `last` an after-position only',
        '(module (@custom "c" (before last) "x"))',
        'unknown section in custom section placement: before last',
      ],
      [
        'a word that is no section',
        '(module (@custom "c" (before after) "x"))',
        'unknown section in custom section placement: before after',
      ],
      ['a name that is not a quoted string', '(module (@custom $c "x"))', 'expected string'],
      [
        'misplaced: inside a function body',
        '(module (func (@custom "c" "x") (nop)))',
        'Annotation',
      ],
      ['misplaced: inside a type field', '(module (type (@custom "c" "x") (func)))', 'Annotation'],
    ] as const
  ) {
    it(name, () => {
      const r = wat2wasm(wat);
      assert(hasErrors(r.errors), 'expected an error');
      assert(
        formatErrors(r.errors).includes(message),
        `expected ${JSON.stringify(message)}, got: ${formatErrors(r.errors)}`,
      );
    });
  }

  it('a longer annotation id is NOT @custom — it is skipped, as before', () => {
    assertEquals(layoutNoNames('(module (@customx "c" "x") (func))'), '1 3 10');
  });
});

describe('C2 — a `name` section written as an annotation is the name section', () => {
  // wasm2wat prints `(@custom "name" …)` exactly when the reader could NOT hold
  // the section in the IR, so the bytes it printed are the whole truth: writing
  // them back verbatim, and generating none, is what makes that text a fixed
  // point. (Upstream wat2wasm --debug-names does the opposite — the generated
  // section wins and the annotation is dropped; wasm-tools writes both.)
  const RAW = '(module (func $f) (@custom "name" "\\01\\04\\01\\00\\01g"))';

  it('the annotation is written verbatim and no second one is generated', () => {
    assertEquals(layout(assemble(RAW)), '1 3 10 "name"=010401000167');
  });

  it("so the module's own $f does not reach the binary", () => {
    assert(!layout(assemble(RAW)).includes('66'), layout(assemble(RAW)));
  });

  // 🔧 Two name sections: the reader applied the FIRST and left the second as
  // bytes — and a raw `name` custom stops the writer generating one, so the
  // first was LOST by a plain read → write. Every one is now kept as bytes, and
  // the names come from the LAST, as upstream wabt, binaryen and wasm-tools all
  // read them.
  const nameSec = (fn: string) => {
    const sub = [1, 0, fn.length, ...new TextEncoder().encode(fn)];
    const body = [4, 0x6e, 0x61, 0x6d, 0x65, 1, sub.length, ...sub];
    return [0, body.length, ...body];
  };
  const TWO = new Uint8Array([
    ...[0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
    ...[1, 4, 1, 0x60, 0, 0],
    ...[3, 2, 1, 0],
    ...[10, 4, 1, 2, 0, 0x0b],
    ...nameSec('a'),
    ...nameSec('b'),
  ]);

  it('the fixture is valid and really holds two', () => {
    assert(WebAssembly.validate(TWO as BufferSource));
    assertEquals(layout(TWO), '1 3 10 "name"=010401000161 "name"=010401000162');
  });

  it('a binary round trip keeps both, each where it was', () => {
    const errors = makeErrorList();
    const m = readBinaryIr(TWO, errors, { readDebugNames: true });
    assert(!hasErrors(errors), formatErrors(errors));
    assert(same(writeBinaryIr(m), TWO), hex(writeBinaryIr(m)));
  });

  it('the names come from the last one, and the text round trips too', () => {
    const text = wasm2wat(TWO).text;
    assert(text.includes('(func $b'), text);
    assertEquals(layout(assemble(text)), layout(TWO));
  });

  it('binaryen-ts names from the last one as well (it writes one section, as binaryen does)', () => {
    assert(
      layout(encodeWasm(parseWasm(TWO))).includes('"name"=010401000162'),
      layout(encodeWasm(parseWasm(TWO))),
    );
  });
});

describe('C2 — the writer and the parser read one table', () => {
  it('a custom after every known section round trips through the text', () => {
    // Positions the writer must spell in a form it can read back: the ones
    // whose section has no `after` keyword both tools take.
    const wat = '(module (type (func)) (@custom "a" (before table) "\\01") ' +
      '(@custom "b" (before global) "\\02") (func (type 0)))';
    const first = assemble(wat);
    const second = assemble(wasm2wat(first).text);
    assertEquals(layout(second), layout(first));
  });

  it('a placement anchored to a section the module does not have still round trips', () => {
    const wat = '(module (@custom "c" (after elem) "\\01") (memory 1))';
    const first = assemble(wat);
    assertEquals(layout(assemble(wasm2wat(first).text)), layout(first));
  });

  it('each position is spelled in the form BOTH oracles accept', async () => {
    // Our own parser takes every keyword in the table, so a round trip cannot
    // catch a spelling only ONE oracle reads. The two disagree:
    //   upstream wat2wasm: type import function table memory global export
    //                      start elem code data   (no `func`, no `tag`,
    //                      no `first`/`last`)
    //   wasm-tools:        …the same, plus `func`, `tag`, `first`, `last`,
    //                      but not `function`
    // So every position must be spelled with a keyword in the intersection —
    // which is why the function and tag sections are named by what FOLLOWS
    // them, and why `(before first)` is written `(before type)`.
    const { placementText } = await import('../../../src/wabt-ts/core/custom-placement.ts');
    const { BinarySection } = await import('../../../src/wabt-ts/core/binary.ts');
    assertEquals(
      [
        null,
        BinarySection.Type,
        BinarySection.Import,
        BinarySection.Function,
        BinarySection.Table,
        BinarySection.Memory,
        BinarySection.Tag,
        BinarySection.Global,
        BinarySection.Export,
        BinarySection.Start,
        BinarySection.Elem,
        BinarySection.DataCount,
        BinarySection.Code,
        BinarySection.Data,
      ].map((a) => placementText(a)),
      [
        '(before type)',
        '(after type)',
        '(after import)',
        '(before table)',
        '(after table)',
        '(after memory)',
        '(before global)',
        '(after global)',
        '(after export)',
        '(after start)',
        '(after elem)',
        '(before code)',
        '(after code)',
        '(after data)',
      ],
    );
  });

  it('and every spelling reads back as the position it was written for', async () => {
    const { placementAnchor, placementText, SECTION_ORDER } = await import(
      '../../../src/wabt-ts/core/custom-placement.ts'
    );
    for (const anchor of [null, ...SECTION_ORDER]) {
      const text = placementText(anchor);
      const [where, word] = text.slice(1, -1).split(' ') as ['before' | 'after', string];
      assertEquals(placementAnchor(where, word), anchor, text);
    }
  });

  it('an unreachable anchor is refused rather than mis-spelled', async () => {
    const { placementText } = await import('../../../src/wabt-ts/core/custom-placement.ts');
    const { BinarySection } = await import('../../../src/wabt-ts/core/binary.ts');
    assertThrows(() => placementText(BinarySection.Custom), Error, 'cannot anchor');
  });
});
