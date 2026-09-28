// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// One node kind per SIMD load, whichever front end reads it (One front end,
// stage 1 — owner, 2026-09-19: "we want both reader to build the simd.load
// form").
//
// Each front end used to decide for itself. The WAT parser built `load` for
// all twelve non-plain SIMD loads, the wabt-ts binary reader built `simd.load`
// for the splats and zero loads but `load` for the six EXTENDING loads, and
// binaryen-ts's decoder built `simd.load` for all twelve. The bytes were the
// same every way; the tree was not, and the optimizer dispatches on the node
// kind. Now every front end asks `isSimdLoadOpcode` (`SIMD_LOAD_OPCODES`),
// and binaryen-ts's `SIMDLoadOp` is pinned to the same set.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { SIMD_LOAD_OPCODES } from '../../src/wabt-ts/ir/ir.ts';
import type { Expr } from '../../src/wabt-ts/ir/ir.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { readBinaryIr } from '../../src/wabt-ts/reader/binary-reader.ts';
import { makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/wabt-ts/tools/wasm2wat.ts';
import { readForPasses } from '../../src/binaryen-ts/ir/prepare.ts';
import { readWat } from '../../src/binaryen-ts/tools/read-wat.ts';
import { SIMDLoadOp } from '../../src/binaryen-ts/ir/expressions.ts';

// Every SIMD load that is a load of memory into a whole v128 — the lane loads
// (`v128.load8_lane` …) are their own kind and carry a vector operand.
const LOADS = [
  ['v128.load', 'load'],
  ['v128.load8x8_s', 'simd.load'],
  ['v128.load8x8_u', 'simd.load'],
  ['v128.load16x4_s', 'simd.load'],
  ['v128.load16x4_u', 'simd.load'],
  ['v128.load32x2_s', 'simd.load'],
  ['v128.load32x2_u', 'simd.load'],
  ['v128.load8_splat', 'simd.load'],
  ['v128.load16_splat', 'simd.load'],
  ['v128.load32_splat', 'simd.load'],
  ['v128.load64_splat', 'simd.load'],
  ['v128.load32_zero', 'simd.load'],
  ['v128.load64_zero', 'simd.load'],
] as const;

/** One function per load, each returning `(drop (<load> (i32.const 0)))`. */
const SRC = `(module (memory 1)
${LOADS.map(([op]) => `  (func (drop (${op} (i32.const 0))))`).join('\n')})`;

/** The kind of the load inside each function's `drop`. */
const kinds = (functions: readonly { body: { children: readonly Expr[] } }[]) =>
  functions.map((f) => {
    const d = f.body.children[0]!;
    return d.kind === 'drop' ? d.value.kind : d.kind;
  });

describe('one node kind per SIMD load, from every front end', () => {
  const want = LOADS.map(([, kind]) => kind);
  const bytes = wat2wasm(SRC, { textForm: false }).binary;

  it('the WAT parser', () => {
    assertEquals(kinds(parseWatModule(SRC).module!.functions), want);
  });

  it('the wabt-ts binary reader', () => {
    assertEquals(kinds(readBinaryIr(bytes, makeErrorList()).functions), want);
  });

  it("binaryen-ts's decoder", () => {
    assertEquals(kinds(readForPasses(bytes).functions), want);
  });

  it("binaryen-ts's internal WAT parser", () => {
    assertEquals(kinds(readWat(SRC).functions), want);
  });

  it("the rule and binaryen-ts's SIMDLoadOp are the same set", () => {
    assertEquals(
      [...SIMD_LOAD_OPCODES].sort((a, b) => a - b),
      Object.values(SIMDLoadOp).sort((a, b) => a - b),
    );
  });

  it('the text and bytes round-trip unchanged', () => {
    const text = wasm2wat(bytes).text;
    for (const [op] of LOADS) assertEquals(text.includes(`(${op}`), true, op);
    assertEquals([...wat2wasm(text, { textForm: false }).binary], [...bytes]);
  });
});
