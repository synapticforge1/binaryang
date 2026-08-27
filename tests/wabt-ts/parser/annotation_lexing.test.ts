// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.7 — an annotation was skipped at the CHARACTER level, so nothing in it
// was checked.
//
// `(@id …)` is transparent: a tool that does not understand an annotation
// skips it. We implemented "skip" literally — consume characters, track paren
// depth, stop at the matching `)`. That is right about the BODY being
// untokenised and wrong about everything else, because the annotation still
// has a grammar:
//
//   annot ::= '(@' (idchar+ | string) (token | annot)* ')'
//
// Two rules fell out of it that the skip could not see:
//
//   1. The ID is REQUIRED and sits immediately after the `@`. `(@)`, `(@ x)`,
//      `(@(@a)x)` and `(@"")` are all malformed; we accepted every one.
//   2. The body is a TOKEN sequence, so it may only contain characters that
//      can appear in WAT source at all. A control byte, a DEL or a raw
//      non-ASCII character was swallowed silently.
//
// A quoted id is a NAME, so it takes the T12.5 UTF-8 rule with it — and the
// same rule then applies to the quoted spelling of an ordinary identifier,
// `$"…"`, which had no checks either.
//
// The exemptions are what make this safe: STRINGS and COMMENTS inside an
// annotation are skipped whole and deliberately NOT character-checked. A
// string is a byte string, and a comment is not tokenised — annotations.wast
// leans on both, with `(@a ")" "(" x")"y)` and `(@a (;bla;) (; ) ;)` among the
// shapes it asserts VALID.
//
// assert_malformed (quoted): 1087 -> 1137 / 1229. Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

const BS = String.fromCharCode(92); // a literal backslash, for WAT escapes

function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}
function ok(src: string): void {
  const { errors } = wat2wasm(src);
  assert(!hasErrors(errors), `rejected a LEGAL module ${src}:\n${formatErrors(errors)}`);
}

describe('T12.7 — an annotation body may only hold source characters', () => {
  it('rejects every control byte the spec calls illegal', () => {
    const legal = new Set([0x09, 0x0a, 0x0d]); // tab, LF, CR are whitespace
    for (let c = 0x00; c <= 0x1f; c++) {
      if (legal.has(c)) continue;
      assert(
        !accepts(`(module (@a ${String.fromCharCode(c)}))`),
        `accepted a body containing 0x${c.toString(16)}`,
      );
    }
    assert(!accepts('(module (@a \x7f))'), 'accepted DEL in a body');
  });

  it('rejects a raw non-ASCII character in a body', () => {
    assert(!accepts('(module (@a caf\u00e9))'));
    assert(!accepts('(module (@a \u{1f4a9}))'));
  });

  it('leaves tab, LF and CR alone — they are whitespace', () => {
    for (const c of ['\t', '\n', '\r', ' ']) ok(`(module (@a ${c}))`);
  });
});

describe('T12.7 — an annotation id is required, and adjacent to the @', () => {
  for (
    const [name, src] of [
      ['nothing at all', '(module (@))'],
      ['a space before the id', '(module (@ ))'],
      ['a space then a bare id', '(module (@ x))'],
      ['a nested annotation where the id goes', '(module (@(@a)x))'],
      ['an empty quoted id', '(module (@""))'],
      ['a space then a quoted id', '(module (@ "a"))'],
      ['a raw newline inside a quoted id', '(module (@"\n"))'],
      ['invalid UTF-8 in a quoted id', `(module (@"${BS}ef"))`],
    ] as const
  ) {
    it(`rejects ${name}`, () => {
      assert(!accepts(src), `accepted: ${src}`);
    });
  }
});

describe('T12.7 — the quoted spelling of an identifier is a name too', () => {
  it('rejects an empty, control-bearing or invalid-UTF-8 quoted id', () => {
    assert(!accepts('(module (func $""))'), 'accepted $""');
    assert(!accepts('(module (func $"a\nb"))'), 'accepted a raw newline');
    assert(!accepts('(module (func $"a\tb"))'), 'accepted a raw tab');
    assert(!accepts(`(module (func $"${BS}ef"))`), 'accepted invalid UTF-8');
  });

  it('still accepts the legal quoted spellings, escapes included', () => {
    // A spelled `\t` is an ESCAPE, not a raw tab — the check is on the source
    // text, not the decoded bytes, precisely so these keep working.
    ok(
      `(module (func $" random ${BS}t ${BS}n stuff ") (func (call $" random ${BS}t ${BS}n stuff ")))`,
    );
    ok(`(module (func $"${BS}t") (func (call $"${BS}09") (call $"${BS}u{09}")))`);
    ok('(module (func $fh) (func (call $"fh")))');
    ok(`(module (func $"${BS}41B") (func (call $"AB") (call $"${BS}u{41}${BS}u{42}")))`);
  });
});

describe('T12.7 — what annotations.wast asserts VALID must still parse', () => {
  const LEGAL = [
    '(@a)',
    '(@0)',
    '(@aas-3!@$d-@#4)',
    '(@@) (@$) (@+) (@.)',
    '(@"a")',
    '(@a x-y $yz "aa" -2 0.3 0x3)',
    '(@a 0x 8q 0xfa #4g0-.@f#^&@#$*0sf -- @#)',
    '(@a , ; ] [ }} }x{ ({) ,{{};}] ;)',
    '(@a (bla) () (5-g) ("aa" a) ($x) (x (y)) ")" "(" x")"y)',
    '(@a @ @x (@x) (@x y))',
  ];
  for (const ann of LEGAL) {
    it(`accepts ${ann}`, () => {
      ok(`(module ${ann})`);
    });
  }

  it('accepts comments in a body, whose contents must NOT be counted', () => {
    // Both `(; ) ;)` and `;; bla)` contain a `)` that would close the
    // annotation early if the comment were not skipped whole. That also means
    // a comment's characters are not source characters and stay unchecked.
    ok(`(module (@a (;bla;) (; ) ;)
      ;; bla)
      ;; bla (@x
    ))`);
  });

  it('accepts a body string holding bytes that would be illegal bare', () => {
    // The string exemption: an escaped 0xff inside an annotation string is
    // fine; the same byte raw in the body is not.
    ok(`(module (@a "${BS}ff${BS}00${BS}7f"))`);
  });

  it('accepts annotations interleaved through a real module', () => {
    ok(`((@a) module (@a)
          ((@a) func (@a) $f (@a) ((@a) result (@a) i32 (@a)) (@a) i32.const 1 (@a)) (@a)
        )`);
  });
});
