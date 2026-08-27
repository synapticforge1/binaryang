// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13 — the last 19 `assert_invalid` modules, and 16 of them were never a
// validator gap at all.
//
// They had been recorded as "modules V8 and Wasmtime both accept — those spec
// tests predate proposals that legalised what they assert against". Re-deriving
// them showed the engines were accepting a DIFFERENT MODULE: our own pipeline
// rewrote each one into validity before anything validated it.
//
//   (memory 0x1_0000_0000)              emitted as (memory 0)
//   (memory i64 0x1_0000_0000_0001)     emitted as (memory i64 1)
//   (func (type 42))                    emitted as (func (type 0))
//   (rec (type (func)) (type $ft (func)))
//     (func $f)                         given (type $ft), a type in a rec group
//
// Three separate repairs, one class — the T11 rule, "an encoder must never
// repair invalid input":
//
//   1. `encodeU32Leb128` began `let v = value >>> 0`, which WRAPS. That was the
//      whole range check, so 2^32 encoded as 0 and 2^48+1 as 1. It also hid a
//      second bug: a 64-bit memory's limits are u64 on the wire and we wrote
//      them as u32, so no 64-bit size above 2^32 could survive at all.
//   2. `synthesizeTypes`, on a type-use naming an index that does not exist,
//      called `ensureTypeFor(item.sig)` — which APPENDS a matching type if none
//      exists. The comment said this would leave "a dangling reference for the
//      validator to report"; what it actually left was a valid module pointing
//      at a different type.
//   3. `synthesizeTypes` reused ANY structurally-matching function type for an
//      implicit type-use. An implicit type-use denotes a SINGLETON rec group,
//      and type identity is compared up to the rec group, so a `(func)` inside
//      a two-member `(rec …)` is a different type. `type-rec.wast` says so in a
//      comment: ";; the implicit type of $f is not $ft".
//
// **The V8-valid metric was partly earned by these repairs.** Two spec modules
// that had counted as V8-valid — a 2^48-page `memory i64` and a 2^64-1-element
// `table i64` — only passed because we truncated them first. The three-engine
// panel settles the first: Wasmtime (the authority) ACCEPTS 2^48 pages and
// rejects 2^48+1 with "memory size must be at most", which is exactly the spec
// ruling and exactly what we now emit. V8 rejects both for its own
// implementation limit, so it is not the oracle here.
//
// assert_invalid 2664 -> 2683 / 2683. Validator agreement 2118 / 2118,
// round-trip 2118 / 2118, execution 23,077 / 23,077, both `assert_malformed`
// halves complete. V8-valid reads 2118 / 2120 — the two modules above, which
// V8 will not accept at any faithful encoding.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

/** Encode, and require the result to be REJECTED — by the encoder or by the validator. */
function invalid(src: string): void {
  const { binary, errors } = wat2wasm(src);
  if (hasErrors(errors)) return; // the encoder refused: also a rejection
  assert(binary);
  assertEquals(
    wasmValidate(binary, { features: allFeatures() }).result,
    Result.Error,
    `accepted a module the spec calls invalid:\n${src}\n${wasm2wat(binary).text}`,
  );
}
function ok(src: string): Uint8Array {
  const { binary, errors } = wat2wasm(src);
  assert(!hasErrors(errors), `rejected a LEGAL module:\n${src}\n${formatErrors(errors)}`);
  assert(binary);
  return binary;
}

describe('T13 — a limits value is not truncated into range', () => {
  for (
    const src of [
      '(module (memory 0x1_0000_0000))',
      '(module (memory 0x1_0000_0000 0x1_0000_0000))',
      '(module (memory 0 0x1_0000_0000))',
      '(module (memory (import "M" "m") 0x1_0000_0000))',
      '(module (memory (import "M" "m") 0 0x1_0000_0000))',
      '(module (memory i64 0x1_0000_0000_0001))',
      '(module (memory i64 0 0x1_0000_0000_0001))',
      '(module (memory (import "M" "m") i64 0x1_0000_0000_0001))',
    ]
  ) {
    it(`rejects ${src.slice(8, 60)}`, () => invalid(src));
  }

  it('says the encoder refused, rather than throwing out of the tool', () => {
    // A fail-loud encoder is right; a throw escaping `wat2wasm` is not. Same
    // rule as the validator's — a failure must REPORT.
    const { errors } = wat2wasm('(module (memory 0x1_0000_0000))');
    assert(hasErrors(errors), 'no error reported');
    assert(/cannot encode module/.test(formatErrors(errors)), formatErrors(errors));
  });

  it('keeps the sizes that DO fit, exactly', () => {
    // The page bound (65536, or 2^48 for i64) is the validator's rule and is
    // unchanged; this is only about the field holding what the source wrote.
    for (
      const [src, printed] of [
        ['(module (memory 65536))', '65536'],
        ['(module (memory 0 65536))', '65536'],
        ['(module (memory i64 0 0x1_0000_0000))', '4294967296'],
      ] as const
    ) {
      const text = wasm2wat(ok(src)).text!;
      assert(text.includes(printed), `${src} came back as: ${text}`);
    }
  });

  it('round-trips a 64-bit size above 2^32, which u32 limits could not hold', () => {
    // The writer emitted u32 for 64-bit limits, so this value could not
    // survive an encode at all — it came back as 0.
    const text = wasm2wat(ok('(module (memory i64 0x1_0000_0000 0x2_0000_0000))')).text!;
    assert(text.includes('4294967296'), text);
    assert(text.includes('8589934592'), text);
  });

  it('still rejects the sizes that exceed the PAGE bound', () => {
    for (
      const src of [
        '(module (memory 65537))',
        '(module (memory 0 65537))',
        '(module (memory i64 0x1_0000_0000_0000_1))',
      ]
    ) invalid(src);
  });
});

describe("T13 — a table's element bound follows its index type", () => {
  it('accepts a 64-bit table larger than a 32-bit one may be', () => {
    // A flat u32 cap in the validator rejected this; it was invisible while the
    // writer was truncating 64-bit limits to u32 before the check ever ran.
    ok('(module (table i64 0 0x1_0000_0000 funcref))');
  });

  it('still holds a 32-bit table to 2^32-1', () => {
    ok('(module (table 0 0xffff_ffff funcref))');
    invalid('(module (table 0 0x1_0000_0000 funcref))');
  });
});

describe('T13 — an out-of-range type index stays out of range', () => {
  for (
    const src of [
      '(module (func (type 42)))',
      '(module (import "spectest" "print_i32" (func (type 43))))',
      '(module (type (func)) (func (type 1)))',
      '(module (type (func (result i32))) (type (func)) (import "test" "func" (func (type 2))))',
    ]
  ) {
    it(`rejects ${src.slice(8, 62)}`, () => invalid(src));
  }

  it('does not APPEND a type to make the reference valid', () => {
    // The repair called `ensureTypeFor`, which appends a matching entry when
    // none exists — so the emitted module grew a type the source never wrote
    // and the reference landed on it. The section must stay the size the
    // source declared, and the module must not validate.
    const { binary, errors } = wat2wasm('(module (type $t (func)) (func (type 5)))');
    assert(!hasErrors(errors) && binary, 'expected the module to encode');
    const text = wasm2wat(binary).text!;
    assertEquals(
      (text.match(/\(type \$\w+ \(func/g) ?? []).length,
      1,
      `type appended:
${text}`,
    );
    assertEquals(wasmValidate(binary, { features: allFeatures() }).result, Result.Error, text);
  });

  it('still resolves a type index that DOES exist', () => {
    ok('(module (type (func)) (type (func (param i32))) (func (type 1) (param i32)))');
  });
});

describe('T13 — an implicit type-use is its own rec group', () => {
  it('does not borrow a type from inside a multi-member (rec …)', () => {
    invalid(`(module
      (rec (type $ft (func)) (type (func)))
      (func $f)
      (global (ref $ft) (ref.func $f)))`);
    invalid(`(module
      (rec (type (func)) (type $ft (func)))
      (func $f)
      (global (ref $ft) (ref.func $f)))`);
    invalid(`(module
      (rec (type $s (struct)) (type $ft (func)))
      (func $f)
      (global (ref $ft) (ref.func $f)))`);
  });

  it('still reuses a type that IS its own rec group', () => {
    // A bare `(type …)` and a singleton `(rec (type …))` denote the same type;
    // only the encoding differs. Both must stay reusable, or every module with
    // an inline signature would grow a duplicate type entry.
    const a = ok('(module (type $t (func (result i32))) (func (result i32) (i32.const 0)))');
    const b = ok('(module (rec (type $t (func (result i32)))) (func (result i32) (i32.const 0)))');
    for (const [name, bin] of [['bare', a], ['singleton rec', b]] as const) {
      const text = wasm2wat(bin).text!;
      const types = (text.match(/\(type \$?\w* ?\(func/g) ?? []).length;
      assertEquals(types, 1, `${name}: a duplicate type entry was appended:\n${text}`);
    }
  });

  it('accepts the matching case the spec calls VALID', () => {
    ok('(module (type $ft (func)) (func $f) (global (ref $ft) (ref.func $f)))');
  });
});
