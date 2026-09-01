// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Numeric branch depths, and the operands `br` / `br_if` carry.
//
// Three defects, all surfaced by re-parsing our own `wasm2wat --fold` output —
// which emits NAMED blocks and NUMERIC branches, a combination nothing else in
// the suite produced:
//
//   1. `resolveLabel` reconstructed the name `pushLabel` would have synthesized
//      (`$depth{N}`) instead of looking up whichever label sits at that depth.
//      That only works when the block is ANONYMOUS; a block with an explicit
//      `$B0` registers that name, so the synthetic one was never in the map.
//      307 of 421 corpus modules failed with `unresolved branch label:
//      "$depth1"`.
//
//   2. An unconditional `br` DROPPED its value: the guard read
//      `conditional && args[2]`, so `(br $l (i32.const 7))` parsed as a bare
//      branch and the enclosing block was left with nothing to return.
//
//   3. `br_if` read its operands BACKWARDS. In `(br_if $l value cond)` the
//      condition is LAST, because it is the top of the stack and the carried
//      value sits below it.
//
// ⚠️ And one the fix itself introduced: depth −1 is the FUNCTION FRAME, the
// implicit block around every body that `br N` may target as a return. A bounds
// check treating it as out of range rejected 279 modules — a guard firing on the
// single most common branch in real code. The encoder seeds its own stack with
// `fn.bodyFrameLabel ?? ''`, so the empty name resolves there.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

/** Call `f` on a module built by binaryen-ts, and on wabt-ts's build of the same source. */
function bothAgree(wat: string, arg = 0): number {
  const run = (bytes: Uint8Array) => {
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource));
    return (inst.exports.f as (x: number) => number)(arg);
  };
  const reference = run(wat2wasm(wat, { filename: 'ref.wat' }).binary);
  const got = run(encodeWasm(parseWat(wat)));
  assertEquals(got, reference, 'binaryen-ts must agree with wabt-ts');
  return got;
}

describe('WAT parser — numeric branch depths', () => {
  it('a numeric br targets a NAMED block', () => {
    assertEquals(
      bothAgree(
        '(module (func (export "f") (result i32) (block $B0 (result i32) (br 0 (i32.const 7)))))',
      ),
      7,
    );
  });

  it('a named br still works', () => {
    assertEquals(
      bothAgree(
        '(module (func (export "f") (result i32) (block $B0 (result i32) (br $B0 (i32.const 7)))))',
      ),
      7,
    );
  });

  // Depth is what distinguishes these two, so they must NOT return the same
  // value — a resolver that collapsed both to the innermost frame would pass a
  // test that only checked one.
  it('br 0 and br 1 select different blocks', () => {
    const inner =
      '(module (func (export "f") (result i32) (block $o (result i32) (block $i (result i32) (br 0 (i32.const 5))))))';
    const outer =
      '(module (func (export "f") (result i32) (block $o (result i32) (block $i (result i32) (br 1 (i32.const 9))))))';
    assertEquals(bothAgree(inner), 5);
    assertEquals(bothAgree(outer), 9);
  });

  it('a branch to the FUNCTION FRAME (depth past every block) returns', () => {
    // `br 1` from inside one block targets the implicit function block.
    assertEquals(
      bothAgree(
        '(module (func (export "f") (result i32) (block $b (result i32) (br 1 (i32.const 3)))))',
      ),
      3,
    );
  });

  // Discriminating the operand ORDER without needing a `drop`, which would be
  // stack-form and is a separate gap. `br_if` leaves its value on the stack when
  // the branch is NOT taken, so the block yields 7 either way when parsed
  // correctly. Read backwards — condition 7 (always true), value `local.get 0` —
  // it would yield the ARGUMENT instead. So f(0) is 7 when right and 0 when
  // reversed.
  it('br_if takes its condition LAST, after the carried value', () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l (result i32)
        (br_if $l (i32.const 7) (local.get 0)))))`;
    assertEquals(bothAgree(wat, 0), 7, 'condition is local.get 0, not the constant');
    assertEquals(bothAgree(wat, 1), 7, 'branch taken carries the same 7');
  });

  it('an anonymous block is still addressable by depth', () => {
    assertEquals(
      bothAgree(
        '(module (func (export "f") (result i32) (block (result i32) (br 1 (i32.const 4)))))',
      ),
      4,
    );
  });
});
