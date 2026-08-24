// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The wide-arithmetic proposal (`i64.add128` / `i64.sub128` / `i64.mul_wide_s`
// / `i64.mul_wide_u`) had two defects, both found by auditing the TYPE rather
// than by any corpus.
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
// 3. **And the first fix only covered HALF the proposal.** `add128`/`sub128`
//    were fixed from the reported symptom; `mul_wide_s`/`mul_wide_u` (0xfc
//    0x15 / 0x16) sat with the identical defect until an exhaustive
//    lexer-vs-reader sweep found them. That sweep is now the last case in this
//    file, so the CLASS is guarded rather than the two instances.
//
// Campaign metrics unmoved by the fix (all six).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { WastLexer } from '../../src/parser/wast-lexer.ts';
import { LexerSource } from '../../src/parser/lexer-source.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';

/** Every opcode spelling in the lexer keyword table, with its opcode value. */
function lexerOpcodes(): [string, number][] {
  const src = Deno.readTextFileSync(
    new URL('../../src/parser/wast-lexer.ts', import.meta.url),
  );
  const out: [string, number][] = [];
  for (const m of src.matchAll(/\['([a-z0-9_.]+)', op\(/g)) {
    const name = m[1]!;
    const tok = new WastLexer(new LexerSource(name)).getToken() as { opcode?: number };
    if (typeof tok.opcode === 'number') out.push([name, tok.opcode]);
  }
  return out;
}

/** Can the binary reader decode this opcode at all? */
function readerDecodes(val: number): boolean {
  const u32 = (n: number): number[] => {
    const o: number[] = [];
    do {
      let b = n & 0x7f;
      n >>>= 7;
      if (n) b |= 0x80;
      o.push(b);
    } while (n);
    return o;
  };
  const pref = val >>> 16, sub = val & 0xffff;
  // Filler keeps immediate reads in bounds; we only care about the
  // "unknown opcode" diagnostic, not about the module being well-typed.
  const instr = pref === 0
    ? [val, ...Array(20).fill(0)]
    : [pref, ...u32(sub), ...Array(20).fill(0)];
  const body = [0x00, ...instr, 0x0b];
  const sec = (id: number, b: number[]) => [id, ...u32(b.length), ...b];
  const bin = new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...sec(1, [0x01, 0x60, 0x00, 0x00]),
    ...sec(3, [0x01, 0x00]),
    ...sec(10, [0x01, ...u32(body.length), ...body]),
  ]);
  const errs = makeErrorList();
  try {
    readBinaryIr(bin, errs);
  } catch { /* a structural blow-up is not the signal we are after */ }
  return !/unknown .*opcode/i.test(formatErrors(errs));
}

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

  // The two-operand half of the proposal. These were missed on the first pass
  // — add128/sub128 were fixed from a reported symptom instead of from the
  // opcode space, so `mul_wide_s` / `mul_wide_u` sat with the identical defect
  // until an exhaustive lexer-vs-reader sweep found them.
  for (const opn of ['i64.mul_wide_s', 'i64.mul_wide_u']) {
    it(`decodes ${opn}`, () => {
      const first = compile(`(module (func (export "f") (result i64 i64)
        (${opn} (i64.const 6) (i64.const 7))))`);
      const { text, errors } = wasm2wat(first);
      assert(!hasErrors(errors), formatErrors(errors));
      assert(text);
      assert(text.includes(opn), text);
      assertEquals(compile(text), first);
    });
  }

  it('leaves NO lexer-reachable opcode undecodable', () => {
    // The general form of the bug. Every opcode spelling the lexer accepts is
    // fed to the reader as a synthetic body; a missing case shows up as the
    // specific "unknown ... opcode" diagnostic. This is what found mul_wide
    // after add128 had been fixed in isolation.
    const undecodable = lexerOpcodes()
      .filter(([, val]) => !readerDecodes(val))
      .map(([name]) => name);
    assertEquals(undecodable, [], `reader has no case for: ${undecodable.join(', ')}`);
  });

  it('round-trips both forms byte-identically', () => {
    for (const [name, src] of [['folded', FOLDED], ['linear', LINEAR]] as const) {
      const first = compile(src);
      assertEquals(compile(wasm2wat(first).text!), first, name);
    }
  });
});
