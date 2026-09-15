// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `call_indirect (type $t)` — the signature lives at the TYPE, and the bridge
// has to go and get it.
//
// wabt-ts leaves `CallIndirectExpr.sig` empty when the call names a type
// (`typeVar` + `typeUse: 'resolved'`); its own validator looks the signature up
// at the use site, and its binary writer writes the type reference as written.
// The bridge read `sig` alone, so it built a `call_indirect` with NO parameters:
// the encoder then chose the empty type, the operands the call should have
// consumed stayed on the stack, and V8 refused the module — "expected 0
// elements on the stack for fallthru, found 1".
//
// That is every one of the 20 corpus modules the bridge gate could not
// round-trip (measured 2026-09-15: 20 of 20 failing modules carry such a node),
// and it is C10a, the diagnosis S6 step 5's acceptance rests on.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';
import { parseWasm } from '../../src/binaryen-ts/binary/index.ts';
import { ExpressionKind } from '../../src/binaryen-ts/ir/expressions.ts';
import { walkExpression } from '../../src/binaryen-ts/ir/walk.ts';

/** Parse → resolve → bridge → encode. */
function bridged(wat: string): Uint8Array {
  const { module, errors } = parseWatModule(new LexerSource(wat, '<ci>'));
  assert(!hasErrors(errors), formatErrors(errors));
  const errs = makeErrorList();
  resolveNames(module, errs);
  assert(!hasErrors(errs), formatErrors(errs));
  return encodeWasm(bridgeToBinaryen(module));
}

/**
 * The signature the module's one `call_indirect` calls through, as the bridge
 * built it, plus how many operands it carries.
 *
 * ⚠️ These modules are COMPILED, not run: the bridge drops element segments
 * (open-work.md), so a table call would trap on an empty table. Validity is
 * what the bridge gate measures, and what this defect broke.
 */
function theCall(bytes: Uint8Array): { params: number; results: number; operands: number } {
  new WebAssembly.Module(bytes as BufferSource); // V8 accepts it
  const found: { params: number; results: number; operands: number }[] = [];
  for (const fn of parseWasm(bytes).functions) {
    walkExpression(fn.body, (e) => {
      if (e.kind === ExpressionKind.CallIndirect) {
        found.push({
          params: e.sig.params.length,
          results: e.sig.results.length,
          operands: e.operands.length,
        });
      }
    });
  }
  assertEquals(found.length, 1, 'exactly one call_indirect');
  return found[0]!;
}

const BY_TYPE_REF = `(module
  (type $unary (func (param i32) (result i32)))
  (table 2 funcref)
  (func $double (type $unary) (i32.mul (local.get 0) (i32.const 2)))
  (func $negate (type $unary) (i32.sub (i32.const 0) (local.get 0)))
  (elem (i32.const 0) $double $negate)
  (func (export "f") (param i32) (result i32)
    (call_indirect (type $unary) (i32.const 21) (local.get 0))))`;

describe('bridge — call_indirect naming a type', () => {
  it('resolves the signature from the type section', () => {
    // Before the fix: params 0 against 1 operand, and V8 refused the module.
    assertEquals(theCall(bridged(BY_TYPE_REF)), { params: 1, results: 1, operands: 1 });
  });

  // The inline form fills `sig` at parse, and must keep working: the lookup is
  // a fallback, not a replacement.
  it('still honours an inline signature', () => {
    assertEquals(
      theCall(bridged(`(module
        (table 1 funcref)
        (func $half (param i32) (result i32) (i32.div_s (local.get 0) (i32.const 2)))
        (func (export "f") (param i32) (result i32)
          (call_indirect (param i32) (result i32) (local.get 0) (i32.const 0))))`)),
      { params: 1, results: 1, operands: 1 },
    );
  });

  // A type reference whose signature really is empty stays empty — the lookup
  // must not invent parameters where the type declares none.
  it('leaves a genuinely empty signature alone', () => {
    assertEquals(
      theCall(bridged(`(module
        (type $void (func))
        (table 1 funcref)
        (func $bump (type $void) (nop))
        (func (export "f") (param i32) (result i32)
          (call_indirect (type $void) (local.get 0))
          (i32.const 7)))`)),
      { params: 0, results: 0, operands: 0 },
    );
  });

  it('refuses a type reference that names a struct, rather than calling with no arguments', () => {
    const wat = `(module
      (type $s (struct (field i32)))
      (table 1 funcref)
      (func (export "f") (param i32) (result i32)
        (call_indirect (type $s) (local.get 0))
        (i32.const 7)))`;
    let threw = '';
    try {
      bridged(wat);
    } catch (e) {
      threw = (e as Error).message;
    }
    assert(/not a func|is a struct/.test(threw), `expected a refusal, got: ${threw || 'no throw'}`);
  });
});
