// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5 item 6 (M5a): a type-section entry carries what the section said —
// its `sub` declaration and its rec group — and holds its signature as `sig`
// (an array's element as `field`), the way every other record in this tree does.
//
// 🔧 Both were LOST, silently, on every module that had them:
// - the decoder read a `(sub …)` supertype list into NOWHERE and the encoder
//   never wrote one, so every declared subtype relationship disappeared;
// - a `(rec …)` group was FLATTENED into singletons, which is a different
//   module wherever two entries in the group refer to each other.
// Measured over the spec corpus: 83 binaries carry rec groups, and all 83
// re-encoded with a different type section before this.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { bridgeToBinaryen } from '../../../src/bridge/bridge.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
/** The type section (id 1), as hex. */
function typeSection(bytes: Uint8Array): string {
  let i = 8;
  while (i < bytes.length) {
    const id = bytes[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const b = bytes[i++]!;
      size += (b & 0x7f) * 2 ** s;
      if ((b & 0x80) === 0) break;
    }
    if (id === 1) return hex(bytes.subarray(i, i + size));
    i += size;
  }
  return '';
}
const roundTrip = (b: Uint8Array) => encodeWasm(parseWasm(b));

describe('M5a — the type section comes back as it was', () => {
  const cases: [string, string][] = [
    ['a rec group', '(module (rec (type $a (struct)) (type $b (struct (field (ref $a))))))'],
    ['a sub declaration', '(module (type $p (sub (struct))) (type $c (sub $p (struct))))'],
    ['sub final', '(module (type $f (sub final (func))))'],
    ['plain entries', '(module (type $s (struct (field i32))) (type $a (array i8)))'],
    [
      'a rec group of subtypes',
      '(module (rec (type $p (sub (struct))) (type $c (sub $p (struct (field i32))))))',
    ],
  ];
  for (const [label, wat] of cases) {
    it(label, () => {
      const bytes = assemble(wat);
      assertEquals(typeSection(roundTrip(bytes)), typeSection(bytes));
    });
  }

  it('the group and the supertypes are in the IR, not just in the bytes', () => {
    const mod = parseWasm(
      assemble('(module (rec (type $p (sub (struct))) (type $c (sub $p (struct (field i32))))))'),
    );
    const [p, c] = mod.types;
    // The group is ONE section entry spanning two type indices, recorded on its
    // first member.
    assertEquals(p!.recGroupSize, 2);
    assertEquals(c!.recGroupSize, undefined);
    assertEquals(p!.sub, { final: false, supertypes: [] });
    assertEquals(c!.sub, { final: false, supertypes: [{ kind: 'index', value: 0 }] });
  });

  it('an entry with NO sub declaration keeps none', () => {
    // The bare comptype shorthand is not `(sub final)` with no supertypes: it is
    // one byte shorter, and writing one for the other changes the section.
    const mod = parseWasm(assemble('(module (type $s (struct (field i32))))'));
    assertEquals(mod.types[0]!.sub, undefined);
  });

  it('a function type holds its signature as `sig`', () => {
    const mod = parseWasm(assemble('(module (type $f (func (param i32) (result i64))))'));
    const def = mod.types[0]!;
    assert(def.kind === 'func');
    assertEquals(def.sig.params.length, 1);
    assertEquals(def.sig.results.length, 1);
  });

  it('an array type holds its element as `field`', () => {
    const mod = parseWasm(assemble('(module (type $a (array (mut i8))))'));
    const def = mod.types[0]!;
    assert(def.kind === 'array');
    assertEquals(def.field.mutable, true);
    assertEquals(def.field.type, 'i8');
  });
});

describe('M5b — the module holds its own type table, and a field its name', () => {
  it('a written field name is kept, mutable or not (the parser skipped it)', () => {
    const mod = parseWat(
      '(module (type $s (struct (field $x i32) (field $m (mut i64)) (field f32))))',
    );
    const def = mod.types[0]!;
    assert(def.kind === 'struct');
    assertEquals(def.fields.map((f) => [f.name, f.mutable]), [
      ['$x', false],
      ['$m', true],
      ['', false],
    ]);
  });

  it('the bridge carries a field name across', () => {
    const { module, errors } = parseWatModule(
      new LexerSource('(module (type $s (struct (field $x i32) (field $y (mut i64)))))', '<m5b>'),
    );
    assert(!hasErrors(errors), formatErrors(errors));
    const errs = makeErrorList();
    resolveNames(module, errs);
    assert(!hasErrors(errs), formatErrors(errs));
    const def = bridgeToBinaryen(module).types[0]!;
    assert(def.kind === 'struct');
    assertEquals(def.fields.map((f) => f.name), ['$x', '$y']);
  });

  it('a decoded field has no name of its own', () => {
    // As in wabt-ts: the name section supplies field names, and inventing one
    // here would be a name the module never had.
    const mod = parseWasm(assemble('(module (type $s (struct (field i32))))'));
    const def = mod.types[0]!;
    assert(def.kind === 'struct');
    assertEquals(def.fields.map((f) => f.name), ['']);
  });

  it('the table the module carries is the table written back', () => {
    // Not re-derived: a module that declares a type nothing references still
    // emits it, in its own order.
    const bytes = assemble('(module (type $unused (func (param f64))) (func))');
    assertEquals(typeSection(roundTrip(bytes)), typeSection(bytes));
    assertEquals(parseWasm(bytes).types.length, 2);
  });
});
