import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';
import {
  decodeS32Leb128,
  decodeS64Leb128,
  decodeU32Leb128,
  decodeU64Leb128,
  encodeS32Leb128,
  encodeS64Leb128,
  encodeU32Leb128,
  encodeU64Leb128,
  MAX_U32_LEB128_BYTES,
  MAX_U64_LEB128_BYTES,
} from '../../src/core/leb128.ts';

describe('LEB128 constants', () => {
  it('MAX_U32_LEB128_BYTES is 5', () => assertEquals(MAX_U32_LEB128_BYTES, 5));
  it('MAX_U64_LEB128_BYTES is 10', () => assertEquals(MAX_U64_LEB128_BYTES, 10));
});

describe('encodeU32Leb128', () => {
  const cases: [number, number[]][] = [
    [0, [0x00]],
    [1, [0x01]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [255, [0xff, 0x01]],
    [256, [0x80, 0x02]],
    [300, [0xac, 0x02]],
    [0x3fff, [0xff, 0x7f]],
    [0x4000, [0x80, 0x80, 0x01]],
    [0xffffffff, [0xff, 0xff, 0xff, 0xff, 0x0f]],
  ];
  for (const [value, expected] of cases) {
    it(`encodes ${value}`, () =>
      assertEquals(Array.from(encodeU32Leb128(value)), expected));
  }
});

describe('decodeU32Leb128', () => {
  const cases: [number[], number, number][] = [
    [[0x00], 0, 1],
    [[0x01], 1, 1],
    [[0x7f], 127, 1],
    [[0x80, 0x01], 128, 2],
    [[0xff, 0x7f], 0x3fff, 2],
    [[0xff, 0xff, 0xff, 0xff, 0x0f], 0xffffffff, 5],
    // extra bytes after the value are ignored
    [[0x01, 0x99, 0x99], 1, 1],
  ];
  for (const [bytes, value, read] of cases) {
    it(`decodes [${bytes.map((b) => '0x' + b.toString(16)).join(', ')}]`, () => {
      const [v, r] = decodeU32Leb128(new Uint8Array(bytes));
      assertEquals(v, value);
      assertEquals(r, read);
    });
  }

  it('throws on overflow', () => {
    assertThrows(() => { decodeU32Leb128(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x1f])); });
  });

  it('throws on truncated sequence', () => {
    assertThrows(() => { decodeU32Leb128(new Uint8Array([0x80])); });
  });
});

describe('u32 round-trip', () => {
  const values = [0, 1, 63, 64, 127, 128, 255, 256, 16383, 16384, 0x7fffffff, 0xffffffff];
  for (const v of values) {
    it(`round-trips ${v}`, () => {
      const [decoded] = decodeU32Leb128(encodeU32Leb128(v));
      assertEquals(decoded, v);
    });
  }
});

describe('encodeU64Leb128 / decodeU64Leb128', () => {
  const cases: [bigint, number[]][] = [
    [0n, [0x00]],
    [1n, [0x01]],
    [127n, [0x7f]],
    [128n, [0x80, 0x01]],
    [0xffffffffffffffffn, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]],
  ];
  for (const [value, expected] of cases) {
    it(`encodes ${value}n`, () =>
      assertEquals(Array.from(encodeU64Leb128(value)), expected));
  }

  it('round-trips large u64', () => {
    const v = 0x123456789abcdef0n;
    const [decoded] = decodeU64Leb128(encodeU64Leb128(v));
    assertEquals(decoded, v);
  });
});

describe('encodeS32Leb128 / decodeS32Leb128', () => {
  const cases: [number, number[]][] = [
    [0, [0x00]],
    [1, [0x01]],
    [-1, [0x7f]],
    [63, [0x3f]],
    [64, [0xc0, 0x00]],
    [-64, [0x40]],
    [-65, [0xbf, 0x7f]],
    [127, [0xff, 0x00]],
    [-128, [0x80, 0x7f]],
    [2147483647, [0xff, 0xff, 0xff, 0xff, 0x07]],
    [-2147483648, [0x80, 0x80, 0x80, 0x80, 0x78]],
  ];
  for (const [value, encoded] of cases) {
    it(`encodes ${value}`, () =>
      assertEquals(Array.from(encodeS32Leb128(value)), encoded));
    it(`round-trips ${value}`, () => {
      const [decoded] = decodeS32Leb128(encodeS32Leb128(value));
      assertEquals(decoded, value);
    });
  }
});

describe('encodeS64Leb128 / decodeS64Leb128', () => {
  const values = [0n, 1n, -1n, 63n, 64n, -64n, -65n, 9223372036854775807n, -9223372036854775808n];
  for (const v of values) {
    it(`round-trips ${v}n`, () => {
      const [decoded] = decodeS64Leb128(encodeS64Leb128(v));
      assertEquals(decoded, v);
    });
  }
});
