/**
 * Custom descriptors (wasmtk's item 5a): exact types, exact function imports,
 * `describes` / `descriptor` clauses, and the four instructions
 * (`struct.new(_default)_desc`, `ref.get_desc`, `ref.cast_desc_eq`,
 * `br_on_cast_desc_eq(_fail)`).
 *
 * The proposal's own testsuite is measured outside the repo (wasm-tools'
 * `json-from-wast` as the oracle, V8 under
 * `--experimental-wasm-custom-descriptors` running it — cmem/open-work.md);
 * this file pins what that measurement found, so none of it regresses
 * silently. Behaviour needs the V8 flag, which a test run cannot set, so these
 * are text, bytes, trees and verdicts.
 */

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/wabt-ts/tools/wasm2wat.ts';
import { allFeatures, wasmValidate } from '../../src/wabt-ts/tools/wasm-validate.ts';
import { defaultFeatures } from '../../src/wabt-ts/core/feature.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { formatErrors } from '../../src/wabt-ts/core/error.ts';
import { Result } from '../../src/wabt-ts/core/result.ts';

/** Text to bytes, failing loudly on a parse or encode error. */
function asm(text: string): Uint8Array {
  const r = wat2wasm(text, { textForm: false });
  assert(r.result === Result.Ok, formatErrors(r.errors));
  return r.binary;
}

/** The validator's verdict under all features: `''` when valid, else the errors. */
function verdict(text: string, features = allFeatures()): string {
  const v = wasmValidate(asm(text), { features });
  return v.result === Result.Ok ? '' : formatErrors(v.errors);
}

/** Does `needle` occur in `hay` as a contiguous byte run? */
function hasBytes(hay: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const TYPES = `
  (rec
    (type $a (sub (descriptor $b) (struct (field i32))))
    (type $b (sub (describes $a) (struct (field i64)))))`;

/** Every new instruction, folded, in one valid module. */
const ALL = `(module ${TYPES}
  (func $new (param $d (ref null (exact $b))) (result (ref (exact $a)))
    (struct.new_desc $a (i32.const 1) (local.get $d)))
  (func $new0 (param $d (ref null (exact $b))) (result (ref (exact $a)))
    (struct.new_default_desc $a (local.get $d)))
  (func $get (param $x (ref (exact $a))) (result (ref (exact $b)))
    (ref.get_desc $a (local.get $x)))
  (func $cast (param $x anyref) (param $d (ref null (exact $b))) (result (ref null (exact $a)))
    (ref.cast_desc_eq (ref null (exact $a)) (local.get $x) (local.get $d)))
  (func $br (param $x anyref) (param $d (ref null $b)) (result (ref null $a))
    (block $l (result (ref null $a))
      (drop (br_on_cast_desc_eq $l anyref (ref null $a) (local.get $x) (local.get $d)))
      (ref.null none)))
  (func $brf (param $x anyref) (param $d (ref null $b)) (result anyref)
    (block $l (result anyref)
      (drop (br_on_cast_desc_eq_fail $l anyref (ref null $a) (local.get $x) (local.get $d)))
      (ref.null none))))`;

describe('custom descriptors — text, bytes, and back', () => {
  it('every instruction encodes as the proposal says', () => {
    const b = asm(ALL);
    assert(hasBytes(b, [0x4d, 0x01, 0x5f]), 'descriptor clause 0x4D before the struct');
    assert(hasBytes(b, [0x4c, 0x00, 0x5f]), 'describes clause 0x4C before the struct');
    assert(hasBytes(b, [0xfb, 0x20, 0x00]), 'struct.new_desc');
    assert(hasBytes(b, [0xfb, 0x21, 0x00]), 'struct.new_default_desc');
    assert(hasBytes(b, [0xfb, 0x22, 0x00]), 'ref.get_desc');
    assert(hasBytes(b, [0xfb, 0x24, 0x62, 0x00]), 'ref.cast_desc_eq (ref null (exact 0))');
    assert(hasBytes(b, [0xfb, 0x25]), 'br_on_cast_desc_eq');
    assert(hasBytes(b, [0xfb, 0x26]), 'br_on_cast_desc_eq_fail');
  });

  it('validates under the feature, and round-trips to the same bytes', () => {
    assertEquals(verdict(ALL), '');
    const bytes = asm(ALL);
    const text = wasm2wat(bytes).text;
    for (
      const kw of [
        'struct.new_desc',
        'struct.new_default_desc',
        'ref.get_desc',
        'ref.cast_desc_eq',
        'br_on_cast_desc_eq ',
        'br_on_cast_desc_eq_fail',
        '(describes',
        '(descriptor',
      ]
    ) assertStringIncludes(text, kw);
    assertEquals(asm(text), bytes);
  });

  it('an exact function import is import kind 0x20 and prints back', () => {
    const src = `(module (type $f (func))
      (import "m" "f" (func $f (exact (type $f))))
      (elem declare func $f)
      (func (result (ref (exact $f))) (ref.func $f)))`;
    const b = asm(src);
    assert(hasBytes(b, [0x01, 0x66, 0x20, 0x00]), 'import kind 0x20, type 0');
    assertEquals(verdict(src), '');
    assertStringIncludes(wasm2wat(b).text, '(exact');
  });
});

describe('custom descriptors — the feature gate', () => {
  it('each part is refused without the feature', () => {
    const off = defaultFeatures();
    off.gc = true;
    off.functionReferences = true;
    off.referenceTypes = true;
    assertStringIncludes(verdict(ALL, off), 'customDescriptors');
    assertStringIncludes(
      verdict(`(module (type $t (struct)) (func (param (ref (exact $t)))))`, off),
      'customDescriptors',
    );
  });
});

describe('custom descriptors — the type-section rules', () => {
  const cases: [string, string, boolean][] = [
    ['describes an earlier type that names it back', TYPES, true],
    [
      'a forward describes',
      `(rec (type $d (describes $x) (struct)) (type $x (descriptor $d) (struct)))`,
      false,
    ],
    [
      'a descriptor outside the rec group',
      `(type $x (descriptor 1) (struct)) (type $d (describes 0) (struct))`,
      false,
    ],
    [
      'a descriptor that does not describe back',
      `(rec (type $o (struct)) (type $x (descriptor $d) (struct)) (type $d (describes $o) (struct)))`,
      false,
    ],
    [
      'a clause on a non-struct',
      `(rec (type $x (descriptor $d) (array i8)) (type $d (describes $x) (struct)))`,
      false,
    ],
    // The testsuite is newer than the Overview and drops two of its rules.
    [
      'mismatched finality (allowed)',
      `(rec (type $x (sub final (descriptor $d) (struct))) (type $d (sub (describes $x) (struct))))`,
      true,
    ],
    [
      'a subtype adds a descriptor its supertype lacks (allowed)',
      `(rec (type $A (sub (struct))) (type $B (sub $A (descriptor $Bd) (struct)))
            (type $Bd (sub (describes $B) (struct))))`,
      true,
    ],
    [
      'a supertype has a descriptor its subtype lacks',
      `(rec (type $A (sub (descriptor $Ad) (struct))) (type $Ad (sub (describes $A) (struct)))
            (type $B (sub $A (struct))))`,
      false,
    ],
    [
      "the subtype's descriptor is not a subtype of the supertype's",
      `(rec (type $A (sub (descriptor $Ad) (struct))) (type $Ad (sub (describes $A) (struct)))
            (type $B (sub $A (descriptor $Bd) (struct))) (type $Bd (sub (describes $B) (struct))))`,
      false,
    ],
  ];
  for (const [what, types, valid] of cases) {
    it(`${valid ? 'accepts' : 'refuses'}: ${what}`, () => {
      const v = verdict(`(module ${types})`);
      assertEquals(v === '', valid, v);
    });
  }
});

describe('custom descriptors — instruction typing', () => {
  const fn = (body: string) => `(module ${TYPES} ${body})`;
  it('struct.new may not allocate a type with a descriptor', () => {
    assertStringIncludes(
      verdict(fn(`(func (drop (struct.new $a (i32.const 1))))`)),
      'requires descriptor allocation',
    );
  });
  it('struct.new_desc may not allocate a type without one', () => {
    assertStringIncludes(
      verdict(`(module (type $s (struct)) (func (param anyref)
        (drop (struct.new_default_desc $s (ref.null none)))))`),
      'requires non-descriptor allocation',
    );
  });
  it('ref.get_desc is exact only from an exact operand (or none)', () => {
    assertEquals(
      verdict(fn(`(func (param (ref null (exact $a))) (result (ref (exact $b)))
      (ref.get_desc $a (local.get 0)))`)),
      '',
    );
    assertEquals(
      verdict(fn(`(func (result (ref (exact $b)))
      (ref.get_desc $a (ref.null none)))`)),
      '',
    );
    assert(
      verdict(fn(`(func (param (ref null $a)) (result (ref (exact $b)))
      (ref.get_desc $a (local.get 0)))`)) !== '',
    );
  });
  it('an exact cast takes an exact descriptor', () => {
    assert(
      verdict(fn(`(func (param anyref (ref null $b)) (result (ref null (exact $a)))
      (ref.cast_desc_eq (ref null (exact $a)) (local.get 0) (local.get 1)))`)) !== '',
    );
  });
  it('struct.new_default needs every field defaultable (a gap closed with 5a)', () => {
    assertStringIncludes(
      verdict(
        `(module (type $s (struct (field (ref any)))) (func (drop (struct.new_default $s))))`,
      ),
      'not defaultable',
    );
  });
});

describe('the folded forms 5a found dropping operands', () => {
  it('a surplus folded child stays below the instruction', () => {
    // `(struct.new_default $s (struct.new $s))` is `struct.new $s;
    // struct.new_default $s` — two values where one is returned. The child
    // was dropped, and the function validated.
    assert(
      verdict(`(module (type $s (struct))
        (func (result anyref) (struct.new_default $s (struct.new $s))))`) !== '',
    );
  });
  it('br_on_cast_fail keeps its ref when a value is carried ahead of it', () => {
    const src = `(module (type $s (struct))
      (func (param (ref null any)) (result i32 (ref any))
        (block (result i32 (ref null $s))
          (br_on_cast_fail 1 (ref null any) (ref null $s) (i32.const 42) (local.get 0)))
        (unreachable)))`;
    assert(hasBytes(asm(src), [0x41, 0x2a, 0x20, 0x00, 0xfb, 0x19]), 'i32.const 42; local.get 0');
    assertEquals(verdict(src), '');
  });
  it('a linear struct.new takes one operand per field, not the whole stack', () => {
    const m = parseWatModule(`(module (type $one (struct (field i32)))
      (func (result i32) i32.const 7 i32.const 1 struct.new $one drop))`).module!;
    const body = m.functions[0]!.body.children;
    const sn = body.flatMap((e) => e.kind === 'drop' ? [e.value] : []).find((e) =>
      e.kind === 'struct.new'
    );
    assert(sn?.kind === 'struct.new');
    assertEquals(sn.operands.length, 1);
  });
});
