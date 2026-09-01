// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// An `if` introduces a BRANCH TARGET, exactly as `block` and `loop` do: `br 0`
// inside a `then` targets the end of the IF, not the construct outside it.
//
// `parseIf` skipped the optional `$label` — `idx++` with nothing captured — and
// pushed no scope, so every branch depth inside an `if` resolved one level too
// far out. `block`, `loop`, `try` and `try_table` all pushed one; `if` was the
// only omission.
//
// ⚠️ The visible symptom was `label depth N exceeds enclosing blocks` on 24
// corpus modules. That is the BENIGN half. Where the miscounted depth still
// named a real block, the branch silently went to the WRONG ONE and the module
// stayed valid — the failure mode that ships.
//
// ⚠️ The first fixture written for this could not tell the two readings apart:
// with `br 0` as the last thing in the block, the if and the block yield the
// same value either way, so it passed against the bug. These fixtures put work
// AFTER the if so the two answers differ — 99 when the branch hits the if, 5
// when it escapes to the block.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

/** Run `f(1)` on binaryen-ts's build and on wabt-ts's, asserting they agree. */
function bothAgree(wat: string): number {
  const run = (bytes: Uint8Array) => {
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource));
    return (inst.exports.f as (x: number) => number)(1);
  };
  const reference = run(wat2wasm(wat, { filename: 'ref.wat' }).binary);
  const got = run(encodeWasm(parseWat(wat)));
  assertEquals(got, reference, 'binaryen-ts must agree with wabt-ts');
  return got;
}

/** `(drop (if …))` then a trailing constant, so the two readings differ. */
const around = (branch: string) =>
  `(module (func (export "f") (param i32) (result i32)
     (block $b (result i32)
       (drop (if (result i32) (local.get 0) (then ${branch}) (else (i32.const 6))))
       (i32.const 99))))`;

describe('WAT parser — an `if` is a branch target', () => {
  it('br 0 inside a then targets the IF, not the enclosing block', () => {
    assertEquals(bothAgree(around('(br 0 (i32.const 5))')), 99);
  });

  it('br 1 reaches past the if to the block', () => {
    assertEquals(bothAgree(around('(br 1 (i32.const 7))')), 7);
  });

  it('a NAMED if label is honoured', () => {
    assertEquals(
      bothAgree(`(module (func (export "f") (param i32) (result i32)
        (block $b (result i32)
          (drop (if $i (result i32) (local.get 0)
            (then (br $i (i32.const 5)))
            (else (i32.const 6))))
          (i32.const 99))))`),
      99,
    );
  });

  it('an if with no branch in it is unaffected', () => {
    assertEquals(
      bothAgree(
        '(module (func (export "f") (param i32) (result i32) (if (result i32) (local.get 0) (then (i32.const 1)) (else (i32.const 2)))))',
      ),
      1,
    );
  });

  // The condition is evaluated BEFORE the if is entered, so it belongs to the
  // enclosing scope — a branch in the condition must not see the if's label.
  it('a branch in the CONDITION resolves against the enclosing scope', () => {
    assertEquals(
      bothAgree(`(module (func (export "f") (param i32) (result i32)
        (block $b (result i32)
          (drop (if (result i32) (br_if $b (i32.const 4) (local.get 0))
            (then (i32.const 1)) (else (i32.const 2))))
          (i32.const 99))))`),
      4,
    );
  });
});
