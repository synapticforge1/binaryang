// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// W14 (cmem/divergences.md): `function` is a SECTION name — the spelling a
// custom section's placement uses, `(@custom "c" (after function) …)`. It is
// not a spelling of `func`. 🔧 The parser took it for one as a module field,
// an import descriptor and an export kind: `(module (function $f))` assembled,
// where upstream `wat2wasm` and `wasm-tools` both refuse all three. Found in
// One front end stage 5 (2026-09-28): binaryen-ts's retired WAT parser
// refused `(export "x" (function $f))`, and its test, moved to the one text
// route, found this parser accepting it.

import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

Deno.test('`function` is refused wherever `func` names a function', () => {
  for (
    const wat of [
      '(module (function $f))',
      '(module (import "a" "b" (function)))',
      '(module (func $f) (export "x" (function $f)))',
    ]
  ) {
    assert(hasErrors(wat2wasm(wat).errors), `${wat} assembled`);
  }
});

Deno.test('`func` still is, and `function` still places a custom section', () => {
  for (
    const wat of [
      '(module (func $f) (export "x" (func $f)))',
      '(module (import "a" "b" (func)))',
      '(module (func) (@custom "c" (after function) ""))',
    ]
  ) {
    const r = wat2wasm(wat);
    assertEquals(hasErrors(r.errors), false, `${wat}: ${formatErrors(r.errors)}`);
  }
});
