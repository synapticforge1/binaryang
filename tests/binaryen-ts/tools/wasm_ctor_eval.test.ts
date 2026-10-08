// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 23, E4: `wasm-ctor-eval`. Each case RUNS the module before and
// after under V8 with the same host, and compares what the program can see —
// the memory, the globals, what the host was told — because a wrong write-back
// is a valid module that starts in the wrong state. The structural claims
// (the export gone, the statements gone) are checked on the text.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm, writeWat } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import {
  ctorEval,
  type CtorEvalOptions,
  packMemory,
} from '../../../src/binaryen-ts/tools/wasm-ctor-eval.ts';

function evalled(wat: string, options: Partial<CtorEvalOptions>) {
  const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
  const report = ctorEval(m, { log: undefined, ...options });
  const bytes = writeWasm(m);
  expect(WebAssembly.validate(bytes as BufferSource)).toBe(true);
  return { report, bytes, text: writeWat(readForPasses(bytes)) };
}

/** Instantiates with a logging host, runs `calls`, and returns everything observable. */
async function run(bytes: Uint8Array, calls: string[]): Promise<unknown[]> {
  const log: number[] = [];
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {
    env: { log: (x: number) => log.push(x) },
  });
  const ex = instance.exports as Record<string, unknown>;
  const seen: unknown[] = [];
  for (const c of calls) {
    const f = ex[c] as ((...a: number[]) => unknown) | undefined;
    if (f === undefined) {
      seen.push(`${c}: no such export`);
      continue;
    }
    try {
      seen.push(f());
    } catch (e) {
      seen.push(`trap: ${(e as Error).message}`);
    }
  }
  const mem = ex.mem as WebAssembly.Memory | undefined;
  if (mem) {
    const b = new Uint8Array(mem.buffer);
    let h = 0x811c9dc5;
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193);
    seen.push(`mem ${b.length} ${(h >>> 0).toString(16)}`);
  }
  for (const [k, v] of Object.entries(ex)) {
    if (v instanceof WebAssembly.Global) seen.push(`${k}=${v.value}`);
  }
  return [...seen, `log ${log.join(',')}`];
}

const original = (wat: string) => wat2wasm(wat, { textForm: false }).binary;

const CTOR = `(module
  (import "env" "log" (func $log (param i32)))
  (memory (export "mem") 1)
  (global $count (export "count") (mut i32) (i32.const 0))
  (global $f (export "f") (mut f64) (f64.const 0))
  (data (i32.const 8) "abc")
  (func $fill (param $n i32) (local $i i32)
    (loop $l
      (i32.store8 (i32.add (i32.const 100) (local.get $i)) (i32.mul (local.get $i) (i32.const 3)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (local.get $n))))
    (global.set $count (i32.add (global.get $count) (local.get $n))))
  (func (export "init") (local $x i32)
    (call $fill (i32.const 10))
    (local.set $x (i32.const 7))
    (global.set $f (f64.sqrt (f64.const 2)))
    (call $log (global.get $count))
    (global.set $count (i32.add (global.get $count) (local.get $x))))
  (func (export "sum") (result i32) (local $i i32) (local $s i32)
    (loop $l
      (local.set $s (i32.add (local.get $s) (i32.load8_u (i32.add (i32.const 100) (local.get $i)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (i32.const 10))))
    (local.get $s)))`;

describe('wasm-ctor-eval writes the state a constructor reached back into the module', () => {
  it('a constructor cut at a host call: memory, globals and its local carried over', async () => {
    const { report, bytes, text } = evalled(CTOR, { ctors: ['init'] });
    expect(report.outcomes).toEqual([
      { name: 'init', statements: 3, of: 5, complete: false, reason: 'host: env.log' },
    ]);
    // The loop that filled memory is gone from the constructor the export now names;
    // what it computed is a data segment and the globals' initialisers.
    expect(text).toContain('(data (;1;) (offset (i32.const 101))');
    expect(text).toContain('(global $count (mut i32) (i32.const 10))');
    expect(text).toContain('(local.set 0\n      (i32.const 7))');
    // The program sees the same world once its constructor has run — the
    // memory, the globals, the host's log. (Not BEFORE: the tool's premise is
    // that the constructor runs at start, so what came before it is gone.)
    expect(await run(bytes, ['init', 'sum'])).toEqual(await run(original(CTOR), ['init', 'sum']));
  });

  it('a constructor that completes: its export goes; kept, it returns its results', async () => {
    const wat = `(module
      (memory (export "mem") 1)
      (global $g (export "g") (mut i32) (i32.const 1))
      (func (export "init") (result i32)
        (i32.store (i32.const 0) (i32.const 0x01020304))
        (global.set $g (i32.mul (global.get $g) (i32.const 21)))
        (i32.add (global.get $g) (i32.const 1)))
      (func (export "get") (result i32) (i32.load (i32.const 0))))`;
    const gone = evalled(wat, { ctors: ['init'] });
    expect(gone.report.outcomes).toEqual([{ name: 'init', statements: 3, of: 3, complete: true }]);
    expect(gone.text).not.toContain('(export "init"');
    expect(gone.text).toContain('(global $g (mut i32) (i32.const 21))');
    // The state after `init` ran, without running it.
    expect(await run(gone.bytes, ['get'])).toEqual(
      (await run(original(wat), ['init', 'get'])).filter((x) => x !== 22),
    );
    const kept = evalled(wat, { ctors: ['init'], keptExports: ['init'] });
    expect(kept.text).toContain('(export "init"');
    expect(await run(kept.bytes, ['init', 'get'])).toEqual([
      22,
      0x01020304,
      'mem 65536 e2d6fa05',
      'g=21',
      'log ',
    ]);
    expect(kept.text).toMatch(/\(func \(;2;\) \(type 0\) \(result i32\)\n\s+\(i32.const 22\)\)/);
  });

  it('a trap, a parameter without the flag, a table that changes: nothing written', async () => {
    const trap = evalled(
      `(module (memory (export "mem") 1) (global (export "g") (mut i32) (i32.const 0))
        (func (export "init") (global.set 0 (i32.const 5))
          (block (global.set 0 (i32.const 6)) (unreachable)) (global.set 0 (i32.const 7))))`,
      { ctors: ['init'] },
    );
    // Statement 1 ran and is written; the trap keeps everything from it on.
    expect(trap.report.outcomes[0]).toEqual({
      name: 'init',
      statements: 1,
      of: 3,
      complete: false,
      reason: 'trap: unreachable',
    });
    expect(trap.text).toContain('(mut i32) (i32.const 5)');
    expect(trap.text).toContain('unreachable');
    expect(await run(trap.bytes, ['init'])).toEqual(
      await run(
        original(`(module (memory (export "mem") 1) (global (export "g") (mut i32) (i32.const 0))
        (func (export "init") (global.set 0 (i32.const 5))
          (block (global.set 0 (i32.const 6)) (unreachable)) (global.set 0 (i32.const 7))))`),
        ['init'],
      ),
    );

    const params = evalled(
      `(module (global (export "g") (mut i32) (i32.const 0)) (func (export "init") (param i32) (global.set 0 (local.get 0))))`,
      { ctors: ['init'] },
    );
    expect(params.report.outcomes[0]!.reason).toBe('parameters');
    expect(params.text).toContain('(mut i32) (i32.const 0)');
    const zeroed = evalled(
      `(module (global (export "g") (mut i32) (i32.const 9)) (func (export "init") (param i32) (global.set 0 (local.get 0))))`,
      { ctors: ['init'], ignoreExternalInput: true },
    );
    expect(zeroed.report.outcomes[0]!.complete).toBe(true);
    expect(zeroed.text).toContain('(mut i32) (i32.const 0)');

    const table = evalled(
      `(module (table 2 funcref) (global (export "g") (mut i32) (i32.const 0))
        (func $f) (elem declare func $f)
        (func (export "init") (global.set 0 (i32.const 1)) (table.set 0 (i32.const 1) (ref.func $f)) (global.set 0 (i32.const 2))))`,
      { ctors: ['init'] },
    );
    expect(table.report.outcomes[0]).toEqual({
      name: 'init',
      statements: 1,
      of: 3,
      complete: false,
      reason: 'unsupported: cannot write back: a table changed',
    });
    expect(table.text).toContain('(mut i32) (i32.const 1)');
    expect(table.text).toContain('table.set');
  });

  it('the start function runs first and goes when complete', async () => {
    const wat = `(module (memory (export "mem") 1) (global $g (export "g") (mut i32) (i32.const 0))
      (func $start (global.set $g (i32.const 3)) (i32.store (i32.const 4) (i32.const 77)))
      (start $start)
      (func (export "init") (global.set $g (i32.add (global.get $g) (i32.const 1))))
      (func (export "get") (result i32) (i32.load (i32.const 4))))`;
    const { report, bytes, text } = evalled(wat, { ctors: ['init'] });
    expect(report.outcomes.map((o) => [o.name, o.complete])).toEqual([['(start)', true], [
      'init',
      true,
    ]]);
    expect(text).not.toContain('(start');
    expect(text).toContain('(i32.const 4))');
    expect(await run(bytes, ['get'])).toEqual(
      (await run(original(wat), ['init', 'get'])).filter((x) => x !== undefined),
    );
  });

  it('after a constructor that did not complete, no later one is evaluated', async () => {
    // 🔧 `second` WAS evaluated, onto `first`'s boundary state, and its effect
    // (×10) written back; then `first`'s remaining code set the global at run
    // time, after it, and `second` was gone: 6 where the program computes 60.
    const wat = `(module (import "env" "log" (func $log (param i32)))
      (memory (export "mem") 1) (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "first") (global.set $g (i32.const 5))
        (block (global.set $g (i32.const 6)) (call $log (global.get $g))))
      (func (export "second") (global.set $g (i32.mul (global.get $g) (i32.const 10)))))`;
    const { report, bytes, text } = evalled(wat, { ctors: ['first', 'second'] });
    expect(report.outcomes.map((o) => [o.name, o.statements, o.complete])).toEqual([
      ['first', 1, false],
      ['second', 0, false],
    ]);
    expect(report.outcomes[1]!.reason).toBe('first did not complete');
    // Written back: `first`'s boundary (5), not the 6 its failed statement
    // wrote before the host call; `second` untouched.
    expect(text).toContain('(mut i32) (i32.const 5)');
    expect(text).toContain('(export "second"');
    expect(await run(bytes, ['first', 'second'])).toEqual(
      await run(original(wat), ['first', 'second']),
    );
  });

  it('a statement that leaves a value on the stack is not a boundary', () => {
    // Linear text: the constant stays on the stack across the global.set and
    // the host call, and the `drop` after them takes it. A cut between would
    // leave a `drop` with nothing to drop — an invalid function.
    const wat = `(module (import "env" "log" (func $log (param i32)))
      (global $g (export "g") (mut i32) (i32.const 0))
      (func (export "init")
        i32.const 1
        i32.const 5
        global.set $g
        i32.const 2
        call $log
        drop))`;
    const { report, text } = evalled(wat, { ctors: ['init'] });
    expect(report.outcomes[0]!.statements).toBe(0);
    expect(text).toContain('(mut i32) (i32.const 0)');
  });

  it('memory that grew is written back at its new size', async () => {
    const wat = `(module (memory (export "mem") 1)
      (func (export "init")
        (drop (memory.grow (i32.const 1)))
        (i32.store (i32.const 70000) (i32.const 9)))
      (func (export "get") (result i32) (i32.load (i32.const 70000))))`;
    const { report, bytes, text } = evalled(wat, { ctors: ['init'] });
    expect(report.outcomes[0]!.complete).toBe(true);
    expect(text).toContain('(memory (;0;) 2)');
    expect(await run(bytes, ['get'])).toEqual(
      (await run(original(wat), ['init', 'get'])).filter((x) => x !== undefined),
    );
  });

  it('a module it cannot instantiate is returned untouched, with the reason', () => {
    const wat =
      `(module (import "env" "mem" (memory 1)) (func (export "init") (i32.store (i32.const 0) (i32.const 1))))`;
    const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
    const before = writeWasm(m);
    const r = ctorEval(m, { ctors: ['init'], log: undefined });
    expect(r.reason).toBe('cannot instantiate: host: memory env.mem');
    expect(writeWasm(m)).toEqual(before);
    expect(() => ctorEval(m, { ctors: ['nope'], log: undefined })).toThrow(
      'export not found: nope',
    );
  });
});

describe('packMemory', () => {
  it('splits on runs of zeros at least the gap long, and drops leading and trailing zeros', () => {
    const b = new Uint8Array(200);
    b[3] = 1;
    b[4] = 2;
    b[10] = 3; // 5 zeros between: merged
    b[100] = 4; // 89 zeros between: split
    b[101] = 5;
    expect(packMemory(b, 32).map((s) => [s.offset, [...s.data]])).toEqual([
      [3, [1, 2, 0, 0, 0, 0, 0, 3]],
      [100, [4, 5]],
    ]);
    expect(packMemory(new Uint8Array(50), 32)).toEqual([]);
    expect(packMemory(new Uint8Array([0, 0, 9]), 1).map((s) => s.offset)).toEqual([2]);
  });
});
