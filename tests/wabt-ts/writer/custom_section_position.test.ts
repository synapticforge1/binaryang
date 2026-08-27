// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmStrip } from '../../../src/wabt-ts/tools/wasm-strip.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { encodeU32Leb128 } from '../../../src/wabt-ts/core/leb128.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';

// T13.41. Custom sections may legally appear anywhere between the known
// sections, and the writer emitted them all in one block at the END. That
// silently RELOCATED any custom section a caller had asked to keep:
// `wasmStrip(m, { sections: ['a'] })` removes `a` and moves everything else.
//
// Position is load-bearing for at least one real custom section: the dynamic
// linking convention requires `dylink.0` to be FIRST. Moving it to the end
// produces a module a dynamic linker will not load, from a tool whose entire
// contract was "remove the sections you named".
//
// `Custom.precedingSection` records the anchor; `undefined` keeps the old
// append-at-the-end behaviour so hand-built IR is unaffected.

const enc = new TextEncoder();
const dec = new TextDecoder();

function customSection(name: string, body: number[]): number[] {
  const nm = [...enc.encode(name)];
  const payload = [...encodeU32Leb128(nm.length), ...nm, ...body];
  return [0x00, ...encodeU32Leb128(payload.length), ...payload];
}

/** Section names in file order; custom sections appear as `custom:<name>`. */
function layout(b: Uint8Array): string[] {
  const SEC = [
    'custom',
    'type',
    'import',
    'func',
    'table',
    'memory',
    'global',
    'export',
    'start',
    'elem',
    'code',
    'data',
    'datacount',
    'tag',
  ];
  const out: string[] = [];
  let p = 8;
  while (p < b.length) {
    const id = b[p]!;
    p++;
    let n = 0, sh = 0;
    while (p < b.length) {
      const x = b[p]!;
      p++;
      n |= (x & 0x7f) << sh;
      sh += 7;
      if (!(x & 0x80)) break;
    }
    if (id === 0) {
      let q = p, ln = 0, s2 = 0;
      while (q < b.length) {
        const x = b[q]!;
        q++;
        ln |= (x & 0x7f) << s2;
        s2 += 7;
        if (!(x & 0x80)) break;
      }
      out.push(`custom:${dec.decode(b.subarray(q, q + ln))}`);
    } else out.push(SEC[id] ?? String(id));
    p += n;
  }
  return out;
}

const BASE = wat2wasm(
  '(module (memory 1) (global $g i32 (i32.const 0)) (func (export "f") (result i32) (i32.const 7)))',
).binary!;

/** Splice a custom section in just before the `nth` known section. */
function withCustomBefore(nth: number, name: string): Uint8Array {
  const sec = customSection(name, [1, 2, 3]);
  let p = 8, seen = 0;
  while (p < BASE.length && seen < nth) {
    p++;
    let n = 0, sh = 0;
    while (p < BASE.length) {
      const x = BASE[p]!;
      p++;
      n |= (x & 0x7f) << sh;
      sh += 7;
      if (!(x & 0x80)) break;
    }
    p += n;
    seen++;
  }
  return new Uint8Array([...BASE.subarray(0, p), ...sec, ...BASE.subarray(p)]);
}

function roundTrip(b: Uint8Array): Uint8Array {
  const errors = makeErrorList();
  const m = readBinaryIr(b, errors, { readDebugNames: false });
  expect(hasErrors(errors)).toBe(false);
  return writeBinaryIr(m);
}

describe('T13.41 — custom sections keep their position', () => {
  it('the base module has enough sections to place customs between', () => {
    // Guard the guard: if BASE had one section, "before the 3rd" would be
    // meaningless and every case below would collapse to the same test.
    expect(layout(BASE).length).toBeGreaterThanOrEqual(4);
  });

  for (const nth of [0, 1, 2, 3]) {
    it(`survives a binary round trip at position ${nth}`, () => {
      const input = withCustomBefore(nth, 'mark');
      const before = layout(input);
      expect(before.indexOf('custom:mark')).toEqual(nth);
      expect(layout(roundTrip(input))).toEqual(before);
    });
  }

  it('preserves relative order of several customs at the same anchor', () => {
    const a = customSection('one', [1]);
    const b = customSection('two', [2]);
    const input = new Uint8Array([...BASE.subarray(0, 8), ...a, ...b, ...BASE.subarray(8)]);
    const out = layout(roundTrip(input));
    expect(out.slice(0, 2)).toEqual(['custom:one', 'custom:two']);
  });

  // The defect as the user meets it: strip the named section, keep the rest
  // WHERE THEY WERE.
  it('wasmStrip({ sections }) removes the named one without moving the others', () => {
    const keep = customSection('dylink.0', [7]);
    const drop = customSection('bloat', [8, 8, 8]);
    const input = new Uint8Array([
      ...BASE.subarray(0, 8),
      ...keep,
      ...BASE.subarray(8),
      ...drop,
    ]);
    const r = wasmStrip(input, { sections: ['bloat'] });
    expect(r.result).toEqual(Result.Ok);
    const out = layout(r.binary);
    expect(out).not.toContain('custom:bloat');
    // The whole point: still FIRST, not relocated to the end.
    expect(out[0]).toEqual('custom:dylink.0');
  });

  it('still strips everything by default', () => {
    const input = new Uint8Array([
      ...BASE.subarray(0, 8),
      ...customSection('a', [1]),
      ...BASE.subarray(8),
    ]);
    const r = wasmStrip(input);
    expect(r.result).toEqual(Result.Ok);
    expect(layout(r.binary).some((s) => s.startsWith('custom:'))).toBe(false);
    expect(Array.from(r.binary)).toEqual(Array.from(BASE));
  });

  // Over-correction guard: IR built by hand carries no anchor, and must keep
  // the old behaviour rather than landing at some arbitrary position.
  it('appends a custom with no recorded position at the end', () => {
    const errors = makeErrorList();
    const m = readBinaryIr(BASE, errors, { readDebugNames: false });
    expect(hasErrors(errors)).toBe(false);
    m.customs.push({
      name: 'handmade',
      data: new Uint8Array([1, 2]),
      loc: { filename: '<test>', line: 0, column: 0, offset: 0 },
    });
    const out = layout(writeBinaryIr(m));
    expect(out[out.length - 1]).toEqual('custom:handmade');
  });
});
