// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The hang check (owner, 2026-10-09: "the cheap sound version of checking for
// stack changes after say 20s minimum intervals ... the best of fuel and trust
// but verify"). Fuel stays the deterministic bound; the check, when due, samples
// one loop as it comes back to its top and stops the run only on a PROOF: the
// same locals and operand stack the next time round, with nothing in between
// that could change anything else. Pinned both ways: every proof fires, and
// nothing that merely LOOKS stuck — a counter, a memory write, a call — does.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { readWat } from '../../../src/tools/read-wat.ts';
import { Interpreter, Stop } from '../../../src/interp/interpreter.ts';
import { ValType } from '../../../src/ir/types.ts';

const i32 = (value: number) => ({ type: ValType.I32, value });

/** What running `f` ends with: its results, or the Stop's reason and message. */
function run(wat: string, opts: { hangCheck: number | null; fuel?: number }, args: unknown[] = []) {
  const inst = new Interpreter(readWat(wat), {
    fuel: opts.fuel ?? 2_000_000,
    hangCheck: opts.hangCheck,
  });
  try {
    return { results: inst.invoke('f', args as never) };
  } catch (e) {
    if (e instanceof Stop) return { stop: e.reason, message: e.message };
    throw e;
  }
}

describe('the hang check: a loop that provably never exits', () => {
  it('stops `(loop (br 0))` as a hang, on its second pass', () => {
    const r = run('(module (func (export "f") (loop (br 0))))', { hangCheck: 0 });
    expect(r).toMatchObject({ stop: 'hang' });
    expect(r.message).toMatch(
      /never exits: it came back to its top with the same locals and stack/,
    );
  });

  it('stops a spin on a condition nothing changes', () => {
    const wat = '(module (func (export "f") (param i32) (loop (br_if 0 (i32.eqz (local.get 0))))))';
    expect(run(wat, { hangCheck: 0 }, [i32(0)])).toMatchObject({ stop: 'hang' });
  });

  it('stops an outer loop that repeats although an inner loop runs inside it', () => {
    const wat = `(module (func (export "f") (local i32)
      (loop $o (local.set 0 (i32.const 0))
        (loop $i (local.set 0 (i32.add (local.get 0) (i32.const 1)))
          (br_if $i (i32.lt_u (local.get 0) (i32.const 3))))
        (br $o))))`;
    const r = run(wat, { hangCheck: 0 });
    expect(r).toMatchObject({ stop: 'hang' });
    expect(r.message).toContain('loop $o');
  });

  it('reads memory and globals without spoiling the proof', () => {
    const wat = `(module (memory 1) (global $g i32 (i32.const 0))
      (func (export "f") (loop (br_if 0 (i32.eqz (i32.add (i32.load (i32.const 0)) (global.get $g)))))))`;
    expect(run(wat, { hangCheck: 0 })).toMatchObject({ stop: 'hang' });
  });
});

describe('the hang check: what only looks stuck runs until fuel', () => {
  const fuel = (wat: string) => run(wat, { hangCheck: 0, fuel: 200_000 });

  it('a counter that changes every pass', () => {
    expect(fuel(`(module (func (export "f") (local i32)
      (loop (local.set 0 (i32.add (local.get 0) (i32.const 1))) (br 0))))`)).toMatchObject({
      stop: 'fuel',
    });
  });

  it('a loop that writes memory, even the same value', () => {
    expect(fuel(`(module (memory 1) (func (export "f")
      (loop (i32.store (i32.const 0) (i32.const 1)) (br 0))))`)).toMatchObject({ stop: 'fuel' });
  });

  it('a loop that writes a global, or calls a function', () => {
    expect(fuel(`(module (global $g (mut i32) (i32.const 0)) (func (export "f")
      (loop (global.set $g (i32.const 1)) (br 0))))`)).toMatchObject({ stop: 'fuel' });
    expect(fuel(`(module (func $h) (func (export "f") (loop (call $h) (br 0))))`))
      .toMatchObject({ stop: 'fuel' });
  });

  it('a loop that finishes returns its result', () => {
    expect(run(
      `(module (func (export "f") (result i32) (local i32)
      (loop (local.set 0 (i32.add (local.get 0) (i32.const 1)))
        (br_if 0 (i32.lt_u (local.get 0) (i32.const 1000)))) (local.get 0)))`,
      { hangCheck: 0 },
    ))
      .toEqual({ results: [i32(1000)] });
  });
});

describe('the hang check: when it looks', () => {
  const spin = '(module (func (export "f") (loop (br 0))))';

  it('waits for its interval, then finds the hang', () => {
    // 100 ms in, far below the fuel: the clock, read every 65,536 instructions, arms it.
    const t = performance.now();
    expect(run(spin, { hangCheck: 100, fuel: 1e12 })).toMatchObject({ stop: 'hang' });
    expect(performance.now() - t).toBeGreaterThanOrEqual(100);
  });

  it('does not look before its interval: fuel stops a short spin first', () => {
    expect(run(spin, { hangCheck: 60_000, fuel: 100_000 })).toMatchObject({ stop: 'fuel' });
  });

  it('`null` turns it off', () => {
    expect(run(spin, { hangCheck: null, fuel: 100_000 })).toMatchObject({ stop: 'fuel' });
  });
});
