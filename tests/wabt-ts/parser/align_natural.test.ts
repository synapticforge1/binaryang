// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// An absent `align=` is the NATURAL alignment — in the parser's tree, not only
// in the binary.
//
// The parser stored 0 for "no `align=`", a sentinel only the binary writer (and
// the bridge) resolved. Every other consumer of the parser's tree read it as an
// alignment:
//
//   - the WAT writer printed `align=0`, so `parseWat(…).toText()` wrote text
//     that does not assemble for any module with a plain load or store — 0 of
//     421 corpus modules re-assembled through the text-only path;
//   - the validator reported "alignment (0) must be a power of 2" on a valid
//     module.
//
// Now the parser stores the opcode's natural alignment, and both resolvers
// throw on a non-power-of-two instead of guessing. Found measuring N1 step P1
// (cmem/names.md), whose acceptance is the text-only round trip.
//
// Behind it, a second false rejection the sentinel had been hiding: the text
// parser builds a plain `LoadExpr` for `v128.load*_splat` and `v128.load*_zero`
// (the binary reader has node kinds of their own), and the type checker's table
// had no entry for those opcodes — "expected [v128] but got [i32]".

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { writeWatModule } from '../../../src/wabt-ts/writer/wat-writer.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import type { Module } from '../../../src/wabt-ts/ir/ir.ts';

/** The text pipeline the wabt.js-compatible `parseWat` runs: parse, resolve, synthesize types. */
function parse(wat: string): Module {
  const { module, errors } = parseWatModule(new LexerSource(wat, '<align-natural>'));
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  const re = makeErrorList();
  resolveNames(module, re);
  if (hasErrors(re)) throw new Error(formatErrors(re));
  synthesizeTypes(module);
  return module;
}

/** Every memarg `align` in the module's function bodies, in body order. */
function aligns(m: Module): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.align === 'number') out.push(o.align);
      for (const [k, x] of Object.entries(o)) if (k !== 'loc') walk(x);
    }
  };
  for (const f of m.functions) walk(f.body.children);
  return out;
}

// One instruction per memarg-bearing family, none with an `align=`, and the
// natural alignment each must get.
const FAMILIES: [string, number][] = [
  ['(drop (i32.load (i32.const 0)))', 4],
  ['(i64.store8 (i32.const 0) (i64.const 0))', 1],
  ['(drop (v128.load (i32.const 0)))', 16],
  ['(drop (v128.load8_splat (i32.const 0)))', 1],
  ['(drop (v128.load16_splat (i32.const 0)))', 2],
  ['(drop (v128.load32_splat (i32.const 0)))', 4],
  ['(drop (v128.load64_splat (i32.const 0)))', 8],
  ['(drop (v128.load32_zero (i32.const 0)))', 4],
  ['(drop (v128.load64_zero (i32.const 0)))', 8],
  ['(drop (v128.load8x8_s (i32.const 0)))', 8],
  ['(drop (v128.load8_lane 0 (i32.const 0) (v128.const i64x2 0 0)))', 1],
  ['(v128.store16_lane 0 (i32.const 0) (v128.const i64x2 0 0))', 2],
  ['(drop (i64.atomic.load (i32.const 0)))', 8],
  ['(i32.atomic.store16 (i32.const 0) (i32.const 0))', 2],
  ['(drop (i32.atomic.rmw.add (i32.const 0) (i32.const 1)))', 4],
  ['(drop (i64.atomic.rmw.cmpxchg (i32.const 0) (i64.const 0) (i64.const 1)))', 8],
  ['(drop (memory.atomic.notify (i32.const 0) (i32.const 1)))', 4],
  ['(drop (memory.atomic.wait64 (i32.const 0) (i64.const 0) (i64.const 0)))', 8],
];
const WAT = `(module (memory 1 1 shared)\n${FAMILIES.map(([i]) => `  (func ${i})`).join('\n')})`;

describe('an absent align= is the natural alignment in the parser tree', () => {
  it('every memarg family holds its natural alignment, not 0', () => {
    assertEquals(aligns(parse(WAT)), FAMILIES.map(([, n]) => n));
  });

  it('an explicit align= is kept as written', () => {
    assertEquals(
      aligns(parse('(module (memory 1) (func (drop (i32.load align=2 (i32.const 0)))))')),
      [2],
    );
  });

  it("the validator accepts the parser's tree", () => {
    const errs = makeErrorList();
    validateModule(parse(WAT), errs, { features: allFeatures() });
    assert(!hasErrors(errs), formatErrors(errs));
  });

  it('…and still types a text-built splat or zero load: its address must be i32', () => {
    for (const op of ['v128.load32_splat', 'v128.load64_zero']) {
      const errs = makeErrorList();
      validateModule(parse(`(module (memory 1) (func (drop (${op} (f32.const 0)))))`), errs, {
        features: allFeatures(),
      });
      assert(
        /expected \[i32\] but got \[f32\]/.test(formatErrors(errs)),
        `${op}: ${formatErrors(errs)}`,
      );
    }
  });
});

describe('the text-only path — parse, WAT writer — re-assembles', () => {
  it('the WAT writer leaves natural alignment implicit and keeps a non-natural one', () => {
    const out = writeWatModule(parse(WAT));
    assert(!out.includes('align='), out);
    const explicit = writeWatModule(
      parse('(module (memory 1) (func (drop (i32.load align=2 (i32.const 0)))))'),
    );
    assert(explicit.includes('i32.load align=2'), explicit);
  });

  it("the written text assembles to the source's bytes", () => {
    const a = wat2wasm(WAT);
    const b = wat2wasm(writeWatModule(parse(WAT)));
    assert(!hasErrors(a.errors), formatErrors(a.errors));
    assert(!hasErrors(b.errors), formatErrors(b.errors));
    assertEquals(b.binary, a.binary);
  });
});

describe('no sentinel is resolved any more', () => {
  it('the binary writer throws on an alignment that is not a power of two', () => {
    const m = parse('(module (memory 1) (func (drop (i32.load (i32.const 0)))))');
    const drop = m.functions[0]!.body.children[0] as unknown as { value: { align: number } };
    drop.value.align = 0;
    assertThrows(() => writeBinaryIr(m), Error, 'power-of-two');
  });
});
