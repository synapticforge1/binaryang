// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.9 — the last of the quoted `assert_malformed` gap, and every one of them
// a silent WRONG VALUE.
//
// 1. **A duplicate identifier was simply unreachable.** Every lookup resolves a
//    name by scanning for the FIRST match, so a second `(func $foo …)` did not
//    collide — the module still referred to something, just never to the item
//    the author wrote last. The index space spans imports AND definitions, so
//    `(import "" "" (func $foo)) (func $foo)` is the same duplicate.
//
// 2. **`nan:0x0` emitted INFINITY.** The payload was masked into the mantissa
//    field instead of being checked, and a payload of 0 leaves no bits set:
//    `f32.const nan:0x0` produced 0x7f800000, which is not a NaN at all. The
//    same mask silently truncated an oversized payload into a different NaN.
//
// 3. **A signed lane index had its sign dropped**, and `i8x16.shuffle` filled
//    any missing lane with zero and let a `Uint8Array` store wrap `-1` to 255
//    and `256` to 0.
//
// 4. **A token does not end at a quote.** `$"l"0` and `data"a"` are each ONE
//    token — a reserved one — because a string can continue a token the same
//    way an idchar can. We stopped at the closing quote and left the rest in
//    the stream, so `(br_table $"l"0)` became a branch to `$l` followed by a
//    stray `0` that read as a second target, and `(data"a")` parsed as a
//    well-formed data segment.
//
// 5. **A second `(start …)` overwrote the first**, so the module ran a
//    different function than the one it names first.
//
// 6. **A type use may refer FORWARD**, so T12.7's restatement check saw an
//    empty table and skipped the comparison whenever the type was declared
//    later. Deferring it to the end of the field list makes the rule apply to
//    a forward reference too — and lets a type index that never exists be
//    reported rather than ignored.
//
// assert_malformed (quoted): 1183 -> 1227 / 1229 measured at the PARSER, and
// 1229 / 1229 through `wat2wasm`: the last two are `(br_table $l0)` with an
// undefined label, which `resolveNames` rejects. Name resolution is genuinely
// a post-parse pass here, so the parser-only harness under-reports the tool by
// exactly those two. Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}
function ok(src: string): void {
  const { errors } = wat2wasm(src);
  assert(!hasErrors(errors), `rejected a LEGAL module:\n${src}\n${formatErrors(errors)}`);
}

describe('T12.9 — an identifier is bound once per index space', () => {
  const DUPES: [string, string][] = [
    ['func', '(module (func $foo) (func $foo))'],
    ['func against an import', '(module (import "" "" (func $foo)) (func $foo))'],
    ['global', '(module (global $foo i32 (i32.const 0)) (global $foo i32 (i32.const 0)))'],
    [
      'global against an import',
      '(module (import "" "" (global $foo i32)) (global $foo i32 (i32.const 0)))',
    ],
    ['memory', '(module (memory $foo 1) (memory $foo 1))'],
    ['memory against an import', '(module (import "" "" (memory $foo 1)) (memory $foo 1))'],
    ['table', '(module (table $foo 1 funcref) (table $foo 1 funcref))'],
    [
      'table against an import',
      '(module (import "" "" (table $foo 1 funcref)) (table $foo 1 funcref))',
    ],
    ['type', '(module (type $t (func)) (type $t (func (param i32))))'],
    ['tag', '(module (tag $e) (tag $e))'],
    ['param', '(module (func (param $foo i32) (param $foo i32)))'],
    ['local against a param', '(module (func (param $foo i32) (local $foo i32)))'],
    ['local', '(module (func (local $foo i32) (local $foo i32)))'],
    ['struct field', '(module (type (struct (field $x i32) (field $x i32))))'],
  ];
  for (const [kind, src] of DUPES) {
    it(`rejects a duplicate ${kind} id`, () => {
      assert(!accepts(src), `accepted: ${src}`);
    });
  }

  it('says which kind and which name', () => {
    const { errors } = wat2wasm('(module (func $foo) (func $foo))');
    assert(/duplicate func \$foo/.test(formatErrors(errors)), formatErrors(errors));
  });

  it('keeps the same name legal in DIFFERENT index spaces', () => {
    ok('(module (func $x) (global $x i32 (i32.const 0)) (memory $x 1) (table $x 1 funcref))');
    ok('(module (type $x (func)) (func $x))');
  });

  it('leaves anonymous items alone', () => {
    ok('(module (func) (func) (global i32 (i32.const 0)) (global i32 (i32.const 0)))');
    ok('(module (type (struct (field i32) (field i32))))');
  });

  it('scopes locals per FUNCTION and fields per TYPE', () => {
    ok('(module (func (local $a i32)) (func (local $a i32)))');
    ok('(module (type (struct (field $x i32))) (type (struct (field $x i64))))');
  });
});

describe('T12.9 — a NaN payload names a NaN', () => {
  it('rejects a zero payload, which is not a NaN', () => {
    assert(!accepts('(module (func (f32.const nan:0x0) drop))'), 'accepted f32 nan:0x0');
    assert(!accepts('(module (func (f64.const nan:0x0) drop))'), 'accepted f64 nan:0x0');
  });

  it('rejects a payload too wide for the mantissa field', () => {
    assert(
      !accepts('(module (func (f32.const nan:0x800000) drop))'),
      'accepted a 24-bit f32 payload',
    );
    assert(
      !accepts('(module (func (f64.const nan:0x10000000000000) drop))'),
      'accepted a 53-bit f64 payload',
    );
  });

  it('still accepts the payloads that ARE in range, unchanged', async () => {
    const { binary, errors } = wat2wasm(`(module
      (func (export "lo") (result f32) (f32.const nan:0x1))
      (func (export "hi") (result f32) (f32.const nan:0x7fffff))
      (func (export "q") (result f32) (f32.const nan:0x400000)))`);
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf, {});
    const bits = (f: unknown) => {
      const dv = new DataView(new ArrayBuffer(4));
      dv.setFloat32(0, (f as () => number)());
      return dv.getUint32(0);
    };
    // Every one must still be a NaN — exponent all ones AND a non-zero
    // mantissa. `nan:0x400000` is the case the old 0x3fffff mask turned into
    // infinity, and `nan:0x0` is the case the 0x7fffff mask did.
    for (const name of ['lo', 'hi', 'q']) {
      const b = bits(instance.exports[name]);
      assertEquals(b & 0x7f800000, 0x7f800000, `${name} lost its NaN exponent`);
      assert((b & 0x7fffff) !== 0, `${name} came back as an infinity`);
    }
  });
});

describe('T12.9 — lane immediates', () => {
  const Z16 = '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0';
  const L16 = '0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15';

  it('rejects a SIGNED lane index', () => {
    for (const lane of ['+1', '+03', '+0x0f']) {
      assert(
        !accepts(
          `(module (func (result i32) (i8x16.extract_lane_u ${lane} (v128.const i8x16 ${Z16}))))`,
        ),
        `accepted lane ${lane}`,
      );
    }
  });

  it('rejects an i8x16.shuffle with the wrong number of lanes', () => {
    assert(
      !accepts(
        `(module (func (param v128) (result v128) (i8x16.shuffle 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 (local.get 0) (local.get 0))))`,
      ),
      'accepted 15 lanes',
    );
    assert(
      !accepts(
        `(module (func (result v128) (i8x16.shuffle (v128.const i8x16 ${Z16}) (v128.const i8x16 ${Z16}))))`,
      ),
      'accepted no lanes at all',
    );
  });

  it('rejects an i8x16.shuffle lane that does not fit a byte', () => {
    for (const bad of ['-1', '256']) {
      assert(
        !accepts(
          `(module (func (result v128) (i8x16.shuffle 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 ${bad} (v128.const i8x16 ${Z16}) (v128.const i8x16 ${Z16}))))`,
        ),
        `accepted shuffle lane ${bad}`,
      );
    }
  });

  it('still accepts a well-formed shuffle and lane op', () => {
    ok(
      `(module (func (result v128) (i8x16.shuffle ${L16} (v128.const i8x16 ${Z16}) (v128.const i8x16 ${Z16}))))`,
    );
    ok(`(module (func (result i32) (i8x16.extract_lane_u 15 (v128.const i8x16 ${Z16}))))`);
  });
});

describe('T12.9 — a token does not end at a quote', () => {
  it('rejects an identifier that runs into what follows', () => {
    assert(!accepts('(module (func (block $l (i32.const 0) (br_table $"l"0))))'), 'accepted $"l"0');
    assert(
      !accepts('(module (func (block $l (i32.const 0) (br_table $"l"$l))))'),
      'accepted $"l"$l',
    );
  });

  it('rejects a keyword that runs into a string', () => {
    assert(!accepts('(module (memory 1) (data"a"))'), 'accepted data"a"');
  });

  it('still accepts the same text with a separator', () => {
    ok('(module (memory 1) (data "a"))');
    ok('(module (func (block $l (i32.const 0) (br_table $"l"))))');
    ok('(module (func $"fh") (func (call $fh)))');
  });
});

describe('T12.9 — one start function per module', () => {
  it('rejects a second (start …)', () => {
    assert(
      !accepts('(module (func $a (unreachable)) (func $b (unreachable)) (start $a) (start $b))'),
    );
  });

  it('still accepts one', () => {
    ok('(module (func $a) (start $a))');
  });
});

describe('T12.9 — a type use is checked once the module is known', () => {
  it('rejects an inline signature against a type index that does not exist', () => {
    assert(
      !accepts(`(module
      (func $f (result f64) (f64.const 0))
      (func $g (param i32))
      (func $h (result f64) (f64.const 1))
      (type $t (func (param i32)))
      (func (type 2) (param i32)))`),
    );
  });

  it('now catches a FORWARD reference that disagrees, which it used to skip', () => {
    // The type is declared AFTER the use, so the old point-of-use check saw an
    // empty table and compared nothing.
    assert(
      !accepts('(module (func (type $t) (result i32) (i32.const 0)) (type $t (func)))'),
      'accepted a forward type use with a mismatched restatement',
    );
  });

  it('accepts a forward reference that AGREES', () => {
    ok('(module (func (type $t) (result i32) (i32.const 0)) (type $t (func (result i32))))');
  });

  it('leaves a type use with no inline signature to the validator', () => {
    // `(func (type 4))` on a module with fewer types is assert_INVALID, not
    // assert_malformed — the parser must not claim that one.
    const { errors } = wat2wasm('(module (func $g (type 4)))');
    assert(!/unknown type/.test(formatErrors(errors)), 'the parser claimed a validator error');
  });
});
