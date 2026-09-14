// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A multi-result `if` / `loop` / `try_table` / `try` whose values a LATER
// instruction consumes one at a time.
//
// The binary pushes N values; the IR holds the construct as ONE node. For a
// `block` and a call the decoder seeds N-1 typed `Pop`s beneath the node, so each
// later consumer has a value-typed representative. The other carriers were
// pushed bare, so `(if (result i32 i32) …) (i32.sub)` decoded as
// `i32.sub(unreachable, if)` — the second pop found nothing and took the
// stack-polymorphic `unreachable`. A plain decode → encode then wrote an
// `unreachable` opcode into a module that validated and trapped. Found
// 2026-09-14, when TranslateToExnref's multi-value fixture trapped; the pass was
// not the cause.

import { assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const CASES: Record<string, string> = {
  // The control: this one already worked, so it shows the test can pass.
  block: '(block (result i32 i32) (i32.const 1) (i32.const 2))',
  if:
    '(if (result i32 i32) (local.get 0) (then (i32.const 1) (i32.const 2)) (else (i32.const 5) (i32.const 3)))',
  loop: '(loop (result i32 i32) (i32.const 1) (i32.const 2))',
  try_table: '(try_table (result i32 i32) (i32.const 1) (i32.const 2))',
  try:
    '(try (result i32 i32) (do (i32.const 1) (i32.const 2)) (catch_all (i32.const 0) (i32.const 0)))',
  'try … delegate': '(try (result i32 i32) (do (i32.const 1) (i32.const 2)) (delegate 0))',
};

for (const [name, construct] of Object.entries(CASES)) {
  Deno.test(`multi-result ${name}: its values survive decode → encode`, () => {
    const r = wat2wasm(`(module (tag $e)
      (func (export "f") (param i32) (result i32) ${construct} (i32.sub)))`);
    assertEquals(hasErrors(r.errors), false, formatErrors(r.errors));
    const f = (b: Uint8Array) =>
      new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports.f as (
        x: number,
      ) => number;
    const bytes = encodeWasm(parseWasm(r.binary));
    assertEquals([f(bytes)(1), f(bytes)(0)], [f(r.binary)(1), f(r.binary)(0)]);
    assertEquals(bytes, r.binary);
  });
}
