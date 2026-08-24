// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `i64.add128` / `i64.sub128` (the wide-arithmetic proposal) had two defects,
// both found by auditing the TYPE rather than by any corpus.
//
// 1. **`instrInputCount` had no `TokenType.Quaternary` entry**, so the token
//    fell to `default: return 0`. `buildPlainExpr` reads `op0()`…`op3()`, so
//    the LINEAR form popped nothing and all four operands became placeholders;
//    the folded form was fine because it uses its inline children.
//
//    The BYTES came out right anyway — `pushStmt` flushes the orphaned
//    operands in source order and a placeholder emits nothing (T10.8) — which
//    is exactly why nothing caught it. The IR TREE was wrong, and the IR tree
//    is what the binaryen bridge and (eventually) `wasm2ts` read.
//
//    This is the mismatch CLAUDE.md warns about: an `instrInputCount` entry
//    that disagrees with `buildPlainExpr`'s `opN()` consumption. It had bitten
//    SIMD twice before (`SimdShuffleOp` declared 3 for a 2-operand op,
//    `SimdStoreLane` 4 for 2, `SimdLoadLane` missing entirely).
//
// 2. **The binary reader could not decode `0xfc 0x13` / `0x14` at all** —
//    `unknown misc opcode: 19`. The lexer has mapped these to
//    `TokenType.Quaternary` all along, so `wat2wasm` accepted and encoded them
//    while `wasm2wat` could not read back what our own front end had just
//    written. A producer/consumer mismatch inside one toolchain, which is the
//    recurring blind spot in `cmem/best-practices.md` §3.
//
// Campaign metrics unmoved by the fix (all six).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

const FOLDED = `(module (func (export "f") (result i64 i64)
  (i64.add128 (i64.const 1) (i64.const 0) (i64.const 2) (i64.const 0))))`;

const LINEAR = `(module (func (export "f") (result i64 i64)
  i64.const 1
  i64.const 0
  i64.const 2
  i64.const 0
  i64.add128))`;

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

/** The four operand kinds of the first `quaternary` node in the body. */
function operandKinds(src: string): string[] {
  const { module, errors } = parseWatModule(src);
  assert(!hasErrors(errors), formatErrors(errors));
  const q = module.funcs[0]!.body.find((e) => e.kind === 'quaternary');
  assert(q, 'no quaternary node in the body');
  const n = q as unknown as Record<string, { kind: string; placeholder?: boolean }>;
  return ['a', 'b', 'c', 'd'].map((k) => (n[k]!.placeholder ? 'placeholder' : n[k]!.kind));
}

describe('wide arithmetic — the quaternary operands reach the IR', () => {
  it('attaches all four operands in FOLDED form', () => {
    assertEquals(operandKinds(FOLDED), ['const', 'const', 'const', 'const']);
  });

  it('attaches all four operands in LINEAR form', () => {
    // This is the one that was broken: arity 0 meant four placeholders, and
    // the operands were left stranded as separate statements.
    assertEquals(operandKinds(LINEAR), ['const', 'const', 'const', 'const']);
  });

  it('encodes both forms to the same bytes', () => {
    const folded = compile(FOLDED);
    assertEquals(compile(LINEAR), folded);
    // 0xfc 0x13 = i64.add128, preceded by the four i64.consts.
    const i = folded.findIndex((b, j) => b === 0xfc && folded[j + 1] === 0x13);
    assert(i >= 0, 'i64.add128 opcode not found');
  });
});

describe('wide arithmetic — wasm2wat can read back what wat2wasm writes', () => {
  it('decodes i64.add128 instead of failing on an unknown misc opcode', () => {
    const { text, errors } = wasm2wat(compile(FOLDED));
    assert(!hasErrors(errors), formatErrors(errors));
    assert(text);
    assert(/i64\.add128/.test(text), text);
  });

  it('decodes i64.sub128', () => {
    const src = `(module (func (export "f") (result i64 i64)
      (i64.sub128 (i64.const 5) (i64.const 0) (i64.const 2) (i64.const 0))))`;
    const { text, errors } = wasm2wat(compile(src));
    assert(!hasErrors(errors), formatErrors(errors));
    assert(text);
    assert(/i64\.sub128/.test(text), text);
  });

  it('round-trips both forms byte-identically', () => {
    for (const [name, src] of [['folded', FOLDED], ['linear', LINEAR]] as const) {
      const first = compile(src);
      assertEquals(compile(wasm2wat(first).text!), first, name);
    }
  });
});
