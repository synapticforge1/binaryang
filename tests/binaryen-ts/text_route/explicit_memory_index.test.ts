// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// An explicit memory index on the text route into binaryen-ts: HONOURED.
//
// binaryen-ts's own WAT parser had no multi-memory support. Four of five ops
// were refused ("unexpected atom"); `(memory.size $b)` was the silent one — it
// built a `memory.size` with no index and asked memory 0: a valid module asking
// the wrong memory (2026-09-15, found making `memidx` required, S6 step 5 B4).
// These tests pinned the refusal.
//
// That parser was retired in One front end stage 5 (2026-09-28). External WAT
// reaches binaryen-ts through `readWat` — the wabt-ts parser, then the bytes,
// then the one reader — which reads the whole format, multi-memory included. So
// the refusal the tests pinned became the thing it was standing in for: each
// op must behave exactly as `wat2wasm`'s module does. `$b` has 2 pages and `$a`
// 1, so an index that was dropped or swapped gives a different answer.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const TWO = (body: string, result = '(result i32)') =>
  `(module (memory $a 1) (memory $b 2) (func (export "f") ${result} ${body})
     (func (export "size_a") (result i32) (memory.size $a))
     (func (export "size_b") (result i32) (memory.size $b))
     (func (export "byte_b") (result i32) (i32.load8_u $b (i32.const 0))))`;

/** Everything a caller could observe: `f`, then both sizes and memory $b's first byte. */
function observe(bytes: Uint8Array): unknown[] {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports;
  const call = (n: string) => (ex[n] as () => number)();
  return [call('f'), call('size_a'), call('size_b'), call('byte_b')];
}

describe('the text route honours an explicit memory index', () => {
  for (
    const [name, body, result] of [
      ['memory.size $b', '(memory.size $b)', '(result i32)'],
      ['memory.grow $b', '(memory.grow $b (i32.const 1))', '(result i32)'],
      ['memory.fill $b', '(memory.fill $b (i32.const 0) (i32.const 7) (i32.const 1))', ''],
      ['memory.copy $b $a', '(memory.copy $b $a (i32.const 0) (i32.const 0) (i32.const 1))', ''],
      ['i32.load $b', '(i32.load $b (i32.const 0))', '(result i32)'],
    ] as const
  ) {
    it(name, () => {
      const wat = TWO(body, result);
      assertEquals(observe(writeWasm(readWat(wat))), observe(wat2wasm(wat).binary));
    });
  }

  it('memory.size $b asks $b — the case that was silent', () => {
    assertEquals(observe(writeWasm(readWat(TWO('(memory.size $b)'))))[0], 2);
  });

  it('a bare memory.size asks memory 0', () => {
    const wat = `(module (memory 3) (func (export "f") (result i32) (memory.size)))`;
    const run = (b: Uint8Array) =>
      (new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports.f as () =>
        number)();
    assertEquals(run(writeWasm(readWat(wat))), 3);
    assertEquals(run(wat2wasm(wat).binary), 3);
  });
});
