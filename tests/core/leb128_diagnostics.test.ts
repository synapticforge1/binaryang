// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import {
  decodeS32Leb128,
  decodeS64Leb128,
  decodeU32Leb128,
  decodeU64Leb128,
} from '../../src/core/leb128.ts';

// T13.37. A LEB128 decode can fail two ways that the spec names SEPARATELY:
//
//   "integer too large"                -- the terminating byte carries value
//                                         bits beyond the target width
//   "integer representation too long"  -- the encoding runs past the maximum
//                                         byte count for that width
//
// The decoders have always told these apart -- they are two distinct branches --
// and then threw one message for both, discarding the distinction at the point
// of reporting. This file pins that they stay distinguishable.
//
// The regression this guards is COLLAPSE: a later edit that unifies the two
// branches, or gives them a shared message, still rejects every input and moves
// no conformance metric. Only the wording tells you it happened.

const TOO_LARGE = 'integer too large';
const TOO_LONG = 'integer representation too long';

type Decoder = (b: Uint8Array, o?: number) => [number | bigint, number];

/** N copies of `byte`, then `tail`. */
function bytes(n: number, byte: number, ...tail: number[]): Uint8Array {
  return new Uint8Array([...new Array(n).fill(byte), ...tail]);
}

function messageOf(fn: Decoder, b: Uint8Array): string {
  try {
    fn(b);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`expected a throw, but the decode succeeded`);
}

const CASES: {
  name: string;
  fn: Decoder;
  tooLarge: Uint8Array;
  tooLong: Uint8Array;
  valid: Uint8Array;
  validValue: number | bigint;
}[] = [
  {
    name: 'u32',
    fn: decodeU32Leb128 as Decoder,
    // 5th byte holds bit 32 -- a value 2**32 cannot represent.
    tooLarge: bytes(4, 0x80, 0x10),
    // 6 bytes: no u32 encoding is that long, however small the value.
    tooLong: bytes(5, 0x80, 0x00),
    valid: bytes(4, 0xff, 0x0f),
    validValue: 0xffffffff,
  },
  {
    name: 'u64',
    fn: decodeU64Leb128 as Decoder,
    tooLarge: bytes(9, 0x80, 0x02),
    tooLong: bytes(10, 0x80, 0x00),
    valid: bytes(9, 0xff, 0x01),
    validValue: 0xffffffffffffffffn,
  },
  {
    name: 's32',
    fn: decodeS32Leb128 as Decoder,
    // 5th byte's bits 3-6 are neither all-0 nor all-1, so it is not a
    // sign-extension of bit 31 -- the value is out of range.
    tooLarge: bytes(4, 0x80, 0x08),
    tooLong: bytes(5, 0x80, 0x00),
    valid: bytes(4, 0xff, 0x7f),
    validValue: -1,
  },
  {
    name: 's64',
    fn: decodeS64Leb128 as Decoder,
    tooLarge: bytes(9, 0x80, 0x02),
    tooLong: bytes(10, 0x80, 0x00),
    valid: bytes(9, 0xff, 0x7f),
    validValue: -1n,
  },
];

describe('LEB128 decode diagnostics', () => {
  it('names the two faults differently, so a collapse is visible', () => {
    expect(TOO_LARGE).not.toEqual(TOO_LONG);
    // Neither may be a substring of the other, or a `.includes` check in a
    // consumer -- the spec-message harness is one -- could not tell them apart.
    expect(TOO_LONG.includes(TOO_LARGE)).toBe(false);
    expect(TOO_LARGE.includes(TOO_LONG)).toBe(false);
  });

  for (const c of CASES) {
    describe(c.name, () => {
      it('reports an out-of-range VALUE as "integer too large"', () => {
        expect(messageOf(c.fn, c.tooLarge)).toContain(TOO_LARGE);
      });

      it('reports an over-long ENCODING as "integer representation too long"', () => {
        expect(messageOf(c.fn, c.tooLong)).toContain(TOO_LONG);
      });

      // Sensitivity, inverted: each fault must NOT get the other's name. This
      // is what fails if the two branches are ever merged -- a single shared
      // message satisfies both `toContain` assertions above only if it contains
      // both strings, which the first test forbids.
      it('does not confuse the two faults', () => {
        expect(messageOf(c.fn, c.tooLarge)).not.toContain(TOO_LONG);
        expect(messageOf(c.fn, c.tooLong)).not.toContain(TOO_LARGE);
      });

      // Over-correction guard: the widest legal encoding must still decode.
      // A fix that reported "too large" one byte early would pass every
      // assertion above and break real modules.
      it('still accepts the widest legal encoding', () => {
        const [value] = c.fn(c.valid);
        expect(value).toEqual(c.validValue);
      });

      it('reports a truncated sequence as an unexpected end', () => {
        expect(messageOf(c.fn, bytes(1, 0x80))).toContain('unexpected end');
      });
    });
  }
});
