// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// binaryen-ts MISCOMPILED every i64 narrow store, and nothing could see it.
//
// The spec — and upstream wabt, checked directly — says:
//
//     i64.store8 = 0x3c   i64.store16 = 0x3d   i64.store32 = 0x3e
//
// binaryen-ts's encoder mapped the store WIDTH to 0x3d / 0x3e / 0x3c — a
// rotation. Executed under V8, a module built through binaryen-ts's WAT parser:
//
//     i64.store8   wrote 2 bytes   (emitted i64.store16)   silent corruption
//     i64.store16  wrote 4 bytes   (emitted i64.store32)   silent corruption
//     i64.store32  REJECTED        (emitted i64.store8 with alignment 2)
//
// Two of the three are valid wasm that overwrites adjacent memory with no
// diagnostic anywhere.
//
// 🛑 WHY IT SURVIVED: the binary DECODER carried the exact inverse rotation
// (0x3c→4, 0x3d→1, 0x3e→2). So binary → IR → binary was byte-identical, and
// every gate that compares bytes — `baseline`, `bridge`, the corpus round-trip
// — agreed with itself. This is the producer/consumer cancelling pair that
// `cmem/best-practices.md` calls the costliest class this codebase has: a defect
// shared by a producer and its consumer is invisible to their round trip.
//
// So this file does not round-trip. It pins each half INDEPENDENTLY:
//   - the ENCODER by executing a module and measuring what the store wrote;
//   - the DECODER by parsing spec-correct bytes and reading the IR directly.
// Either half alone could be wrong and the other test would still catch it.
//
// ⚠️ The two had to be fixed TOGETHER. Correcting only the encoder would have
// made the decoder's rotation visible for the first time — every i64 narrow
// store in a round-tripped module would have changed width.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { storeShape } from '../../../src/binaryen-ts/ir/memory-access.ts';
import type { Opcode } from '../../../src/wabt-ts/core/opcode.ts';

/** Bytes a store actually wrote: store -1 into zeroed memory, count the 0xFF bytes. */
async function bytesWritten(op: string): Promise<number> {
  const operand = op.startsWith('i64') ? 'i64' : 'i32';
  const wat = `(module
    (memory 1)
    (func (export "f") (result i64)
      (${op} (i32.const 0) (${operand}.const -1))
      (i64.load (i32.const 0))))`;
  const bytes = encodeWasm(parseWat(wat)) as BufferSource;
  const instance = new WebAssembly.Instance(await WebAssembly.compile(bytes), {});
  const v = (instance.exports.f as () => bigint)();
  let n = 0;
  while (n < 8 && ((v >> BigInt(n * 8)) & 0xffn) === 0xffn) n++;
  return n;
}

/**
 * Every Store node's width, in order, from a parsed binary — read off the
 * node's OPCODE through the shared table.
 *
 * ⚠️ This used to read `node.bytes` and skip nodes where it was `undefined`.
 * When the node stopped carrying `bytes`, that guard would have turned every
 * Store into a skip: the walk returns `[]`, and the test's only protection is
 * that `[]` happens not to equal `[width]`. A Store without an opcode now
 * THROWS instead of being skipped.
 */
function storeWidths(bytes: Uint8Array): number[] {
  const out: number[] = [];
  const walk = (e: unknown): void => {
    if (!e || typeof e !== 'object') return;
    const node = e as { kind?: string; opcode?: Opcode };
    if (node.kind === ExpressionKind.Store) {
      if (node.opcode === undefined) throw new Error('Store node without an opcode');
      out.push(storeShape(node.opcode).bytes);
    }
    for (const v of Object.values(e as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  for (const f of parseWasm(bytes).functions) walk(f.body);
  return out;
}

/** A hand-assembled module whose only store is `opcode`, checked against wat2wasm. */
function moduleStoring(opcode: number, operandConst: number[]): Uint8Array {
  const body = [
    0x00, // no locals
    0x41,
    0x00, // i32.const 0 (address)
    ...operandConst,
    opcode,
    0x00,
    0x00, // memarg: align 0, offset 0
    0x0b, // end
  ];
  return Uint8Array.from([
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
    0x00, // func 0 : type 0
    0x05,
    0x03,
    0x01,
    0x00,
    0x01, // memory: 1 page
    0x0a,
    body.length + 2,
    0x01,
    body.length,
    ...body,
  ]);
}

const I64_CONST_0 = [0x42, 0x00];
const I32_CONST_0 = [0x41, 0x00];

describe('narrow stores write the width their name says', () => {
  const ENCODE: ReadonlyArray<readonly [string, number]> = [
    ['i32.store8', 1],
    ['i32.store16', 2],
    ['i64.store8', 1],
    ['i64.store16', 2],
    ['i64.store32', 4],
  ];
  for (const [op, width] of ENCODE) {
    it(`ENCODER: ${op} writes ${width} byte(s) when executed`, async () => {
      assertEquals(await bytesWritten(op), width);
    });
  }

  // The CLASS, not the instance: loads use the same kind of width/sign table on
  // both halves, so they get the same execution check. Memory holds
  // 0x0081828384858687 little-endian, so byte 0 is 0x87 — high bit set, which
  // makes sign- and zero-extension produce DIFFERENT answers and a swapped
  // `_s`/`_u` visible. (No literal at or above 2^63 is used: binaryen-ts rejected
  // `i64.const 0xAAAAAAAAAAAAAAAA` with "extra bits in varint" — a separate
  // question, recorded rather than folded in here.)
  const LOADS: ReadonlyArray<readonly [string, string, bigint]> = [
    ['i32.load8_s', 'i32', -121n],
    ['i32.load8_u', 'i32', 135n],
    ['i32.load16_s', 'i32', -31097n],
    ['i32.load16_u', 'i32', 34439n],
    ['i64.load8_s', 'i64', -121n],
    ['i64.load8_u', 'i64', 135n],
    ['i64.load16_s', 'i64', -31097n],
    ['i64.load16_u', 'i64', 34439n],
    ['i64.load32_s', 'i64', -2071624057n],
    ['i64.load32_u', 'i64', 2223343239n],
  ];
  for (const [op, result, expected] of LOADS) {
    it(`ENCODER: ${op} reads the right width and extension when executed`, async () => {
      const wat = `(module
        (memory 1)
        (func (export "f") (result ${result})
          (i64.store (i32.const 0) (i64.const 0x0081828384858687))
          (${op} (i32.const 0))))`;
      const bytes = encodeWasm(parseWat(wat)) as BufferSource;
      const instance = new WebAssembly.Instance(await WebAssembly.compile(bytes), {});
      const got = (instance.exports.f as () => number | bigint)();
      assertEquals(BigInt(got), expected);
    });
  }

  const DECODE: ReadonlyArray<readonly [string, number, number[], number]> = [
    ['i32.store8', 0x3a, I32_CONST_0, 1],
    ['i32.store16', 0x3b, I32_CONST_0, 2],
    ['i64.store8', 0x3c, I64_CONST_0, 1],
    ['i64.store16', 0x3d, I64_CONST_0, 2],
    ['i64.store32', 0x3e, I64_CONST_0, 4],
  ];
  for (const [op, opcode, operand, width] of DECODE) {
    it(`DECODER: spec byte 0x${opcode.toString(16)} (${op}) is recorded as width ${width}`, () => {
      // Parse bytes that are correct by the SPEC, not by our own encoder — a
      // round trip through our encoder is exactly what hid this.
      assertEquals(storeWidths(moduleStoring(opcode, operand)), [width]);
    });
  }
});
