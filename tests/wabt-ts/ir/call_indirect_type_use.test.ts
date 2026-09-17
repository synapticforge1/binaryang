// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, item 4 (a): `call_indirect`'s type is `typeVar?: Var` in both IRs
// (owner, 2026-09-16). binaryen-ts's `typeIndex?: number` became a `Var`;
// wabt-ts's `typeVar` became OPTIONAL and lost its duplicate `typeUse`.
//
// 🔧 wabt-ts's `typeVar` was required and defaulted to `varIndex(0)`, so index 0
// meant both "the source wrote no `(type …)`" and "the source wrote `(type 0)`",
// and a node-level `typeUse` said which — a copy of the fidelity table's entry.
// Now an INLINE signature simply has no `typeVar` until `synthesizeTypes` (or the
// parser's implicit-type pass) interns one; the table keeps how it was written.
// A node that reaches a writer or the validator without one is refused, never
// guessed: deriving it structurally picks the first of several identical types
// (T1).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import type { CallIndirectExpr, Module } from '../../../src/wabt-ts/ir/ir.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { writeWatModule } from '../../../src/wabt-ts/writer/wat-writer.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

function firstCallIndirect(m: Module): CallIndirectExpr {
  const stack: unknown[] = [m.functions.map((f) => f.body.children)];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if ((v as { kind?: unknown }).kind === 'call_indirect') return v as CallIndirectExpr;
    stack.push(...Object.values(v));
  }
  throw new Error('no call_indirect');
}

/** A decoded module whose one call_indirect has had its `typeVar` removed. */
function withoutTypeVar(): Module {
  const r = wat2wasm(
    '(module (table 1 funcref) (func (result i32) (call_indirect (result i32) (i32.const 0))))',
  );
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const errors = makeErrorList();
  const m = readBinaryIr(r.binary!, errors);
  assert(!hasErrors(errors), formatErrors(errors));
  const ci = firstCallIndirect(m) as { typeVar?: unknown };
  delete ci.typeVar;
  return m;
}

describe('an inline signature has no type until one is interned', () => {
  const INLINE = '(module (table 1 funcref)' +
    ' (func (result i32) (call_indirect (param i32) (result i32) (i32.const 5) (i32.const 0))))';

  it('the parser leaves `typeVar` absent for an inline signature — then interns it', () => {
    // parseWatModule runs the implicit-type pass, so the index IS assigned by
    // the time it returns: after, not a placeholder 0 before.
    const { module, errors } = parseWatModule(INLINE);
    assert(!hasErrors(errors), formatErrors(errors));
    const ci = firstCallIndirect(module);
    assertEquals(ci.typeVar, { kind: 'index', value: 1 });
    assertEquals(module.fidelity.get(ci.nodeId)?.typeUse, 'inline');
    assert(!('typeUse' in ci), 'how it was written lives in the table, not on the node');
  });

  it('and `(type $t)` records `resolved`, keeping the NAME until resolution', () => {
    const { module, errors } = parseWatModule(
      '(module (type $t (func (result i32))) (table 1 funcref)' +
        ' (func (result i32) (call_indirect (type $t) (i32.const 0))))',
    );
    assert(!hasErrors(errors), formatErrors(errors));
    const ci = firstCallIndirect(module);
    assertEquals(ci.typeVar, { kind: 'name', name: '$t' });
    assertEquals(module.fidelity.get(ci.nodeId)?.typeUse, 'resolved');
    resolveNames(module, errors);
    assertEquals(firstCallIndirect(module).typeVar, { kind: 'index', value: 0 });
  });
});

describe('a call_indirect with no type is refused, not guessed', () => {
  it('the binary writer throws', () => {
    assertThrows(() => writeBinaryIr(withoutTypeVar()), Error, 'no type index');
  });

  it('the validator reports it', () => {
    const errors = makeErrorList();
    validateModule(withoutTypeVar(), errors, { features: allFeatures() });
    assert(formatErrors(errors).includes('call_indirect: no type index'), formatErrors(errors));
  });

  it('the text writer prints the inline signature, which assembles back', () => {
    const text = writeWatModule(withoutTypeVar());
    assert(/call_indirect \(result i32\)/.test(text), text);
    const r = wat2wasm(text);
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    assert(WebAssembly.validate(new Uint8Array(r.binary!)));
  });
});
