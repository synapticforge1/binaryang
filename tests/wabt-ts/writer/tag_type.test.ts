// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Q9 (cmem/divergences.md): a tag keeps WHICH of several identical function
// types it has. W12: `(import "M" "t" (tag (type $t)))` parses.
//
// 🔧 The tag IR had no `typeVar`, so both writers wrote the FIRST function type
// with the tag's signature: of `(rec (type $t1 (func)) (type $t2 (func)))`, a
// tag of type `$t2` came out as `$t1` — a different type (rec-group members
// are distinct). The parser's implicit-type pass also interned every tag's
// signature, named or not, and the interner reuses only a type that is its own
// rec group — so a named rec-group type gained a spare singleton beside it.
// And the import descriptor read only inline params, refusing the `(type N)`
// form that upstream `wasm2wat` itself prints for every tag.
//
// Oracles: upstream `wat2wasm` 1.0.41 for the non-rec module; `wasm-tools`
// for the rec group, which upstream wabt cannot parse.

import { assert, assertEquals, assertStringIncludes } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { varIndex } from '../../../src/wabt-ts/ir/ir.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm, writeWat } from '../../../src/binaryen-ts/encoder/write-wasm.ts';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/** The module without its custom sections: names and text form are not under test. */
function known(b: Uint8Array): string {
  const out: number[] = [...b.subarray(0, 8)];
  for (let i = 8; i < b.length;) {
    const at = i;
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    i += size;
    if (id !== 0) out.push(...b.subarray(at, i));
  }
  return hex(new Uint8Array(out));
}

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}

/**
 * Two identical types: an imported and a defined tag NAMING the second, an
 * inline tag (the first match), and one naming the first with its params
 * spelled too. The import is the W12 form.
 */
const TWINS = `(module
  (type $a (func (param i32)))
  (type $b (func (param i32)))
  (import "M" "t" (tag $i (type $b)))
  (tag $d (type $b))
  (tag $e (param i32))
  (tag $f (type $a) (param i32)))`;
// upstream wat2wasm: import → 1, $d → 1, $e → 0, $f → 0.
const TWINS_BYTES = '00 61 73 6d 01 00 00 00 01 09 02 60 01 7f 00 60 01 7f 00 02 08 01 01 4d 01 74 ' +
  '04 00 01 0d 07 03 00 01 00 00 00 00';

/**
 * A rec group of two `(func)`: tags naming its SECOND member; a forward
 * reference; and an inline `(tag $e)`, whose type use abbreviates only a type
 * that is its own rec group — so it gets a new singleton, not `$t1`.
 */
const REC = `(module
  (rec (type $t1 (func)) (type $t2 (func)))
  (import "M" "tag" (tag $i (type $t2)))
  (tag $d (type $t2))
  (tag $fwd (type $late))
  (tag $e)
  (type $late (func (param i64)))
  (func (export "f") (param i32)
    local.get 0
    if
      throw $d
    end))`;
// wasm-tools: types t1 t2 late (func) (param i32); import → 1; tags 1 2 3.
const REC_BYTES = '00 61 73 6d 01 00 00 00 01 14 04 4e 02 60 00 00 60 00 00 60 01 7e 00 60 00 00 ' +
  '60 01 7f 00 02 0a 01 01 4d 03 74 61 67 04 00 01 03 02 01 04 0d 07 03 00 01 00 02 00 03 07 05 ' +
  '01 01 66 00 00 0a 0b 01 09 00 20 00 04 40 08 01 0b 0b';

Deno.test('wat2wasm writes the type each tag named, as the oracles do', () => {
  assertEquals(known(assemble(TWINS)), TWINS_BYTES);
  assertEquals(known(assemble(REC)), REC_BYTES);
});

Deno.test('a binary read and written back keeps each tag on its own type', () => {
  for (const want of [TWINS_BYTES, REC_BYTES]) {
    const bytes = new Uint8Array(want.split(' ').map((x) => parseInt(x, 16)));
    const errors = makeErrorList();
    const m = readBinaryIr(bytes, errors);
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(known(writeBinaryIr(m)), want, 'wabt-ts reader → writer');
    assertEquals(known(writeWasm(readForPasses(bytes))), want, 'the one writer');
  }
});

Deno.test('wasm2wat prints a tag\'s (type N), and the text assembles back', () => {
  for (const want of [TWINS_BYTES, REC_BYTES]) {
    const bytes = new Uint8Array(want.split(' ').map((x) => parseInt(x, 16)));
    const text = wasm2wat(bytes).text ?? '';
    assertStringIncludes(text, '(tag (;0;) (type 1)');
    assertEquals(known(assemble(text)), want, 'wasm2wat → wat2wasm');
    assertEquals(known(assemble(writeWat(readForPasses(bytes)))), want, 'writeWat → wat2wasm');
  }
});

Deno.test('W12: an import descriptor names its type', () => {
  for (
    const wat of [
      '(module (type $t (func (param i32))) (import "M" "t" (tag (type $t))))',
      '(module (type $t (func (param i32))) (import "M" "t" (tag $x (type $t))))',
      '(module (type $t (func (param i32))) (import "M" "t" (tag (type 0) (param i32))))',
    ]
  ) {
    assertEquals(
      known(assemble(wat)),
      '00 61 73 6d 01 00 00 00 01 05 01 60 01 7f 00 02 08 01 01 4d 01 74 04 00 00',
      wat,
    );
  }
});

// The parser settles an inline tag's type itself; this is the tag that
// reaches `synthesizeTypes` with none — one the API or a pass built. It is
// interned as an inline one is: beside a rec group of `(func)`, a new
// singleton, never the group's first member.
Deno.test('a tag built with no type interns its signature, as the text does', () => {
  const { module, errors } = parseWatModule('(module (rec (type $t1 (func)) (type $t2 (func))))');
  assert(!hasErrors(errors), formatErrors(errors));
  module.tags.push({ name: '', sig: { params: [], results: [] } });
  synthesizeTypes(module);
  assertEquals(module.types.length, 3);
  assertEquals(module.tags[0]!.typeVar, varIndex(2));
});

Deno.test('a tag naming a type that does not exist keeps the index, for the validator', () => {
  // T13's rule: `(tag (type 42))` must not be repaired into some other type.
  const bytes = assemble('(module (type (func)) (tag (type 42)))');
  const { errors } = wasmValidate(bytes, { features: allFeatures() });
  assert(hasErrors(errors), 'the dangling type was repaired');
});
