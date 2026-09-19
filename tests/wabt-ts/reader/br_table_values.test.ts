// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A `br_table` holds the values it carries (post-M8 fix 9, divergence W9 (a)).
//
// Both front ends took the index alone. The binary reader left the carried
// values as preceding statements, so folded `wasm2wat` printed
// `(i32.const 7) (br_table 0 0 (local.get 0))` where upstream nests the value:
// `(br_table 0 0 (i32.const 7) (local.get 0))`. The WAT parser's linear form did
// the same. Every target carries the same number of values (validation), so the
// DEFAULT target's arity is the table's. Bytes were right either way.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import type { BrTableExpr, Expr, Module } from '../../../src/wabt-ts/ir/ir.ts';

const LINEAR = `(module
  (type $p (func (param i32) (result i32)))
  (func (export "val") (param i32) (result i32)
    block (result i32)
      i32.const 7
      local.get 0
      br_table 0 0
    end)
  (func (export "void") (param i32) (result i32)
    block
      local.get 0
      br_table 0 0
    end
    i32.const 2)
  (func (export "pair") (param i32) (result i32)
    block (result i32 i32)
      i32.const 1
      i32.const 2
      local.get 0
      br_table 0 0
    end
    i32.add)
  (func (export "param") (param i32) (result i32)
    i32.const 4
    block (type $p)
      local.get 0
      br_table 0 0
    end))`;

/** Every br_table in function `f`, in document order. */
function brTables(m: Module, f: number): BrTableExpr[] {
  const out: BrTableExpr[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if ((v as Expr).kind === 'br_table') out.push(v as BrTableExpr);
    for (const [k, x] of Object.entries(v)) if (k !== 'loc') walk(x);
  };
  walk(m.functions[f]!.body);
  return out;
}

function fromBinary(): Module {
  const bytes = wat2wasm(LINEAR).binary;
  assert(bytes !== undefined && WebAssembly.validate(bytes as BufferSource));
  const errors = makeErrorList();
  const m = readBinaryIr(bytes, errors);
  assert(!hasErrors(errors));
  return m;
}

function fromText(): Module {
  const p = parseWatModule(LINEAR);
  assert(p.module);
  return p.module;
}

const valueKinds = (m: Module, f: number) => brTables(m, f).map((b) => b.values.map((v) => v.kind));

describe('a br_table holds the values it carries', () => {
  it('the binary reader: one value, none, two — only what the region holds', () => {
    const m = fromBinary();
    assertEquals(valueKinds(m, 0), [['const']]);
    assertEquals(valueKinds(m, 1), [[]]);
    assertEquals(valueKinds(m, 2), [['const', 'const']]);
    assertEquals(valueKinds(m, 3), [[]], 'the block parameter is outside the region');
  });

  it('the WAT parser, linear: the same, with a block parameter held as a pop', () => {
    const m = fromText();
    assertEquals(valueKinds(m, 0), [['const']]);
    assertEquals(valueKinds(m, 1), [[]]);
    assertEquals(valueKinds(m, 2), [['const', 'const']]);
    assertEquals(valueKinds(m, 3), [['pop']]);
  });

  it('the WAT parser, folded: a block parameter it finds no child for is a pop too', () => {
    // Linear text pads while popping; the folded form takes only its children.
    const p = parseWatModule(`(module (type $p (func (param i32) (result i32)))
      (func (param i32) (result i32)
        (i32.const 4)
        (block (type $p) (br_table 0 0 (local.get 0)))))`);
    assert(p.module);
    assertEquals(valueKinds(p.module, 0), [['pop']]);
  });

  it('folded wasm2wat nests the value, as upstream prints it', () => {
    // The fixture is written linearly; this is about FOLDING, so the S7
    // record (written linearly → written back linearly) is set aside.
    const text = wasm2wat(wat2wasm(LINEAR).binary!, { asWritten: false }).text;
    assert(
      /\(br_table 0 \(;@1;\) 0 \(;@1;\)\s+\(i32\.const 7\) \(local\.get 0\)\)/.test(text),
      text,
    );
  });

  it('both text forms re-assemble to the same bytes, and they run', () => {
    const bytes = wat2wasm(LINEAR).binary!;
    for (const fold of [true, false]) {
      assertEquals(wat2wasm(wasm2wat(bytes, { fold }).text).binary, bytes, `fold: ${fold}`);
    }
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports as Record<string, (i: number) => number>;
    assertEquals([x.val!(0), x.void!(0), x.pair!(0), x.param!(0)], [7, 2, 3, 4]);
  });
});
