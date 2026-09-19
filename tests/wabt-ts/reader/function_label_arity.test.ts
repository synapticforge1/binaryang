// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A branch to the FUNCTION label carries the function's results (post-M8 fix
// 10, divergence W9 (b)).
//
// wabt-ts's binary reader keeps a root frame for the function body whose block
// type is void, and read a branch target's arity from it — so a `br`, `br_if`,
// `br_table` or `br_on_null` to the outermost label carried nothing, and its
// values stayed siblings: folded `wasm2wat` printed `(i32.const 9) (br 0)`
// where upstream prints `(br 0 (i32.const 9))`. The bytes were right.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import type { Expr, Module } from '../../../src/wabt-ts/ir/ir.ts';

const WAT = `(module
  (func (export "br") (result i32)
    i32.const 9
    br 0)
  (func (export "br_if") (param i32) (result i32)
    i32.const 9
    local.get 0
    br_if 0
    drop
    i32.const 2)
  (func (export "br_table") (param i32) (result i32)
    i32.const 9
    local.get 0
    br_table 0 0)
  (func (export "br_on_null") (param i32 externref) (result i32)
    local.get 0
    local.get 1
    br_on_null 0
    drop))`;

const bytes = (): Uint8Array => {
  const b = wat2wasm(WAT).binary;
  assert(b !== undefined && WebAssembly.validate(b as BufferSource), 'valid');
  return b;
};

function read(): Module {
  const errors = makeErrorList();
  const m = readBinaryIr(bytes(), errors);
  assert(!hasErrors(errors));
  return m;
}

/** The first node of `kind` in function `f`, anywhere in its body. */
// deno-lint-ignore no-explicit-any
function first(m: Module, f: number, kind: string): any {
  // deno-lint-ignore no-explicit-any
  let found: any;
  const walk = (v: unknown): void => {
    if (found !== undefined || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if ((v as Expr).kind === kind) found = v;
    else for (const [k, x] of Object.entries(v)) if (k !== 'loc') walk(x);
  };
  walk(m.functions[f]!.body);
  assert(found, `a ${kind} in function ${f}`);
  return found;
}

const kinds = (es: Expr[]) => es.map((e) => e.kind);

describe('a branch to the function label carries the function’s results', () => {
  it('br holds its value', () => {
    const m = read();
    assertEquals(kinds(first(m, 0, 'br').values), ['const']);
    assertEquals(m.functions[0]!.body.children.length, 1, 'no sibling left');
  });

  it('br_if holds its value, and is the drop’s operand', () => {
    const drop = first(read(), 1, 'drop');
    assertEquals(drop.value.kind, 'br');
    assertEquals(kinds(drop.value.values), ['const']);
  });

  it('br_table holds its value', () => {
    assertEquals(kinds(first(read(), 2, 'br_table').values), ['const']);
  });

  it('br_on_null holds its value', () => {
    assertEquals(kinds(first(read(), 3, 'br_on').values), ['local.get']);
  });

  it('folded wasm2wat nests them, as upstream prints them', () => {
    // The fixture is written linearly; this is about FOLDING, so the S7
    // record (written linearly → written back linearly) is set aside.
    const text = wasm2wat(bytes(), { asWritten: false }).text;
    assert(/\(br 0 \(;@0;\)\s+\(i32\.const 9\)\)/.test(text), text);
    assert(/\(drop\s+\(br_if 0 \(;@0;\)\s+\(i32\.const 9\)/.test(text), text);
  });

  it('both text forms re-assemble to the same bytes, and they run', () => {
    const b = bytes();
    // As written, every byte comes back; each FORCED form gives the same code
    // (naming a form rewrites S7's text-form record, and only that).
    const code = (wat: string) => wat2wasm(wat, { textForm: false }).binary;
    assertEquals(wat2wasm(wasm2wat(b).text).binary, b, 'as written');
    for (const fold of [true, false]) {
      assertEquals(code(wasm2wat(b, { fold }).text), code(wasm2wat(b).text), `fold: ${fold}`);
    }
    const x = new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource))
      .exports as Record<string, (...a: unknown[]) => number>;
    assertEquals(
      [
        x.br!(),
        x.br_if!(0),
        x.br_if!(1),
        x.br_table!(0),
        x.br_on_null!(5, null),
        x.br_on_null!(5, {}),
      ],
      [9, 2, 9, 9, 5, 5],
    );
  });
});
