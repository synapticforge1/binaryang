// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8a1 (cmem/ir-convergence.md, item 6 M8): a node's `align` is in BYTES — the
// one declaration's contract ("`align` is in BYTES"), and upstream wabt's and
// binaryen's. binaryen-ts held the EXPONENT in that same field: same name, same
// `number`, different meaning, invisible to the compiler. Only the binary holds
// the exponent now, and the decoder and encoder are the two places it converts.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import * as binaryen from '../../../src/binaryen-ts/api/binaryen-compat.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { makeDrop, makeI32Const, makeLoad } from '../../../src/binaryen-ts/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { Opcode } from '../../../src/wabt-ts/core/opcode.ts';
import { soleInstr } from '../region_helpers.ts';

/** `(func (drop (i32.load <memarg> (i32.const 0))))` with a raw alignment exponent. */
function loadWithExponent(exponent: number): Uint8Array {
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x04,
    0x01,
    0x60,
    0x00,
    0x00, // type: () -> ()
    0x03,
    0x02,
    0x01,
    0x00, // func 0
    0x05,
    0x03,
    0x01,
    0x00,
    0x01, // memory 1
    0x0a,
    0x0a,
    0x01,
    0x08,
    0x00, // code, one body of 8 bytes, no locals
    0x41,
    0x00, // i32.const 0
    0x28,
    exponent,
    0x00, // i32.load align=2^exponent offset=0
    0x1a, // drop
    0x0b,
  ]);
}

describe('M8a1 — a node holds its alignment in BYTES', () => {
  it('the decoder turns the binary exponent into bytes', () => {
    const load = soleInstr(parseWasm(loadWithExponent(2)).functions[0]!.body) as {
      value?: unknown;
    };
    // `drop` wraps the load.
    const inner = (load as { value: { align: number } }).value;
    assertEquals(inner.align, 4);
  });

  it('and the encoder turns it back: a round trip is byte-identical', () => {
    for (const e of [0, 1, 2]) {
      const bytes = loadWithExponent(e);
      assertEquals(encodeWasm(parseWasm(bytes)), bytes, `exponent ${e}`);
    }
  });

  it('an exponent past 8 is refused, as upstream binaryen refuses it; 8 is not', () => {
    parseWasm(loadWithExponent(8)); // invalid for i32.load, but of a reasonable size
    assertThrows(() => parseWasm(loadWithExponent(9)), Error, 'reasonable size');
  });

  it('the encoder refuses an alignment that is not a power of two up to 256', () => {
    const encode = (align: number) =>
      encodeWasm(
        new ModuleBuilder().addMemory('$m', 1, null)
          .addFunction('f', [], [], makeDrop(makeLoad(Opcode.I32Load, 0n, align, makeI32Const(0))))
          .build(),
      );
    assert(WebAssembly.validate(encode(4) as BufferSource));
    assertThrows(() => encode(3), Error, 'not a power of two');
    assertThrows(() => encode(512), Error, 'not a power of two');
    assertThrows(() => encode(0), Error, 'not a power of two');
  });

  it("the compat API takes BYTES, as upstream binaryen.js's does", () => {
    // 🔧 It passed the caller's byte count straight into the field binaryen-ts
    // then read as an exponent, so `i32.load(0, 4, ptr)` — natural alignment,
    // upstream's spelling — came out as 2^4 = 16 bytes and V8 rejected it.
    const m = new binaryen.Module();
    m.setMemory(1, 1, null);
    m.addFunction('f', binaryen.none, binaryen.i32, [], m.i32.load(0, 4, m.i32.const(0)));
    m.addFunctionExport('f', 'f');
    assert(WebAssembly.validate(m.emitBinary() as BufferSource));
  });
});
