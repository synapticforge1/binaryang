// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T11 — the pipeline was rewriting an INVALID module into a valid one.
//
// A funcidx elemlist and an explicitly-written `funcref` elemlist are not the
// same segment. The spec draws the line sharply, and elem.wast tests both
// sides against the same `(ref func)` table:
//
//   (elem (i32.const 0) $g)                  VALID   — funcidx form, and its
//                                                      element type is the
//                                                      NON-NULLABLE (ref func)
//   (elem (i32.const 0) funcref (ref.func 0)) INVALID — funcref is nullable
//                                                      and is not a subtype
//                                                      of (ref func)
//
// wabt-ts collapsed the distinction in FIVE places at once, and each one hid
// the next:
//
//   parser         recorded `funcref` for the funcidx elemlist
//   binary reader  decoded flags 0-3 (funcidx) as `funcref`, and after a
//                  first pass at this, flags 4 (exprs, implicit) as
//                  `(ref func)` — the two forms imply DIFFERENT types and
//                  only one default cannot serve both
//   binary writer  used the funcidx encoding for any all-`ref.func` segment,
//                  widening an explicit `funcref` declaration (T7.11)
//   WAT writer     gated the `func $a $b` shorthand on the NULLABLE funcref —
//                  backwards, since that spelling MEANS (ref func) — so the
//                  declaration was lost in the text too
//   validator      never compared the segment's element type to the table's
//
// The net effect is what makes this worth its own item rather than a line in
// T9.8: `wat2wasm` silently REPAIRED the invalid module. A tool that quietly
// turns invalid input into valid output is worse than one that rejects it.
//
// A T7.11 test asserted the repaired behaviour was correct. It was wrong and
// is now inverted; T7.11's fix had been too broad.
//
// assert_invalid 2629 -> 2632 / 2737, and round-trip fidelity is unchanged at
// 1961/2120 — the WAT-writer half of the fix is what keeps it there.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { isRefValueType } from '../../src/ir/ir.ts';
import type { ValueType } from '../../src/ir/ir.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toBuf(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return buf;
}

/** `(ref func)` / `funcref` / something else, as a short label. */
function label(t: ValueType): string {
  if (!isRefValueType(t)) return `abstract:0x${(t as number).toString(16)}`;
  const h = t.heapType.kind === 'name' ? t.heapType.name : `#${t.heapType.value}`;
  return t.nullable ? `(ref null ${h})` : `(ref ${h})`;
}

/** The element type of the first segment, as parsed and as decoded again. */
function elemTypes(wat: string): { source: string; decoded: string } {
  const src = parseWatModule(wat).module.elemSegments[0]!.elemType;
  const back = readBinaryIr(compile(wat), makeErrorList(), {}).elemSegments[0]!.elemType;
  return { source: label(src), decoded: label(back) };
}

const NONNULL = '(func $f) (func $g) (table $t 10 (ref func) (ref.func $f))';

describe('T11 — a funcidx elemlist is (ref func), not funcref', () => {
  const funcidxForms: ReadonlyArray<readonly [string, string]> = [
    ['bare abbreviation', '(module (func) (table 1 funcref) (elem (i32.const 0) 0))'],
    ['func keyword', '(module (func) (table 1 funcref) (elem (i32.const 0) func 0))'],
    ['passive func form', '(module (func) (table 1 funcref) (elem func 0))'],
    ['declared func form', '(module (func) (table 1 funcref) (elem declare func 0))'],
  ];
  for (const [name, wat] of funcidxForms) {
    it(`${name} parses and decodes as (ref func)`, () => {
      const { source, decoded } = elemTypes(wat);
      assertEquals(source, '(ref func)');
      assertEquals(decoded, '(ref func)');
    });
  }

  it('an explicit funcref elemlist stays funcref through the round-trip', () => {
    const { source, decoded } = elemTypes(
      '(module (func) (table 1 funcref) (elem (i32.const 0) funcref (ref.func 0)))',
    );
    assertEquals(source, 'abstract:0x70');
    assertEquals(decoded, 'abstract:0x70');
  });

  it('and so does an explicit (ref func) one', () => {
    const { source, decoded } = elemTypes(
      '(module (func) (table 1 (ref func) (ref.func 0)) (elem (i32.const 0) (ref func) (ref.func 0)))',
    );
    assertEquals(source, '(ref func)');
    assertEquals(decoded, '(ref func)');
  });
});

describe('T11 — the invalid module stays invalid', () => {
  it('a funcref segment against a (ref func) table is rejected', () => {
    // elem.wast asserts exactly this, "type mismatch". Before, the encoder
    // widened it into a module V8 accepts.
    const wat = `(module ${NONNULL} (elem (i32.const 3) funcref (ref.func $g)))`;
    const bin = compile(wat);
    assert(!WebAssembly.validate(toBuf(bin)), 'the encoder repaired an invalid module');
    assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Error);
  });

  it('while the funcidx form against the same table is accepted', () => {
    const wat = `(module ${NONNULL} (elem (i32.const 3) $g))`;
    const bin = compile(wat);
    assert(WebAssembly.validate(toBuf(bin)));
    assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Ok);
  });

  it('an externref segment against a funcref table is rejected too', () => {
    const wat = '(module (table 1 funcref) (elem (i32.const 0) externref (ref.null extern)))';
    const bin = compile(wat);
    assert(!WebAssembly.validate(toBuf(bin)));
    assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Error);
  });
});

describe('T11 — the WAT writer keeps the declared type', () => {
  it('prints the func shorthand only for (ref func)', () => {
    const { text } = wasm2wat(compile('(module (func) (table 1 funcref) (elem (i32.const 0) 0))'));
    assert(text);
    const line = text.split('\n').find((l) => l.includes('(elem')) ?? '';
    assert(/\bfunc\b/.test(line) && !line.includes('funcref'), `expected the shorthand: ${line}`);
  });

  it('prints funcref explicitly when that is what was declared', () => {
    const { text } = wasm2wat(
      compile('(module (func) (table 1 funcref) (elem (i32.const 0) funcref (ref.func 0)))'),
    );
    assert(text);
    assert(text.includes('funcref'), `lost the funcref declaration:\n${text}`);
  });

  it('and both spellings survive a full round-trip byte-identically', () => {
    for (
      const wat of [
        '(module (func) (func) (table 3 funcref) (elem $e func 0 1 0 1))',
        '(module (func) (table 1 funcref) (elem (i32.const 0) funcref (ref.func 0)))',
        '(module (func) (table 1 funcref) (elem (i32.const 0) 0))',
      ]
    ) {
      const first = compile(wat);
      const { text } = wasm2wat(first);
      assert(text);
      assertEquals([...compile(text)], [...first], `not byte-identical:\n${wat}\n${text}`);
    }
  });
});
