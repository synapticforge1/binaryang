// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T10.1 / T10.2 — the inline `(export "n")` abbreviation was applied
// unconditionally, and it is not always faithful.
//
// Two distinct failures, one root:
//
//   T10.1  Inlining moves each export to the item it names, so re-parsing
//          rebuilds the export SECTION grouped per item. `a, b, ac` came back
//          as `a, ac, b`. Still valid wasm, different module — export order is
//          observable through `WebAssembly.Module.exports()`.
//   T10.2  The abbreviation has no place in the import grammar, but the writer
//          emitted it there anyway:
//              (import "M" "f" (func $f0 (export "n") (result i32)))
//          Our own parser rejects our own output — the whole "reparse FAILS"
//          group of the round-trip metric.
//
// The writer now tests both conditions up front and falls back to standalone
// `(export "n" (func $f))` fields, in the module's own order, when either
// fails. All-or-nothing: standalone exports are written after every item, so
// inlining only SOME of them re-orders the section again.
//
// Round-trip fidelity: spec testsuite 1961 -> 2041 / 2120 byte-identical
// (12 hard failures -> 1); wasmtk WASI corpus 1 -> 50 / 270, which is the
// whole export group — 100% of that corpus's differences were T10.1.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toWat(binary: Uint8Array): string {
  const { text, errors } = wasm2wat(binary);
  if (hasErrors(errors)) throw new Error('wasm2wat:\n' + formatErrors(errors));
  assert(text);
  return text;
}

/** Export names in section order, as an engine reports them. */
function exportNames(binary: Uint8Array): string[] {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.Module.exports(new WebAssembly.Module(buf)).map((e) => e.name);
}

/** binary -> wasm2wat -> wat2wasm. */
function roundTrip(binary: Uint8Array): Uint8Array {
  return compile(toWat(binary));
}

describe('T10.1 — export order survives a wasm2wat round-trip', () => {
  it('keeps interleaved exports of two funcs in section order', () => {
    // Inlining would group these as a, ac, b — the shape the metric saw.
    const first = compile(`(module
      (func $a (result i32) (i32.const 1))
      (func $b (result i32) (i32.const 2))
      (export "a" (func $a))
      (export "b" (func $b))
      (export "ac" (func $a)))`);

    assertEquals(exportNames(first), ['a', 'b', 'ac']);
    assertEquals(exportNames(roundTrip(first)), ['a', 'b', 'ac']);
    assertEquals(roundTrip(first), first);
  });

  it('keeps order across kinds, which the writer does not emit in index order', () => {
    // writeModule emits funcs, tables, memories, globals, tags — so an export
    // list that runs global-then-func is out of emission order even though
    // every item is exported exactly once.
    const first = compile(`(module
      (memory 1)
      (global $g i32 (i32.const 7))
      (func $f)
      (export "g" (global $g))
      (export "f" (func $f))
      (export "m" (memory 0)))`);

    assertEquals(exportNames(first), ['g', 'f', 'm']);
    assertEquals(exportNames(roundTrip(first)), ['g', 'f', 'm']);
    assertEquals(roundTrip(first), first);
  });

  it('still inlines when inlining is faithful', () => {
    // The fallback must be driven by the order test, not applied blindly —
    // otherwise every module loses the abbreviation.
    const wat = toWat(compile(`(module
      (func $a (result i32) (i32.const 1))
      (func $b (result i32) (i32.const 2))
      (export "a" (func $a))
      (export "b" (func $b)))`));

    assert(/\(func [^\n]*\(export "a"\)/.test(wat), wat);
    assert(!/^\s*\(export "a"/m.test(wat), wat);
  });

  it('falls back to standalone fields when it is not', () => {
    const wat = toWat(compile(`(module
      (func $a (result i32) (i32.const 1))
      (func $b (result i32) (i32.const 2))
      (export "a" (func $a))
      (export "b" (func $b))
      (export "ac" (func $a)))`));

    assert(/^\s*\(export "a" \(func/m.test(wat), wat);
    assert(/^\s*\(export "ac" \(func/m.test(wat), wat);
    assert(!/\(func [^\n]*\(export /.test(wat), wat);
  });
});

describe('T10.2 — an inline export is never emitted on an import', () => {
  it('re-parses a module whose imported func is exported', () => {
    const first = compile(`(module
      (import "M" "f" (func $f (result i32)))
      (func $g (result i32) (call $f))
      (export "Mf.call" (func $f))
      (export "g" (func $g)))`);

    const wat = toWat(first);
    // The abbreviation is illegal inside (import …); emitting it there made
    // our own parser reject this with `expected ), got (`.
    assert(!/\(import [^\n]*\(export /.test(wat), wat);
    assertEquals(exportNames(roundTrip(first)), ['Mf.call', 'g']);
    assertEquals(roundTrip(first), first);
  });

  it('re-parses imported globals, memories and tables that are exported', () => {
    // Each kind failed differently — `expected value type, got (` on globals,
    // `expected limit initial value` on memories and tables.
    const first = compile(`(module
      (import "M" "g" (global $g i32))
      (import "M" "m" (memory $m 1))
      (import "M" "t" (table $t 1 funcref))
      (export "g" (global $g))
      (export "m" (memory $m))
      (export "t" (table $t)))`);

    const wat = toWat(first);
    assert(!/\(import [^\n]*\(export /.test(wat), wat);
    assertEquals(exportNames(roundTrip(first)), ['g', 'm', 't']);
    assertEquals(roundTrip(first), first);
  });
});
