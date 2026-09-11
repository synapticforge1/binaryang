// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// W5 (cmem/divergences.md): IMPLICIT types — the ones a module never declares,
// written only as inline signatures — are indexed after every explicit type,
// in text order, as upstream `wat2wasm` and `wasm-tools` both do:
//
//   imports in order; then each function and tag in text order — a function's
//   own signature first, then its body's block types and inline
//   `call_indirect` signatures in BINARY order (a folded `if`'s condition
//   block before the `if`).
//
// A block's type was appended the moment the block was PARSED (before its own
// function's signature, and before any explicit type declared later), and
// `call_indirect`'s and every tag's came after all the functions'. That was not
// only form: `(func (type 1))` naming an implicit type named a DIFFERENT
// signature than upstream's, and made a valid module of one upstream rejects.
//
// Over the corpus: 421/421 identical to upstream wat2wasm outside the custom
// sections (400 before; the 21 were these). The fixtures below are wasm-tools'
// bytes, with upstream wat2wasm agreeing wherever it can parse the module.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
/** The binary with its custom sections cut out. */
function withoutCustoms(b: Uint8Array): Uint8Array {
  const keep: number[] = [...b.subarray(0, 8)];
  for (let i = 8; i < b.length;) {
    const start = i;
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    i += size;
    if (id !== 0) keep.push(...b.subarray(start, i));
  }
  return new Uint8Array(keep);
}
const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));

const CASES: [string, string, string][] = [
  [
    "a function's own signature before its block's type",
    '(module (func (param i32) (result i64) (block (result i32 i32) (i32.const 1) (i32.const 2)) (drop) (drop) (i64.const 0)))',
    `00 61 73 6d 01 00 00 00 01 0b 02 60 01 7f 01 7e 60 00 02 7f 7f 03 02 01 00 0a 0f 01 0d 00 02 01
     41 01 41 02 0b 1a 1a 42 00 0b`,
  ],
  [
    "a call_indirect's signature before the NEXT function's",
    '(module (table 1 funcref) (func (param f32) (call_indirect (param i64) (i64.const 0) (i32.const 0))) (func (param f64)))',
    `00 61 73 6d 01 00 00 00 01 0d 03 60 01 7d 00 60 01 7e 00 60 01 7c 00 03 03 02 00 02 04 04 01 70
     00 01 0a 0e 02 09 00 42 00 41 00 11 01 00 0b 02 00 0b`,
  ],
  [
    'a tag where it stands between two functions',
    '(module (func (param i32)) (tag (param f32)) (func (param i64)))',
    `00 61 73 6d 01 00 00 00 01 0d 03 60 01 7f 00 60 01 7d 00 60 01 7e 00 03 03 02 00 02 0d 03 01 00
     01 0a 07 02 02 00 0b 02 00 0b`,
  ],
  [
    "a folded if's condition block before the if — binary order, not tree order",
    '(module (func (if (result i64 i64) (i32.const 5) (block (param i32) (result i32)) (then (i64.const 1) (i64.const 2)) (else (i64.const 3) (i64.const 4))) (drop) (drop)))',
    `00 61 73 6d 01 00 00 00 01 0e 03 60 00 00 60 01 7f 01 7f 60 00 02 7e 7e 03 02 01 00 0a 17 01 15
     00 41 05 02 01 0b 04 02 42 01 42 02 05 42 03 42 04 0b 1a 1a 0b`,
  ],
  [
    'of two equal explicit types, an implicit signature reuses the FIRST',
    '(module (type $a (func)) (type $b (func)) (func) (func (call_indirect (type $b) (i32.const 0))) (table 1 funcref))',
    `00 61 73 6d 01 00 00 00 01 07 02 60 00 00 60 00 00 03 03 02 00 00 04 04 01 70 00 01 0a 0c 02 02
     00 0b 07 00 41 00 11 01 00 0b`,
  ],
  [
    'a single typed-ref result is written inline, and interns no type (GC; wasm-tools)',
    '(module (type $s (struct)) (func (result (ref null $s)) (block (result (ref null $s)) (ref.null $s))))',
    `00 61 73 6d 01 00 00 00 01 08 02 5f 00 60 00 01 63 00 03 02 01 01 0a 0a 01 08 00 02 63 00 d0 00
     0b 0b`,
  ],
];

describe('implicit types, in the order upstream gives them', () => {
  for (const [name, wat, bytes] of CASES) {
    it(name, () => {
      assertEquals(withoutCustoms(assemble(wat)), hex(bytes));
    });
  }
});

describe('the order carries MEANING', () => {
  it('`(func (type 1))` names the block type upstream gives index 1 — so this module is invalid', () => {
    // Upstream: types = [(param i32) -> i64, () -> (i32 i32)], so the second
    // function must return (i32 i32) and its `i64.const` is a type mismatch.
    // With the block's type first, `(type 1)` was (param i32) -> i64 and the
    // module validated.
    const bin = assemble(`(module
      (func (param i32) (result i64) (block (result i32 i32) (i32.const 1) (i32.const 2)) (drop) (drop) (i64.const 0))
      (func (type 1) (i64.const 5)))`);
    assert(!WebAssembly.validate(bin as BufferSource));
  });

  it('`(block (result (ref 1)))` in a one-type module is "unknown type" (ref.wast)', () => {
    // A typed-ref result interned a function type, which gave `(ref 1)` a type
    // 1 to point at. Written inline, the module has one type and `(ref 1)` none.
    const bin = assemble('(module (func $b (drop (block (result (ref 1)) (unreachable)))))');
    assert(!WebAssembly.validate(bin as BufferSource));
  });
});

describe('the parser indexes them; synthesizeTypes then changes nothing', () => {
  it('running synthesizeTypes after the parser leaves the type section as it was', () => {
    const wat = `(module (table 1 funcref)
      (func (param i32) (result i64) (block (result i32 i32) (i32.const 1) (i32.const 2)) (drop) (drop)
        (call_indirect (param f32) (f32.const 0) (i32.const 0)) (i64.const 0))
      (tag (param f64))
      (func (param i64)))`;
    const { module, errors } = parseWatModule(new LexerSource(wat, '<w5>'));
    assert(!hasErrors(errors), formatErrors(errors));
    resolveNames(module, makeErrorList());
    const before = JSON.stringify(module.types.map((t) => t.kind === 'func' ? t.sig : t.kind));
    synthesizeTypes(module);
    assertEquals(
      JSON.stringify(module.types.map((t) => t.kind === 'func' ? t.sig : t.kind)),
      before,
    );
  });
});

describe("binaryen-ts's encoder writes a typed-ref result inline too", () => {
  it('and so round-trips the module wabt-ts wrote', () => {
    const bytes = assemble(
      '(module (type $s (struct)) (func (result (ref null $s)) (block (result (ref null $s)) (ref.null $s))))',
    );
    const back = encodeWasm(parseWasm(bytes));
    assert(back.length === bytes.length && back.every((x, i) => x === bytes[i]));
  });
});
