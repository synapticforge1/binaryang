// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';

// T13.40. `reserveU32Leb` reserves the maximum width (5 bytes) for a size that
// is not known until the body has been written; `patchU32Leb` used to write a
// fixed-width 5-byte LEB and leave the padding. Legal -- 5 is the maximum for a
// u32, so engines accept it -- but every section header was 4 bytes larger than
// needed, and a minimally-encoded input could never be reproduced byte-for-byte.
// Upstream wabt canonicalises by default (`canonicalize_lebs = true`).
//
// The risk in the fix is the SHIFT: closing the gap moves the whole measured
// body, and the gap is 4 bytes for a small section but 3 or 2 for a larger one.
// Most of this file is about sections big enough to exercise those.

/** Walk the section table, returning [id, declaredSize, lebByteLength][]. */
function sectionHeaders(b: Uint8Array): [id: number, size: number, lebLen: number][] {
  const out: [number, number, number][] = [];
  let p = 8; // magic + version
  while (p < b.length) {
    const id = b[p]!;
    p++;
    let n = 0, sh = 0, len = 0;
    while (p < b.length) {
      const x = b[p]!;
      p++;
      len++;
      n |= (x & 0x7f) << sh;
      sh += 7;
      if (!(x & 0x80)) break;
    }
    out.push([id, n, len]);
    p += n;
  }
  return out;
}

/** Minimum bytes needed to LEB128-encode `n`. */
function minLebLen(n: number): number {
  let len = 1;
  for (let v = n >>> 7; v !== 0; v >>>= 7) len++;
  return len;
}

function compile(src: string): Uint8Array {
  const r = wat2wasm(src);
  expect(r.binary).toBeTruthy();
  expect(r.binary!.length).toBeGreaterThan(0);
  return r.binary!;
}

/** A function body with `n` nops -- a cheap way to size a section precisely. */
function moduleWithBody(nops: number): string {
  return `(module (func (export "f") (result i32) ${'(nop) '.repeat(nops)}(i32.const 7)))`;
}

describe('T13.40 — section sizes are encoded minimally', () => {
  it('does not pad a small section to 5 bytes', () => {
    const bin = compile('(module (memory 1) (func (export "f") (result i32) (i32.const 7)))');
    for (const [id, size, lebLen] of sectionHeaders(bin)) {
      expect(lebLen).toEqual(minLebLen(size));
      // The specific regression: a size that fits in one byte written as five.
      if (size < 128) expect(lebLen).toEqual(1);
      expect(id).toBeGreaterThanOrEqual(0);
    }
  });

  // The shift distance depends on how many bytes the real size needs, so walk
  // a body across the 1->2 and 2->3 byte LEB boundaries (128 and 16384).
  for (const nops of [1, 100, 130, 1000, 16400]) {
    it(`keeps every section header minimal and the body intact (${nops} nops)`, () => {
      const bin = compile(moduleWithBody(nops));
      for (const [, size, lebLen] of sectionHeaders(bin)) {
        expect(lebLen).toEqual(minLebLen(size));
      }
      // The shift must not corrupt what it moves: the module still has to be
      // accepted AND still compute the same answer.
      const buf = new ArrayBuffer(bin.byteLength);
      new Uint8Array(buf).set(bin);
      expect(WebAssembly.validate(buf)).toBe(true);
      const inst = new WebAssembly.Instance(new WebAssembly.Module(buf));
      expect((inst.exports.f as () => number)()).toEqual(7);
    });
  }

  it('covers a multi-byte section size (the 2- and 3-byte LEB cases really occur)', () => {
    // Guard the guard: if every section in the cases above happened to be
    // under 128 bytes, the shift-distance variation would go untested.
    const lens = new Set<number>();
    for (const nops of [1, 130, 16400]) {
      for (const [, size] of sectionHeaders(compile(moduleWithBody(nops)))) {
        lens.add(minLebLen(size));
      }
    }
    expect(lens.has(1)).toBe(true);
    expect(lens.has(2)).toBe(true);
    expect(lens.has(3)).toBe(true);
  });

  it('round-trips its own output byte-identically', () => {
    for (const nops of [1, 130, 1000]) {
      const first = compile(moduleWithBody(nops));
      const text = wasm2wat(first).text;
      expect(text).toBeTruthy();
      const second = wat2wasm(text!).binary;
      expect(second).toBeTruthy();
      expect(Array.from(second!)).toEqual(Array.from(first));
    }
  });

  it('is smaller than the padded encoding it replaced', () => {
    // 5 sections x 4 wasted bytes was the old shape; assert the direction
    // rather than an exact figure so this does not become a brittle golden.
    const bin = compile('(module (memory 1) (global i32 (i32.const 0)) (func (export "f")))');
    const headers = sectionHeaders(bin);
    expect(headers.length).toBeGreaterThanOrEqual(4);
    const wasted = headers.reduce((n, [, size, lebLen]) => n + (lebLen - minLebLen(size)), 0);
    expect(wasted).toEqual(0);
  });
});
