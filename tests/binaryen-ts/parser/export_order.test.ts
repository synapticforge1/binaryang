// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Inline exports appear in the export section in SOURCE order.
//
// The export section is a list, and its order is whatever order `addExport` was
// called in. Every declaration kind — memory, global, table, tag — registered
// its inline export during the parser's FIRST pass, while a function's waited
// until `buildFunc` in the THIRD. So a function's export always landed after
// every other kind's, regardless of the source:
//
//     (func $f1 (export "_start") …)   ← line 4
//     (memory $M0 (export "memory") …) ← line 5
//
// came out as `memory` then `_start`.
//
// ⚠️ This is NOT a semantic defect — exports are looked up by name, names are
// unique, and the interface comparison passed 421/421 throughout. It was the
// last byte difference between binaryen-ts's output and wabt-ts's, and closing
// it took the corpus to **421/421 byte-identical** with a total size delta of
// zero.
//
// 🔑 Worth keeping as a shape: the bug was in WHEN a thing was recorded, not in
// what was recorded. Nothing about the export itself was wrong, and no check
// that inspected exports as a SET could see it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** Export names in the order the binary section lists them. */
function exportOrder(bytes: Uint8Array): string[] {
  return WebAssembly.Module.exports(new WebAssembly.Module(bytes as BufferSource))
    .map((e) => e.name);
}

/** binaryen-ts must produce byte-identical output to wabt-ts. */
function assertSameBytes(wat: string): Uint8Array {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the fixture');
  const got = encodeWasm(parseWat(wat));
  assertEquals(Array.from(got), Array.from(ref.binary));
  return got;
}

describe('WAT parser — inline exports keep source order', () => {
  // The regression, in the order that exposed it: FUNCTION first, then another
  // kind. The reverse order passed throughout, so it is the control below.
  it('a function export before a memory export stays first', () => {
    const wat = `(module
      (func $f (export "alpha"))
      (memory $m (export "beta") 1))`;
    assertEquals(exportOrder(assertSameBytes(wat)), ['alpha', 'beta']);
  });

  it('memory before function — the order that always worked', () => {
    const wat = `(module
      (memory $m (export "alpha") 1)
      (func $f (export "beta")))`;
    assertEquals(exportOrder(assertSameBytes(wat)), ['alpha', 'beta']);
  });

  // Every declaration kind that carries an inline export, interleaved so that
  // any kind registering in the wrong phase shows up as a displaced name.
  it('functions, memories, tables and globals interleave correctly', () => {
    const wat = `(module
      (func $f1 (export "one"))
      (memory $m (export "two") 1)
      (func $f2 (export "three"))
      (table $t (export "four") 1 funcref)
      (global $g (export "five") i32 (i32.const 0))
      (func $f3 (export "six")))`;
    assertEquals(
      exportOrder(assertSameBytes(wat)),
      ['one', 'two', 'three', 'four', 'five', 'six'],
    );
  });

  it('an IMPORTED function with an inline export keeps its place', () => {
    // `(func $id (import …) (export …))` returns before body building, so its
    // export took yet another path. It must land in source order too.
    const wat = `(module
      (func $i (export "first") (import "env" "f"))
      (memory $m (export "second") 1))`;
    assertEquals(exportOrder(assertSameBytes(wat)), ['first', 'second']);
  });

  it('a standalone (export …) is unaffected', () => {
    const wat = `(module
      (func $f)
      (memory $m 1)
      (export "mem" (memory $m))
      (export "fn" (func $f)))`;
    assertEquals(exportOrder(assertSameBytes(wat)), ['mem', 'fn']);
  });

  it('inline and standalone exports interleave in source order', () => {
    const wat = `(module
      (func $f (export "inline-fn"))
      (memory $m 1)
      (export "standalone-mem" (memory $m)))`;
    assertEquals(exportOrder(assertSameBytes(wat)), ['inline-fn', 'standalone-mem']);
  });

  it('several exports on one declaration keep their own order', () => {
    const wat = '(module (func $f (export "a") (export "b")) (memory $m (export "c") 1))';
    assertEquals(exportOrder(assertSameBytes(wat)), ['a', 'b', 'c']);
  });
});
