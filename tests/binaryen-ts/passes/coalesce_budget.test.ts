// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 2 (2026-11-13), A:
//
//   - One 35-byte VALID function declaring the reader's maximum of 1,000,000 locals ran
//     `wasm-opt` for hours and gigabytes: CoalesceLocals allocated one byte per PAIR of locals and
//     checked each local against every member of a slot — the square of a count the input names
//     (10,000 locals 0.3 s, 50,000 6.9 s, 100,000 past 5 minutes, measured that day). Now locals
//     nothing references go straight to the lowest slot of their type (the slot the colouring
//     chose for them: the output is byte-identical on the 5,924 spec modules and the 421
//     real-compiler ones), the matrix is a bitset over the referenced locals only, and a function
//     with more than COALESCE_MAX_REFERENCED_LOCALS of them is left as it is.
//   - Then the reader's backstop reported the out-of-memory as "internal decode error", which the
//     failure path read as the INPUT's invalidity: a valid module called invalid. Now a decoder
//     failure is no verdict (`decoderFailed`, `invalidity`).

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { invalidity, readForPasses } from '../../../src/ir/prepare.ts';
import { readWat } from '../../../src/tools/read-wat.ts';
import { defaultPassOptions, PassRunner } from '../../../src/passes/pass.ts';
import { COALESCE_MAX_REFERENCED_LOCALS } from '../../../src/passes/coalesce-locals.ts';
import {
  decoderFailed,
  INTERNAL_DECODE_ERROR,
  MAX_MATERIALIZED_LOCALS,
  readBinaryIr,
} from '../../../src/reader/binary-reader.ts';
import { makeErrorList } from '../../../src/core/error.ts';
import { ValType } from '../../../src/ir/types.ts';
import type { WasmModule } from '../../../src/ir/module.ts';

const leb = (v: number): number[] => {
  const o: number[] = [];
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    o.push(b);
  } while (v);
  return o;
};
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
/** One exported `() -> ()` function: `locals` i32 locals, and `code` as its body (before `end`). */
function fn(locals: number, code: number[] = []): Uint8Array {
  const body = [1, ...leb(locals), 0x7f, ...code, 0x0b];
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
    ...section(3, [1, 0]),
    ...section(7, [1, 1, 0x66, 0, 0]),
    ...section(10, [1, ...leb(body.length), ...body]),
  ]);
}
const coalesce = (m: WasmModule) =>
  new PassRunner(m, { ...defaultPassOptions, optimizeLevel: 2 }).add('CoalesceLocals').run();

describe('security round 2 — CoalesceLocals is bounded by the input, not by the counts in it', () => {
  it('the 35-byte module of 1,000,000 locals optimizes in seconds, its locals one slot', {
    timeout: 120_000,
  }, async () => {
    const wasm = fn(MAX_MATERIALIZED_LOCALS);
    expect(wasm.length).toBeLessThan(40);
    const t = performance.now();
    const out = await wasmOpt(wasm, { optimizeLevel: 2 });
    expect(performance.now() - t).toBeLessThan(30_000);
    const m = readForPasses(out as Uint8Array);
    expect(m.functions[0]!.locals.length).toBeLessThanOrEqual(1);
  });

  it('places locals nothing references in the lowest slot of their type, a new one if none', () => {
    // params i32, f64; locals i64 i32 f64 i64, none used: i32 → param 0's slot, f64 → param 1's,
    // the i64s share one new slot.
    const m = readWat(
      '(module (func (export "f") (param i32 f64) (local i64 i32 f64 i64)))',
    );
    coalesce(m);
    expect(m.functions[0]!.locals.map((l) => l.type)).toEqual([
      ValType.I32,
      ValType.F64,
      ValType.I64,
    ]);
  });

  it('a referenced local still takes a lowest fitting slot among unreferenced ones', () => {
    // $a is unused; $b is set and read: it may share $a's slot (no interference).
    const m = readWat(
      '(module (func (export "f") (result i32) (local $a i32) (local $b i32) ' +
        '(local.set $b (i32.const 7)) (local.get $b)))',
    );
    coalesce(m);
    expect(m.functions[0]!.locals.length).toBe(1);
  });

  /** All `n` locals live at once: each set, then each read and dropped. */
  const allLive = (n: number) => {
    const code: number[] = [];
    for (let i = 0; i < n; i++) code.push(0x41, 0, 0x21, ...leb(i));
    for (let i = 0; i < n; i++) code.push(0x20, ...leb(i), 0x1a);
    return fn(n, code);
  };

  it(
    'at the budget it colours; one past it the function is left as it is',
    { timeout: 120_000 },
    () => {
      // A copy chain makes coalescing visible: x1 = x0 … every local is a copy of the one before,
      // read once, so all share one slot when the pass runs.
      const chain = (n: number) => {
        const code: number[] = [0x41, 1, 0x21, 0];
        for (let i = 1; i < n; i++) code.push(0x20, ...leb(i - 1), 0x21, ...leb(i));
        code.push(0x20, ...leb(n - 1), 0x1a);
        return fn(n, code);
      };
      const at = readForPasses(chain(COALESCE_MAX_REFERENCED_LOCALS));
      coalesce(at);
      expect(at.functions[0]!.locals.length).toBeLessThan(COALESCE_MAX_REFERENCED_LOCALS);
      const past = readForPasses(chain(COALESCE_MAX_REFERENCED_LOCALS + 1));
      coalesce(past);
      expect(past.functions[0]!.locals.length).toBe(COALESCE_MAX_REFERENCED_LOCALS + 1);
    },
  );

  it('at the budget, every local live at once: seconds, not minutes', { timeout: 120_000 }, () => {
    const m = readForPasses(allLive(COALESCE_MAX_REFERENCED_LOCALS));
    const t = performance.now();
    coalesce(m);
    expect(performance.now() - t).toBeLessThan(20_000);
    // none can share: all live together
    expect(m.functions[0]!.locals.length).toBe(COALESCE_MAX_REFERENCED_LOCALS);
  });
});

describe('security round 2 — the decoder failing is no verdict on the input', () => {
  // Typed-array methods refuse a Proxy, so the reader throws inside: its backstop's error.
  const failing = () => new Proxy(fn(1), {}) as unknown as Uint8Array;

  it("the backstop's error is recognised as the decoder's own failure", () => {
    const errors = makeErrorList();
    readBinaryIr(failing(), errors, {});
    expect(errors.map((e) => e.message.split(':')[0])).toContain(INTERNAL_DECODE_ERROR);
    expect(decoderFailed(errors)).toBe(true);
    const ok = makeErrorList();
    readBinaryIr(fn(1), ok, {});
    expect(decoderFailed(ok)).toBe(false);
  });

  it("invalidity gives no verdict when the decoder failed, and the validator's when it did not", () => {
    expect(invalidity(failing(), '<x>')).toBe(null);
    expect(invalidity(fn(1), '<x>')).toBe(null);
    const bad = fn(1, [0x6a]); // i32.add with nothing on the stack
    expect(invalidity(bad, '<x>')).toMatch(/type mismatch|expected/);
  });
});
