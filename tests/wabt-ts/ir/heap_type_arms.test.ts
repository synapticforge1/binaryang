// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `HeapTypeRef` has three arms — `abstract` (one of the twelve keywords),
// `index` (a resolved defined type) and `name` (an unresolved `$T`). The
// INVARIANT is that an abstract keyword never appears in the `name` arm.
//
// That was one arm before: the keyword and the `$T` shared `name`, and four
// consumers told them apart by looking the string up in the keyword table.
// Splitting them deleted those lookups — but the old shape is still
// CONSTRUCTIBLE, and the compiler cannot object:
//
//     { kind: 'name', name: 'func' }      // a valid Var, so a valid HeapTypeRef
//
// Six sites built exactly that. `deno task baseline` caught one (a funcidx
// elem segment stopped printing its `func` shorthand); the other five were
// latent, in the two validators, where a keyword in the wrong arm makes
// `sameHeap` compare unequal against a correctly-parsed one and the type
// checker reports a mismatch that is not there.
//
// ⚠️ Neither a type error nor a rename can catch this: adding an arm to a
// union does not invalidate code that builds an EXISTING arm. So the invariant
// is asserted directly, over both front ends — the WAT parser and the binary
// reader — because they are the two places heap types enter the IR.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { heapTypeNameToType } from '../../../src/wabt-ts/core/types.ts';
import { isRefValueType } from '../../../src/wabt-ts/ir/ir.ts';
import type { HeapTypeRef, Module } from '../../../src/wabt-ts/ir/ir.ts';

/**
 * Every heap type reachable in a module, by brute-force structural walk.
 *
 * Deliberately not a typed visitor: the point is to catch a heap type in a
 * field nobody remembered to look at, which is what a hand-written list of
 * fields would miss.
 */
function allHeapTypes(root: unknown): HeapTypeRef[] {
  const out: HeapTypeRef[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const o = v as Record<string, unknown>;
    if (isRefValueType(o as never)) out.push((o as { heapType: HeapTypeRef }).heapType);
    for (const [k, x] of Object.entries(o)) {
      if (k === 'heapType' || k === 'refType') out.push(x as HeapTypeRef);
      walk(x);
    }
  };
  walk(root);
  return out;
}

/** The invariant: a `name` arm is an unresolved `$T`, never a keyword. */
function assertArmsAreHonest(mod: Module, what: string): number {
  const heaps = allHeapTypes(mod);
  for (const h of heaps) {
    if (h === undefined || h === null || typeof h !== 'object') continue;
    if (h.kind !== 'name') continue;
    assertEquals(
      heapTypeNameToType(h.name),
      null,
      `${what}: abstract keyword "${h.name}" is in the NAME arm; build it with heapAbstract()`,
    );
    assert(
      h.name.startsWith('$'),
      `${what}: name-arm heap type "${h.name}" is not a $-prefixed identifier`,
    );
  }
  return heaps.length;
}

/** Modules covering each position a heap type reached in the six defect sites. */
const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ['param value type', '(module (func $f (param (ref null extern))))'],
  ['non-nullable param', '(module (func $f (param (ref i31))))'],
  ['ref.null abstract', '(module (func $f (result funcref) (ref.null func)))'],
  [
    'ref.test / ref.cast',
    '(module (func $f (param anyref) (result i32) (ref.test (ref null i31) (local.get 0))))',
  ],
  [
    'funcidx elem segment',
    '(module (func) (table 1 funcref) (elem (i32.const 0) 0))',
  ],
  ['table element type', '(module (func) (table 1 (ref func) (ref.func 0)))'],
  [
    'defined type stays a $T or an index',
    '(module (type $t (struct (field i32))) (func $f (param (ref null $t))))',
  ],
];

describe('heap-type arms — an abstract keyword is never in the name arm', () => {
  for (const [name, wat] of FIXTURES) {
    it(`${name}: the WAT parser`, () => {
      const { module } = parseWatModule(wat);
      assertArmsAreHonest(module, `parser/${name}`);
    });

    it(`${name}: the binary reader`, () => {
      const r = wat2wasm(wat);
      assert(r.binary, `wat2wasm produced no binary for ${name}`);
      const mod = readBinaryIr(r.binary, makeErrorList(), {});
      assertArmsAreHonest(mod, `reader/${name}`);
    });
  }

  it('the walk actually reaches heap types (guards against a vacuous pass)', () => {
    // A structural walk that silently finds nothing would make every case
    // above pass for the wrong reason — the failure mode this whole file is
    // about.
    const { module } = parseWatModule('(module (func $f (param (ref null extern))))');
    assert(allHeapTypes(module).length > 0, 'found no heap types at all');
  });
});
