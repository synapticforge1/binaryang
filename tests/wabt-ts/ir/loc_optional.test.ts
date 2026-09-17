// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, item 5 (1): `loc` is OPTIONAL on every wabt-ts expression node, as
// it is on binaryen-ts's (step 3: absent means "unknown"). Every wabt-ts producer
// still sets it; a consumer that needs a `Location` reads `locOf(e)`.
//
// The property: a module whose nodes carry NO location — the shape a
// binaryen-ts pass or factory builds — validates, resolves, and writes exactly
// as one that does, and a diagnostic about such a node is reported at the
// unknown location rather than crashing or carrying `undefined`.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertNotStrictEquals, assertStrictEquals } from '@std/assert';

import type { Module } from '../../../src/wabt-ts/ir/ir.ts';
import { locOf } from '../../../src/wabt-ts/ir/ir.ts';
import {
  formatErrors,
  hasErrors,
  makeErrorList,
  unknownLocation,
} from '../../../src/wabt-ts/core/error.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { writeWatModule } from '../../../src/wabt-ts/writer/wat-writer.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

/** Every node object under the function bodies that has a string `kind`. */
function nodes(m: Module): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const stack: unknown[] = [m.functions.map((f) => f.body.children)];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.kind === 'string' && o.kind !== 'index' && o.kind !== 'name') out.push(o);
    stack.push(...Object.values(o));
  }
  return out;
}

/** Deletes `loc` from every expression node; returns how many carried one. */
function stripLocs(m: Module): number {
  let n = 0;
  for (const o of nodes(m)) {
    if ('loc' in o) n++;
    delete o.loc;
  }
  return n;
}

const SRC = '(module (table 1 funcref)' +
  ' (func (param i32) (result i32)' +
  '  (block (result i32) (loop (br_if 1 (local.get 0) (local.get 0)) (br 0))' +
  '   (if (result i32) (local.get 0) (then (i32.const 1)) (else' +
  '    (call_indirect (param i32) (result i32) (local.get 0) (i32.const 0)))))))';

function decoded(): { m: Module; binary: Uint8Array } {
  const r = wat2wasm(SRC);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const errors = makeErrorList();
  const m = readBinaryIr(r.binary!, errors);
  assert(!hasErrors(errors), formatErrors(errors));
  return { m, binary: r.binary! };
}

describe('locOf', () => {
  it("returns the node's own location when it has one", () => {
    const loc = { filename: 'a.wat', line: 3, column: 7, offset: 0 };
    assertStrictEquals(locOf({ loc }), loc);
  });

  it('returns the unknown location, frozen, when it has none', () => {
    const a = locOf({});
    assertEquals(a, unknownLocation());
    assert(Object.isFrozen(a), 'the shared fallback cannot be mutated by a caller');
    assertStrictEquals(locOf({}), a);
    assertNotStrictEquals(a, unknownLocation());
  });
});

describe('a module whose nodes carry no location', () => {
  it('validates, and writes the same bytes and text', () => {
    const { m, binary } = decoded();
    const wat = writeWatModule(m);
    const stripped = stripLocs(m);
    assert(stripped >= 10, `the fixture's nodes carried locations (${stripped})`);
    assertEquals(nodes(m).filter((o) => 'loc' in o).length, 0);

    const errors = makeErrorList();
    validateModule(m, errors);
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(writeBinaryIr(m), binary);
    assertEquals(writeWatModule(m), wat);
  });

  it('the validator reports a defect in such a node at the unknown location', () => {
    const { m } = decoded();
    stripLocs(m);
    const get = nodes(m).find((o) => o.kind === 'local.get')!;
    get.var = { kind: 'index', value: 9 };

    const errors = makeErrorList();
    validateModule(m, errors);
    // Follow-on stack errors belong to the FUNCTION, which keeps its location.
    const range = errors.filter((e) => e.message.includes('local variable out of range'));
    assertEquals(range.length, 1, formatErrors(errors));
    assertEquals(range[0]!.loc, unknownLocation(), range[0]!.message);
  });

  it('resolveNames reports an unresolvable name in such a node at the unknown location', () => {
    const { module: m, errors: parseErrors } = parseWatModule(
      '(module (type $s (struct (field $x i32)))' +
        ' (func (param (ref $s)) (result i32) (struct.get $s $x (local.get 0))))',
    );
    assert(!hasErrors(parseErrors), formatErrors(parseErrors));
    stripLocs(m);
    const get = nodes(m).find((o) => o.kind === 'struct.get')!;
    get.fieldVar = { kind: 'name', name: '$nope' };

    const errors = makeErrorList();
    resolveNames(m, errors);
    assertEquals(errors.length, 1, formatErrors(errors));
    assert(errors[0]!.message.includes('$nope'), errors[0]!.message);
    assertEquals(errors[0]!.loc, unknownLocation());
  });
});

describe('a catch clause that carries no location (item 5 (4))', () => {
  // `Catch` / `TableCatch` `loc` is optional too — binaryen-ts's records have
  // none. A defect in such a clause reports at the unknown location.
  it('the validator reports a bad catch tag at the unknown location', () => {
    const r = wat2wasm(
      '(module (tag $e) (func (try (do (nop)) (catch $e (nop)))))',
    );
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    const errors0 = makeErrorList();
    const m = readBinaryIr(r.binary!, errors0);
    assert(!hasErrors(errors0), formatErrors(errors0));
    const tr = nodes(m).find((o) => o.kind === 'try')!;
    const c = (tr.catches as Record<string, unknown>[])[0]!;
    assert('loc' in c, 'the reader gave the clause a location');
    delete c.loc;
    c.tag = { kind: 'index', value: 9 };

    const errors = makeErrorList();
    validateModule(m, errors, { features: allFeatures() });
    assert(hasErrors(errors), 'tag 9 does not exist');
    const bad = errors.filter((e) => /tag/.test(e.message));
    assert(bad.length > 0, formatErrors(errors));
    for (const e of bad) assertEquals(e.loc, unknownLocation(), e.message);
  });
});
