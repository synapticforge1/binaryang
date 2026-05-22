import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import {
  parseF32Literal,
  parseF64Literal,
  parseS32Literal,
  parseS64Literal,
  parseU32Literal,
  parseU64Literal,
  printF32Literal,
  printF64Literal,
} from '../../src/core/literal.ts';
import { Result } from '../../src/core/result.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function f32Bits(v: number): number {
  const b = new ArrayBuffer(4);
  new DataView(b).setFloat32(0, v);
  return new DataView(b).getUint32(0);
}

function f64Bits(v: number): bigint {
  const b = new ArrayBuffer(8);
  new DataView(b).setFloat64(0, v);
  return new DataView(b).getBigUint64(0);
}

// ---------------------------------------------------------------------------
// Integer literal parsing
// ---------------------------------------------------------------------------

describe('parseU32Literal', () => {
  const ok: [string, number][] = [
    ['0', 0],
    ['1', 1],
    ['42', 42],
    ['255', 255],
    ['4294967295', 0xffffffff],
    ['0x0', 0],
    ['0xff', 255],
    ['0xffffffff', 0xffffffff],
    ['0xDEADBEEF', 0xdeadbeef],
  ];
  for (const [s, expected] of ok) {
    it(`parses "${s}"`, () => {
      const [r, v] = parseU32Literal(s);
      assertEquals(r, Result.Ok);
      assertEquals(v, expected >>> 0);
    });
  }

  const err = ['', '-1', '4294967296', '0xffffffff0', 'abc', '0x'];
  for (const s of err) {
    it(`rejects "${s}"`, () => assertEquals(parseU32Literal(s)[0], Result.Error));
  }
});

describe('parseS32Literal', () => {
  const ok: [string, number][] = [
    ['0', 0],
    ['1', 1],
    ['-1', -1],
    ['-2147483648', -2147483648],
    ['2147483647', 2147483647],
    ['0x7fffffff', 2147483647],
  ];
  for (const [s, expected] of ok) {
    it(`parses "${s}"`, () => {
      const [r, v] = parseS32Literal(s);
      assertEquals(r, Result.Ok);
      assertEquals(v, expected | 0);
    });
  }
});

describe('parseU64Literal', () => {
  const ok: [string, bigint][] = [
    ['0', 0n],
    ['1', 1n],
    ['18446744073709551615', 0xffffffffffffffffn],
    ['0xffffffffffffffff', 0xffffffffffffffffn],
    ['0xdeadbeefcafebabe', 0xdeadbeefcafebaben],
  ];
  for (const [s, expected] of ok) {
    it(`parses "${s}"`, () => {
      const [r, v] = parseU64Literal(s);
      assertEquals(r, Result.Ok);
      assertEquals(v, expected);
    });
  }

  const err = ['', 'abc', '18446744073709551616', '-1'];
  for (const s of err) {
    it(`rejects "${s}"`, () => assertEquals(parseU64Literal(s)[0], Result.Error));
  }
});

describe('parseS64Literal', () => {
  it('parses -1', () => {
    const [r, v] = parseS64Literal('-1');
    assertEquals(r, Result.Ok);
    assertEquals(v, -1n);
  });
  it('parses -9223372036854775808', () => {
    const [r, v] = parseS64Literal('-9223372036854775808');
    assertEquals(r, Result.Ok);
    assertEquals(v, -9223372036854775808n);
  });
});

// ---------------------------------------------------------------------------
// F32 literal parsing
// ---------------------------------------------------------------------------

describe('parseF32Literal', () => {
  it('parses inf', () => {
    const [r, bits] = parseF32Literal('inf');
    assertEquals(r, Result.Ok);
    assertEquals(bits, 0x7f800000);
  });
  it('parses -inf', () => {
    const [r, bits] = parseF32Literal('-inf');
    assertEquals(r, Result.Ok);
    assertEquals(bits, 0xff800000);
  });
  it('parses nan (canonical)', () => {
    const [r, bits] = parseF32Literal('nan');
    assertEquals(r, Result.Ok);
    // quiet NaN bit must be set
    assertEquals((bits & 0x7fc00000), 0x7fc00000);
  });
  it('parses -nan', () => {
    const [r, bits] = parseF32Literal('-nan');
    assertEquals(r, Result.Ok);
    assertEquals((bits >>> 31), 1); // negative
    assertEquals((bits & 0x7fc00000), 0x7fc00000);
  });
  it('parses nan:0x200000', () => {
    const [r, bits] = parseF32Literal('nan:0x200000');
    assertEquals(r, Result.Ok);
    assertEquals(bits & 0x7fffff, 0x600000); // quiet bit (0x400000) | payload (0x200000)
  });
  it('parses hex float 0x1.8p+1 = 3.0', () => {
    const [r, bits] = parseF32Literal('0x1.8p+1');
    assertEquals(r, Result.Ok);
    assertEquals(bits, f32Bits(3.0));
  });
  it('parses hex float 0x1p+0 = 1.0', () => {
    const [r, bits] = parseF32Literal('0x1p+0');
    assertEquals(r, Result.Ok);
    assertEquals(bits, f32Bits(1.0));
  });
  it('parses decimal float 1.5', () => {
    const [r, bits] = parseF32Literal('1.5');
    assertEquals(r, Result.Ok);
    assertEquals(bits, f32Bits(1.5));
  });
  it('parses 0.0', () => {
    const [r, bits] = parseF32Literal('0.0');
    assertEquals(r, Result.Ok);
    assertEquals(bits, f32Bits(0));
  });
  it('rejects empty string', () => assertEquals(parseF32Literal('')[0], Result.Error));
});

// ---------------------------------------------------------------------------
// F64 literal parsing
// ---------------------------------------------------------------------------

describe('parseF64Literal', () => {
  it('parses inf', () => {
    const [r, bits] = parseF64Literal('inf');
    assertEquals(r, Result.Ok);
    assertEquals(bits, 0x7ff0000000000000n);
  });
  it('parses -inf', () => {
    const [r, bits] = parseF64Literal('-inf');
    assertEquals(r, Result.Ok);
    assertEquals(bits, 0xfff0000000000000n);
  });
  it('parses nan (canonical)', () => {
    const [r, bits] = parseF64Literal('nan');
    assertEquals(r, Result.Ok);
    assertEquals((bits & 0x7ff8000000000000n), 0x7ff8000000000000n);
  });
  it('parses hex float 0x1.8p+1 = 3.0', () => {
    const [r, bits] = parseF64Literal('0x1.8p+1');
    assertEquals(r, Result.Ok);
    assertEquals(bits, f64Bits(3.0));
  });
  it('parses decimal 1.5', () => {
    const [r, bits] = parseF64Literal('1.5');
    assertEquals(r, Result.Ok);
    assertEquals(bits, f64Bits(1.5));
  });
});

// ---------------------------------------------------------------------------
// F32 literal printing
// ---------------------------------------------------------------------------

describe('printF32Literal', () => {
  it('prints inf', () => assertEquals(printF32Literal(0x7f800000), 'inf'));
  it('prints -inf', () => assertEquals(printF32Literal(0xff800000), '-inf'));
  it('prints zero', () => assertEquals(printF32Literal(0x00000000), '0x0p+0'));
  it('prints canonical NaN', () => {
    const s = printF32Literal(0x7fc00000);
    assertEquals(s.startsWith('nan'), true);
  });
  it('prints -nan', () => {
    const s = printF32Literal(0xffc00000);
    assertEquals(s.startsWith('-nan'), true);
  });
  it('prints 3.0 as hex float', () => {
    // 3.0 f32 = 0x40400000
    const s = printF32Literal(f32Bits(3.0));
    assertEquals(s, '0x1.8p+1');
  });
  it('prints 1.0', () => {
    const s = printF32Literal(f32Bits(1.0));
    assertEquals(s, '0x1.0p+0');
  });
  it('round-trips: parse then print', () => {
    const [, bits] = parseF32Literal('0x1.8p+1');
    assertEquals(printF32Literal(bits), '0x1.8p+1');
  });
});

// ---------------------------------------------------------------------------
// F64 literal printing
// ---------------------------------------------------------------------------

describe('printF64Literal', () => {
  it('prints inf', () => assertEquals(printF64Literal(0x7ff0000000000000n), 'inf'));
  it('prints -inf', () => assertEquals(printF64Literal(0xfff0000000000000n), '-inf'));
  it('prints zero', () => assertEquals(printF64Literal(0n), '0x0p+0'));
  it('prints canonical NaN', () => {
    const s = printF64Literal(0x7ff8000000000000n);
    assertEquals(s.startsWith('nan'), true);
  });
  it('prints 3.0 as hex float', () => {
    const s = printF64Literal(f64Bits(3.0));
    assertEquals(s, '0x1.8p+1');
  });
  it('round-trips 1.5', () => {
    const [, bits] = parseF64Literal('1.5');
    const s = printF64Literal(bits);
    const [, bits2] = parseF64Literal(s);
    assertEquals(bits, bits2);
  });
});
