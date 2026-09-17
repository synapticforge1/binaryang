// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5 item 6 (M2): a constant expression is a `RegionExpr`, and an absent
// one is a MISSING field (owner, 2026-09-16).
//
// Measured first: every constant expression in a valid module reads as one tree,
// but 32 spec binaries hold one that is not a single constant instruction —
// empty, two instructions, a `nop` — and wabt-ts round-trips all 32. A region
// holds that sequence exactly. What `Expr[]` could NOT hold is the difference
// between "no expression" and "an empty one": `[]` meant both, so a table with a
// PRESENT-but-empty initializer was written back without one.

import { assert, assertEquals, assertThrows } from '@std/assert';

import { ExternalKind } from '../../../src/wabt-ts/core/binary.ts';
import { formatErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import type { Module } from '../../../src/wabt-ts/ir/ir.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function read(sections: number[]): { m: Module; bytes: Uint8Array } {
  const bytes = new Uint8Array([...HEADER, ...sections]);
  const m = readBinaryIr(bytes, makeErrorList(), {});
  return { m, bytes };
}

function roundTrips(bytes: Uint8Array, m: Module): void {
  assertEquals(writeBinaryIr(m, { writeDebugNames: false }), bytes);
}

Deno.test('a table with a present-but-EMPTY initializer keeps it (it was written without one)', () => {
  // table section: 1 table, 0x40 0x00 (init form), funcref, limits {min 1}, `end`
  const { m, bytes } = read([0x04, 0x07, 0x01, 0x40, 0x00, 0x70, 0x00, 0x01, 0x0b]);
  const init = m.tables[0]!.init;
  assert(init !== undefined, 'present');
  assertEquals(init.children, []);
  roundTrips(bytes, m);
});

Deno.test('a table without an initializer has NO init field', () => {
  const { m, bytes } = read([0x04, 0x04, 0x01, 0x70, 0x00, 0x01]);
  assertEquals('init' in m.tables[0]!, false);
  roundTrips(bytes, m);
});

Deno.test('an active offset holds exactly what was read — two instructions stay two', () => {
  // memory 1; data: active, offset `i32.const 0 i32.const 0 end` (invalid: two values), 0 bytes
  const { m, bytes } = read([
    0x05,
    0x03,
    0x01,
    0x00,
    0x01,
    0x0b,
    0x08,
    0x01,
    0x00,
    0x41,
    0x00,
    0x41,
    0x00,
    0x0b,
    0x00,
  ]);
  assertEquals(m.dataSegments[0]!.offset?.children.map((e) => e.kind), ['const', 'const']);
  roundTrips(bytes, m);
});

Deno.test('a passive segment and an imported global carry no expression at all', () => {
  const { module: m } = parseWatModule(
    '(module (import "e" "g" (global i32)) (memory 1) (table 1 funcref) (func $f)' +
      ' (data "x") (elem funcref (ref.func $f)) (global i32 (i32.const 7)))',
  );
  assertEquals('offset' in m.dataSegments[0]!, false);
  assertEquals('offset' in m.elements[0]!, false);
  const imported = m.imports[0]!;
  assert(imported.kind === ExternalKind.Global);
  assertEquals('init' in imported.global, false);
  assertEquals(m.globals[0]!.init?.children.map((e) => e.kind), ['const']);
  assertEquals(m.elements[0]!.elemExprs.map((r) => r.kind), ['region']);
});

Deno.test('the writer refuses an ACTIVE segment with no offset rather than inventing one', () => {
  const { m } = read([
    0x05,
    0x03,
    0x01,
    0x00,
    0x01,
    0x0b,
    0x07,
    0x01,
    0x00,
    0x41,
    0x00,
    0x0b,
    0x01,
    0x78,
  ]);
  const seg = m.dataSegments[0]!;
  const { offset: _, ...withoutOffset } = seg;
  m.dataSegments[0] = withoutOffset;
  assertThrows(
    () => writeBinaryIr(m, {}),
    Error,
    'an active data segment offset has no constant expression',
  );
});

Deno.test('the validator sees an EMPTY initializer as one — a non-null table is not "missing" it', () => {
  // (table 1 (ref func)) with the init form and nothing in it: invalid for the
  // EXPRESSION (no value), not for lacking an initializer, which it has.
  const { m } = read([0x04, 0x08, 0x01, 0x40, 0x00, 0x64, 0x70, 0x00, 0x01, 0x0b]);
  const errors = makeErrorList();
  validateModule(m, errors, { features: allFeatures() });
  assertEquals(errors.length, 1, formatErrors(errors));
  assert(errors[0]!.message.includes('expected 1 elements on the stack'), errors[0]!.message);
});

Deno.test('a passive segment read from BINARY has no offset field', () => {
  // memory 1, table 1 funcref, a function; data: passive "x"; elem: passive funcref (ref.func 0)
  const { m, bytes } = read([
    0x01,
    0x04,
    0x01,
    0x60,
    0x00,
    0x00,
    0x03,
    0x02,
    0x01,
    0x00,
    0x04,
    0x04,
    0x01,
    0x70,
    0x00,
    0x01,
    0x05,
    0x03,
    0x01,
    0x00,
    0x01,
    0x09,
    0x07,
    0x01,
    0x05,
    0x70,
    0x01,
    0xd2,
    0x00,
    0x0b,
    0x0a,
    0x04,
    0x01,
    0x02,
    0x00,
    0x0b,
    0x0b,
    0x04,
    0x01,
    0x01,
    0x01,
    0x78,
  ]);
  assertEquals('offset' in m.elements[0]!, false);
  assertEquals('offset' in m.dataSegments[0]!, false);
  roundTrips(bytes, m);
});
