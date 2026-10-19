// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// DCE and the code after a construct that never reaches its `end` (open-work 31).
//
// Upstream binaryen types such a construct `unreachable` and its writer leaves out what follows.
// Ours missed two shapes, both on zig-debug:
//
//   1. a block in an OPERAND — `(local.tee (block …))`, as stack code reads back — was never
//      visited: DCE descended only through control nodes;
//   2. a block no branch targets, or a loop, whose every path ends in a terminator, ended
//      control and its tail stayed. Its `end` is a join point, so the stack after it is NOT
//      polymorphic: the tail becomes one `unreachable`, which keeps any enclosing `end` valid.
//
// (A dead branch still names its label until the next DCE removes it; repeating DCE to a fixed
// point for that was measured and not kept — dce.ts.) Each shape below, with its control (a
// targeted label, an `if` with no `else`: the tail runs).

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { type Expression, ExpressionKind } from '../../../src/ir/expressions.ts';
import { walkExpression } from '../../../src/ir/walk.ts';

const LEVELS = [[1, 0], [2, 0], [3, 0], [2, 1], [2, 2]] as const;

const assemble = (wat: string): Uint8Array => {
  const bytes = wat2wasm(wat, { textForm: false }).binary;
  new WebAssembly.Module(bytes as BufferSource); // the INPUT is valid
  return bytes;
};

/** DCE alone; the module, written and read back. */
function dce(wat: string): { bytes: Uint8Array; body: Expression } {
  const m = readForPasses(assemble(wat));
  new PassRunner(m, {}).add('DCE').run();
  const bytes = writeWasm(m);
  new WebAssembly.Module(bytes as BufferSource);
  return { bytes, body: readForPasses(bytes).functions[0]!.body };
}

function optimized(wat: string, optimizeLevel: 0 | 1 | 2 | 3, shrinkLevel: 0 | 1 | 2): Uint8Array {
  const m = readForPasses(assemble(wat));
  new PassRunner(m, { optimizeLevel, shrinkLevel }).addDefaultOptimizationPasses().run();
  return writeWasm(m);
}

const count = (e: Expression, kind: string): number => {
  let n = 0;
  walkExpression(e, (x) => {
    if (x.kind === kind) n++;
  });
  return n;
};

const run = (b: Uint8Array, x: number): number =>
  (new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports['f'] as (
    v: number,
  ) => number)(x);

/** Valid at every level, with the input's results for `args`. */
function assertSameEverywhere(wat: string, args: number[]): void {
  const want = args.map((a) => run(assemble(wat), a));
  for (const [o, s] of LEVELS) {
    assertEquals(args.map((a) => run(optimized(wat, o, s), a)), want, `-O${o} shrink ${s}`);
  }
}

// The global writes stand for dead work: DCE must remove them, and nothing else may.
const G = '(global $g (mut i32) (i32.const 0))';

describe('DCE after a construct that never reaches its end', () => {
  it('reaches a block in an operand position', () => {
    const wat = `(module ${G} (func (export "f") (param i32) (result i32)
      (i32.add (local.get 0)
        (block (result i32)
          (br 0 (i32.const 1))
          (global.set $g (i32.const 9))
          (i32.const 2)))))`;
    const { body } = dce(wat);
    assertEquals(count(body, ExpressionKind.GlobalSet), 0, 'the tail after the br went');
    assertSameEverywhere(wat, [0, 5]);
  });

  it('a block no branch targets, ending in a loop that never exits', () => {
    const wat = `(module ${G} (func (export "f") (param i32) (result i32)
      (block $out
        (block $a
          (loop $l
            (br_if $out (local.get 0))
            (global.set $g (i32.const 1))
            (br $l)))
        (global.set $g (i32.const 2))
        (global.set $g (i32.const 3)))
      (i32.const 7)))`;
    const { body } = dce(wat);
    assertEquals(count(body, ExpressionKind.GlobalSet), 1, "only the loop's write is left");
    assertEquals(count(body, ExpressionKind.Unreachable), 1, 'the tail is one unreachable');
    assertSameEverywhere(wat, [1]);
  });

  // The inserted `unreachable` is what keeps this valid: the outer block declares an i64, and
  // after the loop's `end` the stack is empty, not polymorphic.
  it('a tail that carried the enclosing result', () => {
    const wat = `(module ${G} (func (export "f") (param i32) (result i32)
      (i32.wrap_i64
        (block (result i64)
          (loop $l
            (br_if 2 (i32.const 4) (local.get 0))
            (br $l))
          (global.set $g (i32.const 2))
          (i64.const 5)))))`;
    const { body } = dce(wat);
    assertEquals(count(body, ExpressionKind.GlobalSet), 0);
    assertSameEverywhere(wat, [1]);
  });

  it('an if whose arms both end, and one with no else (control)', () => {
    const both = `(module ${G} (func (export "f") (param i32) (result i32)
      (if (local.get 0) (then (return (i32.const 1))) (else (return (i32.const 2))))
      (global.set $g (i32.const 2))
      (i32.const 4)))`;
    assertEquals(count(dce(both).body, ExpressionKind.GlobalSet), 0);
    assertSameEverywhere(both, [0, 1]);
    const noElse = `(module ${G} (func (export "f") (param i32) (result i32)
      (if (local.get 0) (then (return (i32.const 1))))
      (global.set $g (i32.const 2))
      (i32.const 4)))`;
    assertEquals(count(dce(noElse).body, ExpressionKind.GlobalSet), 1, 'the tail runs when 0');
    assertSameEverywhere(noElse, [0, 1]);
  });

  it('a targeted block keeps its tail, and the tail runs (control)', () => {
    const wat = `(module ${G} (func (export "f") (param i32) (result i32)
      (block $a
        (br_if $a (local.get 0))
        (return (i32.const 3)))
      (global.set $g (i32.const 2))
      (i32.const 4)))`;
    const { body, bytes } = dce(wat);
    assertEquals(count(body, ExpressionKind.GlobalSet), 1);
    assertEquals([run(bytes, 1), run(bytes, 0)], [4, 3]);
    assertSameEverywhere(wat, [0, 1]);
  });

  it('a try_table whose catch goes to its own label keeps its tail (control)', () => {
    const wat = `(module ${G} (tag $e) (func (export "f") (param i32) (result i32)
      (block $h
        (try_table (catch $e $h)
          (if (local.get 0) (then (throw $e)))
          (return (i32.const 3))))
      (global.set $g (i32.const 2))
      (i32.const 4)))`;
    const { body } = dce(wat);
    assertEquals(count(body, ExpressionKind.GlobalSet), 1, 'the catch reaches the tail');
    assertSameEverywhere(wat, [0, 1]);
    const plain = assemble(wat);
    assert(run(plain, 1) === 4);
  });
});
