// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression: the abbreviated element-expression form was rejected.
//
// The wast grammar is `elemlist ::= reftype elemexpr*`, and `elemexpr` has
// two spellings: the explicit `(item instr*)` form, and the abbreviation
// where a single folded instruction IS the element expression —
// `(elem (i32.const 0) funcref (ref.null func) (ref.func $f))`.
//
// `parseElemModuleField` only looped on `(item …)`, so the abbreviation fell
// straight through to the segment's closing `expect(Rpar)` and failed with
// "expected ), got (". Not instruction-specific: `(ref.func $f)` and
// `(ref.null func)` failed identically.
//
// Surfaced alongside the `ref.null` heap-type fix, but independent of it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary, 'expected a binary');
  return binary;
}

function v8Accepts(binary: Uint8Array): boolean {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

describe('elem — abbreviated element expressions', () => {
  it('accepts a bare (ref.func $f) element expression', () => {
    const binary = compile(
      '(module (func $f) (table 2 funcref) (elem (i32.const 0) funcref (ref.func $f)))',
    );
    assert(v8Accepts(binary));
  });

  it('accepts bare (ref.null func) element expressions', () => {
    const binary = compile(
      '(module (table 2 funcref) (elem (i32.const 0) funcref (ref.null func) (ref.null func)))',
    );
    assert(v8Accepts(binary));
  });

  it('accepts a bare element expression in a passive segment', () => {
    const binary = compile('(module (elem funcref (ref.null func) (ref.null func)))');
    assert(v8Accepts(binary));
  });

  it('accepts an externref element list', () => {
    const binary = compile(
      '(module (table 2 externref) (elem (i32.const 0) externref (ref.null extern)))',
    );
    assert(v8Accepts(binary));
  });

  it('mixes the abbreviated and (item …) forms in one segment', () => {
    const binary = compile(
      `(module (func $f) (table 3 funcref)
         (elem (i32.const 0) funcref (ref.func $f) (item (ref.null func)) (ref.func $f)))`,
    );
    assert(v8Accepts(binary));
  });

  it('lands one table element per abbreviated expression', async () => {
    // Three expressions must produce three distinct elements in order, not
    // one merged run — `(ref.func $f) (ref.null func) (ref.func $g)` fills
    // slots 0/1/2 with f / null / g.
    const binary = compile(
      `(module
         (func $f (result i32) (i32.const 11))
         (func $g (result i32) (i32.const 22))
         (table (export "t") 3 funcref)
         (elem (i32.const 0) funcref (ref.func $f) (ref.null func) (ref.func $g)))`,
    );
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    const table = instance.exports.t as WebAssembly.Table;
    assertEquals(table.length, 3);
    assertEquals((table.get(0) as () => number)(), 11);
    assertEquals(table.get(1), null);
    assertEquals((table.get(2) as () => number)(), 22);
  });

  it('round-trips through wasm2wat back to an equivalent binary', () => {
    const wat = `(module (func $f) (table 2 funcref)
      (elem (i32.const 0) funcref (ref.func $f) (ref.null func)))`;
    const binary = compile(wat);
    const { text, errors } = wasm2wat(binary);
    if (hasErrors(errors)) throw new Error('wasm2wat:\n' + formatErrors(errors));
    assert(text);
    assert(v8Accepts(compile(text)));
  });
});

describe('elem — pre-existing forms still parse', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    [
      '(item …) form',
      '(module (table 2 funcref) (elem (i32.const 0) funcref (item (ref.null func))))',
    ],
    ['legacy var list', '(module (func $f) (table 2 funcref) (elem (i32.const 0) $f $f))'],
    ['func keyword', '(module (func $f) (table 2 funcref) (elem (i32.const 0) func $f $f))'],
    ['declare', '(module (func $f) (elem declare func $f))'],
    [
      '(table …) form',
      '(module (func $f) (table $t 2 funcref) (elem (table $t) (i32.const 0) func $f))',
    ],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      assert(v8Accepts(compile(wat)));
    });
  }
});

describe('elem — malformed input still fails', () => {
  it('reports an error instead of looping on a non-instruction (…)', () => {
    // parseOneInstr consumes nothing here; the loop must bail rather than spin.
    const { errors } = wat2wasm(
      '(module (table 2 funcref) (elem (i32.const 0) funcref (nonsense)))',
    );
    assert(hasErrors(errors), 'expected an error for a non-instruction element expression');
    assertEquals(typeof formatErrors(errors), 'string');
  });
});
