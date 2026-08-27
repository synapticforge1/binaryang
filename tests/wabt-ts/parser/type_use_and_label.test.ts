// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.7 — two things the parser read and then THREW AWAY unchecked.
//
// 1. **The closing label of a linear block.** `block $a … end $l` repeats the
//    label at the `end`, and the repeat must match. Every site did
//    `if (peek() === Var) this.drop()` — consume it, look at nothing. So a
//    typo'd or copy-pasted closing label named a different block and the
//    module still compiled. Four sites: block/loop, `if`'s `end`, `else`, and
//    the two `try` forms.
//
// 2. **The inline signature beside a `(type $t)`.** A type use may restate its
//    signature — `(func (type $sig) (result i32) …)` — and the restatement has
//    to say the same thing as `$sig`. `parseBlockType` SKIPPED the inline part
//    without reading it (`skipInlineBlockSig`) and `settleTypeUse` returned
//    early on it, so `(type $sig (func))` combined with `(result i32)` was
//    accepted and emitted against `$sig` — a function whose declared signature
//    was neither of the two the source wrote.
//
// Reading the inline part instead of skipping it recovers two more rules for
// free, because a skip cannot see order or names: `(result …)` before
// `(param …)` is malformed, and a param in a BLOCK or `call_indirect` type use
// may not be named (there is no body for the name to scope over — but
// `parseFuncSignature` allows names, because a real `(func (param $x i32) …)`
// needs them).
//
// assert_malformed (quoted): 1137 -> 1183 / 1229. Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}
function ok(src: string): void {
  const { errors } = wat2wasm(src);
  assert(!hasErrors(errors), `rejected a LEGAL module:\n${src}\n${formatErrors(errors)}`);
}

describe('T12.7 — a repeated closing label must match', () => {
  const MISMATCHED: [string, string][] = [
    ['block, unlabelled', '(module (func block end $l))'],
    ['block, different label', '(module (func block $a end $l))'],
    ['loop, unlabelled', '(module (func loop end $l))'],
    ['loop, different label', '(module (func loop $a end $l))'],
    ['if end, unlabelled', '(module (func i32.const 0 if end $l))'],
    ['if end, different label', '(module (func i32.const 0 if $a end $l))'],
    ['else, unlabelled', '(module (func i32.const 0 if else $l end))'],
    ['else, different label', '(module (func i32.const 0 if $a else $l end))'],
    ['if/else end, unlabelled', '(module (func i32.const 0 if else end $l))'],
    ['else and end both wrong', '(module (func i32.const 0 if else $l1 end $l2))'],
    ['end wrong after a good else', '(module (func i32.const 0 if $a else $a end $l))'],
  ];
  for (const [name, src] of MISMATCHED) {
    it(`rejects ${name}`, () => {
      assert(!accepts(src), `accepted: ${src}`);
    });
  }

  it('says which label was expected', () => {
    const { errors } = wat2wasm('(module (func block $a end $l))');
    assert(/mismatching label/.test(formatErrors(errors)), formatErrors(errors));
  });
});

describe('T12.7 — the legal spellings of a closing label still parse', () => {
  const LEGAL: [string, string][] = [
    ['no closing label at all', '(module (func block end))'],
    ['a matching one', '(module (func block $a end $a))'],
    ['a matching one on a loop', '(module (func loop $a end $a))'],
    ['matching on both else and end', '(module (func i32.const 0 if $a else $a end $a))'],
    ['a matching QUOTED spelling', '(module (func block $l1 end $"l1"))'],
    [
      'nested blocks, each closed by its own name',
      '(module (func block $a block $b end $b end $a))',
    ],
    ['try_table', '(module (func try_table $t end $t))'],
  ];
  for (const [name, src] of LEGAL) {
    it(`accepts ${name}`, () => ok(src));
  }
});

describe('T12.7 — an inline signature must match the type it restates', () => {
  const MISMATCHED: [string, string][] = [
    [
      'func, empty type vs a result',
      '(module (type $s (func)) (func (type $s) (result i32) (i32.const 0)))',
    ],
    [
      'func, param dropped',
      '(module (type $s (func (param i32) (result i32))) (func (type $s) (result i32) (i32.const 0)))',
    ],
    [
      'func, result dropped',
      '(module (type $s (func (param i32) (result i32))) (func (type $s) (param i32) (i32.const 0)))',
    ],
    [
      'block, empty type vs a result',
      '(module (type $s (func)) (func (block (type $s) (result i32) (i32.const 0)) (unreachable)))',
    ],
    [
      'loop, empty type vs a result',
      '(module (type $s (func)) (func (loop (type $s) (result i32) (i32.const 0)) (unreachable)))',
    ],
    [
      'if, empty type vs a result',
      '(module (type $s (func)) (func (i32.const 1) (if (type $s) (result i32) (then (i32.const 0)) (else (i32.const 2))) (unreachable)))',
    ],
    [
      'call_indirect',
      '(module (type $s (func)) (table 0 funcref) (func (result i32) (call_indirect (type $s) (result i32) (i32.const 0))))',
    ],
    [
      'return_call_indirect',
      '(module (type $s (func)) (table 0 funcref) (func (result i32) (return_call_indirect (type $s) (result i32) (i32.const 0))))',
    ],
  ];
  for (const [name, src] of MISMATCHED) {
    it(`rejects ${name}`, () => {
      assert(!accepts(src), `accepted: ${name}`);
    });
  }

  it('says what is wrong', () => {
    const { errors } = wat2wasm(
      '(module (type $s (func)) (func (type $s) (result i32) (i32.const 0)))',
    );
    assert(/inline function type/.test(formatErrors(errors)), formatErrors(errors));
  });
});

describe('T12.7 — a MATCHING restatement is legal and keeps its index', () => {
  it('accepts the restated forms', () => {
    ok(
      '(module (type $s (func (param i32) (result i32))) (func (type $s) (param i32) (result i32) (local.get 0)))',
    );
    ok(
      '(module (type $s (func (result i32))) (func (block (type $s) (result i32) (i32.const 0)) (drop)))',
    );
    ok(
      '(module (type $s (func)) (table 0 funcref) (func (call_indirect (type $s) (i32.const 0))))',
    );
  });

  it('still takes the INDEX from the type use, not from the restatement', () => {
    // Two structurally identical types: a restatement must not re-intern and
    // silently move the call onto type 0.
    const { binary, errors } = wat2wasm(`(module
      (type $a (func (param i32) (result i32)))
      (type $b (func (param i32) (result i32)))
      (table 1 funcref)
      (func (export "f") (param i32) (result i32)
        (call_indirect (type $b) (param i32) (result i32) (local.get 0) (i32.const 0))))`);
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);
    // type index 1 ($b) must appear as the call_indirect immediate.
    assert(binary.includes(0x11), 'no call_indirect opcode in the output');
    const at = binary.indexOf(0x11);
    assertEquals(binary[at + 1], 1, 'call_indirect was re-interned onto another type');
  });
});

describe('T12.7 — reading the inline part recovers order and naming too', () => {
  const MALFORMED: [string, string][] = [
    [
      'a param after a result in a block',
      '(module (type $s (func (param i32) (result i32))) (func (i32.const 0) (block (type $s) (result i32) (param i32))))',
    ],
    [
      'a param after a result in a loop',
      '(module (type $s (func (param i32) (result i32))) (func (i32.const 0) (loop (type $s) (result i32) (param i32))))',
    ],
    [
      'a NAMED param in a call_indirect type use',
      '(module (table 0 funcref) (func (call_indirect (param $x i32) (i32.const 0) (i32.const 0))))',
    ],
    [
      'a NAMED param in a return_call_indirect type use',
      '(module (table 0 funcref) (func (return_call_indirect (param $x i32) (i32.const 0) (i32.const 0))))',
    ],
  ];
  for (const [name, src] of MALFORMED) {
    it(`rejects ${name}`, () => {
      assert(!accepts(src), `accepted: ${name}`);
    });
  }

  it('still accepts a named param on a real function, which needs it', () => {
    ok('(module (func (param $x i32) (result i32) (local.get $x)))');
    ok(
      '(module (type $s (func (param i32))) (func (type $s) (param $x i32) (drop (local.get $x))))',
    );
  });
});
