// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 1 (2026-11-13), A2: what a small module could make the library spend.
//
//   - 36 bytes declared two functions of 1,000,000 locals each: 549 MB to decode, reported
//     valid; 100 of them ran the heap out with a bare RangeError. The reader's cap was per
//     function. Now the module as a whole is held to 1,000,000 locals plus one per byte.
//   - The interpreter made every call's locals with only the DEPTH limited: 1,000 nested calls
//     of a 1,000,000-local function asked for 10^9 slots. Now the locals of every active call
//     together are held to `maxStackLocals`, and past it the call stack is exhausted, as an
//     engine's would be.
//   - Fuel counted instructions, not their work: a `memory.fill` of 1 GiB cost one unit. Now
//     bulk operations and a call's locals are charged by size.
//   - `memory.grow` allocated a new buffer and copied the memory on every grow, so growing a
//     page at a time cost the square of the final size. Now the storage doubles.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readWat } from '../../../src/tools/read-wat.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { Interpreter, Stop, Trap } from '../../../src/interp/interpreter.ts';
import { MemoryCell } from '../../../src/interp/memory.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { Result } from '../../../src/core/result.ts';
import { formatErrors } from '../../../src/core/error.ts';
import { MAX_MATERIALIZED_LOCALS, maxModuleLocals } from '../../../src/reader/binary-reader.ts';

const leb = (n: number): number[] => {
  const o: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return o;
};
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];

/**
 * A module of `funcs` functions of type `() -> ()`, each declaring `locals` i32 locals, the
 * first exported as "f" and calling itself when `recursive`.
 */
function manyLocals(funcs: number, locals: number, recursive = false): Uint8Array {
  const body = [1, ...leb(locals), 0x7f, ...(recursive ? [0x10, 0] : []), 0x0b];
  return new Uint8Array([
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(3, [...leb(funcs), ...Array<number>(funcs).fill(0)]),
    ...section(7, [1, 1, 0x66, 0, 0]),
    ...section(10, [
      ...leb(funcs),
      ...Array.from({ length: funcs }, () => [...leb(body.length), ...body]).flat(),
    ]),
  ]);
}

/** How running `f` ends: its results, or the Stop's or Trap's kind and message. */
function outcome(inst: Interpreter, args: unknown[] = []) {
  try {
    return { results: inst.invoke('f', args as never) };
  } catch (e) {
    if (e instanceof Stop) return { stop: e.reason, message: e.message };
    if (e instanceof Trap) return { trap: e.message };
    throw e;
  }
}

describe('security round 1 — decoding is held to the size of the input', () => {
  it('refuses a second function of 1,000,000 locals in a module of a few dozen bytes', () => {
    const wasm = manyLocals(2, 1_000_000);
    const { errors, result } = wasmValidate(wasm);
    expect(result).toBe(Result.Error);
    expect(formatErrors(errors)).toContain(
      `too many locals: 2000000 in the module so far exceeds this decoder's limit of ` +
        `${maxModuleLocals(wasm.length)}`,
    );
  });

  it('a hundred of them is the same refusal, not a heap exhausted', () => {
    const { errors, result } = wasmValidate(manyLocals(100, 1_000_000));
    expect(result).toBe(Result.Error);
    expect(formatErrors(errors)).toContain('too many locals');
  });

  it('still decodes one function at the per-function limit, and many small ones', () => {
    expect(wasmValidate(manyLocals(1, MAX_MATERIALIZED_LOCALS)).result).toBe(Result.Ok);
    expect(wasmValidate(manyLocals(1000, 500)).result).toBe(Result.Ok);
  });

  it('the budget grows with the input: one local per byte beyond the base', () => {
    expect(maxModuleLocals(0)).toBe(MAX_MATERIALIZED_LOCALS);
    expect(maxModuleLocals(5_000_000)).toBe(MAX_MATERIALIZED_LOCALS + 5_000_000);
  });
});

describe("security round 1 — the interpreter holds every active call's locals together", () => {
  it('a recursion through a 1,000,000-local function exhausts the call stack, at once', () => {
    const inst = new Interpreter(readForPasses(manyLocals(1, 1_000_000, true)));
    const t = performance.now();
    expect(outcome(inst)).toEqual({ trap: 'call stack exhausted' });
    // Four frames fit the default 4,000,000; the depth limit alone allowed 1,000.
    expect(performance.now() - t).toBeLessThan(10_000);
  });

  it('maxStackLocals is the bound, counted across frames', () => {
    const wat = `(module (func $r (export "f") (param i32) (local i32 i32 i32)
      (if (local.get 0) (then (call $r (i32.sub (local.get 0) (i32.const 1)))))))`;
    // Four slots a frame (the parameter and three locals): 10 frames are 40 slots.
    const run = (max: number, depth: number) =>
      outcome(new Interpreter(readWat(wat), { maxStackLocals: max }), [
        { type: 0x7f, value: depth - 1 },
      ]);
    expect(run(40, 10)).toEqual({ results: [] });
    expect(run(39, 10)).toEqual({ trap: 'call stack exhausted' });
  });

  it('runStatements (wasm-ctor-eval) releases its frame too', () => {
    const wat = '(module (func (export "f") (param i32) (local i32 i32 i32)))';
    const inst = new Interpreter(readWat(wat), { maxStackLocals: 7 });
    // Four slots a run; a leak exhausts the seven on the second.
    for (let k = 0; k < 5; k++) {
      expect(inst.runStatements(0, [{ type: 0x7f, value: 1 }] as never, () => undefined))
        .toEqual([]);
    }
  });

  it('a frame is released however the call ends: returns, traps, and tail calls', () => {
    const wat = `(module
      (func $leaf (param i32) (result i32) (local i32 i32 i32)
        (if (i32.eqz (local.get 0)) (then unreachable)) (local.get 0))
      (func $tail (param i32) (result i32) (local i32 i32 i32)
        (return_call $leaf (local.get 0)))
      (func (export "f") (param i32) (result i32) (call $tail (local.get 0))))`;
    const inst = new Interpreter(readWat(wat), { maxStackLocals: 13 });
    // Each run holds at most f (1) + tail or leaf (4), so a leak shows within three runs.
    for (let k = 0; k < 10; k++) {
      expect(outcome(inst, [{ type: 0x7f, value: 7 }])).toEqual({
        results: [{ type: 0x7f, value: 7 }],
      });
      expect(outcome(inst, [{ type: 0x7f, value: 0 }])).toEqual({ trap: 'unreachable' });
    }
  });
});

describe('security round 1 — fuel pays for the work, not only the instruction', () => {
  // Instantiated with fuel to spare (a segment's entries are evaluated then), refuelled for the call.
  const stops = (wat: string, fuel: number) => {
    const inst = new Interpreter(readWat(wat));
    inst.refuel(fuel);
    return outcome(inst);
  };

  const cases: [string, string][] = [
    [
      'memory.fill',
      '(memory 1) (func (export "f") (memory.fill (i32.const 0) (i32.const 1) (i32.const 65536)))',
    ],
    [
      'memory.copy',
      '(memory 1) (func (export "f") (memory.copy (i32.const 0) (i32.const 1) (i32.const 65535)))',
    ],
    [
      'memory.init',
      `(memory 1) (data $d "${
        'x'.repeat(40_000)
      }") (func (export "f") (memory.init $d (i32.const 0) (i32.const 0) (i32.const 40000)))`,
    ],
    ['memory.grow', '(memory 1) (func (export "f") (drop (memory.grow (i32.const 1))))'],
    [
      'table.fill',
      '(table 20000 funcref) (func (export "f") (table.fill 0 (i32.const 0) (ref.null func) (i32.const 20000)))',
    ],
    [
      'table.copy',
      '(table 20000 funcref) (func (export "f") (table.copy (i32.const 0) (i32.const 1) (i32.const 19999)))',
    ],
    [
      'table.grow',
      '(table 0 funcref) (func (export "f") (drop (table.grow (ref.null func) (i32.const 20000))))',
    ],
    [
      'table.init',
      `(table 20000 funcref) (elem $e func ${
        '$g '.repeat(20_000)
      }) (func $g) (func (export "f") (table.init $e (i32.const 0) (i32.const 0) (i32.const 20000)))`,
    ],
    [
      'array.new',
      '(type $a (array (mut i32))) (func (export "f") (drop (array.new $a (i32.const 0) (i32.const 20000))))',
    ],
    [
      'array.new_default',
      '(type $a (array (mut i32))) (func (export "f") (drop (array.new_default $a (i32.const 20000))))',
    ],
    [
      'array.fill',
      '(type $a (array (mut i32))) (func (export "f") (array.fill $a (array.new_default $a (i32.const 20000)) (i32.const 0) (i32.const 1) (i32.const 20000)))',
    ],
    ['locals of a call', `(func (export "f") (local ${'i32 '.repeat(20_000)}))`],
  ];
  it('array.fill is charged on its own, beyond the array.new before it', () => {
    // The new costs 20,000; the fill 20,000 more. 30,000 pays for the new but not both.
    const wat =
      '(module (type $a (array (mut i32))) (func (export "f") (array.fill $a (array.new_default $a (i32.const 20000)) (i32.const 0) (i32.const 1) (i32.const 20000))))';
    expect(stops(wat, 30_000)).toMatchObject({ stop: 'fuel' });
    expect(stops(wat, 41_000)).not.toHaveProperty('stop');
  });

  for (const [name, body] of cases) {
    it(`${name}: stops for fuel well short of its work, and runs with enough`, () => {
      const wat = `(module ${body})`;
      expect(stops(wat, 1_000)).toMatchObject({ stop: 'fuel' });
      expect(stops(wat, 1_000_000)).not.toHaveProperty('stop');
    });
  }

  it("an access out of bounds is still the spec's trap, not a fuel stop", () => {
    const wat =
      '(module (memory 1) (func (export "f") (memory.fill (i32.const 0) (i32.const 0) (i32.const -1))))';
    expect(stops(wat, 1_000)).toEqual({ trap: 'out of bounds memory access' });
  });

  it('unlimited fuel stays unlimited', () => {
    const wat =
      '(module (memory 1) (func (export "f") (memory.fill (i32.const 0) (i32.const 1) (i32.const 65536))))';
    expect(outcome(new Interpreter(readWat(wat)))).toEqual({ results: [] });
  });
});

describe('security round 1 — memory.grow copies under twice the final size, all told', () => {
  const limits = (initial: bigint, max?: bigint) =>
    ({ initial, ...(max === undefined ? {} : { max }), is64: false, shared: false }) as never;

  it('grows into spare room without a new buffer, keeping the contents and zeroing the rest', () => {
    const m = new MemoryCell(limits(1n));
    m.bytes[100] = 7;
    expect(m.grow(1n)).toBe(1n); // 2 pages: doubled from 1
    expect(m.grow(1n)).toBe(2n); // 3 pages: doubled to 4
    const store = m.bytes.buffer;
    expect(store.byteLength).toBe(4 * 65536);
    expect(m.grow(1n)).toBe(3n);
    expect(m.bytes.buffer).toBe(store); // the fourth page was already there
    expect(m.bytes.length).toBe(4 * 65536);
    expect(m.view.byteLength).toBe(4 * 65536);
    expect(m.bytes[100]).toBe(7);
    expect(m.bytes.subarray(65536).every((b) => b === 0)).toBe(true);
    expect(() => m.at(BigInt(4 * 65536), 0n, 1)).toThrow();
    // The spare room past the size is never visible: a grow shows zeros there, the spec's.
    const n = new MemoryCell(limits(1n));
    n.grow(2n);
    expect(n.bytes.length).toBe(3 * 65536);
    expect(n.bytes.every((b) => b === 0)).toBe(true);
  });

  it('a page at a time to 64 MiB allocates a handful of buffers, not one per page', () => {
    const m = new MemoryCell(limits(1n));
    const buffers = new Set<ArrayBufferLike>([m.bytes.buffer]);
    for (let p = 1; p < 1024; p++) {
      m.grow(1n);
      buffers.add(m.bytes.buffer);
    }
    expect(m.bytes.length).toBe(1024 * 65536);
    expect(buffers.size).toBeLessThanOrEqual(12);
  });

  it('never reserves past the declared maximum', () => {
    const m = new MemoryCell(limits(1n, 3n));
    m.grow(1n);
    expect(m.bytes.buffer.byteLength).toBeLessThanOrEqual(3 * 65536);
    expect(m.grow(1n)).toBe(2n);
    expect(m.grow(1n)).toBe(-1n);
  });
});
