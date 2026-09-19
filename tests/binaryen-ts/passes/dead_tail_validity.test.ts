// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Dead-code removal asks whether a node NEVER FALLS THROUGH, not whether its
// TYPE is unreachable. A node with an unreachable OPERAND is typed unreachable
// and still runs in the byte stream, still leaving its own value on the stack:
// `(select (unreachable) x y)` encodes as `unreachable x y select`, and the
// `select` pushes. Reading the type as "terminates" made `wasm-opt` emit
// INVALID modules (One front end, 2026-09-19):
//
//   - DCE trimmed a block tail after such a node — the spec's
//     `unreached-valid.0`: "expected 0 elements on the stack for fallthru,
//     found 1";
//   - Vacuum replaced `(drop X)` with X — the spec's `br.0`: "expected 1
//     elements on the stack for fallthru, found 2".
//
// Both shapes are below, with a control: after a REAL terminator the tail is
// still removed, so the fix did not simply switch dead-code removal off.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

const LEVELS = [[1, 0], [2, 0], [3, 0], [2, 1], [2, 2]] as const;

function optimized(wat: string, optimizeLevel: 0 | 1 | 2 | 3, shrinkLevel: 0 | 1 | 2): Uint8Array {
  const bytes = wat2wasm(wat, { textForm: false }).binary;
  assert(bytes.length > 0, 'assembles');
  new WebAssembly.Module(bytes as BufferSource); // the INPUT is valid
  const m = parseWasm(bytes);
  new PassRunner(m, { optimizeLevel, shrinkLevel }).addDefaultOptimizationPasses().run();
  return encodeWasm(m);
}

/** The output at every level, each compiled — the assertion is validity. */
function assertValidAtEveryLevel(wat: string, what: string): void {
  for (const [o, s] of LEVELS) {
    const out = optimized(wat, o, s);
    try {
      new WebAssembly.Module(out as BufferSource);
    } catch (e) {
      throw new Error(`${what} at -O${o} shrink ${s}: ${(e as Error).message}`);
    }
  }
}

describe('dead-code removal keeps the output valid', () => {
  // The value the `br_if` leaves needs the `drop`: the block declares ONE
  // result and `i32.const 7` follows.
  it('a br_if whose carried value is a br (spec br.0)', () => {
    assertValidAtEveryLevel(
      `(module (func (export "f") (result i32)
        (block $l (result i32)
          i32.const 8
          br $l
          i32.const 1
          br_if $l
          drop
          i32.const 7)))`,
      'br_if carrying a br',
    );
  });

  // A void function of `select`s over `unreachable` operands — the spec's
  // `select-unreached`, whose shape matters: each `unreachable` is an OPERAND of
  // the select that follows it, so a reader's tree holds unreachable-TYPED
  // selects as the body's children, and only the trailing `unreachable` makes
  // the stack conform.
  it('selects over unreachable operands (spec unreached-valid.0)', () => {
    assertValidAtEveryLevel(
      `(module (func (export "f")
        unreachable
        select
        unreachable
        i32.const 0
        select
        unreachable
        i32.const 0
        i32.const 0
        select
        unreachable
        i32.const 0
        i32.const 0
        i32.const 0
        select
        unreachable))`,
      'select over unreachable',
    );
  });

  // A conditional branch is not a terminator: the tail after a `br_if` runs
  // when the condition is false, so removing it would change the RESULT, not
  // only the bytes.
  it('the tail after a br_if survives, and still runs', () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      (block $l (result i32)
        i32.const 8
        local.get 0
        br_if $l
        drop
        i32.const 7)))`;
    assertValidAtEveryLevel(wat, 'br_if tail');
    const run = (b: Uint8Array, x: number) =>
      (new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports.f as (
        v: number,
      ) => number)(x);
    for (const [o, s] of LEVELS) {
      const out = optimized(wat, o, s);
      assertEquals([run(out, 1), run(out, 0)], [8, 7], `-O${o} shrink ${s}`);
    }
  });

  it('the results are unchanged', () => {
    const wat = `(module (func (export "f") (result i32)
      (block $l (result i32)
        i32.const 8
        br $l
        i32.const 1
        br_if $l
        drop
        i32.const 7)))`;
    const run = (b: Uint8Array) =>
      (new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports.f as () =>
        number)();
    assertEquals(run(wat2wasm(wat, { textForm: false }).binary), 8);
    for (const [o, s] of LEVELS) assertEquals(run(optimized(wat, o, s)), 8, `-O${o} shrink ${s}`);
  });

  // The control: a REAL terminator still ends the block, so the tail goes.
  it('dead code after a real terminator is still removed', () => {
    // The tail is valid on its own (it leaves exactly the declared result) and
    // entirely dead.
    const wat = `(module (func (export "f") (result i32)
      (return (i32.const 1))
      (drop (i32.const 4))
      (i32.const 5)))`;
    const plain = wat2wasm(wat, { textForm: false }).binary;
    const out = optimized(wat, 2, 0);
    assert(out.length < plain.length, `expected the tail to go: ${out.length} vs ${plain.length}`);
    const m = parseWasm(out);
    assertEquals(m.functions[0]!.body.children.length, 1, 'one child: the return');
  });
});
