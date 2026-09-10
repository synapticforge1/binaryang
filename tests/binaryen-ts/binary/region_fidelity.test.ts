// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A region holds a body EXACTLY as the input had it (S6 Group 2 decision 5).
//
// Before regions were a kind, a body was its lone expression or a synthetic
// unnamed block, and the decoder built that choice from the list it already
// held. Two inputs lost bytes on the way through:
//
//   - an EMPTY loop / try_table body became a `nop` the binary never had
//     (`03 40 0b` re-encoded as `03 40 01 0b`);
//   - an `if` with an explicit but EMPTY `else` lost the `else` — the arm was
//     built only when it had instructions.
//
// Both FAIL against the pre-region decoder. The block cases pin the other half
// of the design: a block the source wrote without a label is a Block, never
// mistaken for a wrapper — upstream wat2wasm is the oracle for their bytes.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm, WasmEncodeError } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import {
  asRegion,
  asStatement,
  ExpressionKind,
  makeBlock,
  makeDrop,
  makeI32Const,
  makeNop,
  makeRegion,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const VOID_TYPE = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00];
const ONE_FUNC = [0x03, 0x02, 0x01, 0x00];

/** A one-function module whose code-section body (locals + instrs + end) is `body`. */
function moduleWith(body: number[]): Uint8Array {
  return new Uint8Array([
    ...HEADER,
    ...VOID_TYPE,
    ...ONE_FUNC,
    0x0a,
    body.length + 2,
    0x01,
    body.length,
    ...body,
  ]);
}

/** The function body bytes of a single-function module (code section payload). */
function bodyOf(bytes: Uint8Array): number[] {
  let p = 8;
  while (p < bytes.length) {
    const id = bytes[p++]!;
    let size = 0, shift = 0, b: number;
    do {
      b = bytes[p++]!;
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (id === 10) return [...bytes.slice(p + 2, p + size)]; // skip count + body size
    p += size;
  }
  throw new Error('no code section');
}

describe('decode → encode keeps a body exactly as written', () => {
  it('an empty loop body stays empty — no invented nop', () => {
    const body = [0x00, 0x03, 0x40, 0x0b, 0x0b]; // loop (void) end
    const input = moduleWith(body);
    assertEquals(WebAssembly.validate(input as BufferSource), true);
    assertEquals(bodyOf(encodeWasm(parseWasm(input))), body);
  });

  it('an explicit empty else survives', () => {
    const body = [0x00, 0x41, 0x01, 0x04, 0x40, 0x01, 0x05, 0x0b, 0x0b]; // if nop else end
    const input = moduleWith(body);
    assertEquals(WebAssembly.validate(input as BufferSource), true);
    assertEquals(bodyOf(encodeWasm(parseWasm(input))), body);
  });

  it('an EMPTY `(else)` in TEXT is no else — as upstream wat2wasm and wabt-ts write it', () => {
    // upstream wat2wasm 1.0.41: `(if (i32.const 1) (then (nop)) (else))` →
    // `41 01 04 40 01 0b` (no 0x05). The binaryen-ts WAT path emitted the else.
    const out = encodeWasm(parseWat('(module (func (if (i32.const 1) (then (nop)) (else))))'));
    assertEquals(bodyOf(out), [0x00, 0x41, 0x01, 0x04, 0x40, 0x01, 0x0b, 0x0b]);
  });

  it('an if with no else still has none', () => {
    const body = [0x00, 0x41, 0x01, 0x04, 0x40, 0x01, 0x0b, 0x0b]; // if nop end
    assertEquals(bodyOf(encodeWasm(parseWasm(moduleWith(body)))), body);
  });
});

describe('a block the source wrote is a block, never a wrapper', () => {
  // Bytes are upstream wat2wasm 1.0.41's for the same text.
  const CASES: [string, string, number[]][] = [
    ['inside a loop', '(func (loop (block (nop) (nop))))', [
      0x00,
      0x03,
      0x40,
      0x02,
      0x40,
      0x01,
      0x01,
      0x0b,
      0x0b,
      0x0b,
    ]],
    ['inside an if arm', '(func (if (i32.const 1) (then (block (nop) (nop)))))', [
      0x00,
      0x41,
      0x01,
      0x04,
      0x40,
      0x02,
      0x40,
      0x01,
      0x01,
      0x0b,
      0x0b,
      0x0b,
    ]],
    ['as a whole function body', '(func (block (nop) (nop)))', [
      0x00,
      0x02,
      0x40,
      0x01,
      0x01,
      0x0b,
      0x0b,
    ]],
  ];
  for (const [name, fn, upstream] of CASES) {
    it(name, () => {
      const viaWat = encodeWasm(parseWat(`(module ${fn})`));
      assertEquals(bodyOf(viaWat), upstream);
      assertEquals(bodyOf(encodeWasm(parseWasm(viaWat))), upstream);
    });
  }
});

describe('the region helpers', () => {
  it("asRegion takes an unnamed block's contents, and keeps a named one", () => {
    assertEquals(asRegion(makeBlock([makeNop(), makeNop()])).children.length, 2);
    const named = asRegion(makeBlock([makeNop()], '$b'));
    assertEquals(named.children.map((c) => c.kind), [ExpressionKind.Block]);
  });

  it("asRegion dissolves an unnamed block that is a region's ONLY instruction — one level", () => {
    const inner = makeBlock([makeNop()]);
    const r = asRegion(makeRegion([makeBlock([inner])]));
    assertEquals(r.children, [inner]);
  });

  it('asStatement: one instruction stands for itself, several become a block', () => {
    const c = makeI32Const(1);
    assertEquals(asStatement(makeRegion([c])), c);
    assertEquals(asStatement(makeRegion([makeNop(), makeNop()])).kind, ExpressionKind.Block);
    assertEquals(asStatement(c), c);
  });

  it('the encoder refuses a region outside a region slot', () => {
    // A region is an Expression, so the type admits one as an operand; the IR
    // forbids it, and emitting its children inline would change what the
    // surrounding code consumes.
    const mod = new ModuleBuilder()
      .addFunction('$f', [], [], [makeDrop(makeRegion([makeI32Const(1)]))])
      .build();
    assertThrows(() => encodeWasm(mod), WasmEncodeError, 'region outside a region slot');
  });
});
