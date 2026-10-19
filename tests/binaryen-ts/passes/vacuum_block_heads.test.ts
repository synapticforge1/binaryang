// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Vacuum moves the HEAD of a named block out in front of it (open-work 31, upstream MergeBlocks):
// leading statements that never name the block's label run the same outside it. Zig's code holds
// such blocks, and once the head is out the block is often an `if` or a loop the later passes can
// shrink (six real-compiler modules -Oz −133 bytes).
//
// The controls: a statement that names the label stays, and so does everything after it; the
// last child always stays. And the defect the first version had: a void statement is not always
// stack-neutral — `(local.set $a (call $two))` leaves a second result for a later `pop` in the same
// block — so nothing moves out of a block that holds a `pop` (the corpus's `27_number-parsing`).

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { assertEquals } from '@std/assert';

import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { type Expression, ExpressionKind } from '../../../src/ir/expressions.ts';

const LEVELS = [[1, 0], [2, 0], [3, 0], [2, 1], [2, 2]] as const;

const assemble = (wat: string): Uint8Array => {
  const bytes = wat2wasm(wat, { textForm: false }).binary;
  new WebAssembly.Module(bytes as BufferSource);
  return bytes;
};

/** Vacuum alone: the function's top-level children, as written and read back. */
function vacuum(wat: string): Expression[] {
  const m = readForPasses(assemble(wat));
  new PassRunner(m, {}).add('Vacuum').run();
  const bytes = writeWasm(m);
  new WebAssembly.Module(bytes as BufferSource);
  return readForPasses(bytes).functions[0]!.body.children;
}

function optimized(wat: string, optimizeLevel: 0 | 1 | 2 | 3, shrinkLevel: 0 | 1 | 2): Uint8Array {
  const m = readForPasses(assemble(wat));
  new PassRunner(m, { optimizeLevel, shrinkLevel }).addDefaultOptimizationPasses().run();
  return writeWasm(m);
}

const run = (b: Uint8Array, x: number): number[] => {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource));
  const r = (inst.exports['f'] as (v: number) => number)(x);
  return [r, (inst.exports['g'] as WebAssembly.Global).value as number];
};

function assertSameEverywhere(wat: string, args: number[]): void {
  const want = args.map((a) => run(assemble(wat), a));
  for (const [o, s] of LEVELS) {
    assertEquals(args.map((a) => run(optimized(wat, o, s), a)), want, `-O${o} shrink ${s}`);
  }
}

const kinds = (cs: Expression[]) => cs.map((c) => c.kind);
const G = '(global $g (export "g") (mut i32) (i32.const 0))';

describe('Vacuum: the head of a named block', () => {
  it('moves out, up to the first statement that names the label', () => {
    const wat = `(module ${G} (func (export "f") (param i32) (result i32)
      (block $b
        (global.set $g (i32.const 1))
        (global.set $g (i32.add (global.get $g) (i32.const 2)))
        (br_if $b (local.get 0))
        (global.set $g (i32.const 9)))
      (global.get $g)))`;
    const top = vacuum(wat);
    assertEquals(kinds(top), [
      ExpressionKind.GlobalSet,
      ExpressionKind.GlobalSet,
      ExpressionKind.Block,
      ExpressionKind.GlobalGet,
    ]);
    const block = top[2] as Extract<Expression, { kind: typeof ExpressionKind.Block }>;
    assertEquals(
      kinds(block.children),
      [ExpressionKind.Break, ExpressionKind.GlobalSet],
      'the br_if and after stay',
    );
    assertSameEverywhere(wat, [0, 1]);
  });

  it('a statement that branches to the label stays, even nested (control)', () => {
    const wat = `(module ${G} (func (export "f") (param i32) (result i32)
      (block $b
        (if (local.get 0) (then (br $b)))
        (global.set $g (i32.const 9)))
      (global.get $g)))`;
    assertEquals(kinds(vacuum(wat)), [ExpressionKind.Block, ExpressionKind.GlobalGet]);
    assertSameEverywhere(wat, [0, 1]);
  });

  it('the last child stays inside (control)', () => {
    const wat = `(module ${G} (func (export "f") (param i32) (result i32)
      (block $b
        (global.set $g (i32.const 4))
        (br_if $b (local.get 0)))
      (global.set $g (i32.const 5))
      (block $c
        (global.set $g (i32.add (global.get $g) (i32.const 1))))
      (global.get $g)))`;
    const top = vacuum(wat);
    const c = top.find((x, i) => i > 1 && x.kind === ExpressionKind.Block);
    // `$c` holds one statement and nothing names it: it may stay a block or become that
    // statement, never an empty block.
    if (c !== undefined) assertEquals((c as { children: Expression[] }).children.length, 1);
    assertSameEverywhere(wat, [0, 1]);
  });

  // The first version's defect, on the module that showed it: a two-result call whose results
  // are set one statement at a time, the second through a `pop`. (A hand-written module of that
  // shape did not reach Vacuum in it — the text front end and inlining reshape it first.)
  // Through `wasmOpt`, whose level presets are what reach the shape (a bare PassRunner's
  // defaults did not); it validates its own output and throws when that fails.
  it('nothing moves out of a block holding a pop (the corpus module)', async () => {
    const wat = readFileSync(
      new URL('../../wabt-ts/wasmtk/27_number-parsing.wat', import.meta.url),
      'utf8',
    );
    const bytes = assemble(wat);
    for (const [o, s] of LEVELS) {
      await wasmOpt(bytes, { optimizeLevel: o, shrinkLevel: s, validate: true }).catch((e) => {
        throw new Error(`-O${o} shrink ${s}: ${(e as Error).message}`);
      });
    }
  });
});
