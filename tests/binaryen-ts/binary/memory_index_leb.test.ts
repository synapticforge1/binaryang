// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A memory index is a LEB `u32` wherever it appears (post-M8 fix 8).
//
// binaryen-ts's decoder READ the index of `memory.size`, `memory.grow`,
// `memory.init`, `memory.copy` (both) and `memory.fill` as ONE BYTE, and its
// encoder WROTE them as one byte (`n & 0xff`). Below 128 a LEB is that byte, so
// nothing showed; from 128 the decoder misread the body — the LEB's second
// byte became the next opcode — and the encoder wrote a continuation byte, or
// from 256 a DIFFERENT memory. The item that listed it named only size / grow;
// the other four sites were the same defect. wabt-ts reads and writes a LEB.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';

/** `n` one-page memories, `$m0` … `$m<n-1>`. */
const memories = (n: number) => Array.from({ length: n }, (_, i) => `(memory $m${i} 1)`).join(' ');

/** Assembled by wabt-ts (LEB throughout), then binaryen-ts decode -> encode. */
function roundTrip(wat: string): { original: Uint8Array; back: Uint8Array } {
  const original = wat2wasm(wat).binary;
  assert(original !== undefined && WebAssembly.validate(original as BufferSource), 'valid input');
  return { original, back: writeWasm(readForPasses(original)) };
}

function exportsOf(bytes: Uint8Array): Record<string, () => number> {
  return new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
    .exports as Record<string, () => number>;
}

describe('binaryen-ts reads and writes a memory index as a LEB', () => {
  it('every memory-index instruction, at index 150 (and 199)', () => {
    const { original, back } = roundTrip(`(module ${memories(200)}
      (data $d "hi")
      (func (export "size") (result i32) (memory.size $m150))
      (func (export "grow") (result i32) (memory.grow $m150 (i32.const 1)))
      (func (export "init") (memory.init $m150 $d (i32.const 0) (i32.const 0) (i32.const 2)))
      (func (export "copy") (memory.copy $m199 $m150 (i32.const 5) (i32.const 1) (i32.const 1)))
      (func (export "fill") (memory.fill $m150 (i32.const 0) (i32.const 7) (i32.const 1)))
      (func (export "at150") (result i32) (i32.load8_u $m150 (i32.const 1)))
      (func (export "at199") (result i32) (i32.load8_u $m199 (i32.const 5))))`);
    assertEquals(back, original, 'byte-identical round trip');
    for (const bytes of [original, back]) {
      const x = exportsOf(bytes);
      x.init!(); // "hi" into $m150 at 0
      x.fill!(); // 7 into $m150 at 0
      x.copy!(); // $m150[1] ('i', 105) into $m199 at 5
      assertEquals(
        [x.size!(), x.grow!(), x.size!(), x.at150!(), x.at199!()],
        [1, 1, 2, 105, 105],
      );
    }
  });

  for (const index of [127, 128, 255, 256]) {
    it(`memory.size at index ${index}, where one byte stops being the LEB`, () => {
      const { original, back } = roundTrip(`(module ${memories(index)} (memory $big 3)
        (func (export "size") (result i32) (memory.size $big)))`);
      assertEquals(back, original);
      assertEquals(exportsOf(back).size!(), 3, 'the index names the 3-page memory');
    });
  }
});
