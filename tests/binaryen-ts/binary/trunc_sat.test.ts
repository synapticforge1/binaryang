// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The SATURATING truncations (0xFC 0x00–0x07) survive binaryen-ts's decoder.
//
// It decoded all eight as the TRAPPING truncations (0xa8–0xb1): binaryen-ts's
// opcode set had no saturating scalar truncation, so `decodeMiscPrefix` picked
// the nearest name. Bytes changed on every decode → encode, and so did the
// program — `i32.trunc_sat_f32_s(1e10)` is 2147483647; after `wasm-opt` it
// TRAPPED. Every corpus module using the instruction was affected (4 of 4).
// Found measuring whether the wabt-ts reader can feed the optimizer (One front
// end, cmem/ir-convergence.md); that route was already right.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/encoder/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { UnaryOp } from '../../../src/binaryen-ts/ir/expressions.ts';

// Each export takes a float and returns the saturated integer as an f64, so
// an i64 result compares as a number: the edge cases are NaN, both overflows,
// and a negative input to an unsigned truncation.
const OPS = [
  ['i32.trunc_sat_f32_s', 'f32', 'i32', 'f64.convert_i32_s'],
  ['i32.trunc_sat_f32_u', 'f32', 'i32', 'f64.convert_i32_u'],
  ['i32.trunc_sat_f64_s', 'f64', 'i32', 'f64.convert_i32_s'],
  ['i32.trunc_sat_f64_u', 'f64', 'i32', 'f64.convert_i32_u'],
  ['i64.trunc_sat_f32_s', 'f32', 'i64', 'f64.convert_i64_s'],
  ['i64.trunc_sat_f32_u', 'f32', 'i64', 'f64.convert_i64_u'],
  ['i64.trunc_sat_f64_s', 'f64', 'i64', 'f64.convert_i64_s'],
  ['i64.trunc_sat_f64_u', 'f64', 'i64', 'f64.convert_i64_u'],
] as const;

const SRC = `(module
${
  OPS.map(([op, from, , widen], i) =>
    `  (func (export "t${i}") (param ${from}) (result f64) (${widen} (${op} (local.get 0))))`
  ).join('\n')
})`;

const INPUTS = [NaN, 1e30, -1e30, -1, 3.7];

/** What every export returns on every input — or 'TRAP'. */
function results(bytes: Uint8Array): (number | string)[][] {
  const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports;
  return OPS.map((_, i) =>
    INPUTS.map((v) => {
      try {
        return (x[`t${i}`] as (a: number) => number)(v);
      } catch {
        return 'TRAP';
      }
    })
  );
}

describe('binaryen-ts decoder — saturating truncation stays saturating', () => {
  const bytes = wat2wasm(SRC, { textForm: false }).binary;

  it('each decodes to its own saturating opcode, typed by its result', () => {
    const m = readForPasses(bytes);
    const expected = [
      UnaryOp.TruncSatSF32ToI32,
      UnaryOp.TruncSatUF32ToI32,
      UnaryOp.TruncSatSF64ToI32,
      UnaryOp.TruncSatUF64ToI32,
      UnaryOp.TruncSatSF32ToI64,
      UnaryOp.TruncSatUF32ToI64,
      UnaryOp.TruncSatSF64ToI64,
      UnaryOp.TruncSatUF64ToI64,
    ];
    m.functions.forEach((f, i) => {
      const widen = f.body.children[0]!;
      const trunc = widen.kind === 'unary' ? widen.value : widen;
      assertEquals(trunc.kind === 'unary' ? trunc.opcode : -1, expected[i], OPS[i]![0]);
      assertEquals(trunc.type, OPS[i]![2] === 'i32' ? 0x7f : 0x7e, `${OPS[i]![0]} type`);
    });
  });

  it('decode → encode gives the input bytes back', () => {
    assertEquals([...writeWasm(readForPasses(bytes))], [...bytes]);
  });

  it('the optimizer keeps the saturating results, at every level', () => {
    const want = results(bytes);
    // Saturating, nothing traps. NaN and both overflows DO trap in the trapping
    // form — restoring the old decoder mapping fails this step.
    assertEquals(want.flat().includes('TRAP'), false);
    const levels = [[1, 0], [2, 0], [3, 0], [2, 1], [2, 2]] as const;
    for (const [optimizeLevel, shrinkLevel] of levels) {
      const m = readForPasses(bytes);
      new PassRunner(m, { optimizeLevel, shrinkLevel }).addDefaultOptimizationPasses().run();
      assertEquals(results(writeWasm(m)), want, `-O${optimizeLevel} shrink ${shrinkLevel}`);
    }
  });
});
