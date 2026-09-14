// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A control construct TYPED unreachable is not stack-polymorphic after its `end`.
//
// wasm validates a `block` / `if` / `loop` / `try` / `try_table` against its
// DECLARED type: after `end` the stack holds exactly its results, even when every
// path inside throws or traps. The IR may still type such a construct
// `unreachable` (an `if` inferred from two unreachable arms, a block ending in
// `unreachable`), and a pass reading that type is entitled to treat what follows
// as dead. Two holes let the two views disagree (found 2026-09-14, when -Oz on
// the legacy EH spec files failed 30 of 70 assertions — all of one module):
//
//   1. the DECODER typed a void `if` whose arms both end unreachable as
//      `unreachable` rather than as written. DCE then deleted the `i32.const 2`
//      after it, and the enclosing `try (result i32)` was left short a value:
//      "expected 1 elements on the stack for fallthru, found 0";
//   2. the ENCODER wrote a construct typed unreachable as a plain `end`, so a tree
//      a PASS built that way was invalid wherever a value had to follow — StripEH
//      on `(block (result i32) (throw $e (local.get 0)))` wrote the inner
//      `block drop unreachable end` and nothing after it.
//
// Upstream binaryen's writer emits an extra `unreachable` after every construct
// typed unreachable (`wasm-stack.h`, `visitBlock` / `visitIf` / `visitLoop` /
// `visitTry` / `visitTryTable`); ours now does too. A DECODED construct carries
// its declared type, so a plain decode → encode still writes no extra byte.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  return r.binary;
}

function runPass(bytes: Uint8Array, pass: string): Uint8Array {
  const mod = parseWasm(bytes);
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).add(pass).run();
  return encodeWasm(mod);
}

function call(bytes: Uint8Array, x: number): number | string {
  const f = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    x: number,
  ) => number;
  try {
    return f(x);
  } catch (e) {
    return e instanceof WebAssembly.RuntimeError ? 'trap' : 'exception';
  }
}

// The spec's `try_catch.wast` shape, reduced: both arms throw, and the value the
// try's type needs is written after the `if`.
const LEGACY_TRY = `(module (tag $a) (tag $b)
  (func (export "f") (param i32) (result i32)
    (try (result i32)
      (do (if (local.get 0) (then (throw $a)) (else (throw $b))) (i32.const 2))
      (catch $a (i32.const 3))
      (catch $b (i32.const 4)))))`;

// The same hole with no exception handling at all.
const PLAIN_BLOCK = `(module
  (func (export "f") (param i32) (result i32)
    (block (result i32)
      (if (local.get 0) (then (unreachable)) (else (unreachable)))
      (i32.const 2))))`;

Deno.test('DCE: a void if whose arms both throw keeps what its try needs after it', () => {
  const out = runPass(assemble(LEGACY_TRY), 'DCE');
  assertEquals([call(out, 1), call(out, 0)], [3, 4]);
});

Deno.test('DCE: the same, with no EH — a void if whose arms both trap', () => {
  const out = runPass(assemble(PLAIN_BLOCK), 'DCE');
  assertEquals([call(out, 1), call(out, 0)], ['trap', 'trap']);
});

Deno.test('decode → encode: a void if with unreachable arms writes no extra byte', () => {
  for (const wat of [LEGACY_TRY, PLAIN_BLOCK]) {
    const bytes = assemble(wat);
    assertEquals(encodeWasm(parseWasm(bytes)), bytes);
  }
});

Deno.test('encoder: a construct a pass typed unreachable is followed by unreachable', () => {
  // StripEH turns the throw into `block (drop …) (unreachable)` — typed
  // unreachable, and the last instruction of a `block (result i32)`. (At a
  // function's top level the region flattens it, so it must be nested.)
  const out = runPass(
    assemble(`(module (tag $e (param i32))
      (func (export "f") (param i32) (result i32)
        (block (result i32) (throw $e (local.get 0)))))`),
    'StripEH',
  );
  assertEquals(call(out, 5), 'trap');
});
