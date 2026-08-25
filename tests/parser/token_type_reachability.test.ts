// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.32 — every `TokenType` the lexer can emit, and nothing else.
//
// `TokenType` has 182 members. Two are referenced by neither the lexer nor the
// parser, and both turn out to be deliberate:
//
//   SimdLoadSplat  superseded — `v128.load8_splat` lexes as TokenType.Load
//                  carrying a SIMD sub-opcode, not as its own token type
//   LparAnn        deliberately abandoned. `wast-lexer.ts` explains it in
//                  place: annotation bodies contain arbitrary reserved
//                  characters, so they are skipped at the CHARACTER level;
//                  emitting LparAnn and resuming normal lexing produced
//                  "unexpected char" on the first `,`
//
// Neither is a bug. Both are traps — an editor reaching for
// `TokenType.SimdLoadSplat` to handle splat instructions would emit a token
// nothing consumes, and the parse would fail somewhere unrelated.
//
// **The regression this really guards is the other direction.** A member stops
// being produced when its KEYWORDS entry is deleted or mistyped — and the
// symptom is not a compile error, it is valid WAT quietly failing to parse.
// Pinning the never-produced set to a documented allowlist turns that into a
// red test naming the token, instead of a lexer that silently forgets a
// keyword. That is the same shape as T13.18's arity gate: a hand-maintained
// correspondence, enforced from the source rather than asserted in a comment.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

const TOKEN_SRC = new URL('../../src/parser/token.ts', import.meta.url);
const LEXER_SRC = new URL('../../src/parser/wast-lexer.ts', import.meta.url);
const PARSER_SRC = new URL('../../src/parser/wast-parser.ts', import.meta.url);

/**
 * Members that the lexer legitimately never emits. Each needs a reason here;
 * an entry with no reason is a cleanup someone abandoned halfway.
 */
const NEVER_EMITTED: ReadonlyMap<string, string> = new Map([
  ['SimdLoadSplat', 'superseded: v128.load*_splat lexes as TokenType.Load + a SIMD sub-opcode'],
  ['LparAnn', 'abandoned: annotations are skipped at the character level (see wast-lexer.ts)'],
]);

async function tokenTypeMembers(): Promise<string[]> {
  const src = await Deno.readTextFile(TOKEN_SRC);
  const at = src.indexOf('export const enum TokenType {');
  assert(at !== -1, 'could not locate the TokenType enum');
  const end = src.indexOf('\n}', at);
  assert(end !== -1, 'unbalanced TokenType enum');
  return [...src.slice(at, end).matchAll(/^\s*(\w+)\s*(?:=|,)/gm)].map((m) => m[1]!);
}

async function referenced(url: URL): Promise<Set<string>> {
  const src = await Deno.readTextFile(url);
  return new Set([...src.matchAll(/TokenType\.(\w+)/g)].map((m) => m[1]!));
}

describe('T13.32 — TokenType members are reachable, or documented as not', () => {
  it('the lexer emits every member except the documented exceptions', async () => {
    const members = await tokenTypeMembers();
    const emitted = await referenced(LEXER_SRC);

    // Pin the population: a broken enum scrape would make this vacuous.
    assert(
      members.length > 150,
      `only found ${members.length} TokenType members — scrape is broken`,
    );

    const missing = members.filter((m) => !emitted.has(m) && !NEVER_EMITTED.has(m)).sort();
    assert(
      missing.length === 0,
      `${missing.length} TokenType member(s) are never emitted by the lexer. If a KEYWORDS ` +
        `entry was deleted or mistyped, valid WAT now fails to parse with an unrelated error. ` +
        `If the member is genuinely obsolete, add it to NEVER_EMITTED with a reason:\n  ` +
        missing.join('\n  '),
    );
  });

  it('does not carry a stale NEVER_EMITTED entry', async () => {
    // If one of these starts being emitted, the allowlist is a lie and the next
    // reader will trust it. Same rule as T13.18's SimdLaneOp exemption.
    const emitted = await referenced(LEXER_SRC);
    const stale = [...NEVER_EMITTED.keys()].filter((k) => emitted.has(k));
    assertEquals(stale, [], `allowlisted but now emitted: ${stale.join(', ')}`);
  });

  it('every allowlisted member still exists in the enum', async () => {
    // The other way an allowlist rots: the member is deleted and the entry
    // lingers, quietly excusing nothing.
    const members = new Set(await tokenTypeMembers());
    const ghosts = [...NEVER_EMITTED.keys()].filter((k) => !members.has(k));
    assertEquals(ghosts, [], `allowlisted but no longer a TokenType member: ${ghosts.join(', ')}`);
  });

  it('records which emitted members the parser never consumes', async () => {
    // NOT a failure — the lexer knows several wabt script keywords the parser
    // has never implemented (`input`, `output`, `before`, `after`, `code`), and
    // an unhandled token yields a parse error, which is right for an
    // unsupported feature. None appears in any spec-testsuite file.
    //
    // The assertion is that this set does not GROW silently: a newly
    // unconsumed token usually means a parser case was dropped.
    const members = await tokenTypeMembers();
    const emitted = await referenced(LEXER_SRC);
    const consumed = await referenced(PARSER_SRC);

    const orphans = members.filter((m) => emitted.has(m) && !consumed.has(m)).sort();
    // `Reserved` was on this list until T13.38, and its presence here was the
    // SYMPTOM of a real defect that nobody read as one: the lexer emits Reserved
    // for every word it does not recognise -- a misspelled instruction -- and the
    // parser never looking at it is exactly why an unknown operator was reported
    // as a stray parenthesis. A token sitting in this list is not automatically
    // benign; ask what the lexer emits it FOR before excusing it.
    const KNOWN = ['After', 'Before', 'Code', 'Input', 'Invalid', 'Output'];
    assertEquals(
      orphans,
      KNOWN,
      'the set of lexer-emitted tokens the parser ignores changed. Growing means a parser ' +
        'case was probably dropped; shrinking means this list needs updating.',
    );
  });
});
