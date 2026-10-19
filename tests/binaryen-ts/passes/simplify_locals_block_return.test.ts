// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// SimplifyLocals, open-work 31: a block whose every way out sets one local gets that value as its
// RESULT, set once (upstream's `optimizeBlockReturn`; six real-compiler modules -Oz −184 bytes).
// Each case RUNS the module before and after the pass alone and asserts whether the fold happened;
// the controls are the blocks it must leave: a `br_if` to it, a way out setting another local or
// none, a shadowed label. And the corpus module that caught the first version's defect, through
// `wasmOpt` at every level.

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

type Fn = (...a: number[]) => unknown;

function simplify(wat: string) {
  const before = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('SimplifyLocals').run();
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text };
}

async function same(before: Uint8Array, after: Uint8Array, inputs: number[]) {
  const run = async (b: Uint8Array, a: number) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
    return String((instance.exports['f'] as Fn)(a));
  };
  for (const a of inputs) expect(await run(after, a)).toBe(await run(before, a));
}

const count = (text: string, s: string) => text.split(s).length - 1;

/**
 * A switch: each way out of `$exit` sets `$r` just before its `br`; `$exit` itself never falls
 * through. (The default's `-1` runs into case 1's code, so it is not a way out and stays.)
 */
const SWITCH = (caseThree: string) =>
  `(module
  (func (export "f") (param $v i32) (result i32) (local $r i32) (local $s i32)
    (block $exit
      (block $c2
        (block $c1
          (br_if $c1 (i32.eq (local.get $v) (i32.const 1)))
          (br_if $c2 (i32.eq (local.get $v) (i32.const 2)))
          ${caseThree}
          (local.set $r (i32.const -1)))
        (local.set $r (i32.const 10))
        (br $exit))
      (local.set $r (i32.const 20))
      (br $exit))
    (i32.add (local.get $r) (local.get $s))))`;

describe('a block whose every way out sets one local', () => {
  it('gets the value as its result, set once', async () => {
    const { before, after, text } = simplify(SWITCH(''));
    expect(count(text, 'local.set')).toBe(2); // the block's one set, and the default's `-1`
    expect(text).toContain('block (result i32)');
    await same(before, after, [0, 1, 2, 3]);
  });

  it('a fall-through that sets the local is a way out too', async () => {
    const { before, after, text } = simplify(`(module
      (func (export "f") (param $v i32) (result i32) (local $r i32)
        (block $exit
          (if (local.get $v) (then (local.set $r (i32.const 5)) (br $exit)))
          (local.set $r (i32.const 7)))
        (local.get $r)))`);
    expect(count(text, 'local.set')).toBe(1);
    await same(before, after, [0, 1]);
  });

  // Both blocks fold in one round: `$a`'s way out from inside `$b` is a set and a `br`, `$b`'s
  // fall-through set ends its list — no node is edited for both.
  it('nested blocks both fold', async () => {
    const { before, after, text } = simplify(`(module
      (func (export "f") (param $v i32) (result i32) (local $r i32)
        (block $a
          (block $b
            (if (i32.eq (local.get $v) (i32.const 1)) (then (local.set $r (i32.const 1)) (br $a)))
            (if (i32.eq (local.get $v) (i32.const 2)) (then (local.set $r (i32.const 6)) (br $b)))
            (local.set $r (i32.const 7)))
          (local.set $r (i32.add (local.get $r) (i32.const 100))))
        (local.get $r)))`);
    expect(count(text, 'block (result i32)')).toBe(2);
    await same(before, after, [0, 1, 2]);
  });

  it('a br_if to it stops the fold (control)', async () => {
    const { before, after, text } = simplify(
      SWITCH('(br_if $exit (i32.eq (local.get $v) (i32.const 3)))'),
    );
    expect(count(text, 'local.set')).toBe(3);
    await same(before, after, [0, 1, 2, 3]);
  });

  it('a way out that sets another local, or none, stops it (control)', async () => {
    const other = simplify(`(module
      (func (export "f") (param $v i32) (result i32) (local $r i32) (local $s i32)
        (block $exit
          (if (local.get $v) (then (local.set $s (i32.const 5)) (br $exit)))
          (local.set $r (i32.const 7)))
        (i32.add (local.get $r) (local.get $s))))`);
    expect(count(other.text, 'local.set')).toBe(2);
    await same(other.before, other.after, [0, 1]);
    const none = simplify(`(module
      (func (export "f") (param $v i32) (result i32) (local $r i32)
        (local.set $r (i32.const 3))
        (block $exit
          (if (local.get $v) (then (br $exit)))
          (local.set $r (i32.const 7)))
        (local.get $r)))`);
    expect(count(none.text, 'local.set')).toBe(2);
    await same(none.before, none.after, [0, 1]);
  });

  it('a shadowed label is left alone (control)', async () => {
    const { before, after, text } = simplify(`(module
      (func (export "f") (param $v i32) (result i32) (local $r i32)
        (block $b
          (block $b
            (if (local.get $v) (then (local.set $r (i32.const 5)) (br $b)))
            (local.set $r (i32.const 7)))
          (local.set $r (i32.add (local.get $r) (i32.const 1))))
        (local.get $r)))`);
    expect(count(text, 'local.set')).toBe(3);
    await same(before, after, [0, 1]);
  });

  // The first version folded the `if`s with a `mapExpression` that rebuilt the tree, then edited
  // the blocks' branches by the identity of nodes no longer in it: they kept no value.
  it('the switch the corpus has stays valid at every level', async () => {
    const wat = readFileSync(
      new URL('../../wabt-ts/wasmtk/core_SwitchCase.wat', import.meta.url),
      'utf8',
    );
    const bytes = wat2wasm(wat, { textForm: false }).binary;
    for (const [o, s] of [[1, 0], [2, 0], [3, 0], [2, 1], [2, 2]] as const) {
      await wasmOpt(bytes, { optimizeLevel: o, shrinkLevel: s, validate: true }).catch((e) => {
        throw new Error(`-O${o} shrink ${s}: ${(e as Error).message}`);
      });
    }
  });
});
