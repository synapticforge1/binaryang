// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 23, E2: Precompute — an expression whose value is known at compile
// time becomes that value, through the evaluator's numeric core. Each case RUNS
// the module before and after: a fold that picks the wrong arm, drops an effect
// or removes a trap is a valid module computing the wrong thing.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm, writeWat } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

const MODULE = (body: string, result = 'i32') =>
  `(module (memory 1) (global $g (mut i32) (i32.const 0))
    (func (export "f") (result ${result}) ${body})
    (func (export "g") (result i32) (global.get $g)))`;

function precompute(wat: string) {
  const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
  new PassRunner(m, {}).add('Precompute').run();
  return { bytes: writeWasm(m), text: writeWat(m) };
}
/** `f`'s result (or its trap) and the global it may have written, in that order. */
async function outcome(bytes: Uint8Array): Promise<unknown[]> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  const { f, g } = instance.exports as Record<string, () => unknown>;
  let r: unknown;
  try {
    r = f!();
  } catch (e) {
    if (!(e instanceof WebAssembly.RuntimeError)) throw e;
    r = `trap: ${e.message}`;
  }
  return [r, g!()];
}
/** Precompute `body`; the module behaves the same; returns the text it left. */
async function same(body: string, result = 'i32'): Promise<string> {
  const wat = MODULE(body, result);
  const after = precompute(wat);
  expect(await outcome(after.bytes)).toEqual(
    await outcome(wat2wasm(wat, { textForm: false }).binary),
  );
  return after.text.slice(after.text.indexOf('(export "f")'), after.text.indexOf('(export "g")'));
}

describe('a tree of constants folds in one run', () => {
  it('nested arithmetic, comparison and conversion', async () => {
    const t = await same(
      '(i32.trunc_f64_s (f64.sqrt (f64.convert_i32_s (i32.mul (i32.const 3) (i32.const 3)))))',
    );
    expect(t).toContain('i32.const 3');
    expect(t).not.toContain('f64.');
  });

  it('a trap stays, and so does everything above it', async () => {
    const t = await same('(i32.add (i32.const 1) (i32.rem_u (i32.const 1) (i32.const 0)))');
    expect(t).toContain('i32.rem_u');
  });

  it("an arithmetic NaN stays the engine's", async () => {
    const t = await same('(i32.reinterpret_f32 (f32.sqrt (f32.const -1)))');
    expect(t).toContain('f32.sqrt');
  });

  // E3e: `v128` operators go through the same evaluator and the same rule.
  it('a v128 tree of constants folds; a NaN lane from arithmetic and a relaxed operator stay', async () => {
    const folded = await same(
      '(i32x4.extract_lane 2 (i32x4.add (i32x4.splat (i32.const 20)) (v128.const i32x4 1 2 3 4)))',
    );
    expect(folded).toContain('v128.const i32x4 0x00000015 0x00000016 0x00000017 0x00000018');
    expect(folded).not.toContain('i32x4.add');
    const nan = await same(
      '(i32x4.extract_lane 0 (f32x4.sqrt (v128.const f32x4 -1 1 1 1)))',
    );
    expect(nan).toContain('f32x4.sqrt');
    const relaxed = await same(
      '(i32x4.extract_lane 0 (f32x4.relaxed_min (v128.const f32x4 1 1 1 1) (v128.const f32x4 2 2 2 2)))',
    );
    expect(relaxed).toContain('f32x4.relaxed_min');
    const exact = await same(
      '(i32x4.extract_lane 0 (f32x4.neg (v128.const f32x4 nan 1 1 1)))',
    );
    expect(exact).not.toContain('f32x4.neg');
  });
});

describe('a constant condition picks its arm', () => {
  it("an if — each way, the other arm's effect gone", async () => {
    for (const c of [0, 1, 7]) {
      const t = await same(
        `(if (result i32) (i32.const ${c})
          (then (global.set $g (i32.const 10)) (i32.const 1))
          (else (global.set $g (i32.const 20)) (i32.const 2)))`,
      );
      expect(t).not.toContain('(if');
    }
  });

  it('an else-less if not taken leaves nothing', async () => {
    const t = await same('(if (i32.const 0) (then (global.set $g (i32.const 5)))) (i32.const 0)');
    expect(t).not.toContain('global.set');
  });

  it('an if something branches to keeps its label on a block', async () => {
    const t = await same(
      `(if $l (i32.const 1)
        (then (br_if $l (i32.eqz (global.get $g))) (global.set $g (i32.const 9))))
       (global.get $g)`,
    );
    expect(t).not.toContain('(if');
  });

  it('a select: the operand not picked goes when it does nothing', async () => {
    const t = await same('(select (i32.const 4) (i32.const 5) (i32.const 0))');
    expect(t).toContain('i32.const 5');
    expect(t).not.toContain('select');
  });

  it('a select: an operand not picked that traps STAYS', async () => {
    const t = await same(
      '(select (i32.const 4) (i32.div_s (i32.const 1) (i32.const 0)) (i32.const 1))',
    );
    expect(t).toContain('select');
  });

  it('a select: an operand not picked with an effect STAYS', async () => {
    const t = await same(
      '(select (i32.const 4) (block (result i32) (global.set $g (i32.const 3)) (i32.const 5)) (i32.const 1))',
    );
    expect(t).toContain('select');
  });
});

describe('a branch with a constant condition', () => {
  it('br_if taken becomes br; not taken, its value falls through', async () => {
    for (const c of [0, 1]) {
      const t = await same(
        `(block $b (result i32)
          (drop (br_if $b (i32.const 11) (i32.const ${c})))
          (i32.const 22))`,
      );
      expect(t).not.toContain('br_if');
    }
  });

  it('br_table picks its target; an index past them takes the default', async () => {
    for (const i of [0, 1, 2, -1]) {
      const t = await same(
        `(block $d (block $b1 (block $b0
           (br_table $b0 $b1 $d (i32.const ${i})))
           (return (i32.const 100)))
         (return (i32.const 101)))
         (i32.const 102)`,
      );
      expect(t).not.toContain('br_table');
    }
  });
});
