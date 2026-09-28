// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A memory with its data written inline — `(memory i64? (pagesize N)? (data
// …))` — is the spec's abbreviation for `(memory m m)` plus an active segment
// at 0, `m` the data's size in pages. Two defects (2026-09-28):
//
// - `(pagesize N)` before the data was refused: "expected limit initial value"
//   (wasmtk's letter, item 5 — 2 modules of `custom-page-sizes.wast`);
// - the MAXIMUM was never written (`01 00 01`), so the memory could grow
//   where the spec's cannot.
//
// Every expected memory section below is what wasm-tools 1.259 and upstream
// wabt 1.0.41 both write for the same text.

import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';

/** The memory section's payload, as hex. */
function memorySection(b: Uint8Array): string {
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id === 5) {
      return [...b.subarray(i, i + size)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    }
    i += size;
  }
  return 'none';
}

for (
  const [wat, want] of [
    ['(module (memory (data "xyz")))', '01 01 01 01'], // one page, min = max
    ['(module (memory (pagesize 1) (data "xyz")))', '01 09 03 03 00'], // 3 one-byte pages
    ['(module (memory (pagesize 65536) (data "xyz")))', '01 09 01 01 10'],
  ] as const
) {
  Deno.test(`inline memory data: ${wat}`, () => {
    const r = wat2wasm(wat, { textForm: false });
    assertEquals(r.errors.length, 0, formatErrors(r.errors));
    // Bytes only: V8 does not implement custom page sizes (flags 0x9).
    assertEquals(memorySection(r.binary), want);
  });
}

Deno.test('an inline-data memory cannot grow past its data (min = max)', () => {
  const r = wat2wasm(
    '(module (memory (export "m") (data "xyz")) (func (export "g") (result i32) (memory.grow (i32.const 1))))',
  );
  assertEquals(r.errors.length, 0, formatErrors(r.errors));
  const g = new WebAssembly.Instance(new WebAssembly.Module(r.binary as BufferSource)).exports
    .g as () => number;
  assertEquals(g(), -1);
});
