// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Inlining over many functions. For every `__inlined_func$` wrapper block the pass scanned ALL
// inlineable function names to learn which callee the label names: n² string work. A chain of
// `$f_i` returning `(call $f_{i+1} (i32.add (local.get 0) (i32.const 1)))` (one exported) took
// 7.1 s at 10,000 functions and 24.3 s at 20,000 with `--inlining`, 34 s at -O3 (a 600 KB input);
// upstream: 0.3 s (security review round 3, 2026-11-20). The label is now looked up by its
// prefixes, so the work is the label's length.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { calleeOfLabel } from '../../../src/passes/inlining.ts';
import process from 'node:process';

/** CPU time of this process, in ms: the bounds below are on work, not on how busy the machine
 * is (a wall-clock bound failed under the gate's load, 2026-11-25; Q-H5's method). */
const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

function chainWat(n: number): string {
  const fs: string[] = [];
  for (let i = 0; i < n; i++) {
    fs.push(
      i === n - 1
        ? `(func $f${i} (param i32) (result i32) (local.get 0))`
        : `(func $f${i} (param i32) (result i32) (call $f${
          i + 1
        } (i32.add (local.get 0) (i32.const 1))))`,
    );
  }
  return `(module ${fs.join('\n')} (export "f" (func $f0)))`;
}

describe('inlining: many functions', () => {
  it('a chain of 20,000 functions at --inlining: under 6 s', () => {
    const m = readForPasses(wat2wasm(chainWat(20_000), { textForm: false }).binary);
    const t = cpuMs();
    new PassRunner(m, {}).add('Inlining').run();
    expect(cpuMs() - t).toBeLessThan(6000); // measured ~1.5 s; scanning every name: ~9 s
  });

  it('a chain of 2,000 functions inlines and the result still runs', async () => {
    const before = wat2wasm(chainWat(2000), { textForm: false }).binary;
    const m = readForPasses(before);
    new PassRunner(m, {}).add('Inlining').run();
    expect(m.functions.length).toBeLessThan(2000);
    const after = writeWasm(m);
    const f = async (b: Uint8Array) =>
      ((await WebAssembly.instantiate(b as BufferSource)).instance.exports['f'] as (
        a: number,
      ) => number)(
        5,
      );
    expect(await f(after)).toBe(await f(before));
  });

  it('the callee of a wrapper label: the longest name, by lookups, not a scan', () => {
    let lookups = 0;
    const names = new Map<string, number>(
      Array.from({ length: 50_000 }, (_, i) => [`$f${i}`, i] as [string, number]),
    );
    names.set('$a', 1);
    names.set('$a$b', 2);
    const counting = new Proxy(names, {
      get(target, prop) {
        if (prop === 'has') {
          return (k: string) => {
            lookups++;
            return target.has(k);
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    expect(calleeOfLabel('$f123', counting)).toBe('$f123');
    expect(calleeOfLabel('$f123$7', counting)).toBe('$f123'); // a hint suffix
    expect(calleeOfLabel('$a$b$3', counting)).toBe('$a$b'); // the longest of two
    expect(calleeOfLabel('$a$c', counting)).toBe('$a');
    expect(calleeOfLabel('$f12x', counting)).toBeUndefined();
    expect(lookups).toBeLessThan(20);
  });

  it('a long label with no match costs at most the longest name, not its own length (round 5)', () => {
    // 1,000,000 `$` and no callee: every `$` was a probe, each slicing the label (71 s). With the
    // longest inlineable name passed, no prefix longer than it is tried.
    const names = new Map<string, unknown>([['$a', 0], ['$a$b', 0]]);
    const t = cpuMs();
    expect(calleeOfLabel('$'.repeat(1_000_000), names, 4)).toBeUndefined();
    expect(cpuMs() - t).toBeLessThan(1000);
    // The bound keeps every answer within it: the longest match still wins.
    expect(calleeOfLabel('$a$b$3', names, 4)).toBe('$a$b');
    expect(calleeOfLabel('$a$c', names, 4)).toBe('$a');
  });

  it('a callee named "" is found, as the old scan found it (review round 4)', () => {
    // The old scan matched "" against any label rest starting with `$`; a longer name still wins.
    const names = new Map<string, unknown>([['', 0], ['$g', 0]]);
    expect(calleeOfLabel('$3', names)).toBe('');
    expect(calleeOfLabel('$x$3', names)).toBe('');
    expect(calleeOfLabel('$g$3', names)).toBe('$g');
    expect(calleeOfLabel('x', names)).toBeUndefined();
  });
});
