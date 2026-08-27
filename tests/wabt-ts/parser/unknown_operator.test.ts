// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';

// T13.38. A misspelled or nonexistent instruction is the most common mistake in
// hand-written WAT, and the parser reported it by naming whatever token it had
// stopped on -- almost never the operator:
//
//   (i32.load32 (local.get 0))   ->  "unexpected ( in function body"
//   local.get 0 i32.load32       ->  "unexpected Reserved in function body"
//   (block (i32.frobnicate))     ->  "expected ), got ("
//
// The first blames a parenthesis. The second leaks an internal token-class name
// to the user. The third mentions neither the instruction nor the fact that one
// was involved. The spec calls this an "unknown operator", and 400+ testsuite
// cases assert that wording.
//
// The lexer emits `TokenType.Reserved` for a word it does not recognise and for
// no other reason, so consulting it is safe from any error site -- which is why
// the fix is one helper wired into three of them rather than a special case.

function errorFor(src: string): string {
  const { errors } = parseWatModule(new LexerSource(src, '<test>'));
  return formatErrors(errors);
}

describe('T13.38 — an unknown instruction is named', () => {
  const CASES: [name: string, src: string, op: string][] = [
    [
      'folded form',
      '(module (memory 1) (func (param i32) (result i32) (i32.load32 (local.get 0))))',
      'i32.load32',
    ],
    [
      'linear form',
      '(module (func (param i32) (result i32) local.get 0 i32.load32))',
      'i32.load32',
    ],
    [
      'a near-miss typo',
      '(module (func (result i32) (i32.addd (i32.const 1) (i32.const 2))))',
      'i32.addd',
    ],
    [
      'nested inside a block',
      '(module (func (block (i32.frobnicate))))',
      'i32.frobnicate',
    ],
    [
      'a plausible instruction that does not exist',
      '(module (memory 1) (func (result i32) (i32.load8 (i32.const 0))))',
      'i32.load8',
    ],
  ];

  for (const [name, src, op] of CASES) {
    describe(name, () => {
      it('uses the spec\'s "unknown operator" wording', () => {
        // The spec testsuite matches on this phrase as a substring, so it is
        // load-bearing, not stylistic.
        expect(errorFor(src)).toContain('unknown operator');
      });

      it('names the operator the author actually wrote', () => {
        expect(errorFor(src)).toContain(op);
      });

      it('does not leak an internal token-class name', () => {
        // "unexpected Reserved in function body" was real output. `Reserved` is
        // a lexer implementation detail and means nothing to the author.
        const msg = errorFor(src);
        expect(msg).not.toContain('Reserved');
        expect(msg).not.toContain('Lpar');
      });

      it('still reports a source position', () => {
        expect(/:\d+:\d+/.test(errorFor(src))).toBe(true);
      });
    });
  }

  // Over-correction guard 1. `Reserved` is consulted from `expect()`, which
  // runs everywhere -- so the risk is hijacking unrelated diagnostics. A token
  // that is merely in the wrong PLACE is not an unknown operator, and must
  // keep its own message.
  it('leaves an ordinary unexpected-token error alone', () => {
    const msg = errorFor('(module (func (result i32) (i32.const 1)) (i32.const 2))');
    expect(msg).not.toContain('unknown operator');
    expect(msg.length).toBeGreaterThan(0);
  });

  // Over-correction guard 2. The whole point is that VALID input is untouched.
  // These are the real instructions the bogus ones above resemble.
  it('still accepts every real instruction the typos resemble', () => {
    const good = `(module
      (memory 1)
      (func (param i32) (result i32) (i32.load (local.get 0)))
      (func (param i32) (result i32) (i32.load8_u (local.get 0)))
      (func (param i32) (result i32) (i32.load16_s (local.get 0)))
      (func (result i32) (i32.add (i32.const 1) (i32.const 2)))
      (func (block (nop))))`;
    const { errors } = parseWatModule(new LexerSource(good, '<test>'));
    expect(formatErrors(errors)).toEqual('');
  });

  // The defect this whole path exists to prevent, per the comment at the
  // leftover-input check: an unknown instruction must never parse to an EMPTY
  // body with `wat2wasm` reporting success. Naming it better must not weaken
  // that -- the message changed, the rejection did not.
  it('still REJECTS rather than silently dropping the instruction', () => {
    for (const [, src] of CASES) {
      expect(errorFor(src).length).toBeGreaterThan(0);
    }
  });
});
