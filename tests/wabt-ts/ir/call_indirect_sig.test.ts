// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8a3 (cmem/ir-convergence.md, item 6 M8): a `call_indirect` that NAMES its
// type carries that type's signature in `sig`. The text parser left `sig` as the
// (empty) inline signature, so a REQUIRED field said `() -> ()` for a call whose
// type said otherwise — 222 corpus nodes. wabt-ts's own readers use `typeVar`
// and never noticed; binaryen-ts reads `sig`, and the bridge was filling it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { Type } from '../../../src/wabt-ts/core/types.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import type { CallIndirectExpr, Module } from '../../../src/wabt-ts/ir/ir.ts';

function prepared(wat: string): Module {
  const { module, errors } = parseWatModule(new LexerSource(wat, '<m8a3>'));
  assert(!hasErrors(errors), formatErrors(errors));
  const errs = makeErrorList();
  resolveNames(module, errs);
  synthesizeTypes(module);
  return module;
}

const callOf = (m: Module) => m.functions[0]!.body.children[0] as CallIndirectExpr;

const NAMED = `(module
  (type $t (func (param i32) (result i32)))
  (table 1 funcref)
  (func (result i32) (call_indirect (type $t) (i32.const 7) (i32.const 0))))`;

describe('M8a3 — a call_indirect that names its type carries its signature', () => {
  it("`sig` is the named type's, not the empty inline one", () => {
    assertEquals(callOf(prepared(NAMED)).sig, { params: [Type.I32], results: [Type.I32] });
  });

  it('the text still says only `(type $t)` — nothing invented', () => {
    const r = wat2wasm(NAMED);
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    const text = wasm2wat(r.binary).text;
    assert(/call_indirect[^\n]*\(type /.test(text), text);
    assert(!/call_indirect[^\n]*\(param/.test(text), text);
  });

  it('a reference to a type that does not exist is left for the validator', () => {
    const m = prepared(`(module
      (table 1 funcref)
      (func (call_indirect (type 9) (i32.const 0))))`);
    assertEquals(callOf(m).sig, { params: [], results: [] });
  });
});
