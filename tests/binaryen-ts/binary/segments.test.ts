// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5 item 6 (M3): binaryen-ts's segments are wabt-ts's records — a data
// segment's `kind` / `memoryVar`, an element segment's `kind` / `tableVar` /
// `elemType` / `elemExprs`.
//
// 🔧 What the old records could not hold, they lost or refused:
// - element entries were function NAMES, so a `ref.null` entry was refused (and,
//   before that, dropped — shifting every later table index);
// - the segment's element type was discarded, so a `(ref func)` or `externref`
//   segment came back as `funcref`: a table of `(ref func)` does not accept a
//   `funcref` segment, so an invalid module came back looking valid, and back;
// - an entry could not be a `global.get` or any other constant expression.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm, WasmEncodeError } from '../../../src/binaryen-ts/encoder/index.ts';
import { elemFuncNames, ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { makeI32Const } from '../../../src/binaryen-ts/ir/expressions.ts';
import { varIndex } from '../../../src/wabt-ts/ir/ir.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
const roundTrip = (b: Uint8Array) => encodeWasm(parseWasm(b));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

describe('M3 — an element segment keeps what the binary said', () => {
  const cases: [string, string][] = [
    [
      'a non-null `(ref func)` segment keeps the funcidx form',
      `(module
      (func $f) (table 1 (ref func) (ref.func $f))
      (elem (table 0) (i32.const 0) (ref func) (ref.func $f)))`,
    ],
    [
      'an externref segment keeps its element type',
      `(module
      (table 1 externref)
      (elem (table 0) (i32.const 0) externref (ref.null extern)))`,
    ],
    [
      'a funcref segment keeps its NULLABLE type',
      `(module
      (func $f) (table 1 funcref)
      (elem (table 0) (i32.const 0) funcref (ref.func $f)))`,
    ],
    [
      'a passive segment of expressions',
      `(module
      (func $f) (elem funcref (ref.func $f) (ref.null func)))`,
    ],
    ['a declared segment', '(module (func $f) (elem declare func $f))'],
    [
      'an entry that is a global.get',
      `(module
      (import "m" "g" (global $g funcref))
      (table 1 funcref) (elem (table 0) (i32.const 0) funcref (global.get $g)))`,
    ],
  ];
  for (const [label, wat] of cases) {
    it(label, () => {
      const bytes = assemble(wat);
      assertEquals(hex(roundTrip(bytes)), hex(bytes));
    });
  }

  it('a ref.null entry is held, and names no function', () => {
    const mod = parseWasm(
      assemble('(module (func $f) (elem funcref (ref.func $f) (ref.null func)))'),
    );
    const seg = mod.elements[0]!;
    assertEquals(seg.kind, 'passive');
    assertEquals(seg.elemExprs.map((e) => e.children.map((c) => c.kind)), [
      ['ref.func'],
      ['ref.null'],
    ]);
    // A pass asking what the table can reach sees the one function, not two.
    assertEquals(elemFuncNames(seg), ['$f']);
  });

  it('the funcidx form types the segment as the NON-NULL `(ref func)`', () => {
    // The distinction the spec draws between `(elem … $f)` and
    // `(elem … funcref (ref.func $f))`: conflating them makes an invalid module
    // (a funcref segment against a `(ref func)` table) come back looking valid.
    const funcIdx = parseWasm(
      assemble('(module (func $f) (table 1 funcref) (elem (i32.const 0) $f))'),
    );
    assertEquals(funcIdx.elements[0]!.elemType, {
      heapType: { kind: 'abstract', name: 'func' },
      nullable: false,
    });
    const exprs = parseWasm(
      assemble(
        '(module (func $f) (table 1 funcref) (elem (table 0) (i32.const 0) funcref (ref.func $f)))',
      ),
    );
    assertEquals(exprs.elements[0]!.elemType, 0x70); // ValType.FuncRef, the nullable abstract type
  });
});

describe('M3 — a data segment says how it reaches its memory', () => {
  it('active and passive round-trip, and say which they are', () => {
    const active = parseWasm(assemble('(module (memory 1) (data (i32.const 0) "hi"))'));
    assertEquals(active.dataSegments[0]!.kind, 'active');
    assertEquals(active.dataSegments[0]!.memoryVar, varIndex(0));
    const passive = parseWasm(assemble('(module (memory 1) (data "hi"))'));
    assertEquals(passive.dataSegments[0]!.kind, 'passive');
  });

  it('a data segment can only be active or passive', () => {
    const mod = new ModuleBuilder()
      .addMemory('$m', 1)
      .addDataSegment('$d', makeI32Const(0), new Uint8Array([1]))
      .build();
    mod.dataSegments[0]!.kind = 'declared';
    assertThrows(() => encodeWasm(mod), WasmEncodeError, 'never declared');
  });
});

describe('M3 — sections a module did not have are not invented', () => {
  it('a module whose only table is IMPORTED gets no (empty) table section', () => {
    // The encoder wrote one whenever a table was reachable, imported or not
    // (elem.107): an empty section the input never had.
    const bytes = assemble('(module (import "m" "t" (table 1 funcref)))');
    assertEquals(hex(roundTrip(bytes)), hex(bytes));
  });
});
