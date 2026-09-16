// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5's ratchet: how far wabt-ts's `Expr` and binaryen-ts's `Expression`
// still are from being ONE type, kind by kind — checked by the compiler.
//
// Every kind both unions declare is pinned to one of three states:
//
//   'identical' — the same field names, and every field the same type
//   'types'     — the same field names, but at least one field's type differs
//   'names'     — a field exists on one side and not the other
//
// "The same type" treats `Expr` and `Expression` as equal (that difference is
// the one step 5 removes) and ignores the node BASE (`kind`, `loc`, `nodeId`,
// `type`), whose differences are one decision for all kinds, not one per kind.
//
// ⚠️ **This is a compile-time test, and the pin table is the assertion.** The
// table is assigned to the COMPUTED state of every kind, so a wrong pin fails
// `deno task check` in either direction: a kind that converged and was not
// re-pinned, and a kind that diverged again. A kind missing from the table, or
// one that no longer exists, fails too. Progress has to be recorded to land,
// and regress cannot land silently.
//
// Measured when written (2026-09-15, `3a9462423`): 35 identical, 14 types,
// 23 names. cmem's earlier "the (a) renames dissolve by definition when the
// types unify" was wrong about the NAMES — only the element type dissolves;
// `unary.operand` and `unary.value` still have to become one field.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import type { Expr } from '../../src/wabt-ts/ir/ir.ts';
import type { Expression } from '../../src/binaryen-ts/ir/expressions.ts';

type Base = 'kind' | 'loc' | 'nodeId' | 'type';
type W<K> = Extract<Expr, { kind: K }>;
type B<K> = Extract<Expression, { kind: K }>;

/** Kinds with a node on BOTH sides (a declared-only enum value has none). */
type Shared = {
  [K in Expr['kind']]: [B<K>] extends [never] ? never : K;
}[Expr['kind']];

/** `Expr` and `Expression` are the difference being removed, so they compare equal. */
type Norm<T> = T extends Expression ? 'EXPR'
  : T extends Expr ? 'EXPR'
  : T extends ReadonlyArray<infer U> ? Norm<U>[]
  : T;

type Same<A, C> = [A] extends [C] ? ([C] extends [A] ? true : false) : false;

type FieldsOf<T> = Exclude<keyof T, Base>;

type NamesAgree<K> = Same<FieldsOf<W<K>>, FieldsOf<B<K>>>;

type TypesAgree<K> = false extends {
  [F in FieldsOf<W<K>> & FieldsOf<B<K>>]: Same<
    Norm<W<K>[F & keyof W<K>]>,
    Norm<B<K>[F & keyof B<K>]>
  >;
}[FieldsOf<W<K>> & FieldsOf<B<K>>] ? false
  : true;

type State<K> = NamesAgree<K> extends true ? (TypesAgree<K> extends true ? 'identical' : 'types')
  : 'names';

type Computed = { [K in Shared]: State<K> };

/**
 * THE RATCHET. Re-pin a kind when step 5 converges it; never widen one back.
 * The goal state is every row `'identical'`, at which point the base is the
 * only difference left and the two types can be aliased.
 */
const PINNED: Computed = {
  'array.copy': 'identical',
  'array.fill': 'identical',
  'array.get': 'identical',
  'array.init_data': 'identical',
  'array.init_elem': 'identical',
  'array.len': 'identical',
  'array.new': 'identical',
  'array.new_data': 'identical',
  'array.new_elem': 'identical',
  'array.new_fixed': 'identical',
  'array.set': 'identical',
  'binary': 'identical',
  'block': 'types',
  'br': 'identical',
  'br_on': 'identical',
  'br_table': 'identical',
  'call': 'identical',
  'call_indirect': 'names',
  'const': 'identical',
  'data.drop': 'identical',
  'drop': 'identical',
  'elem.drop': 'identical',
  'global.get': 'identical',
  'global.set': 'identical',
  'i31.get': 'identical',
  'if': 'types',
  'load': 'identical',
  'local.get': 'identical',
  'local.set': 'identical',
  'local.tee': 'identical',
  'loop': 'types',
  'memory.copy': 'identical',
  'memory.fill': 'identical',
  'memory.grow': 'identical',
  'memory.init': 'identical',
  'memory.size': 'identical',
  'nop': 'identical',
  'pop': 'identical',
  'quaternary': 'identical',
  'ref.as': 'identical',
  'ref.cast': 'identical',
  'ref.eq': 'identical',
  'ref.func': 'identical',
  'ref.i31': 'identical',
  'ref.is_null': 'identical',
  'ref.null': 'names',
  'ref.test': 'identical',
  'rethrow': 'identical',
  'return': 'identical',
  'select': 'types',
  'simd.extract': 'identical',
  'simd.load': 'identical',
  'simd.load_store_lane': 'identical',
  'simd.replace': 'identical',
  'simd.shuffle': 'identical',
  'simd.ternary': 'identical',
  'store': 'identical',
  'struct.get': 'identical',
  'struct.new': 'identical',
  'struct.set': 'identical',
  'table.copy': 'identical',
  'table.fill': 'identical',
  'table.get': 'identical',
  'table.grow': 'identical',
  'table.init': 'identical',
  'table.set': 'identical',
  'table.size': 'identical',
  'throw': 'identical',
  'throw_ref': 'identical',
  'try': 'types',
  'try_table': 'types',
  'unary': 'identical',
  'unreachable': 'identical',
};

describe('S6 step 5 — Expr / Expression convergence ratchet', () => {
  it('is enforced at compile time; this records the counts', () => {
    const counts = { identical: 0, types: 0, names: 0 };
    for (const s of Object.values(PINNED)) counts[s]++;
    // The type check above is the real assertion. This one keeps the numbers in
    // front of a reader of the test output.
    assert(counts.identical + counts.types + counts.names === Object.keys(PINNED).length);
  });
});
