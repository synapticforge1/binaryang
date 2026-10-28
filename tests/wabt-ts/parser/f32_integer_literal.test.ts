// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): an INTEGER-spelled `f32.const` (`f32.const 18014399583223809`)
// was converted with `Number(n)` — rounded to f64 — and then to f32, rounding twice. When the
// first rounding lands on an f32 midpoint, ties-to-even goes the wrong way: 2^54 + 2^30 + 1 came
// out 0x1p+54 instead of 0x1.000002p+54, and a value just below FLT_MAX's rounding midpoint was
// refused as out of range. No diagnostic either way. It is rounded once now.
//
// The expected bits are computed here independently: `Math.fround` rounds a double exactly once,
// so below 2^53 (where `Number(n)` is exact) it is the reference; above, the constants are worked
// out by hand. Upstream wabt 1.0.41 and wasm-tools agree on the decimal cases; both TRUNCATE some
// HEX integers near a midpoint (0x6736246 → 108225088, where 108225096 is nearer), so the hex
// cases are pinned to the correctly rounded value, not to an oracle (divergence F4).

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/reader/binary-reader.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/core/error.ts';

/** The bits of every `const` in `wat`'s binary, in order (functions, then globals). */
function constBits(wat: string): number[] {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const m = readBinaryIr(r.binary, makeErrorList(), {});
  const out: number[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { for (const y of x) walk(y); }
    else if (x !== null && typeof x === 'object') {
      const node = x as { kind?: string; value?: { bits?: unknown; bytes?: unknown } };
      if (node.kind === 'const' && node.value !== undefined) {
        // An f32 carries `bits`; a v128 carries its 16 `bytes`, lane 0 first.
        const b = node.value.bits ?? node.value.bytes;
        if (typeof b === 'number') out.push(b >>> 0);
        else if (b instanceof Uint8Array) {
          const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
          for (let i = 0; i < b.byteLength; i += 4) out.push(v.getUint32(i, true));
        }
        return;
      }
      for (const v of Object.values(x)) if (v !== null && typeof v === 'object') walk(v);
    }
  };
  for (const f of m.functions) walk(f.body);
  for (const g of m.globals) walk(g.init);
  return out;
}

const f32 = (lit: string) => constBits(`(module (func (result f32) f32.const ${lit}))`)[0];

function fround(n: number): number {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, Math.fround(n), true);
  return v.getUint32(0, true);
}

describe('code lens 3 — an integer-spelled f32.const is rounded once', () => {
  it('2^54 + 2^30 + 1, which double rounding sent to 2^54', () => {
    assertEquals(f32('18014399583223809').toString(16), '5a800001');
    assertEquals(f32('-18014399583223809').toString(16), 'da800001');
    assertEquals(f32('0x40000040000001').toString(16), '5a800001');
  });

  it('a hex integer rounds to the NEAREST f32 (where upstream wabt and wasm-tools truncate)', () => {
    // 0x6736246 = 108225094: neighbours 108225088 (6 away) and 108225096 (2 away).
    assertEquals(f32('0x6736246'), fround(108225094));
    assertEquals(f32('0x6736246'), fround(108225096));
  });

  it('just below FLT_MAX rounding midpoint is FLT_MAX, accepted; the midpoint itself overflows', () => {
    // FLT_MAX = (2^24 - 1) × 2^104; the midpoint to 2^128 is FLT_MAX + 2^103, and ties-to-even
    // (FLT_MAX's mantissa is odd) rounds it UP, to infinity.
    assertEquals(f32('340282356779733661637539395458142568447').toString(16), '7f7fffff');
    const r = wat2wasm(
      '(module (func (result f32) f32.const 340282356779733661637539395458142568448))',
    );
    assert(hasErrors(r.errors), 'the overflowing midpoint was accepted');
    assert(formatErrors(r.errors).includes('out of range'), formatErrors(r.errors));
  });

  it('agrees with Math.fround below 2^53, in f32.const, a v128 lane and a global', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 200; i++) {
      const n = Math.floor(rnd() * 2 ** 53) * (rnd() < 0.3 ? -1 : 1);
      const want = fround(n);
      const lit = rnd() < 0.3 ? `${n < 0 ? '-' : ''}0x${Math.abs(n).toString(16)}` : String(n);
      const got = constBits(
        `(module (func (result f32) f32.const ${lit}) (func (result v128) v128.const f32x4 ${lit} 0 0 0)` +
          ` (global f32 (f32.const ${lit})))`,
      );
      assertEquals([got[0], got[1], got[5]], [want, want, want], lit);
    }
  });

  it('keeps an integer -0 negative in every position', () => {
    const got = constBits(
      '(module (func (result f32) f32.const -0) (func (result v128) v128.const f32x4 -0 0 -0x0 1)' +
        ' (global f32 (f32.const -0)))',
    );
    assertEquals(got.map((b) => b.toString(16)), [
      '80000000',
      '80000000',
      '0',
      '80000000',
      '3f800000',
      '80000000',
    ]);
  });
});
