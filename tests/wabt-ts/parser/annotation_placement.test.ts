// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Annotations the testsuite checks (`custom/name_annot.wast`,
// `custom/branch_hint.wast`) — five were accepted (wasmtk's letter of
// 2026-09-28, item 4):
//
// - `(@name "…")` belongs right after a BINDING id (or where one would be):
//   a module, a field, a param, a local, a label. It was skipped wherever it
//   stood; now its placement is checked. Its value is well-formed and NOT
//   applied — annotations are optional to process, and upstream wabt ignores
//   `@name` entirely.
// - a branch hint must be alone on its instruction, inside a function
//   (malformed otherwise), and that instruction must be an `if` or a `br_if`
//   (invalid otherwise — checked on the binary, where the hint points).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { allFeatures, wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';

const BODY = '(type (;0;) (func (param i32))) (memory (;0;) 1 1)';
const hinted = (before: string, after: string) =>
  `(module ${BODY} (func $t (type 0) (local i32) local.get 1 local.get 0 ${before} i32.eq ${after} if return end return))`;

/** `malformed: …` from the parser, `invalid: …` from the validator, or `valid`. */
function verdict(wat: string): string {
  const r = wat2wasm(wat);
  if (r.errors.length) return `malformed: ${formatErrors(r.errors)}`;
  const v = wasmValidate(r.binary, { features: allFeatures() });
  return v.errors.length ? `invalid: ${formatErrors(v.errors)}` : 'valid';
}

describe('annotation placement (custom/name_annot.wast, custom/branch_hint.wast)', () => {
  for (
    const [name, wat] of [
      ['module @name', '(module (@name "Modül"))'],
      ['module $id @name', '(module $moduel (@name "Modül"))'],
      [
        'func and tag @name',
        '(module (type $t (func)) (func (@name "λ") (type $t)) (func $lambda (@name "λ") (type $t)) (tag (@name "θ") (type $t)) (tag $theta (@name "θ") (type $t)))',
      ],
      [
        'param, local and label @name',
        '(module (func (param $p (@name "p") i32) (local $l (@name "l") i32) (block $b (@name "b"))))',
      ],
      ['a branch hint on an if', hinted('', '(@metadata.code.branch_hint "\\01")')],
      [
        "the testsuite's nested hints",
        `(module (func $dummy) (func (export "nested") (param i32 i32) (result i32)
          (@metadata.code.branch_hint "\\00")
          (if (result i32) (local.get 0)
            (then (@metadata.code.branch_hint "\\01")
              (if (result i32) (local.get 1) (then (call $dummy) (i32.const 9)) (else (i32.const 10))))
            (else (i32.const 11)))))`,
      ],
    ] as [string, string][]
  ) {
    it(`accepts ${name}`, () => assertEquals(verdict(wat), 'valid'));
  }

  for (
    const [name, wat, why] of [
      [
        '@name twice on the module',
        '(module (@name "M1") (@name "M2"))',
        '@name annotation: multiple module',
      ],
      ['@name after a field', '(module (func) (@name "M"))', 'misplaced @name annotation'],
      [
        '@name inside start',
        '(module (start $f (@name "M")) (func $f))',
        'misplaced @name annotation',
      ],
      [
        'a duplicated branch hint',
        hinted('', '(@metadata.code.branch_hint "\\01") (@metadata.code.branch_hint "\\01")'),
        'duplicate annotation',
      ],
      [
        'a branch hint outside a function',
        `(module (@metadata.code.branch_hint "\\01") ${BODY})`,
        'not in a function',
      ],
    ] as [string, string, string][]
  ) {
    it(`refuses ${name} as malformed`, () => {
      const v = verdict(wat);
      assert(v.startsWith('malformed') && v.includes(why), v);
    });
  }

  it('refuses a branch hint on a non-branch as invalid', () => {
    const v = verdict(hinted('(@metadata.code.branch_hint "\\01")', ''));
    assert(v.startsWith('invalid') && v.includes('invalid target'), v);
  });
});
