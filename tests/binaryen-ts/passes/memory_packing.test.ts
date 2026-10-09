// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// MemoryPacking, open-work 2 step 6e: the data segments rewritten as the
// fewest bytes that build the same image. Each case instantiates the module
// before and after and compares the whole memory; the leave-alone cases
// assert the segments are untouched.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { packModule } from '../../../src/binaryen-ts/passes/memory-packing.ts';

function pack(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('MemoryPacking').run();
  const after = writeWasm(m);
  expect(WebAssembly.validate(after as BufferSource)).toBe(true);
  return { before, after, segments: m.dataSegments.map((d) => [...d.data].length) };
}
async function image(bytes: Uint8Array): Promise<string> {
  try {
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
    const mem = instance.exports.m as WebAssembly.Memory;
    const b = new Uint8Array(mem.buffer);
    let h = 0x811c9dc5;
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193);
    return `${b.length}:${(h >>> 0).toString(16)}`;
  } catch (e) {
    return `fails: ${(e as Error).constructor.name}`;
  }
}

describe('MemoryPacking', () => {
  it('merges adjacent segments, splits on long zero runs, drops short ones inline', async () => {
    const { before, after, segments } = pack(`(module (memory (export "m") 1)
      (data (i32.const 8) "abc") (data (i32.const 11) "def")
      (data (i32.const 20) "\\00\\00g")
      (data (i32.const 500) "late"))`);
    // "abcdef" at 8..13; then eight zeros (14..21, two of them the third
    // segment's own) — a run as long as a header, so "g" at 22 is its own
    // segment; 500 is far: its own. The zeros written by the third segment
    // are not written at all.
    expect(segments).toEqual([6, 1, 4]);
    expect(await image(after)).toBe(await image(before));
    expect(after.length).toBeLessThan(before.length);
  });

  it('a later segment overwrites an earlier one, as at instantiation', async () => {
    const { before, after, segments } = pack(`(module (memory (export "m") 1)
      (data (i32.const 0) "xxxxxxxx") (data (i32.const 2) "YY"))`);
    expect(segments).toEqual([8]);
    expect(await image(after)).toBe(await image(before));
  });

  it('leaves alone: a passive segment, an imported memory, code naming a segment, an image past the memory', () => {
    const untouched = (wat: string, n: number) => {
      const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
      expect(packModule(m)).toBe(false);
      expect(m.dataSegments.length).toBe(n);
    };
    untouched(`(module (memory 1) (data (i32.const 0) "a") (data "p"))`, 2);
    untouched(
      `(module (import "e" "m" (memory 1)) (data (i32.const 0) "a") (data (i32.const 1) "b"))`,
      2,
    );
    untouched(
      `(module (memory 1) (data $d (i32.const 0) "a") (data (i32.const 1) "b")
        (func (data.drop $d)))`,
      2,
    );
    // 65536 + 1: the original traps at instantiation; packing must not make it load.
    untouched(`(module (memory 1) (data (i32.const 0) "a") (data (i32.const 65535) "bb"))`, 2);
  });
});
