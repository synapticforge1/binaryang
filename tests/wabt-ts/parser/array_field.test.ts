// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A1 (cmem/divergences.md): an array's element may be written `fieldtype` or,
// as both upstreams allow, `(field id? fieldtype)`.
//
// The spec grammar is `'(' 'array' fieldtype ')'` — `(field id? fieldtype)`
// belongs to STRUCTS (webassembly.github.io/gc/core/text/types.html, checked
// 2026-09-11). Upstream wabt takes it for arrays anyway, through the very same
// `ParseField` it uses for struct fields (`wast-parser.cc:1793`); binaryen
// takes it too, rejecting only a second field ("expected exactly one field in
// array definition"); `wasm-tools` refuses it. The spec testsuite has NO case
// either way — nothing to accept, nothing that must be rejected.
//
// 🔧 We took the form but not its `id`, and the `id` is the half that carries a
// name. An array field named in the binary (name section subsection 10, FEATURE
// N2) had nowhere to go in text, so `wasm2wat` printed `(array (mut i8))` and
// the name was gone — a name lost at the text hop, which is exactly what N1
// forbids. So: read the id, and print the `(field …)` wrapper ONLY when there
// is a name to keep, leaving every other array type in the spec's own form that
// `wasm-tools` reads.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
function errorOf(wat: string): string {
  const r = wat2wasm(wat);
  assert(hasErrors(r.errors), `expected an error for ${wat}`);
  return formatErrors(r.errors);
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
/** The type section's bytes — what was actually built. */
function typeSection(b: Uint8Array): string {
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id === 1) {
      return [...b.subarray(i, i + size)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    }
    i += size;
  }
  return '(none)';
}
/** The `name` section's field-name subsection (10), as bytes. */
function fieldNames(b: Uint8Array): string {
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    const end = i + size;
    if (id === 0 && b[i] === 4 && new TextDecoder().decode(b.subarray(i + 1, i + 5)) === 'name') {
      let p = i + 5;
      while (p < end) {
        const sid = b[p++]!;
        let ssize = 0;
        for (let s = 0;; s += 7) {
          const x = b[p++]!;
          ssize += (x & 0x7f) * 2 ** s;
          if ((x & 0x80) === 0) break;
        }
        if (sid === 10) {
          return [...b.subarray(p, p + ssize)].map((x) => x.toString(16).padStart(2, '0')).join(
            ' ',
          );
        }
        p += ssize;
      }
    }
    i = end;
  }
  return '(none)';
}

describe('A1 — `(field …)` in an array is the same type as the bare form', () => {
  // `01 5e 78 00` and `01 5e 78 01` are `wasm-tools parse`'s own bytes for
  // `(array i8)` and `(array (mut i8))` — the spec forms.
  for (
    const [name, wat, expected] of [
      ['bare storage type', '(module (type $a (array i8)))', '01 5e 78 00'],
      ['bare, mutable', '(module (type $a (array (mut i8))))', '01 5e 78 01'],
      ['(field st)', '(module (type $a (array (field i8))))', '01 5e 78 00'],
      ['(field (mut st))', '(module (type $a (array (field (mut i8)))))', '01 5e 78 01'],
      ['(field $id (mut st))', '(module (type $a (array (field $e (mut i8)))))', '01 5e 78 01'],
    ] as const
  ) {
    it(name, () => {
      assertEquals(typeSection(assemble(wat)), expected);
    });
  }

  it('and the same inside a rec group and a sub', () => {
    assertEquals(
      typeSection(assemble('(module (rec (type $a (array (field (mut i8))))))')),
      '01 4e 01 5e 78 01',
    );
    assertEquals(
      typeSection(assemble('(module (type $a (sub (array (field (mut i8))))))')),
      '01 50 00 5e 78 01',
    );
  });
});

describe('A1 — the id is a NAME, and it reaches the binary', () => {
  it('an array field name is written to the name section (subsection 10)', () => {
    // type 0, field 0, "e" — the same shape a struct field's name takes.
    assertEquals(
      fieldNames(assemble('(module (type $a (array (field $e (mut i8)))))')),
      '01 00 01 00 01 65',
    );
  });

  it('an UNNAMED array field writes no field name', () => {
    assertEquals(fieldNames(assemble('(module (type $a (array (mut i8))))')), '(none)');
  });

  it("WAT → wat2wasm → wasm2wat gives the name back — N1's rule", () => {
    const wat = '(module (type $a (array (field $e (mut i8)))))';
    const text = wasm2wat(assemble(wat)).text;
    assert(text.includes('(field $e (mut i8))'), text);
  });

  it('and the text is a fixed point, bytes and all', () => {
    const first = assemble('(module (type $a (array (field $e (mut i8)))))');
    const second = assemble(wasm2wat(first).text);
    assert(same(second, first), wasm2wat(first).text);
  });
});

describe('A1 — the wrapper is printed ONLY when a name needs it', () => {
  it('an unnamed array field prints the spec form, which wasm-tools reads', () => {
    const text = wasm2wat(assemble('(module (type $a (array (mut i8))))')).text;
    assert(text.includes('(array (mut i8))'), text);
    assert(!text.includes('(field'), text);
  });

  it('a named one prints the wabt form, the only way to say it', () => {
    const text = wasm2wat(assemble('(module (type $a (array (field $e i8))))')).text;
    assert(text.includes('(array (field $e i8))'), text);
  });

  it('a struct field is unchanged — it always had the wrapper', () => {
    const text = wasm2wat(assemble('(module (type $s (struct (field $x i8))))')).text;
    assert(text.includes('(struct (field $x i8))'), text);
  });
});

describe('A1 — what is still rejected', () => {
  it('two fields in an array, as binaryen rejects it too', () => {
    // upstream binaryen: "expected exactly one field in array definition"
    assert(errorOf('(module (type $a (array (field i8) (field i8))))').length > 0);
  });

  it('two types in one array field', () => {
    assert(errorOf('(module (type $a (array (field i8 i8))))').length > 0);
  });

  it('a struct written without the wrapper — the mirror case', () => {
    assert(errorOf('(module (type $s (struct i8)))').length > 0);
  });
});
