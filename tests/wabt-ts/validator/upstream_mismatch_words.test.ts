// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Divergence DG7 (fixed 2026-10-28): the validator's type-mismatch messages are upstream wabt's,
// word for word. Before, a short stack read "type mismatch in function, expected 1 elements on
// the stack but got 0", a wrong type at a signature read "type mismatch in function", leftovers
// read "type mismatch at end of end", and a one-armed `if` was refused in words of its own and
// then a SECOND time at the function end. Upstream (`TypeChecker::PrintStackIfFailedV`) prints
// `type mismatch in <desc>, expected [<types>] but got [<types>]` — or `at end of <desc>` for
// leftovers — names each construct as `OnEnd` does ("implicit return", "block", "`if false`
// branch", "initializer expression"), and models a missing `else` instead of a special rule.
//
// Every expected message below was MEASURED with upstream wabt 1.0.41 `wasm-validate --enable-all`
// on the same bytes (2026-10-28); the verdicts are V8's too. The positions are not asserted:
// upstream reports a binary offset after an instruction is read and a block error at its `end`,
// which binaryang's IR does not record — the residue DG7 keeps (divergences.md).

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { Result } from '../../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

// [name, WAT, upstream wabt's messages, in order]
const CASES: [string, string, string[]][] = [
  [
    'an empty body for a result',
    '(module (func (result i32)))',
    ['type mismatch in implicit return, expected [i32] but got []'],
  ],
  [
    'a wrong type at the implicit return',
    '(module (func (result i32) (i64.const 1)))',
    ['type mismatch in implicit return, expected [i32] but got [i64]'],
  ],
  [
    'values left at a block end',
    '(module (func (block (i32.const 1) (i32.const 2))))',
    ['type mismatch at end of block, expected [] but got [i32, i32]'],
  ],
  [
    'more left than is printed (four, after "... ")',
    '(module (func (block (i32.const 1) (i32.const 2) (i32.const 3) (i32.const 4) (i32.const 5))))',
    ['type mismatch at end of block, expected [] but got [... i32, i32, i32, i32]'],
  ],
  [
    'a deeper stack under a wrong result, then the leftovers',
    '(module (func (result i32) (i32.const 1) (i32.const 2) (i64.const 3)))',
    [
      'type mismatch in implicit return, expected [i32] but got [... i64]',
      'type mismatch at end of function, expected [] but got [i32, i32]',
    ],
  ],
  [
    'a one-armed if with a result — ONE message, as an empty else',
    '(module (func (result i32) (if (result i32) (i32.const 1) (then (i32.const 1)))))',
    ['type mismatch in `if false` branch, expected [i32] but got []'],
  ],
  [
    'drop with nothing to drop',
    '(module (func (drop)))',
    ['type mismatch in drop, expected [any] but got []'],
  ],
  [
    'an operand missing',
    '(module (func (result i32) (i32.add (i32.const 1))))',
    ['type mismatch in i32.add, expected [i32, i32] but got [i32]'],
  ],
  [
    'an operand of the wrong type',
    '(module (func (result i32) (i32.add (i32.const 1) (i64.const 2))))',
    ['type mismatch in i32.add, expected [i32, i32] but got [i32, i64]'],
  ],
  [
    'a branch without its value',
    '(module (func (result i32) (block (result i32) (br 0))))',
    ['type mismatch in br, expected [i32] but got []'],
  ],
  [
    'a return without its value',
    '(module (func (result i32) (return)))',
    ['type mismatch in return, expected [i32] but got []'],
  ],
  [
    'a call without its argument',
    '(module (func $f (param i32)) (func (call $f)))',
    ['type mismatch in call, expected [i32] but got []'],
  ],
  [
    'local.set of the wrong type',
    '(module (func (local i32) (local.set 0 (i64.const 1))))',
    ['type mismatch in local.set, expected [i32] but got [i64]'],
  ],
];

describe("DG7 — type-mismatch messages are upstream wabt's, word for word", () => {
  for (const [name, wat, upstream] of CASES) {
    it(name, () => {
      const binary = compile(wat);
      const { result, errors } = wasmValidate(binary, { features: allFeatures() });
      assertEquals(result, Result.Error, `we accepted "${name}"`);
      assertEquals(
        errors.map((e) => e.message),
        upstream,
        `"${name}":\n${formatErrors(errors)}`,
      );
    });
  }
});
