// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The WAT parser silently DROPPED inline exports on memory, table and tag, and
// threw on global. `(memory (export "m") 1)` is shorthand for `(memory 1)` plus
// `(export "m" (memory 0))`; only `collectFunc` implemented it.
//
// The two failure modes came from what each collector fed the unexpected node:
//   - memory/table/tag -> `atomInt`, which returns null, so the limits took
//     their defaults and the export vanished WITH NO DIAGNOSTIC;
//   - global -> `parseValType`, which threw `unknown value type`.
//
// Measured over 149 corpus modules before the fix: 345 exports through wabt-ts,
// 196 through this parser. 43% lost, `memory` in every sampled case, 148 of 149
// modules affected. After: 345 / 345.
//
// ⚠️ The defect presented as a size WIN. binaryen-ts output measured 1.24%
// smaller, which reads as better encoding; it was emitting less. Every module
// still validated, because a module that fails to export its memory is valid
// and merely useless to its host. **A byte-count comparison cannot see this.**
// The export COUNT is what separated them, which is why these tests assert on
// the export set and not on size.
//
// Inline export is the idiomatic form and is what our own `wasm2wat` emits
// (`inlineExport` defaults to true), so this compounded the wasm-opt round trip
// rather than sitting beside it.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

/** Export set of a binary, as `name:kind`, sorted — the property that matters. */
function exportsOf(bytes: Uint8Array): string[] {
  const m = new WebAssembly.Module(bytes as BufferSource);
  return WebAssembly.Module.exports(m).map((e) => `${e.name}:${e.kind}`).sort();
}

/** Import set, as `module.name:kind`, sorted. */
function importsOf(bytes: Uint8Array): string[] {
  const m = new WebAssembly.Module(bytes as BufferSource);
  return WebAssembly.Module.imports(m).map((i) => `${i.module}.${i.name}:${i.kind}`).sort();
}

/**
 * wabt-ts is the oracle: it has always handled the abbreviation, and it is the
 * other half of this repository. Asserting against it rather than a hard-coded
 * list means a future change to either parser that makes them disagree fails
 * here, which is the actual invariant.
 */
function assertAgrees(wat: string) {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  const got = encodeWasm(parseWat(wat));
  assertEquals(exportsOf(got), exportsOf(ref.binary), 'export sets must agree');
  assertEquals(importsOf(got), importsOf(ref.binary), 'import sets must agree');
}

const FN = '(func $fn (result i32) (i32.const 1))';

describe('WAT parser — inline exports on every declaration kind', () => {
  it('func (the one that always worked — guards the template)', () => {
    assertAgrees('(module (func (export "x") (result i32) (i32.const 1)))');
  });

  it('memory — was silently dropped', () => {
    assertAgrees(`(module (memory (export "x") 1) ${FN})`);
  });

  it('table — was silently dropped', () => {
    assertAgrees(`(module (table (export "x") 1 funcref) ${FN})`);
  });

  it('tag — was silently dropped', () => {
    assertAgrees(`(module (tag (export "x")) ${FN})`);
  });

  it('global — used to throw "unknown value type"', () => {
    assertAgrees(`(module (global (export "x") i32 (i32.const 1)) ${FN})`);
  });

  // The abbreviation permits any number of inline exports, and they must not
  // disturb the operands that follow — which is exactly what went wrong, since
  // the limits were read from whatever node sat at the un-advanced index.
  it('several inline exports on one declaration', () => {
    assertAgrees(`(module (memory (export "a") (export "b") (export "c") 1) ${FN})`);
  });

  it('an inline export does not swallow the limits that follow it', () => {
    const wat = `(module (memory (export "x") 2 7) ${FN})`;
    assertAgrees(wat);
    // Assert the limits SURVIVED, not merely that an export appeared: reading
    // them from the wrong index is how the export was lost in the first place,
    // and a defaulted `(memory 1)` would still export and still validate.
    const bin = encodeWasm(parseWat(wat));
    const ref = wat2wasm(wat, { filename: 'ref.wat' }).binary;
    assertEquals(bin.length, ref.length, 'limits must match the reference encoding');
  });

  it('a named declaration keeps its name AND its export', () => {
    assertAgrees(`(module (memory $m (export "x") 1) ${FN})`);
    assertAgrees(`(module (global $g (export "x") i32 (i32.const 1)) ${FN})`);
  });

  it('the separate (export ...) form still works', () => {
    assertAgrees(`(module (memory 1) (export "x" (memory 0)) ${FN})`);
  });

  it('a declaration with no inline export exports nothing', () => {
    assertEquals(exportsOf(encodeWasm(parseWat(`(module (memory 1) ${FN})`))), []);
  });

  // ---------------------------------------------------------------------------
  // Inline IMPORTS — the same abbreviation family, and the worse half.
  //
  // `(memory (import "m" "b") 1)` makes the item an IMPORT rather than a
  // definition. Before the fix, memory/table/func were dropped silently and
  // global threw. A dropped import is worse than a dropped export: it removes an
  // entry from the index space, so every later index shifts by one and a valid
  // module can end up referencing the wrong thing.
  // ---------------------------------------------------------------------------

  it('memory inline import', () => {
    assertAgrees(`(module (memory (import "m" "a") 1) ${FN})`);
  });

  it('table inline import', () => {
    assertAgrees(`(module (table (import "m" "a") 1 funcref) ${FN})`);
  });

  it('global inline import, immutable and mutable', () => {
    assertAgrees(`(module (global (import "m" "a") i32) ${FN})`);
    assertAgrees(`(module (global (import "m" "a") (mut i32)) ${FN})`);
  });

  it('func inline import, with and without a signature', () => {
    assertAgrees(`(module (func (import "m" "a")) ${FN})`);
    assertAgrees(`(module (func $i (import "m" "a") (param i32) (result i32)) ${FN})`);
  });

  it('inline import and inline export on the same declaration', () => {
    assertAgrees(`(module (memory (export "e") (import "m" "a") 1) ${FN})`);
    assertAgrees(`(module (func $i (export "e") (import "m" "a") (param i32)) ${FN})`);
  });

  it('a declaration WITHOUT an inline import is still a definition', () => {
    const wat = `(module (memory (export "e") 1) ${FN})`;
    assertEquals(importsOf(encodeWasm(parseWat(wat))), []);
    assertAgrees(wat);
  });

  // The consequence that makes a dropped import worse than a dropped export.
  // If the import were lost, `$two` would move from index 1 to index 0 and
  // `call $two` would still be a VALID module -- calling the wrong function.
  // So this asserts the computed VALUE, not the module's shape.
  it('an inline import does not shift call targets', () => {
    const wat = `(module
      (func $imp (import "m" "a") (result i32))
      (func $two (result i32) (i32.const 2))
      (func (export "f") (result i32) (call $two)))`;
    const call = (bytes: Uint8Array) => {
      const inst = new WebAssembly.Instance(
        new WebAssembly.Module(bytes as BufferSource),
        { m: { a: () => 99 } },
      );
      return (inst.exports.f as () => number)();
    };
    assertEquals(call(encodeWasm(parseWat(wat))), 2);
    assertEquals(call(wat2wasm(wat, { filename: 'ref.wat' }).binary), 2);
  });
});
