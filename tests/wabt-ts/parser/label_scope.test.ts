// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13 — a branch to a label that is not in scope is reported by the PARSER.
//
// Labels are lexical and fully known at parse time, so `(block $l (br $l0))` is
// malformed, not merely invalid. `resolveNames` already reported it — but that
// is a separate pass, and `parseWatModule` does not run it, so the parser
// accepted the module and only `wat2wasm` (which runs both) caught it. The
// quoted `assert_malformed` metric read 1227 / 1229 at the parser and 1229 /
// 1229 through the tool; this closes that gap, and puts the diagnostic at the
// BRANCH rather than at the enclosing function.
//
// `checkLabelScopes` CHECKS ONLY — it resolves nothing and rewrites no `Var`,
// so the worst it can do is report an error that is not there. Resolution stays
// in `resolveNames`, which still owns it for IR that never came from text.
//
// Two scoping details, both of them past bugs (T7.6, T9.8):
//
//   - a `try_table`'s CATCH targets resolve in the ENCLOSING scope, so they are
//     checked BEFORE the try_table's own label is pushed;
//   - a legacy `try`'s `delegate` targets the OUTER scope, so it is checked
//     AFTER the try's label is popped.
//
// `ExprVisitor` walks neither, so both are read explicitly — which is also why
// they get their own cases below.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** The PARSER alone — deliberately not `wat2wasm`, which also runs resolveNames. */
function parseErrors(src: string): string {
  const { errors } = parseWatModule(new LexerSource(src, '<test>'));
  return hasErrors(errors) ? formatErrors(errors) : '';
}
function rejects(src: string): boolean {
  return parseErrors(src) !== '';
}
function ok(src: string): void {
  const e = parseErrors(src);
  assert(e === '', `parser rejected a LEGAL module:\n${src}\n${e}`);
}

describe('T13 — the parser reports an out-of-scope branch target', () => {
  const BAD: [string, string][] = [
    ['br', '(module (func (block $l (br $nope))))'],
    ['br_if', '(module (func (block $l (br_if $nope (i32.const 0)))))'],
    ['br_table default', '(module (func (block $l (i32.const 0) (br_table $l0))))'],
    ['br_table run-on id', '(module (func (block $l (i32.const 0) (br_table $l$l))))'],
    ['br_table in the list', '(module (func (block $l (i32.const 0) (br_table $l $nope $l))))'],
    ['a label that has gone out of scope', '(module (func (block $a) (block $b (br $a))))'],
    [
      'a label from a sibling arm',
      '(module (func (if (i32.const 0) (then (block $t)) (else (br $t)))))',
    ],
  ];
  for (const [name, src] of BAD) {
    it(`rejects ${name}`, () => {
      assert(rejects(src), `parser accepted: ${src}`);
    });
  }

  it('names the label it could not find', () => {
    assert(/undefined label \$nope/.test(parseErrors('(module (func (block $l (br $nope))))')));
  });

  it("leaves a NUMERIC depth alone — that is the validator's business", () => {
    // `br 9` out of range is `assert_invalid`, not `assert_malformed`; the
    // parser must not claim it.
    ok('(module (func (block (br 9))))');
  });
});

describe('T13 — every legal spelling still parses', () => {
  const GOOD: [string, string][] = [
    ['a branch to its own block', '(module (func (block $l (br $l))))'],
    ['an outer block from an inner one', '(module (func (block $a (block $b (br $a)))))'],
    ['a loop label', '(module (func (loop $l (br $l))))'],
    ['an if label', '(module (func (if $l (i32.const 0) (then (br $l)))))'],
    ['the quoted spelling of a label', '(module (func (block $l1 (br $"l1"))))'],
    ['shadowing — the inner one wins', '(module (func (block $l (block $l (br $l)))))'],
    ['a function-level br to the implicit frame', '(module (func (br 0)))'],
    [
      'br_table with every target in scope',
      '(module (func (block $a (block $b (i32.const 0) (br_table $a $b $a)))))',
    ],
  ];
  for (const [name, src] of GOOD) {
    it(`accepts ${name}`, () => ok(src));
  }
});

describe('T13 — the two scopes that are NOT the enclosing block', () => {
  it('resolves a try_table catch target OUTSIDE the try_table', () => {
    // The catch target names a block the try_table is nested in, never the
    // try_table itself. Pushing the label before checking would accept the
    // second of these.
    ok('(module (tag $e) (func (block $b (try_table (catch $e $b)))))');
    assert(
      rejects('(module (tag $e) (func (block $b (try_table $t (catch $e $t)))))'),
      'accepted a catch targeting the try_table it belongs to',
    );
  });

  it('resolves a legacy try delegate OUTSIDE the try', () => {
    ok('(module (func (block $b (try (do) (delegate $b)))))');
    assert(
      rejects('(module (func (try $t (do) (delegate $t))))'),
      'accepted a delegate targeting its own try',
    );
  });

  it('still checks a rethrow depth by name', () => {
    ok('(module (tag $e) (func (try $t (do) (catch $e (rethrow $t)))))');
    assert(
      rejects('(module (tag $e) (func (try $t (do) (catch $e (rethrow $nope)))))'),
      'accepted a rethrow naming no label',
    );
  });
});
