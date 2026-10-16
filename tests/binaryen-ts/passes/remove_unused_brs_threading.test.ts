// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedBrs, open-work 31: jump threading (a branch to a block followed directly by `br $y`
// goes to `$y`), and RemoveUnusedBrs scheduled after CodeFolding (a folded terminating tail leaves
// `if (c) (then (br …))`). Each case RUNS the module before and after, and asserts whether the
// rewrite happened.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { walkExpression } from '../../../src/ir/walk.ts';
import { ExpressionKind, labelName } from '../../../src/ir/expressions.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

type Fn = (...a: number[]) => unknown;

function rub(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('RemoveUnusedBrs').add('RemoveUnusedNames').add('Vacuum').run();
  const after = writeWasm(m);
  expect(wasmValidate(after, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after, text: wasm2wat(after).text };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[]) {
  const run = async (b: Uint8Array, a: number) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    const ex = instance.exports as Record<string, unknown>;
    try {
      return `${a} -> ${String((ex['f'] as Fn)(a))} g=${(ex['g'] as WebAssembly.Global).value}`;
    } catch (e) {
      return `${a} -> trap: ${(e as Error).message}`;
    }
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

const count = (text: string, s: string) => text.split(s).length - 1;
const G = '(global $g (export "g") (mut i32) (i32.const 0))';
const INPUTS = [0, 1, 2, 3];

describe('a branch to a block followed by `br $y` goes to `$y`', () => {
  it('br_if and br_table both move, and the block goes', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $y
          (block $x
            (br_if $x (i32.eq (local.get 0) (i32.const 1)))
            (global.set $g (i32.const 5))
            (br_table $x $y $x (local.get 0)))
          (br $y))
        (i32.add (global.get $g) (i32.const 100))))`);
    expect(count(text, '(block')).toBe(1);
    await same(before, after, INPUTS);
  });
});

describe('not threaded when a label inside would catch the branch', () => {
  it('an inner label spelled like the target', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $y
          (block $x
            (block $y (global.set $g (i32.const 9)) (br_if $x (local.get 0)) (global.set $g (i32.const 3)))
            (global.set $g (i32.const 4)))
          (br $y))
        (global.get $g)))`);
    // Threaded, the `br_if` would exit the INNER `$y` only and run `(global.set $g 4)`.
    expect(text).toContain('br_if');
    await same(before, after, INPUTS);
  });

  it('an inner label spelled like the block itself', async () => {
    const { before, after, text } = rub(`(module ${G}
      (func (export "f") (param i32) (result i32)
        (block $y
          (block $x
            (block $x (global.set $g (i32.const 9)) (br_if $x (local.get 0)) (global.set $g (i32.const 3)))
            (global.set $g (i32.const 4)))
          (br $y))
        (global.get $g)))`);
    expect(count(text, 'br_if 0 ')).toBe(1); // still to the inner block, not threaded
    await same(before, after, INPUTS);
  });
});

describe('the -Oz schedule', () => {
  it('a folded panic tail leaves no `if (c) (br …)`: RemoveUnusedBrs runs after CodeFolding', async () => {
    const before = wat2wasm(
      `(module ${G}
      (func $p (param i32 i32) (global.set $g (i32.add (local.get 0) (local.get 1))))
      (func (export "f") (param i32) (result i32)
        (if (i32.eq (local.get 0) (i32.const 1))
          (then (call $p (local.get 0) (i32.add (local.get 0) (i32.const 7))) (unreachable)))
        (if (i32.eq (local.get 0) (i32.const 2))
          (then (call $p (local.get 0) (i32.add (local.get 0) (i32.const 7))) (unreachable)))
        (if (i32.eq (local.get 0) (i32.const 3))
          (then (call $p (local.get 0) (i32.add (local.get 0) (i32.const 7))) (unreachable)))
        (i32.mul (local.get 0) (i32.const 10))))`,
      { textForm: false },
    ).binary;
    const after = (await wasmOpt(before, { optimizeLevel: 2, shrinkLevel: 2 })) as Uint8Array;
    const text = wasm2wat(after).text;
    expect(count(text, 'unreachable')).toBe(1);
    expect(count(text, '(if')).toBe(0);
    await same(before, after, [0, 1, 2, 3, 4]);
  });

  // A small fixture is threaded in the FIRST round and cleaned in the second, so it cannot see the
  // late RemoveUnusedNames + Vacuum; a corpus module whose late rounds thread does (3 blocks left
  // without them, 2026-10-15). Over the whole corpus the -Oz output then holds no block nothing
  // branches to.
  it('no block nothing branches to survives -Oz (late threading cleaned up)', async () => {
    const wat = readFileSync(
      fileURLToPath(new URL('../../wabt-ts/wasmtk/52_StringFromCodePoint.wat', import.meta.url)),
      'utf8',
    );
    const out = (await wasmOpt(wat2wasm(wat, { textForm: false }).binary, {
      optimizeLevel: 2,
      shrinkLevel: 2,
    })) as Uint8Array;
    const m = readForPasses(out);
    let untargeted = 0;
    for (const fn of m.functions) {
      const targeted = new Set<string>();
      walkExpression(fn.body, (e) => {
        if (e.kind === ExpressionKind.Break) targeted.add(labelName(e.target));
        if (e.kind === ExpressionKind.Switch) {
          for (const t of [...e.targets, e.defaultTarget]) targeted.add(labelName(t));
        }
      });
      walkExpression(fn.body, (e) => {
        if (e.kind === ExpressionKind.Block && e.type === 'none' && !targeted.has(e.label)) {
          untargeted++;
        }
      });
    }
    expect(untargeted).toBe(0);
  });
});
