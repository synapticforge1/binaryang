// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// N1 step P1 (cmem/names.md): param and local NAMES survive the text path.
//
// wabt-ts's tree had nowhere to keep them. The parser resolved `$arg` to a slot
// through its scope and discarded the name, so the WAT writer — even given the
// module straight from the parser — wrote `(param i32)` and `local.get 0`.
// 24,694 param and local names in the corpus sources, none of them written
// back. `Func.localNames` keeps them; the writer prints them the way upstream
// wasm2wat does: a named param or local on its own, consecutive unnamed params
// as one group, references by name.
//
// Through BYTES they are still lost until the name section is written and read
// (steps P2 and P3). This pins the text half.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { writeWatModule } from '../../../src/wabt-ts/writer/wat-writer.ts';
import type { Module } from '../../../src/wabt-ts/ir/ir.ts';

/** The text pipeline the wabt.js-compatible `parseWat` runs: parse, resolve, synthesize types. */
function parse(wat: string): Module {
  const { module, errors } = parseWatModule(new LexerSource(wat, '<local-names>'));
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  const re = makeErrorList();
  resolveNames(module, re);
  if (hasErrors(re)) throw new Error(formatErrors(re));
  synthesizeTypes(module);
  return module;
}

const WAT = `(module
  (import "env" "log" (func $log (param $message i32)))
  (func $f (param $a i32) (param i32) (param $c i64) (result i32)
    (local $x i32) (local i32) (local $y f32)
    (local.set $x (local.get $a))
    (local.tee $x (local.get 1))))`;

describe('param and local names through the WAT writer', () => {
  const out = writeWatModule(parse(WAT));

  it('a named param on its own; an unnamed one in a group of its own', () => {
    assert(out.includes('(param $a i32) (param i32) (param $c i64)'), out);
  });

  it('named locals carry their names; an unnamed one stays unnamed', () => {
    assert(out.includes('(local $x i32) (local i32) (local $y f32)'), out);
  });

  it('local references print by name where there is one, by index where not', () => {
    for (const s of ['local.set $x', 'local.get $a', 'local.tee $x', 'local.get 1']) {
      assert(out.includes(s), `missing "${s}" in:\n${out}`);
    }
  });

  it("an imported function's param names too", () => {
    assert(out.includes('(param $message i32)'), out);
  });

  it('the written text reads back to the same names', () => {
    const again = parse(out);
    const f = again.funcs[0]!;
    assertEquals([...(f.localNames ?? [])].sort(), [[0, '$a'], [2, '$c'], [3, '$x'], [5, '$y']]);
  });

  it('with no names at all, params stay ONE group — the form this always wrote', () => {
    const plain = writeWatModule(parse('(module (func (param i32 i64) (param f32) (local i32)))'));
    assert(plain.includes('(param i32 i64 f32)'), plain);
    assert(plain.includes('(local i32)'), plain);
  });
});
