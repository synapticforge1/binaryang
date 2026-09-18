// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// binaryen-ts's decoder materialized a slot per declared local AS IT READ THE
// GROUPS, so five bytes declaring 2^32 locals (spec `binary.43` / `.44`) ran it
// out of memory: the process died instead of the module being refused. Found at
// M8a1 (cmem/ir-convergence.md) while measuring the spec corpus; wabt-ts's reader
// had the same defect and the same fix at M6c (`tests/wabt-ts/reader/
// local_limits.test.ts`), and the two decoders now share the limit.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { MAX_MATERIALIZED_LOCALS } from '../../../src/wabt-ts/reader/binary-reader.ts';

/** Unsigned LEB128. */
function leb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

/** A one-function module whose body declares one i32 group per entry of `counts`. */
function moduleDeclaring(...counts: number[]): Uint8Array {
  const body = [...leb(counts.length), ...counts.flatMap((c) => [...leb(c), 0x7f]), 0x0b];
  const code = [...leb(1), ...leb(body.length), ...body];
  return new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...[0x01, 0x04, 0x01, 0x60, 0x00, 0x00], // type: () -> ()
    ...[0x03, 0x02, 0x01, 0x00], // func: one, type 0
    0x0a,
    ...leb(code.length),
    ...code,
  ]);
}

describe("binaryen-ts's decoder: a function's declared locals", () => {
  it('a modest count is materialized, one slot per local', () => {
    assertEquals(parseWasm(moduleDeclaring(3)).functions[0]!.locals.length, 3);
  });

  it('exactly the limit is materialized', () => {
    assertEquals(
      parseWasm(moduleDeclaring(MAX_MATERIALIZED_LOCALS)).functions[0]!.locals.length,
      MAX_MATERIALIZED_LOCALS,
    );
  });

  it("one past the decoder's limit is refused, not allocated", () => {
    assertThrows(
      () => parseWasm(moduleDeclaring(MAX_MATERIALIZED_LOCALS + 1)),
      Error,
      'too many locals',
    );
  });

  it('2^32 - 1 locals in ONE group — binary.43 — is refused, not an out-of-memory', () => {
    assertThrows(() => parseWasm(moduleDeclaring(0xffff_ffff)), Error, 'too many locals');
  });

  it("the spec's cap is on the SUM: two groups of 2^31 overflow where neither does", () => {
    assertThrows(
      () => parseWasm(moduleDeclaring(0x8000_0000, 0x8000_0000)),
      Error,
      'too many locals',
    );
  });
});
