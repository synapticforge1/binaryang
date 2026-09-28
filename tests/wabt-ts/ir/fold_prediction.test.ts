// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S7's prediction — the canonical forms of the wabt-ts reader's tree — must BE
// what the fold writer prints, or a function whose source form equalled the
// prediction is left unrecorded and printed differently (`text-form.ts`, the
// module doc). They disagreed on 6 of 26,896 corpus functions (2026-09-28):
// a fold around an operand the writer SPREADS — scattered `pop`s from a
// multi-value producer, written as its operands' items and then a bare head,
// all inside the enclosing parens — was predicted as one item.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { formNodes, writtenForms } from '../../../src/wabt-ts/ir/text-form.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';

/** Each function whose fold-written forms are not the prediction, as `name: at`. */
function disagreements(wat: string): string[] {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const errors = makeErrorList();
  const tree = readBinaryIr(r.binary, errors, {});
  assert(!hasErrors(errors), formatErrors(errors));
  const printed = parseWatModule(new LexerSource(wasm2wat(r.binary).text, 'folded')).module;
  const out: string[] = [];
  tree.functions.forEach((f, i) => {
    const predicted = formNodes(f.body.children).canonical;
    const g = printed.functions[i]!;
    const wrote = writtenForms(printed, g);
    assert(wrote, `no forms recorded for function ${i}`);
    const at = wrote.findIndex((x, p) => x !== predicted[p]);
    if (at !== -1 || wrote.length !== predicted.length) out.push(`${f.name}: ${at}`);
  });
  return out;
}

describe("S7: the fold writer's grouping IS the prediction", () => {
  it('around an operand spread by a multi-value producer', () => {
    // `$cmp` takes two 2-value results: its operands are [pop, call, pop, call],
    // so it is written `(call $pair …) (call $pair …) (call $cmp)` — three
    // items inside `i32.ne`'s parens, not one.
    assertEquals(
      disagreements(`(module
        (func $pair (param i32) (result i32 i32) (local.get 0) (local.get 0))
        (func $cmp (param i32 i32 i32 i32) (result i32) (local.get 3))
        (func (export "f") (param i32) (result i32)
          (i32.ne (call $cmp (call $pair (local.get 0)) (call $pair (i32.const 1))) (i32.const 0)))
        (func (export "g") (param i32)
          (local.set 0 (call $cmp (call $pair (local.get 0)) (call $pair (i32.const 1))))))`),
      [],
    );
  });

  it('over every corpus module', () => {
    const dir = new URL('../wasmtk/', import.meta.url);
    const bad: string[] = [];
    for (const e of Deno.readDirSync(dir)) {
      if (!e.name.endsWith('.wat')) continue;
      const wat = Deno.readTextFileSync(new URL(e.name, dir));
      if (hasErrors(wat2wasm(wat, { textForm: false }).errors)) continue;
      for (const d of disagreements(wat)) bad.push(`${e.name} ${d}`);
    }
    assertEquals(bad, []);
  });
});
