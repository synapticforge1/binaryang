// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 23, E1: OptimizeInstructions folds through the evaluator's numeric
// core — one semantics. Three rules decide WHETHER it folds, each checked by
// running the module before and after:
//   - every scalar operator folds, floats and division included;
//   - an operation that traps is left to trap;
//   - an arithmetic NaN is left to the engine; a bit-exact one (neg, abs,
//     copysign, reinterpret) folds with its payload.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm, writeWat } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

function optimize(body: string, result: string) {
  const wat = `(module (func (export "f") (result ${result}) ${body}))`;
  const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
  new PassRunner(m, {}).add('OptimizeInstructions').run();
  return {
    before: wat2wasm(wat, { textForm: false }).binary,
    after: writeWasm(m),
    text: writeWat(m),
  };
}
async function run(bytes: Uint8Array): Promise<unknown> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  try {
    return (instance.exports.f as () => unknown)();
  } catch (e) {
    return e instanceof WebAssembly.RuntimeError ? `trap: ${e.message}` : Promise.reject(e);
  }
}

describe('OptimizeInstructions folds through the evaluator', () => {
  it('float arithmetic and conversions fold', async () => {
    const r = optimize(
      '(i32.trunc_f64_s (f64.floor (f64.add (f64.const 2.5) (f64.const 0.5))))',
      'i32',
    );
    expect(r.text).not.toContain('f64.');
    expect(r.text).toContain('i32.const 3');
    expect(await run(r.after)).toBe(await run(r.before));
  });

  it('division by a non-zero constant folds', async () => {
    const r = optimize('(i32.div_s (i32.const -7) (i32.const 2))', 'i32');
    expect(r.text).toContain('i32.const -3');
    expect(await run(r.after)).toBe(-3);
  });

  it('a division by zero is left to trap', async () => {
    const r = optimize('(i32.div_u (i32.const 1) (i32.const 0))', 'i32');
    expect(r.text).toContain('i32.div_u');
    expect(await run(r.after)).toBe(await run(r.before));
  });

  it('a conversion out of range is left to trap', async () => {
    const r = optimize('(i32.trunc_f32_u (f32.const -1))', 'i32');
    expect(r.text).toContain('i32.trunc_f32_u');
    expect(await run(r.after)).toBe(await run(r.before));
  });

  it('an arithmetic NaN is left to the engine', () => {
    const r = optimize(
      '(i32.reinterpret_f32 (f32.add (f32.const nan:0x200001) (f32.const 1)))',
      'i32',
    );
    expect(r.text).toContain('f32.add');
  });

  it('a bit-exact NaN folds, payload and all', async () => {
    const r = optimize('(i32.reinterpret_f32 (f32.neg (f32.const nan:0x200001)))', 'i32');
    expect(r.text).not.toContain('f32.');
    expect(await run(r.after)).toBe(await run(r.before));
  });
});
