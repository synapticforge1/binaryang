// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// OptimizeInstructions coverage (open-work 2, step 3): the shapes upstream's
// pass still found on our -Oz output. A peephole that is wrong yields a VALID
// module that computes something else, so every case RUNS the module before and
// after on inputs at the edges (wrap-around, sign bits, above 2^53), and asserts
// the rewrite fired — a test whose rewrite never ran proves nothing.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

type Fn = (...a: (number | bigint)[]) => number | bigint;

async function exportsOf(bytes: Uint8Array) {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  return instance.exports as Record<string, Fn>;
}

/** The module as written, and after OptimizeInstructions alone; plus the latter's text. */
function optimize(wat: string) {
  const before = wat2wasm(wat, { textForm: false }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('OptimizeInstructions').run();
  const after = writeWasm(m);
  const { errors } = wasmValidate(after, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { before, after, text: wasm2wat(after).text };
}

/** Every export gives the same result (or the same trap) before and after, on every input. */
async function sameBehaviour(
  before: Uint8Array,
  after: Uint8Array,
  name: string,
  inputs: (number | bigint)[][],
) {
  for (const args of inputs) {
    const run = async (b: Uint8Array) => {
      try {
        return String((await exportsOf(b))[name](...args));
      } catch (e) {
        return `trap: ${(e as Error).message}`;
      }
    };
    expect(`${args} -> ${await run(after)}`).toBe(`${args} -> ${await run(before)}`);
  }
}

const I32_EDGES = [0, 1, -1, 5, 0x7fffffff, -0x80000000, 0x12345678, -64, 64];
const I64_EDGES = [
  0n,
  1n,
  -1n,
  0x7fffffffffffffffn,
  -0x8000000000000000n,
  0x100000000000007fn,
  0xffffffffn,
  0x1_0000_0000n,
];

describe('a store writes only its low bits', () => {
  it('i32.store of a wrap_i64 is an i64.store32', async () => {
    const { before, after, text } = optimize(`(module (memory 1)
      (func (export "f") (param i64) (result i64)
        (i64.store (i32.const 0) (i64.const -1))
        (i32.store (i32.const 0) (i32.wrap_i64 (local.get 0)))
        (i64.load (i32.const 0)))
      (func (export "s8") (param i64) (result i64)
        (i64.store (i32.const 0) (i64.const -1))
        (i32.store8 (i32.const 0) (i32.wrap_i64 (local.get 0)))
        (i64.load (i32.const 0))))`);
    expect(text).toContain('i64.store32');
    expect(text).toContain('i64.store8');
    expect(text).not.toContain('i32.wrap_i64');
    for (const f of ['f', 's8']) await sameBehaviour(before, after, f, I64_EDGES.map((v) => [v]));
  });

  it('i64.store8 of an extend is an i32.store8', async () => {
    const { before, after, text } = optimize(`(module (memory 1)
      (func (export "f") (param i32) (result i64)
        (i64.store (i32.const 0) (i64.const -1))
        (i64.store8 (i32.const 0) (i64.extend_i32_s (local.get 0)))
        (i64.load (i32.const 0))))`);
    expect(text).toContain('i32.store8');
    expect(text).not.toContain('extend');
    await sameBehaviour(before, after, 'f', I32_EDGES.map((v) => [v]));
  });

  it('a mask that keeps every stored bit goes; one that does not, stays', async () => {
    const { before, after, text } = optimize(`(module (memory 1)
      (func (export "f") (param i32) (result i32)
        (i32.store8 (i32.const 0) (i32.and (local.get 0) (i32.const 0x1ff)))
        (i32.store8 (i32.const 1) (i32.and (local.get 0) (i32.const 0x7f)))
        (i32.load16_u (i32.const 0))))`);
    expect(text.match(/i32\.and/g)?.length).toBe(1);
    expect(text).toContain('127');
    await sameBehaviour(before, after, 'f', [...I32_EDGES, 0xff, 0x80].map((v) => [v]));
  });
});

describe('an extend of a load is the extending load', () => {
  it('_u of i32.load, _s of load8_s, _u of load16_u', async () => {
    const { before, after, text } = optimize(`(module (memory 1)
      (func (export "u32") (param i32) (result i64)
        (i32.store (i32.const 0) (local.get 0))
        (i64.extend_i32_u (i32.load (i32.const 0))))
      (func (export "s8") (param i32) (result i64)
        (i32.store (i32.const 0) (local.get 0))
        (i64.extend_i32_s (i32.load8_s (i32.const 0))))
      (func (export "u16") (param i32) (result i64)
        (i32.store (i32.const 0) (local.get 0))
        (i64.extend_i32_u (i32.load16_u (i32.const 0))))
      (func (export "s32") (param i32) (result i64)
        (i32.store (i32.const 0) (local.get 0))
        (i64.extend_i32_s (i32.load (i32.const 0)))))`);
    expect(text).toContain('i64.load32_u');
    expect(text).toContain('i64.load32_s');
    expect(text).toContain('i64.load8_s');
    expect(text).toContain('i64.load16_u');
    expect(text).not.toContain('extend');
    for (const f of ['u32', 's8', 'u16', 's32']) {
      await sameBehaviour(before, after, f, [...I32_EDGES, 0x80, 0xff, 0x8000].map((v) => [v]));
    }
  });

  it('NOT a _u extend of a signed load: it extends twice, differently', async () => {
    const { before, after, text } = optimize(`(module (memory 1)
      (func (export "f") (param i32) (result i64)
        (i32.store (i32.const 0) (local.get 0))
        (i64.extend_i32_u (i32.load8_s (i32.const 0)))))`);
    expect(text).toContain('i64.extend_i32_u');
    await sameBehaviour(before, after, 'f', [[0x80], [0xff], [0x7f]]);
  });
});

describe('a condition reads only true / false', () => {
  it('if (eqz c) A else B is if c B else A', async () => {
    const { before, after, text } = optimize(`(module
      (func (export "f") (param i32) (result i32)
        (if (result i32) (i32.eqz (local.get 0))
          (then (i32.const 10)) (else (i32.const 20)))))`);
    expect(text).not.toContain('eqz');
    await sameBehaviour(before, after, 'f', I32_EDGES.map((v) => [v]));
  });

  it('br_if on eqz(eqz x) branches on x', async () => {
    const { before, after, text } = optimize(`(module
      (func (export "f") (param i32) (result i32)
        (block $b (result i32)
          (br_if $b (i32.const 7) (i32.eqz (i32.eqz (local.get 0))))
          (drop) (i32.const 9))))`);
    expect(text).not.toContain('eqz');
    await sameBehaviour(before, after, 'f', I32_EDGES.map((v) => [v]));
  });

  it('select swaps its operands only when neither has an effect', async () => {
    const { before, after, text } = optimize(`(module
      (global $g (mut i32) (i32.const 0))
      (func $mark (param i32) (result i32)
        (global.set $g (i32.add (i32.mul (global.get $g) (i32.const 10)) (local.get 0)))
        (local.get 0))
      (func (export "pure") (param i32 i32 i32) (result i32)
        (select (local.get 1) (local.get 2) (i32.eqz (local.get 0))))
      (func (export "effects") (param i32) (result i32)
        (global.set $g (i32.const 0))
        (drop (select (call $mark (i32.const 1)) (call $mark (i32.const 2)) (i32.eqz (local.get 0))))
        (global.get $g)))`);
    // One eqz left: the select whose operands call.
    expect(text.match(/i32\.eqz/g)?.length).toBe(1);
    await sameBehaviour(before, after, 'pure', I32_EDGES.map((v) => [v, 3, 4]));
    await sameBehaviour(before, after, 'effects', I32_EDGES.map((v) => [v]));
  });
});

describe('added constants are gathered into one', () => {
  it('i32: nested adds, a negated operand, through shl and mul, and the shorter spelling', async () => {
    const { before, after, text } = optimize(`(module
      (func (export "nested") (param i32) (result i32)
        (i32.add (i32.sub (i32.add (local.get 0) (i32.const 8)) (i32.const 3)) (i32.const 12)))
      (func (export "neg") (param i32) (result i32)
        (i32.add (i32.sub (i32.const 0) (local.get 0)) (i32.const 1)))
      (func (export "shl") (param i32) (result i32)
        (i32.add (i32.shl (i32.add (local.get 0) (i32.const 1)) (i32.const 2)) (i32.const 8)))
      (func (export "mul") (param i32) (result i32)
        (i32.add (i32.mul (i32.sub (local.get 0) (i32.const 3)) (i32.const 5)) (i32.const 7)))
      (func (export "cancel") (param i32) (result i32)
        (i32.sub (i32.add (local.get 0) (i32.const 5)) (i32.const 5)))
      (func (export "spell") (param i32) (result i32)
        (i32.add (local.get 0) (i32.const 64)))
      (func (export "spell2") (param i32) (result i32)
        (i32.sub (local.get 0) (i32.const 64)))
      (func (export "subchain") (param i32) (result i32)
        (i32.add (i32.sub (local.get 0) (i32.const 1)) (i32.const 5))))`);
    // nested: x + 17; neg: 1 - x; shl: (x << 2) + 12; mul: x*5 - 8; cancel: x;
    // spell: x - -64; spell2: x + -64; subchain: x + 4.
    expect(text).toContain('i32.const 17');
    expect(text).toContain('i32.const 12');
    expect(text).toContain('i32.const -8');
    expect(text).toContain('i32.const 4');
    expect(text.match(/i32\.sub/g)?.length).toBe(2); // neg's, and spell's `x - -64`
    expect(text).not.toContain('i32.const 64');
    for (const f of ['nested', 'neg', 'shl', 'mul', 'cancel', 'spell', 'spell2', 'subchain']) {
      await sameBehaviour(before, after, f, I32_EDGES.map((v) => [v]));
    }
  });

  it('i64 alike', async () => {
    const { before, after, text } = optimize(`(module
      (func (export "f") (param i64) (result i64)
        (i64.add (i64.shl (i64.add (local.get 0) (i64.const 1)) (i64.const 40)) (i64.const 8))))`);
    expect(text.match(/i64\.add/g)?.length).toBe(1);
    await sameBehaviour(before, after, 'f', I64_EDGES.map((v) => [v]));
  });
});

describe('sign-extension folds keep every bit', () => {
  it('i64.extend8_s / extend16_s of a constant above 2^53', async () => {
    const { before, after, text } = optimize(`(module
      (func (export "e8") (result i64) (i64.extend8_s (i64.const 0x100000000000007f)))
      (func (export "e8n") (result i64) (i64.extend8_s (i64.const 0x10000000000000ff)))
      (func (export "e16") (result i64) (i64.extend16_s (i64.const 0x1000000000008001))))`);
    expect(text).not.toContain('extend');
    for (const f of ['e8', 'e8n', 'e16']) await sameBehaviour(before, after, f, [[]]);
  });
});
