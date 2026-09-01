// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `(export "f" (func 19))` — a NUMERIC entity reference — failed to encode.
//
// `resolveRef` looked every reference up as a name and threw on a miss. But in
// WAT an identifier always begins with `$`, so a bare integer can only be a
// direct index into the entity space. `(export "f" (func 19))` is as legal as
// `(export "f" (func $g))`, and both wabt and the spec testsuite emit the
// numeric form freely — as does our own `wasm2wat`.
//
// Measured before the fix: re-parsing our own disassembly failed on 310 of 421
// corpus modules, while the PARSER had already accepted them. The gap was in the
// encoder, which is why it survived the inline-export fix that looked adjacent —
// that one was about exports being DROPPED at parse time, this one is about a
// parsed export failing to RESOLVE.
//
// ⚠️ This must not weaken the fail-loud rule `resolveRef` exists for. The
// dangling references that rule guards against are NAMED — a pass dropped `$g`
// and left a reference behind — and a `map.get(name) ?? 0` fallback would encode
// index 0, producing a valid-but-wrong binary. A named miss must still throw.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';

/** Export set as `name:kind`, sorted. */
function exportsOf(wat: string): string[] {
  const m = new WebAssembly.Module(encodeWasm(parseWat(wat)) as BufferSource);
  return WebAssembly.Module.exports(m).map((e) => `${e.name}:${e.kind}`).sort();
}

const FN = '(func $f (result i32) (i32.const 1))';

describe('encoder — numeric entity references resolve as indices', () => {
  it('a function exported by index', () => {
    assertEquals(exportsOf(`(module ${FN} (export "e" (func 0)))`), ['e:function']);
  });

  it('a global exported by index', () => {
    assertEquals(
      exportsOf(`(module (global i32 (i32.const 1)) ${FN} (export "g" (global 0)))`),
      ['g:global'],
    );
  });

  it('a memory exported by index', () => {
    assertEquals(exportsOf(`(module (memory 1) ${FN} (export "m" (memory 0)))`), ['m:memory']);
  });

  it('the named form still works', () => {
    assertEquals(exportsOf(`(module ${FN} (export "e" (func $f)))`), ['e:function']);
  });

  it('both forms in one module select DIFFERENT functions', () => {
    // Index 1 is `$g`, not `$f` — so a numeric reference that silently resolved
    // to 0 would still produce a valid module exporting the wrong function.
    // Asserting the returned VALUE is what separates those.
    const wat = `(module
      (func $f (result i32) (i32.const 11))
      (func $g (result i32) (i32.const 22))
      (export "byName" (func $f))
      (export "byIndex" (func 1)))`;
    const inst = new WebAssembly.Instance(
      new WebAssembly.Module(encodeWasm(parseWat(wat)) as BufferSource),
    );
    assertEquals((inst.exports.byName as () => number)(), 11);
    assertEquals((inst.exports.byIndex as () => number)(), 22, 'index 1 must be $g, not $f');
  });

  // The guarantee the numeric path must not erode.
  it('a dangling NAMED reference still throws', () => {
    assertThrows(
      () => encodeWasm(parseWat(`(module ${FN} (export "e" (func $nope)))`)),
      Error,
      'unresolved',
    );
  });
});
