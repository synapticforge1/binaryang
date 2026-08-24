// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.6 — two TYPE-LEVEL audits, made permanent.
//
// Both guard a table with a documented history of drifting, and neither needs a
// corpus: they enumerate the whole population and check it, which is what
// best-practices.md means by "audit a manual walk against the TYPE".
//
// 1. **lexer ⇄ printer symmetry.** Every keyword the lexer maps to an opcode
//    must print back under the same name. If the two tables disagree, a round
//    trip RENAMES an instruction — and the SIMD opcode-name table has drifted
//    before, caught by the wasmtk corpus rather than by anything here.
//
// 2. **natural-alignment coverage.** The binary writer fills `align = 0` — the
//    parser's "no `align=` keyword" sentinel — from `naturalAlignForOpcode`. An
//    opcode missing from that table is therefore emitted with alignment
//    exponent 0, which binaryen's optimizer reads as a HARD CONSTRAINT: it
//    bailed on rewrites and produced out-of-bounds accesses at runtime. A
//    missing entry is a silent wrong value, not a missing feature.
//
// Both run off the LEXER's own behaviour rather than a regex over its source,
// so they cannot drift from what the lexer actually does. Written after a
// review pass that found nothing new in either — the point is to keep it that
// way when the next proposal lands.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { WastLexer } from '../../src/parser/wast-lexer.ts';
import { LexerSource } from '../../src/parser/lexer-source.ts';
import { TokenType } from '../../src/parser/token.ts';
import { anyOpcodeName, naturalAlignForOpcode } from '../../src/core/opcode.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

/** Lex a single keyword and return its token, or null if it is not one token. */
function lexOne(kw: string): { tokenType: TokenType; opcode?: number } | null {
  const lexer = new WastLexer(new LexerSource(kw, '<t>'));
  const tok = lexer.getToken() as { tokenType: TokenType; opcode?: number };
  const next = lexer.getToken();
  if (next.tokenType !== TokenType.Eof) return null;
  return tok;
}

/**
 * Instruction keywords, harvested from the printer rather than from the lexer's
 * source: every opcode `anyOpcodeName` can name is a keyword the lexer should
 * know. Covers the core, misc (0xfc), SIMD (0xfd), threads (0xfe) and GC (0xfb)
 * spaces by sweeping each prefix's sub-opcode range.
 */
function namedOpcodes(): { name: string; op: number }[] {
  const out: { name: string; op: number }[] = [];
  const push = (op: number) => {
    const n = anyOpcodeName(op);
    if (!n.startsWith('<opcode:')) out.push({ name: n, op });
  };
  for (let i = 0; i <= 0xff; i++) push(i);
  for (const prefix of [0xfb, 0xfc, 0xfd, 0xfe]) {
    for (let i = 0; i <= 0x200; i++) push((prefix << 16) | i);
  }
  return out;
}

describe('T13.6 — every named opcode is a keyword the lexer knows', () => {
  it('round-trips name -> lexer -> opcode -> name', () => {
    const named = namedOpcodes();
    assert(named.length > 400, `only ${named.length} named opcodes — the sweep missed a space`);

    const unknown: string[] = [];
    const mismatched: string[] = [];
    for (const { name, op } of named) {
      // DISASSEMBLY LABELS, not keywords. `ref.test null` / `ref.cast null`
      // name the nullable OPCODES (0xfb0015 / 0xfb0017), but the text format
      // puts the nullability in the immediate — `ref.test (ref null $t)` — so
      // the mnemonic is one token and these names are two. Guarded below by a
      // round trip of all four spellings.
      if (name === 'ref.test null' || name === 'ref.cast null') continue;
      const tok = lexOne(name);
      if (tok === null || tok.opcode === undefined) {
        unknown.push(`${name} (0x${op.toString(16)})`);
        continue;
      }
      // `select` is legitimately MANY-TO-ONE: 0x1b is the untyped form and
      // 0x1c the annotated `select (result T)`, and the spec spells both
      // `select`. The lexer produces the untyped opcode and the writer upgrades
      // to 0x1c when a result annotation is present. Exempted by NAME rather
      // than by opcode so a new collision still fails.
      if (tok.opcode !== op && name !== 'select') {
        mismatched.push(
          `${name}: printer says 0x${op.toString(16)}, lexer says 0x${tok.opcode.toString(16)}`,
        );
      }
    }
    assertEquals(mismatched, [], 'the lexer and the printer disagree about an opcode');
    // A name the lexer cannot lex is a one-sided table: the writer would emit
    // text nothing can read back.
    assertEquals(unknown, [], 'the printer names opcodes the lexer cannot lex');
  });

  it('the exempted names round-trip in every spelling', () => {
    // The two exemptions above are only safe if the text forms survive; if they
    // did not, the odd names WOULD be the bug they look like.
    for (
      const src of [
        '(module (type $t (struct)) (func (param anyref) (result i32) (ref.test (ref $t) (local.get 0))))',
        '(module (type $t (struct)) (func (param anyref) (result i32) (ref.test (ref null $t) (local.get 0))))',
        '(module (type $t (struct)) (func (param anyref) (result (ref $t)) (ref.cast (ref $t) (local.get 0))))',
        '(module (type $t (struct)) (func (param anyref) (result (ref null $t)) (ref.cast (ref null $t) (local.get 0))))',
      ]
    ) {
      const { binary, errors } = wat2wasm(src);
      assert(
        !hasErrors(errors),
        `${src}
${formatErrors(errors)}`,
      );
      assert(binary);
      const text = wasm2wat(binary).text!;
      // The mnemonic must NOT pick up the label's trailing " null".
      assert(
        !/ref\.(test|cast) null/.test(text),
        `disassembly label leaked into WAT:
${text}`,
      );
      const again = wat2wasm(text);
      assert(!hasErrors(again.errors), formatErrors(again.errors));
      assertEquals([...again.binary!], [...binary], `round trip changed: ${src}`);
    }
  });

  it('the one many-to-one name still works in both forms', () => {
    // The exemption above is only safe because both spellings survive a round
    // trip; if they did not, the shared name WOULD be the bug it looks like.
    for (
      const src of [
        '(module (func (result i32) (select (i32.const 1) (i32.const 2) (i32.const 0))))',
        '(module (func (result i32) (select (result i32) (i32.const 1) (i32.const 2) (i32.const 0))))',
      ]
    ) {
      const { binary, errors } = wat2wasm(src);
      assert(
        !hasErrors(errors),
        `${src}
${formatErrors(errors)}`,
      );
      assert(binary);
      const again = wat2wasm(wasm2wat(binary).text!);
      assert(!hasErrors(again.errors), formatErrors(again.errors));
      assertEquals([...again.binary!], [...binary], `select round trip changed: ${src}`);
    }
  });
});

describe('T13.6 — every memarg-bearing opcode has a natural alignment', () => {
  // The token types whose instructions carry a memarg. Derived from the lexer,
  // not hardcoded per opcode, so a new instruction in an existing family is
  // covered automatically.
  const MEMARG = new Set<TokenType>([
    TokenType.Load,
    TokenType.Store,
    TokenType.AtomicLoad,
    TokenType.AtomicStore,
    TokenType.AtomicRmw,
    TokenType.AtomicRmwCmpxchg,
    TokenType.AtomicWait,
    TokenType.AtomicNotify,
    TokenType.SimdLoadLane,
    TokenType.SimdStoreLane,
  ]);

  it('covers every one, with a power-of-two width', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const { name, op } of namedOpcodes()) {
      const tok = lexOne(name);
      if (tok === null || tok.opcode === undefined || !MEMARG.has(tok.tokenType)) continue;
      checked++;
      const nat = naturalAlignForOpcode(op);
      if (!Number.isInteger(nat) || nat <= 0 || (nat & (nat - 1)) !== 0) {
        missing.push(`${name} -> ${nat}`);
      }
    }
    assert(checked > 80, `only ${checked} memarg opcodes found — the token set is wrong`);
    assertEquals(missing, [], 'memarg opcodes with no natural alignment');
  });

  it('agrees with the known widths', () => {
    for (
      const [kw, want] of [
        ['i32.load', 4],
        ['i64.load', 8],
        ['i32.load8_u', 1],
        ['i32.load16_s', 2],
        ['f64.store', 8],
        ['v128.load', 16],
        ['i64.atomic.rmw.cmpxchg', 8],
      ] as const
    ) {
      const tok = lexOne(kw);
      assert(tok?.opcode !== undefined, `${kw} did not lex to an opcode`);
      assertEquals(naturalAlignForOpcode(tok.opcode), want, kw);
    }
  });
});
