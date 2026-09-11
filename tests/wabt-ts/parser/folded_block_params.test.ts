// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Block PARAMETERS written in FOLDED form.
//
// Every linear instruction has a folded form — wrap it in parentheses; folded
// operands are optional, and missing ones come from the stack. So block
// parameters are writable folded: an input folded BEFORE the construct and
// consumed inside by a partial fold, or — for `if` — extra folded instructions
// in the condition slot, where `(if bt foldedinstr* (then …))` means
// `foldedinstr* if bt … end`. Upstream wat2wasm 1.0.41 reads every one.
//
// wabt-ts's folded `if` kept the LAST instruction of its condition slot and
// discarded the rest, so the input vanished and the module was invalid.
//
// Each case runs the module: the answer depends on the parameter arriving.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

async function run(wat: string): Promise<number> {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  const { instance } = await WebAssembly.instantiate(binary as BufferSource, {});
  return (instance.exports.f as () => number)();
}

const CASES: [string, string, number][] = [
  [
    'block, input folded before it',
    '(module (func (export "f") (result i32) (i32.const 7) (block (param i32) (result i32))))',
    7,
  ],
  [
    'block, body consumes the parameter with a partial fold',
    '(module (func (export "f") (result i32) (i32.const 7) ' +
    '(block (param i32) (result i32) (i32.add (i32.const 1)))))',
    8,
  ],
  [
    'if, input in the condition slot (was DROPPED)',
    '(module (func (export "f") (result i32) (if (param i32) (result i32) ' +
    '(i32.const 7) (i32.const 1) (then (i32.add (i32.const 1))) (else (i32.sub (i32.const 1))))))',
    8,
  ],
  [
    'if, input in the condition slot, else arm taken',
    '(module (func (export "f") (result i32) (if (param i32) (result i32) ' +
    '(i32.const 7) (i32.const 0) (then (i32.add (i32.const 1))) (else (i32.sub (i32.const 1))))))',
    6,
  ],
  [
    'if, condition itself spans two folds (the case the slot loop was written for)',
    '(module (func (export "f") (result i32) (if (result i32) (i32.const 0) (i32.eqz) ' +
    '(then (i32.const 1)) (else (i32.const 2)))))',
    1,
  ],
  [
    'loop, a back-edge br_if re-supplies the parameter',
    '(module (func (export "f") (result i32) (local i32) (i32.const 3) ' +
    '(loop $l (param i32) (result i32) (i32.sub (i32.const 1)) (local.tee 0) (br_if $l (local.get 0)))))',
    0,
  ],
];

describe('folded block parameters, through wabt-ts wat2wasm', () => {
  for (const [name, wat, expected] of CASES) {
    it(name, async () => assertEquals(await run(wat), expected));
  }
});
