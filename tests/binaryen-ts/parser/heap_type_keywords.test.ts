// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// binaryen-ts spelled two abstract heap types `ext` / `noext` — binaryen's
// internal C++ names, which are NOT WAT keywords. Because `heapTypeToString`
// returns the enum VALUE as the keyword, the defect ran both ways:
//
//   - the parser REJECTED `(ref null extern)`, which is the spec spelling and
//     what every other tool emits, with "unknown heap type: extern";
//   - the printer EMITTED `(ref null ext)`, which no WAT parser accepts.
//
// `exn` / `noexn` were absent from the parser's map entirely, though the enum
// declared them. Four of twelve keywords broken in both directions.
//
// Nothing caught it because nothing asserted on the keyword set: the round-trip
// corpus is binary-sourced, and `deno task baseline` compares OUR bytes against
// OUR bytes. wabt-ts had the right table all along (`core/types.ts`), so the
// two implementations disagreed silently — the case for checking a vocabulary
// against the SPEC rather than against the other half of the same repo.
//
// ⚠️ Upstream wabt cannot arbitrate this one: 1.0.41 has no GC heap-type text
// support at all (`(ref null any)` → `unexpected token "any"`), which is the
// same limitation that makes it skip 30 files in `deno task spec:prepare`.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWat, WatParseError } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { AbstractHeapType, refTypeToString } from '../../../src/binaryen-ts/ir/gc-types.ts';

/** Every abstract heap type the text format defines. */
const SPEC_KEYWORDS: ReadonlyArray<readonly [string, AbstractHeapType]> = [
  ['func', AbstractHeapType.Func],
  ['nofunc', AbstractHeapType.NoFunc],
  ['extern', AbstractHeapType.Ext],
  ['noextern', AbstractHeapType.NoExt],
  ['any', AbstractHeapType.Any],
  ['eq', AbstractHeapType.Eq],
  ['i31', AbstractHeapType.I31],
  ['struct', AbstractHeapType.Struct],
  ['array', AbstractHeapType.Array],
  ['none', AbstractHeapType.None],
  ['exn', AbstractHeapType.Exn],
  ['noexn', AbstractHeapType.NoExn],
];

/** binaryen's internal spellings, which are not WAT and must not be accepted. */
const NOT_WAT = ['ext', 'noext'];

describe('binaryen-ts — abstract heap-type keywords', () => {
  for (const [keyword, heap] of SPEC_KEYWORDS) {
    it(`parses (ref null ${keyword}) and prints it back unchanged`, () => {
      parseWat(`(module (func $f (param (ref null ${keyword}))))`);
      // The printed form is the property that broke: the enum's VALUE is the
      // keyword, so a wrong value is invalid output rather than a wrong label.
      assertEquals(refTypeToString({ heap, nullable: true }), `(ref null ${keyword})`);
    });
  }

  for (const bad of NOT_WAT) {
    it(`rejects "${bad}", which is binaryen's internal name and not WAT`, () => {
      assertThrows(
        () => parseWat(`(module (func $f (param (ref null ${bad}))))`),
        WatParseError,
        'unknown heap type',
      );
    });
  }

  it('every enum member is reachable from the text format', () => {
    // A member with no keyword is a type the parser can never produce — the
    // shape `exn`/`noexn` were in before this fix.
    const mapped = new Set(SPEC_KEYWORDS.map(([, h]) => h));
    for (const h of Object.values(AbstractHeapType)) {
      assertEquals(mapped.has(h), true, `AbstractHeapType.${h} has no WAT keyword`);
    }
  });
});
