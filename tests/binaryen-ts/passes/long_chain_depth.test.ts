// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// No pass deepens a long FLAT module past the nesting limit (C48's follow-up, 2026-11-20). The
// sinks were bounded after `-Oz` built a 1,000-deep tree out of a flat chain of sets
// (`sink_nesting_bound.test.ts`); this runs the other passes that rewrite statements into
// expressions — vacuum, code-folding, local-cse, flatten, merge-locals, precompute,
// precompute-propagate, remove-unused-brs, coalesce-locals — and -O2 / -O3 / -Oz over
// chains of 600 statements (well past the limit, 256) in the shapes that could nest: dependent
// sets, teed values, selects, blocks with results, copies. Measured on chains of 3,000 with all
// of them: the deepest output was 255 (the sinks' bound), none refused, none changed behaviour.
// (merge-blocks and rereloop are not ported passes: there is nothing to run.)

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { MAX_NESTING_DEPTH, nestingDepth } from '../../../src/ir/nesting.ts';

const N = 600;
const rep = (n: number, s: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => s(i)).join('\n');
const fn = (locals: string, body: string, tail = '(local.get $x)') =>
  `(module (func (export "f") (param $a i32) (result i32) (local $x i32) (local $y i32) ${locals}
${body}
${tail}))`;

const SHAPES: Record<string, string> = {
  'dependent temporaries': fn(
    Array.from({ length: N }, (_, i) => `(local $t${i} i32)`).join(' '),
    rep(
      N,
      (i) =>
        `(local.set $t${i} (i32.add ${
          i === 0 ? '(local.get $a)' : `(local.get $t${i - 1})`
        } (i32.const 1)))`,
    ),
    `(local.get $t${N - 1})`,
  ),
  'x = x * 3 + a - 2': fn(
    '',
    rep(
      N,
      () =>
        '(local.set $x (i32.sub (i32.add (i32.mul (local.get $x) (i32.const 3)) (local.get $a)) (i32.const 2)))',
    ),
  ),
  'tees: x = x + tee(y, x)': fn(
    '',
    rep(N, () => '(local.set $x (i32.add (local.tee $y (local.get $x)) (local.get $y)))'),
  ),
  'selects': fn(
    '',
    rep(N, () => '(local.set $x (select (local.get $x) (i32.const 1) (local.get $a)))'),
  ),
  'blocks with a result': fn(
    '',
    rep(
      N,
      () =>
        '(local.set $x (block (result i32) (local.set $y (i32.add (local.get $x) (i32.const 1))) (local.get $y)))',
    ),
  ),
  'dropped blocks': fn(
    '',
    rep(
      N,
      () =>
        '(drop (block (result i32) (local.set $x (i32.add (local.get $x) (i32.const 1))) (local.get $x)))',
    ),
  ),
  'copies': fn(
    Array.from({ length: N }, (_, i) => `(local $c${i} i32)`).join(' '),
    rep(N, (i) => `(local.set $c${i} (local.get ${i === 0 ? '$a' : `$c${i - 1}`}))`),
    `(local.get $c${N - 1})`,
  ),
};

const PASSES = [
  'vacuum',
  'code-folding',
  'local-cse',
  'flatten',
  'merge-locals',
  'coalesce-locals',
  'precompute',
  'precompute-propagate',
  'remove-unused-brs',
];

type Fn = (a: number) => number;
const exportOf = async (b: Uint8Array) =>
  (await WebAssembly.instantiate(b as BufferSource)).instance.exports['f'] as Fn;

async function check(
  wat: string,
  o: { optimizeLevel: 0 | 2 | 3; shrinkLevel: 0 | 2; passes: string[] },
) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const after = await wasmOpt(before, { ...o, output: '-' }) as Uint8Array;
  const m = readForPasses(after); // throws past the limit
  expect(Math.max(...m.functions.map((f) => nestingDepth(f.body)))).toBeLessThanOrEqual(
    MAX_NESTING_DEPTH,
  );
  const [f0, f1] = [await exportOf(before), await exportOf(after)];
  for (const a of [0, 1, -1, 7]) expect(f1(a)).toBe(f0(a));
}

describe('a long flat chain stays within the nesting limit through every pass', () => {
  for (const [shape, wat] of Object.entries(SHAPES)) {
    for (const pass of PASSES) {
      it(`${pass}: ${shape}`, async () => {
        await check(wat, { optimizeLevel: 0, shrinkLevel: 0, passes: [pass] });
      });
    }
  }
  for (const [shape, wat] of Object.entries(SHAPES)) {
    for (
      const [name, optimizeLevel, shrinkLevel] of [['-O2', 2, 0], ['-O3', 3, 0], [
        '-Oz',
        2,
        2,
      ]] as const
    ) {
      it(`${name}: ${shape}`, async () => {
        await check(wat, { optimizeLevel, shrinkLevel, passes: [] });
      });
    }
  }
});
