// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The binaryen-ts WAT parser used to route loads and stores with a PATTERN —
// `(i32|i64|f32|f64|v128).load(8_[su]|16_[su]|32_[su]|64)?` — and then build the
// node from the width, sign and type it read out of the name. The pattern admits
// names no instruction has, and the node turned each into a DIFFERENT, real one:
//
//   f32.load8_s   → f32.load     (V8-valid; reads 4 bytes where 1 was written)
//   i32.load32_s  → i32.load     (V8-valid)
//   f64.store8    → f64.store    (V8-valid; writes 8 bytes where 1 was written)
//   i32.load64    → a module V8 rejects
//   i32.store64   → a module V8 rejects
//
// The MALFORMED answers below are upstream wat2wasm 1.0.41's, not this parser's:
// each is rejected with `unexpected token "<name>", expected an expr/instr`. The
// parser now looks names up in the one table (`memory-access.ts`), so a name that
// is not a row is not a load or store at all.
//
// `deno task spec` cannot see any of this: it drives the wabt-ts parser, not
// this one.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWat, WatParseError } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { MEMORY_ACCESS_TABLE } from '../../../src/binaryen-ts/ir/memory-access.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

const MALFORMED: [string, string][] = [
  ['i32.load32_s', '(drop (i32.load32_s (i32.const 0)))'],
  ['f32.load8_s', '(drop (f32.load8_s (i32.const 0)))'],
  ['i32.load64', '(drop (i32.load64 (i32.const 0)))'],
  ['i32.store64', '(i32.store64 (i32.const 0) (i32.const 1))'],
  ['f64.store8', '(f64.store8 (i32.const 0) (f64.const 1))'],
];

/** A constant of `t`, as WAT. */
function constOf(t: ValType): string {
  return t === ValType.V128 ? '(v128.const i64x2 0 0)' : `(${t}.const 0)`;
}

/** The single Load/Store node in function 0's body. */
function memNode(src: string): { kind: string; opcode: number } {
  const hits: { kind: string; opcode: number }[] = [];
  const walk = (e: unknown): void => {
    if (!e || typeof e !== 'object') return;
    const n = e as { kind?: string; opcode?: number };
    if (n.kind === ExpressionKind.Load || n.kind === ExpressionKind.Store) {
      hits.push(n as { kind: string; opcode: number });
    }
    for (const v of Object.values(e as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(parseWat(src).functions[0]?.body);
  assertEquals(hits.length, 1, 'expected exactly one load/store node');
  return hits[0]!;
}

describe('binaryen-ts WAT parser: memory mnemonics', () => {
  for (const [name, body] of MALFORMED) {
    it(`MALFORMED (per upstream wat2wasm): ${name}`, () => {
      assertThrows(() => parseWat(`(module (memory 1) (func ${body}))`), WatParseError, name);
    });
  }

  for (const l of MEMORY_ACCESS_TABLE.loads) {
    it(`${l.name} parses to its own opcode, and V8 accepts the encoding`, () => {
      const src = `(module (memory 1) (func (drop (${l.name} (i32.const 0)))))`;
      assertEquals(memNode(src).opcode, l.opcode);
      assertEquals(WebAssembly.validate(encodeWasm(parseWat(src)) as BufferSource), true);
    });
  }

  for (const s of MEMORY_ACCESS_TABLE.stores) {
    it(`${s.name} parses to its own opcode, and V8 accepts the encoding`, () => {
      const src = `(module (memory 1) (func (${s.name} (i32.const 0) ${constOf(s.valueType)})))`;
      assertEquals(memNode(src).opcode, s.opcode);
      assertEquals(WebAssembly.validate(encodeWasm(parseWat(src)) as BufferSource), true);
    });
  }
});
