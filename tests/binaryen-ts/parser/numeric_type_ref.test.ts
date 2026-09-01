// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `(call_indirect (type 0) …)` — a NUMERIC type reference — was rejected with
// `call_indirect: unknown type 0`.
//
// `funcTypeDefs` is keyed by `$name`, and only a NAMED declaration is recorded
// there at all, so a numeric reference never matched. But `(type 0)` is as legal
// as `(type $sig)`, and it is what our own `wasm2wat` emits — an anonymous type
// declaration has no name to print. `heapTypeDefs` is the index-keyed map and
// holds every declaration, named or not.
//
// Same shape as the numeric ENTITY reference fixed in the encoder's
// `resolveRef`: a WAT identifier always begins with `$`, so a bare integer can
// only be an index. That one surfaced first and this was underneath it — 39 of
// 421 corpus modules.
//
// Asserts the resolved SIGNATURE rather than executing, deliberately: a
// call_indirect fixture needs a table and an element segment, and those carry
// their own unrelated gaps. The signature is the property this fix is about.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWat, WatParseError } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import type { CallIndirectExpr, Expression } from '../../../src/binaryen-ts/ir/expressions.ts';

/** The first `call_indirect` in the last function of a parsed module. */
function findCallIndirect(wat: string): CallIndirectExpr {
  const m = parseWat(wat);
  const fn = m.functions[m.functions.length - 1]!;
  let found: CallIndirectExpr | undefined;
  const walk = (e: Expression | undefined) => {
    if (!e || found) return;
    if (e.kind === ExpressionKind.CallIndirect) {
      found = e as CallIndirectExpr;
      return;
    }
    for (const v of Object.values(e as unknown as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach((x) => walk(x as Expression));
      else if (v && typeof v === 'object' && 'kind' in v) walk(v as Expression);
    }
  };
  walk(fn.body);
  if (!found) throw new Error('no call_indirect in the fixture');
  return found;
}

const HEAD = '(module (type $t (func (param i32 i64) (result f32))) (table $tbl 1 funcref) ' +
  '(func (export "f") ';
const TAIL = '))';

describe('WAT parser — numeric type references', () => {
  it('a NAMED type ref resolves its signature', () => {
    const e = findCallIndirect(
      `${HEAD}(call_indirect $tbl (type $t) (i32.const 1) (i64.const 2) (i32.const 0))${TAIL}`,
    );
    assertEquals(e.params.length, 2, 'two params from the referenced type');
    assertEquals(e.results.length, 1);
  });

  it('a NUMERIC type ref resolves the SAME signature', () => {
    const e = findCallIndirect(
      `${HEAD}(call_indirect $tbl (type 0) (i32.const 1) (i64.const 2) (i32.const 0))${TAIL}`,
    );
    assertEquals(e.params.length, 2, 'index 0 is $t, which has two params');
    assertEquals(e.results.length, 1);
  });

  it('an ANONYMOUS type declaration is reachable only by index', () => {
    const e = findCallIndirect(
      '(module (type (func (param i32 i64) (result f32))) (table $tbl 1 funcref) ' +
        '(func (export "f") (call_indirect $tbl (type 0) (i32.const 1) (i64.const 2) (i32.const 0))))',
    );
    assertEquals(e.params.length, 2);
  });

  // The fail-loud path must survive: an index naming nothing is still an error,
  // because falling through to the empty inline signature would give the
  // indirect call zero args — a wrong-arity miscompile, which is why the
  // diagnostic exists.
  it('an out-of-range index still fails loudly', () => {
    assertThrows(
      () => findCallIndirect(`${HEAD}(call_indirect $tbl (type 9) (i32.const 0))${TAIL}`),
      WatParseError,
      'unknown type',
    );
  });

  // An index that names a struct is not a function signature, and must not be
  // silently accepted as one.
  it('an index naming a non-func type still fails loudly', () => {
    assertThrows(
      () =>
        findCallIndirect(
          '(module (type (struct (field i32))) (table $tbl 1 funcref) ' +
            '(func (export "f") (call_indirect $tbl (type 0) (i32.const 0))))',
        ),
      WatParseError,
      'unknown type',
    );
  });
});
