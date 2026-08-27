// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression: reference values were unparseable in wast script positions.
//
// `assert_return` results and `invoke` arguments both accept reference forms
// alongside `(X.const N)`. Almost none of them were implemented:
//
//   * `(ref.any)` / `(ref.eq)` / `(ref.i31)` / `(ref.struct)` / `(ref.array)`
//     — bare "a reference whose heap type is a subtype of H" result patterns.
//     `ref.any` / `ref.struct` / `ref.array` had no lexer keyword at all.
//   * `(ref.extern)` / `(ref.extern N)` — declared in the `ExpectedConst`
//     union all along, but `parseExpectedConst` never produced it.
//   * `(ref.host)` / `(ref.host N)` — the internalized counterpart of
//     `ref.extern`; no token, no keyword, no parse.
//   * ANY reference value as an `invoke` argument — `parseConstExprArg`
//     accepted only `(X.const N)` and rejected the rest with "expected const
//     instr", so `(invoke "init" (ref.extern 0))` failed.
//
// Also fixed here: the `noexn` heap type / `nullexnref` value type were
// missing from `Type` entirely (12 uses in the spec testsuite).
//
// Measured against the 257-file WebAssembly spec testsuite: 107 → 120 files
// parse clean with these fixes plus the ref.null and elem ones, no
// regressions.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { expectedRefHeapType, parseWastScript } from '../../src/parser/wast-parser.ts';
import type { ExpectedConst } from '../../src/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';
import { Type } from '../../src/core/types.ts';

const MODULE = '(module (func (export "f")))';

function parse(body: string) {
  const { script, errors } = parseWastScript(`${MODULE}\n${body}`);
  if (hasErrors(errors)) throw new Error('parseWastScript:\n' + formatErrors(errors));
  return script;
}

/** The single expected value of the script's one assert_return. */
function expected(body: string): ExpectedConst {
  const cmd = parse(body).commands.find((c) => c.kind === 'assert_return');
  assert(cmd && cmd.kind === 'assert_return');
  assertEquals(cmd.expected.length, 1);
  const e = cmd.expected[0];
  assert(e);
  return e;
}

/** The arguments of the script's one assert_return invoke action. */
function args(body: string): readonly ExpectedConst[] {
  const cmd = parse(body).commands.find((c) => c.kind === 'assert_return');
  assert(cmd && cmd.kind === 'assert_return');
  assert(cmd.action.kind === 'invoke');
  return cmd.action.args;
}

describe('wast results — bare abstract-reference patterns', () => {
  const cases: ReadonlyArray<readonly [string, ExpectedConst['kind'], Type]> = [
    ['ref.func', 'ref.func', Type.FuncRef],
    ['ref.any', 'ref.any', Type.AnyRef],
    ['ref.eq', 'ref.eq', Type.EqRef],
    ['ref.i31', 'ref.i31', Type.I31Ref],
    ['ref.struct', 'ref.struct', Type.StructRef],
    ['ref.array', 'ref.array', Type.ArrayRef],
  ];
  for (const [form, kind, heapType] of cases) {
    it(`(${form}) parses and maps to its heap type`, () => {
      const e = expected(`(assert_return (invoke "f") (${form}))`);
      assertEquals(e.kind, kind);
      // The six patterns all mean the same thing, so a runner can handle them
      // uniformly instead of switching on six near-identical kinds.
      assertEquals(expectedRefHeapType(e), heapType);
    });
  }

  it('expectedRefHeapType returns null for non-reference patterns', () => {
    assertEquals(expectedRefHeapType(expected('(assert_return (invoke "f") (i32.const 1))')), null);
    // ref.null matches on NULLNESS, not on a heap type — read refType instead.
    assertEquals(expectedRefHeapType(expected('(assert_return (invoke "f") (ref.null))')), null);
  });
});

describe('wast results — host references', () => {
  it('(ref.extern N) carries its value', () => {
    const e = expected('(assert_return (invoke "f") (ref.extern 1))');
    assert(e.kind === 'ref.extern');
    assertEquals(e.value, 1);
    assertEquals(expectedRefHeapType(e), Type.ExternRef);
  });

  it('bare (ref.extern) omits the value rather than defaulting to 0', () => {
    const e = expected('(assert_return (invoke "f") (ref.extern))');
    assert(e.kind === 'ref.extern');
    // Omitted, not 0 — `(ref.extern)` matches ANY external reference, and
    // 0 is itself a legal host value the script could have named.
    assertEquals(e.value, undefined);
  });

  it('(ref.host N) carries its value and lives in the any hierarchy', () => {
    const e = expected('(assert_return (invoke "f") (ref.host 2))');
    assert(e.kind === 'ref.host');
    assertEquals(e.value, 2);
    assertEquals(expectedRefHeapType(e), Type.AnyRef);
  });

  it('bare (ref.host) omits the value', () => {
    const e = expected('(assert_return (invoke "f") (ref.host))');
    assert(e.kind === 'ref.host');
    assertEquals(e.value, undefined);
  });

  it('rejects a non-numeric host reference index', () => {
    const { errors } = parseWastScript(
      `${MODULE}\n(assert_return (invoke "f") (ref.extern $nope))`,
    );
    assert(hasErrors(errors), 'expected `(ref.extern $nope)` to be rejected');
  });
});

describe('wast invoke arguments — reference values', () => {
  it('accepts every reference form as an argument', () => {
    const a = args(
      `(assert_return
         (invoke "f" (ref.extern 0) (ref.null extern) (i32.const 7) (ref.func) (ref.host 3))
         (i32.const 0))`,
    );
    assertEquals(a.map((x) => x.kind), [
      'ref.extern',
      'ref.null',
      'value',
      'ref.func',
      'ref.host',
    ]);
    const externArg = a[0];
    assert(externArg && externArg.kind === 'ref.extern');
    assertEquals(externArg.value, 0);
    const nullArg = a[1];
    assert(nullArg && nullArg.kind === 'ref.null');
    assertEquals(nullArg.refType, Type.ExternRef);
  });

  it('still accepts a plain numeric argument', () => {
    const a = args('(assert_return (invoke "f" (i32.const 42)) (i32.const 42))');
    assertEquals(a.length, 1);
    const only = a[0];
    assert(only && only.kind === 'value');
    assertEquals(only.value.type, Type.I32);
  });

  it('reports an error for a non-value argument', () => {
    const { errors } = parseWastScript(`${MODULE}\n(assert_return (invoke "f" (nonsense)) )`);
    assert(hasErrors(errors), 'expected a non-value invoke argument to be rejected');
  });
});
