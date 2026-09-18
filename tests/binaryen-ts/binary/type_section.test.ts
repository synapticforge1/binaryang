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
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { Packed, storageTypeToString } from '../../../src/binaryen-ts/ir/gc-types.ts';

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
    assertEquals(def.field.type, Packed.I8);
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
      // Unnamed in the text: named anyway, as every entity is (owner decision 4,
      // M7c3b b0) — `$fieldN` by its index.
      ['$field2', false],
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

  it('a decoded field the section did not name gets a MADE-UP name, never recorded as real', () => {
    // Owner decision 4 (M7c3b b0) — it was `''` (M5a). The made-up name is in no
    // `explicitNames` set, so it is never written; the type's own name is real.
    const mod = parseWasm(assemble('(module (type $s (struct (field i32))))'));
    const def = mod.types[0]!;
    assert(def.kind === 'struct');
    assertEquals(def.name, '$s');
    assertEquals(def.fields.map((f) => f.name), ['$field0']);
    assertEquals([...mod.explicitNames!.types], ['$s']);
    assertEquals(mod.explicitNames!.fields.get('$s'), undefined);
    // And it is never written: the round trip is exact.
    assertEquals(encodeWasm(mod), assemble('(module (type $s (struct (field i32))))'));
  });

  it('an unnamed TYPE is made up too, and not written', () => {
    const bytes = assemble('(module (type (struct (field $f i32))))');
    const mod = parseWasm(bytes);
    const def = mod.types[0]!;
    assertEquals(def.name, '$type0');
    assertEquals([...mod.explicitNames!.types], []);
    assert(def.kind === 'struct');
    assertEquals([...mod.explicitNames!.fields.get('$type0')!], ['$f']);
    assertEquals(encodeWasm(mod), bytes);
  });

  it('the table the module carries is the table written back', () => {
    // Not re-derived: a module that declares a type nothing references still
    // emits it, in its own order.
    const bytes = assemble('(module (type $unused (func (param f64))) (func))');
    assertEquals(typeSection(roundTrip(bytes)), typeSection(bytes));
    assertEquals(parseWasm(bytes).types.length, 2);
  });
});

describe('M7c3b b0 — the builder names every type and field', () => {
  it('a made-up name never takes the spelling of a real one', () => {
    const m = new ModuleBuilder();
    m.addType({ name: '$type1', kind: 'func', sig: { params: [], results: [] } });
    m.addType({
      name: '',
      kind: 'struct',
      fields: [
        { name: '', type: ValType.I32, mutable: false },
        { name: '$field0', type: ValType.I32, mutable: false },
      ],
    });
    const [a, b] = m.build().types;
    assertEquals(a!.name, '$type1');
    // Index 1's made-up `$type1` is taken, so it moves aside.
    assertEquals(b!.name, '$type1.1');
    assert(b!.kind === 'struct');
    assertEquals(b.fields.map((f) => f.name), ['$field0.1', '$field0']);
  });

  it("leaves the caller's object as it was", () => {
    const def = {
      name: '',
      kind: 'array' as const,
      field: { name: '', type: ValType.I32, mutable: true },
    };
    new ModuleBuilder().addType(def);
    assertEquals([def.name, def.field.name], ['', '']);
  });
});

describe('M8b2 — packed field types are the binary codes, printed by NAME', () => {
  // A packed type is a NUMBER now (`Type.I8` is 0x78). Returning it from the
  // printer would say `120` — the V1 slip this function had once through a
  // cast. A mutant doing exactly that survived every other test.
  it('storageTypeToString names i8 / i16, never the code', () => {
    assertEquals(storageTypeToString(Packed.I8), 'i8');
    assertEquals(storageTypeToString(Packed.I16), 'i16');
    assertEquals(storageTypeToString(ValType.I32), 'i32');
  });
});
