// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A name section the READER could not apply is kept RAW, at its own position, so
// `wasm-strip` and a plain round trip give the bytes back (R8). The rule for
// names under optimization has to cover that copy too: once a pass has run, the
// indices inside those bytes name code that was renumbered, merged or deleted.
//
// 🔧 `PassRunner` cleared `hasNameSection` and left the raw copy, so the reader
// route's OPTIMIZED output carried a stale name section — 211 of the 286 modules
// in binaryen's suite and the spec testsuite that keep one, 13,720 bytes, 13,670
// of them one DWARF module. Stale debug info, not merely size, and it only
// appears on this route: binaryen-ts's decoder regenerates names rather than
// keeping bytes (R8'), so nothing before the merge could show it (One front end,
// found while measuring stage 2 item 2, 2026-09-20).
//
// The `data: null` entry is NOT that copy — it is the PLACEMENT marker that says
// where a generated name section goes (W8) — so it stays.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { prepareForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

const SRC = `(module
  (func $helper (param $x i32) (result i32) (i32.add (local.get $x) (i32.const 1)))
  (func (export "f") (param $y i32) (result i32) (call $helper (local.get $y))))`;

/** The `[id, size, payload]` span of the first `name` custom section. */
function nameSection(b: Uint8Array): { start: number; end: number } {
  let p = 8;
  while (p < b.length) {
    const start = p;
    const id = b[p++]!;
    let size = 0, shift = 0, byte;
    do {
      byte = b[p++]!;
      size += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    const end = p + size;
    if (id === 0) {
      const n = b[p]!;
      if (new TextDecoder().decode(b.subarray(p + 1, p + 1 + n)) === 'name') return { start, end };
    }
    p = end;
  }
  throw new Error('the fixture has no name section');
}

/**
 * Two name sections: the reader applies the LAST and keeps the earlier one raw,
 * which is the shape `duplicated_names_collision.test.wasm` has upstream.
 */
function twoNameSections(): Uint8Array {
  const one = wat2wasm(SRC, { textForm: false }).binary;
  assert(one.length > 0, 'the fixture assembles');
  const { start, end } = nameSection(one);
  const out = new Uint8Array(one.length + (end - start));
  out.set(one, 0);
  out.set(one.subarray(start, end), one.length);
  return out;
}

const rawNames = (m: { customSections: readonly { name: string; data: Uint8Array | null }[] }) =>
  m.customSections.filter((c) => c.name === 'name' && c.data !== null);
const read = (b: Uint8Array) =>
  prepareForPasses(readBinaryIr(b, makeErrorList(), { readDebugNames: true }));

describe('a raw-kept name section follows the same rule as the applied names', () => {
  const bytes = twoNameSections();

  it('the reader keeps the section bytes, so the fixture has something to lose', () => {
    const m = read(bytes);
    // BOTH copies are kept as bytes (the writer then generates none of its own,
    // W7), and the LAST one is also applied to the IR. What matters here is that
    // there are bytes to go stale.
    assertEquals(rawNames(m).length, 2, 'both name sections kept as bytes');
    assert(rawNames(m).every((c) => c.data!.length > 0), 'with bytes in them');
    assert(m.hasNameSection, 'and the last one applied to the IR');
    assert(WebAssembly.validate(bytes as BufferSource), 'the engine accepts two name sections');
  });

  it('no pass run: the bytes are still there — a plain round trip keeps them', () => {
    const m = read(bytes);
    new PassRunner(m).run(); // empty queue: read-and-write, the owner's rule
    assertEquals(rawNames(m).length, 2, 'kept');
    const out = encodeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'and written back out valid');
  });

  it('after a pass: the stale copy is gone, and the output is valid', () => {
    const m = read(bytes);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 2 }).addDefaultOptimizationPasses().run();
    assertEquals(rawNames(m).length, 0, 'the stale bytes are dropped');
    const out = encodeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'the optimized module is valid');
    // Nothing in the output claims to be a name section either.
    let found = 0, p = 8;
    while (p < out.length) {
      const id = out[p++]!;
      let size = 0, shift = 0, byte;
      do {
        byte = out[p++]!;
        size += (byte & 0x7f) * 2 ** shift;
        shift += 7;
      } while (byte & 0x80);
      if (id === 0) {
        const n = out[p]!;
        if (new TextDecoder().decode(out.subarray(p + 1, p + 1 + n)) === 'name') found++;
      }
      p += size;
    }
    assertEquals(found, 0, 'no name section in optimized output');
  });

  it('under `-g` the names come from the IR, not from the stale bytes', () => {
    const m = read(bytes);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 2, debugInfo: true })
      .addDefaultOptimizationPasses().run();
    assertEquals(rawNames(m).length, 0, 'the raw copy goes under -g too — it is stale either way');
    assert(m.hasNameSection, 'the IR still carries the names it kept');
    assert(WebAssembly.validate(encodeWasm(m) as BufferSource));
  });
});
