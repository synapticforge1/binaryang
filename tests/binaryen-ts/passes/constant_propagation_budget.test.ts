// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// ConstantPropagation (and PrecomputePropagate over it) kept one dense state of `numLocals`
// cells per block: blocks × locals in memory and time. A 60 KB module — one function with 10,000
// locals and 10,000 `(if (local.get $c) (then (nop)))` — took 5.8 GB and 6.3 s at
// `--precompute-propagate` (security review round 3, 2026-11-20; upstream: 0.1 s). Now only a
// local some block SETS holds a cell (the others hold their starting value everywhere), and a
// function whose (blocks + 1) × set locals passes CONSTANT_PROPAGATION_MAX_CELLS is left as it is
// (README "Limits on untrusted input").

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import {
  CONSTANT_PROPAGATION_MAX_CELLS,
  propagateFunction,
} from '../../../src/passes/constant-propagation.ts';

const rep = (n: number, f: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => f(i)).join('\n');
const bytesOf = (wat: string) => wat2wasm(wat, { textForm: false }).binary;
const call = async (b: Uint8Array, c: number) =>
  ((await WebAssembly.instantiate(b as BufferSource)).instance.exports['f'] as (
    c: number,
  ) => number)(
    c,
  );

/** `locals` locals none of them set, then `ifs` ifs on the parameter, then a read of a local. */
const unsetWat = (locals: number, ifs: number) =>
  `(module (func (export "f") (param $c i32) (result i32) (local ${'i32 '.repeat(locals)})
  ${rep(ifs, () => '(if (local.get $c) (then (nop)))')} (i32.add (local.get $c) (local.get 1))))`;

/** Every one of `locals` locals set to a constant and read straight after, then `ifs` ifs. */
const setWat = (locals: number, ifs: number) =>
  `(module (func (export "f") (param $c i32) (result i32) (local ${'i32 '.repeat(locals)})
  ${rep(locals, (i) => `(local.set ${i + 1} (i32.const ${i})) (drop (local.get ${i + 1}))`)}
  ${rep(ifs, () => '(if (local.get $c) (then (nop)))')} (local.get $c)))`;

describe('ConstantPropagation: work bounded by blocks and set locals', () => {
  it('10,000 locals nothing sets, 10,000 ifs: under 3 s, and the read still becomes its zero', async () => {
    const before = bytesOf(unsetWat(10_000, 10_000));
    const m = readForPasses(before);
    const t = performance.now();
    new PassRunner(m, {}).add('PrecomputePropagate').run();
    expect(performance.now() - t).toBeLessThan(3000); // measured ~0.2 s; the dense states: 6 s, 5.8 GB
    const after = writeWasm(m);
    for (const c of [0, 1, 5]) expect(await call(after, c)).toBe(await call(before, c));
    // `(local.get 1)` is a declared local nothing sets: it is its zero.
    expect(propagateFunction(readForPasses(before).functions[0]!)).toBe(true);
  });

  it('a function whose cells pass the budget is left as it is; below it, propagated', async () => {
    const small = readForPasses(bytesOf(setWat(3000, 300))).functions[0]!;
    expect(3001 * 3000).toBeLessThan(CONSTANT_PROPAGATION_MAX_CELLS);
    expect(propagateFunction(small)).toBe(true);
    // 3,000 set locals × (about 3 blocks per if × 6,000 + 1) passes 2^25 cells.
    const bigBytes = bytesOf(setWat(3000, 6000));
    const big = readForPasses(bigBytes).functions[0]!;
    const body = JSON.stringify(big.body, (_k, v) => typeof v === 'bigint' ? String(v) : v);
    expect(propagateFunction(big)).toBe(false);
    expect(JSON.stringify(big.body, (_k, v) => typeof v === 'bigint' ? String(v) : v)).toBe(body);
    expect(await call(bigBytes, 1)).toBe(1);
  });

  // What SSANoMerge feeds it, under the LocalGraph budget (round 3 review: PrecomputePropagate
  // 4.3 s and 5.2 GB after SSANoMerge on 10,000 `x = i; if (x) nop`; -O3 5.3 GB).
  const afterSsa = (wat: string) => {
    const m = readForPasses(bytesOf(wat));
    new PassRunner(m, {}).add('SSANoMerge').run();
    const t = performance.now();
    new PassRunner(m, {}).add('PrecomputePropagate').run();
    return performance.now() - t;
  };

  it('after SSANoMerge: 9,000 `x = i; if (x) nop` under 3 s', () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      ${rep(9000, (i) => `(local.set 1 (i32.const ${i})) (if (local.get 1) (then (nop)))`)}
      (i32.add (local.get 0) (local.get 1))))`;
    expect(afterSsa(wat)).toBeLessThan(3000); // 9,002 locals, each set its own; measured ~0.1 s; the dense states: ~4 s, 5 GB
  });

  it('after SSANoMerge: 9,000 `if (a) x = i` under 3 s', () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      ${rep(9000, (i) => `(if (local.get 0) (then (local.set 1 (i32.const ${i}))))`)}
      (local.get 1)))`;
    expect(afterSsa(wat)).toBeLessThan(3000);
  });

  it('20,000 locals nothing sets, 20,000 ifs: under 3 s', () => {
    const m = readForPasses(bytesOf(unsetWat(20_000, 20_000)));
    const t = performance.now();
    new PassRunner(m, {}).add('PrecomputePropagate').run();
    expect(performance.now() - t).toBeLessThan(3000); // the dense states: 36 s and 16 GB at -O2 on Bun
  });
});
