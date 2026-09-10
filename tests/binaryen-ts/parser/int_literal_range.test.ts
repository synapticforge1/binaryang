// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// An integer literal for an N-bit type is valid in [-2^(N-1), 2^N): it may be
// written signed OR unsigned, and denotes the two's-complement value. Outside
// that range it is MALFORMED. Every expected value below is upstream wabt's
// answer, checked directly — not this repo's own.
//
// binaryen-ts's WAT parser got this wrong in OPPOSITE directions on the two
// widths, which is why neither was an obvious single bug:
//
//   i32  accepted out-of-range literals and WRAPPED them silently —
//        `i32.const 0x100000000` became 0, `i32.const -2147483649` became
//        2147483647. A typo turned into a different program.
//   i64  REJECTED valid literals in the unsigned range — `i64.const
//        0xFFFFFFFFFFFFFFFF`, a common way to write -1, produced a module V8
//        refused ("extra bits in varint"). The literal reached the SIGNED LEB
//        writer as a positive bigint above 2^63.
//
// Found while probing for something else: a memory pre-fill in the i64
// narrow-store investigation used `i64.const 0xAAAAAAAAAAAAAAAA` and hit the
// i64 half. The i32 half came from checking the CLASS rather than the instance.
//
// ⚠️ binaryen-ts's WAT parser is NOT covered by `deno task spec` — the
// 1156/1156 "malformed TEXT rejected" axis runs wabt-ts's parser. That is why a
// parser that accepted malformed literals was invisible to a 100% spec score.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWat, WatParseError } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';

async function run(type: 'i32' | 'i64', literal: string): Promise<bigint> {
  const wat = `(module (func (export "f") (result ${type}) (${type}.const ${literal})))`;
  const bytes = encodeWasm(parseWat(wat)) as BufferSource;
  const instance = new WebAssembly.Instance(await WebAssembly.compile(bytes), {});
  return BigInt((instance.exports.f as () => number | bigint)());
}

/** [type, literal, value it denotes] — all accepted by upstream wabt. */
const VALID: ReadonlyArray<readonly ['i32' | 'i64', string, bigint]> = [
  ['i32', '0x7FFFFFFF', 2147483647n],
  ['i32', '0x80000000', -2147483648n],
  ['i32', '0xFFFFFFFF', -1n],
  ['i32', '4294967295', -1n],
  ['i32', '-2147483648', -2147483648n],
  ['i64', '0x7FFFFFFFFFFFFFFF', 9223372036854775807n],
  ['i64', '0x8000000000000000', -9223372036854775808n],
  ['i64', '0xFFFFFFFFFFFFFFFF', -1n],
  ['i64', '18446744073709551615', -1n],
  ['i64', '-9223372036854775808', -9223372036854775808n],
];

/** [type, literal] — all REJECTED by upstream wabt as out of range. */
const MALFORMED: ReadonlyArray<readonly ['i32' | 'i64', string]> = [
  ['i32', '0x100000000'],
  ['i32', '4294967296'],
  ['i32', '-2147483649'],
  ['i64', '0x10000000000000000'],
  ['i64', '-9223372036854775809'],
];

describe('integer literals: the range is [-2^(N-1), 2^N)', () => {
  for (const [type, literal, value] of VALID) {
    it(`${type}.const ${literal} is valid and denotes ${value}`, async () => {
      assertEquals(await run(type, literal), value);
    });
  }

  for (const [type, literal] of MALFORMED) {
    it(`${type}.const ${literal} is MALFORMED — rejected, not wrapped`, () => {
      assertThrows(
        () => parseWat(`(module (func (result ${type}) (${type}.const ${literal})))`),
        WatParseError,
        'out of range',
      );
    });
  }
});
