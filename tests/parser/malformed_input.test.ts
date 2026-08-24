// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Two ways the parser silently accepted input the spec calls MALFORMED.
//
// Both were found by building a seventh metric — `assert_malformed`, the spec's
// "this text must fail to parse" assertions. Nothing in the campaign had ever
// measured that direction: `assert_invalid` covers modules that parse and then
// fail validation, and malformed input must not get that far. It started at
// 356/1229 and these two fixes took it to 666/1229.
//
// 1. **An unknown or misspelled instruction was silently DELETED.**
//    `(i32.addd (i32.const 40) (i32.const 2))` parsed to an EMPTY function
//    body and `wat2wasm` returned Ok. The failure surfaced only at the engine,
//    as "expected 1 element on the stack" — pointing nowhere near the typo.
//
//    **This was a regression introduced by T10.5's deferred body parsing.**
//    Before it, a body that failed to parse left the cursor mid-body and the
//    enclosing `expect(Rpar)` failed loudly ("expected ), got ("). Deferring
//    made `parsePendingBodies` restore the cursor unconditionally, so the
//    leftovers were never looked at again. `parseInstrList` compounds it by
//    breaking out of its loop and returning `Result.Ok` regardless.
//
//    The fix records where each body ENDS and requires the parse to land
//    exactly there, so ANY unconsumed body content is reported — not just
//    typos.
//
// 2. **Digit separators were accepted anywhere.** `num ::= d | num '_'? d`:
//    an underscore must sit BETWEEN digits. `readNum` consumed one
//    unconditionally, so `1_`, `1__2` and `0x1_` all lexed as numbers. The
//    machinery to reject them already existed — `getNumberToken` falls back to
//    a Reserved token when an id-char trails the literal — it just never saw
//    the offending `_`, because `readNum` had eaten it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

/** Does the front end reject this text? */
function rejects(src: string): boolean {
  let parseFailed: boolean;
  try {
    parseFailed = hasErrors(parseWatModule(src).errors);
  } catch {
    return true;
  }
  const { errors } = wat2wasm(src);
  return parseFailed && hasErrors(errors);
}

describe('an unknown instruction is an error, not a silent deletion', () => {
  const BOGUS: [string, string][] = [
    ['a typo', '(module (func (result i32) (i32.addd (i32.const 1) (i32.const 2))))'],
    [
      'a non-existent load width',
      '(module (memory 1) (func (result i32) (i32.load32 (i32.const 0))))',
    ],
    [
      'a non-existent SIMD op',
      '(module (func (result v128) (f32x4.max_s (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0))))',
    ],
    ['garbage in linear position', '(module (func nonsense))'],
    ['garbage after a valid instr', '(module (func (result i32) (i32.const 1) bogus))'],
  ];

  for (const [name, src] of BOGUS) {
    it(`rejects ${name}`, () => {
      assert(rejects(src), `accepted: ${src}`);
    });
  }

  it('names the offending token and where it is', () => {
    const { errors } = parseWatModule(
      '(module (func (result i32) (i32.addd (i32.const 1) (i32.const 2))))',
    );
    const msg = formatErrors(errors);
    assert(/in function body/.test(msg), msg);
    assert(/:1:\d+/.test(msg), `no source position: ${msg}`);
  });

  it('still accepts every real instruction it resembles', () => {
    // The fix must not become a blanket rejection.
    for (
      const src of [
        '(module (func (export "f") (result i32) (i32.add (i32.const 1) (i32.const 2))))',
        '(module (memory 1) (func (result i32) (i32.load (i32.const 0))))',
        '(module (func (result v128) (f32x4.max (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0))))',
        '(module (func (export "g") (result i32) i32.const 1 i32.const 2 i32.add))',
      ]
    ) {
      const { errors } = wat2wasm(src);
      assert(!hasErrors(errors), `rejected a VALID module:\n${formatErrors(errors)}`);
    }
  });
});

describe('a digit separator must sit between digits', () => {
  const MALFORMED = ['1_', '1__2', '_1', '0x1_', '0x_1', '1_.0', '1.0_', '1e1_', '0x1p1_'];
  for (const lit of MALFORMED) {
    it(`rejects ${lit}`, () => {
      assert(
        rejects(`(module (func (result f64) (f64.const ${lit})))`) ||
          rejects(`(module (func (result i32) (i32.const ${lit})))`),
        `accepted malformed literal ${lit}`,
      );
    });
  }

  it('still accepts separators in legal positions', () => {
    const cases: [string, number][] = [
      ['1_000', 1000],
      ['1_0_0_0', 1000],
      ['0xf_f', 255],
    ];
    for (const [lit, want] of cases) {
      const { binary, errors } = wat2wasm(
        `(module (global (export "g") i32 (i32.const ${lit})))`,
      );
      assert(!hasErrors(errors), `rejected legal ${lit}:\n${formatErrors(errors)}`);
      assert(binary);
      const buf = new ArrayBuffer(binary.byteLength);
      new Uint8Array(buf).set(binary);
      const inst = new WebAssembly.Instance(new WebAssembly.Module(buf), {});
      assertEquals((inst.exports.g as WebAssembly.Global).value, want, lit);
    }
  });
});
