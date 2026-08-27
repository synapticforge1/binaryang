// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T7 (semantic correctness) batch 2. All four were invisible to the
// parse-clean metric: the text parsed, then the encoder produced bytes V8
// rejects, or -- worse -- bytes V8 accepts that mean the wrong thing.
//
//   1. QUOTED IDENTIFIERS were a different name from their bare spelling.
//      `id ::= '$' idchar+ | '$' '"' string '"'` -- the quoted form is an
//      alternate spelling of the SAME identifier, with escapes resolved, so
//      `$"fh"` denotes exactly `$fh`. The lexer handed back the raw source
//      slice including quotes, so the two never matched.
//
//   2. RAW NON-ASCII CHARACTERS IN STRINGS WERE TRUNCATED TO ONE BYTE.
//      The decoder did `bytes.push(ch)` with a UTF-16 code unit, so `é`
//      (U+00E9) emitted `e9` instead of UTF-8 `c3 a9`, and U+F61A emitted
//      `1a` instead of `ef 98 9a`. WAT strings are BYTE strings and the
//      source is UTF-8, so a raw character contributes its UTF-8 encoding.
//      This silently corrupted data segments and import/export names -- and
//      produced a VALID module, just with the wrong bytes in it.
//
//   3. `(func $f (type $t) ...)` WITH NO INLINE SIGNATURE GOT AN EMPTY ONE.
//      The func's whole signature comes from $t. Without it the emitted type
//      was `() -> ()` while the body pushed a value, and V8 rejected with
//      "expected 0 elements on the stack". It also has to be resolved BEFORE
//      the body is parsed, because local slot numbering starts at
//      sig.params.length.
//
//   4. MULTI-VALUE BLOCK RESULTS WERE TRUNCATED TO THE FIRST TYPE, and block
//      PARAMS were not parsed at all. The old code said so outright:
//      "multi-value: use func_type index (simplified: use first type)".
//      Anything other than the single-result shorthand needs a function type
//      index in the blocktype slot.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

const B = String.fromCharCode(92); // backslash, kept out of TS escape rules

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(wat: string): boolean {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

describe('quoted identifiers denote the same name as bare ones', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['quoted reference to bare decl', '(module (func $fh) (func (call $"fh")))'],
    ['bare reference to quoted decl', '(module (func $"gh") (func (call $gh)))'],
    ['escape inside the identifier', `(module (func $"a${B}tb") (func (call $"a${B}tb")))`],
    ['spaces inside the identifier', '(module (func $" x ") (func (call $" x ")))'],
    ['quoted param name', '(module (func (param $"p" i32) (result i32) (local.get $p)))'],
    ['quoted local name', '(module (func (result i32) (local $"l" i32) (local.get $l)))'],
    ['plain identifiers still work', '(module (func $ok) (func (call $ok)))'],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      assert(v8Accepts(wat), `V8 rejected: ${wat}`);
    });
  }
});

describe('WAT strings encode raw characters as UTF-8', () => {
  /** The data-segment payload: the trailing bytes after the length prefix. */
  function dataOf(literal: string, len: number): number[] {
    const binary = compile(`(module (memory 1) (data (i32.const 0) "${literal}"))`);
    return [...binary.slice(binary.length - len)];
  }

  it('a raw non-ASCII character emits its UTF-8 bytes', () => {
    // U+00E9 -> c3 a9, NOT the truncated e9.
    assertEquals(dataOf('é', 2), [0xc3, 0xa9]);
  });

  it('all three spellings of one character agree', () => {
    const viaBytes = dataOf(`${B}ef${B}98${B}9a`, 3);
    const viaScalar = dataOf(`${B}u{f61a}`, 3);
    const viaRaw = dataOf('\u{f61a}', 3);
    assertEquals(viaBytes, [0xef, 0x98, 0x9a]);
    assertEquals(viaScalar, viaBytes, 'u{} escape must match byte escapes');
    assertEquals(viaRaw, viaBytes, 'raw character must match byte escapes');
  });

  it('ASCII is unaffected', () => {
    assertEquals(dataOf('AB', 2), [0x41, 0x42]);
  });

  it('a character outside the BMP survives as four bytes', () => {
    // U+1F600 -> f0 9f 98 80; a surrogate pair must be consumed as one code point.
    assertEquals(dataOf('\u{1f600}', 4), [0xf0, 0x9f, 0x98, 0x80]);
  });
});

describe('(func (type $t)) takes its signature from $t', () => {
  it('adopts results', () => {
    const { module, errors } = parseWatModule(
      '(module (type $t (func (result i32))) (func $f (type $t) (i32.const 5)))',
    );
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(module.funcs[0]!.sig.results.length, 1);
    assert(v8Accepts('(module (type $t (func (result i32))) (func $f (type $t) (i32.const 5)))'));
  });

  it('adopts params, so local slots number correctly', async () => {
    const wat = `(module
      (type $t (func (param i32 i32) (result i32)))
      (func (export "f") (type $t)
        (local $extra i32)
        (local.set $extra (i32.add (local.get 0) (local.get 1)))
        (local.get $extra)))`;
    const { module } = parseWatModule(wat);
    assertEquals(module.funcs[0]!.sig.params.length, 2);
    const binary = compile(wat);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    // The local must land in slot 2, after the two params.
    assertEquals((instance.exports.f as (a: number, b: number) => number)(3, 4), 7);
  });

  it('an inline signature alongside the type annotation still wins', () => {
    assert(v8Accepts(
      '(module (type $t (func (result i32))) (func $f (type $t) (result i32) (i32.const 5)))',
    ));
  });

  it('a plain inline signature is unaffected', () => {
    assert(v8Accepts('(module (func $f (result i32) (i32.const 5)))'));
  });
});

describe('block signatures beyond the single-result shorthand', () => {
  it('multi-value results encode as a function type', async () => {
    const wat = `(module (func (export "f") (result i32 i32)
      (block (result i32 i32) (i32.const 1) (i32.const 2))))`;
    const binary = compile(wat);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    assert(WebAssembly.validate(buf), 'V8 rejected the multi-value block');
    const { instance } = await WebAssembly.instantiate(buf);
    assertEquals((instance.exports.f as () => number[])(), [1, 2]);
  });

  it('block params parse and encode', async () => {
    const wat = `(module (func (export "f") (result i32)
      (i32.const 40)
      (block (param i32) (result i32) (i32.add (i32.const 2)))))`;
    const binary = compile(wat);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    assert(WebAssembly.validate(buf), 'V8 rejected the block with params');
    const { instance } = await WebAssembly.instantiate(buf);
    assertEquals((instance.exports.f as () => number)(), 42);
  });

  it('loop params work too', () => {
    assert(v8Accepts(`(module (func (export "f") (result i32)
      (i32.const 7) (loop (param i32) (result i32))))`));
  });

  it('the single-result shorthand still uses the compact encoding', () => {
    const binary = compile('(module (func (result i32) (block (result i32) (i32.const 1))))');
    // 0x7f is the i32 value type used directly as the blocktype byte; a
    // needlessly interned function type would show up as an extra type entry.
    assert(binary.includes(0x7f));
    assert(v8Accepts('(module (func (result i32) (block (result i32) (i32.const 1))))'));
  });

  it('a void block is still void', () => {
    assert(v8Accepts('(module (func (block (nop))))'));
  });
});
