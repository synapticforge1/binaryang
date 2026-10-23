// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/relaxed-simd-lowering
 * Lowers the relaxed-SIMD instructions to the specification's DETERMINISTIC PROFILE, written in
 * plain SIMD-128, so a module runs on the engines without relaxed SIMD — wasmer and wazero
 * (measured 2026-10-23, cmem/portability.md) — and gives the SAME result on every engine, where the
 * relaxed instructions differ by hardware. `wasm-opt --relaxed-simd-lowering`. Owner decision 2 of
 * open-work 34, and (owner, 2026-10-23) the deterministic profile as the semantics.
 *
 * ## The semantics: the spec's, not ours
 *
 * WebAssembly 3.0, `document/core/exec/numerics.rst` § "Relaxed Operations": each relaxed operator
 * is `relaxed(R)[A0, …, An]`, and "in the deterministic profile, every parameter is prescribed to be
 * 0" — so its result is `A0`. Read operator by operator (spec `4441525`):
 *
 * | relaxed | deterministic (A0), in the spec's words | becomes |
 * | --- | --- | --- |
 * | `i8x16.relaxed_swizzle` | "like regular swizzle" | `i8x16.swizzle` |
 * | `i32x4.relaxed_trunc_*` | "like regular trunc_sat" | the matching `trunc_sat` |
 * | `f32x4` / `f64x2` `relaxed_madd` | "the unfused behaviour" | `add(mul(a, b), c)` |
 * | … `relaxed_nmadd` | `madd(-a, b, c)` | `add(mul(neg a, b), c)` |
 * | `*.relaxed_laneselect` | "like bitselect" | `v128.bitselect` |
 * | `relaxed_min` / `relaxed_max` | "like regular fmin / fmax" | `min` / `max` |
 * | `i16x8.relaxed_q15mulr_s` | "like regular q15mulr_sat_s" | `i16x8.q15mulr_sat_s` |
 * | `i16x8.relaxed_dot_i8x16_i7x16_s` | `ivdot`, BOTH operands signed, wrapping | signed products, adjacent pairs added |
 * | `i32x4.relaxed_dot_i8x16_i7x16_add_s` | that dot, `extadd_pairwise_s`, `add c` | the same three steps |
 *
 * The 2-operand dot uses each operand twice (its low and high halves), so it is a `call` to a
 * helper whose parameters hold them — added once, if used; every other rewrite evaluates each
 * operand once, in its original order, inline.
 *
 * @license MIT
 */

import type { Expression } from '../ir/expressions.ts';
import {
  asRegion,
  BinaryOp,
  ExpressionKind,
  makeBinary,
  makeCall,
  makeLocalGet,
  makeSIMDShuffle,
  makeSIMDTernary,
  makeUnary,
  SIMDTernaryOp,
  UnaryOp,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { varIndex, varName } from '../ir/ir.ts';
import { mapExpression } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

// The relaxed opcodes (0xfd prefix, sub-opcode 0x100–0x113) and their deterministic targets, by the
// instruction index of the specification (cmem/definitions.md § "D1 against the specification").
const R = {
  swizzle: 0xfd0100,
  truncF32S: 0xfd0101,
  truncF32U: 0xfd0102,
  truncF64SZero: 0xfd0103,
  truncF64UZero: 0xfd0104,
  maddF32: 0xfd0105,
  nmaddF32: 0xfd0106,
  maddF64: 0xfd0107,
  nmaddF64: 0xfd0108,
  laneselectI8: 0xfd0109,
  laneselectI16: 0xfd010a,
  laneselectI32: 0xfd010b,
  laneselectI64: 0xfd010c,
  minF32: 0xfd010d,
  maxF32: 0xfd010e,
  minF64: 0xfd010f,
  maxF64: 0xfd0110,
  q15mulr: 0xfd0111,
  dot: 0xfd0112,
  dotAdd: 0xfd0113,
} as const;

/** Relaxed → plain, for the binary ones that keep their operands and only change opcode. */
const SAME_BINARY: ReadonlyMap<number, BinaryOp> = new Map([
  [R.swizzle, BinaryOp.SwizzleVecI8x16],
  [R.minF32, BinaryOp.MinVecF32x4],
  [R.maxF32, BinaryOp.MaxVecF32x4],
  [R.minF64, BinaryOp.MinVecF64x2],
  [R.maxF64, BinaryOp.MaxVecF64x2],
  [R.q15mulr, BinaryOp.Q15MulrSatSVecI16x8],
]);
/** Relaxed → plain, for the unary ones (the truncations). */
const SAME_UNARY: ReadonlyMap<number, UnaryOp> = new Map([
  [R.truncF32S, UnaryOp.TruncSatSVecF32x4ToI32x4],
  [R.truncF32U, UnaryOp.TruncSatUVecF32x4ToI32x4],
  [R.truncF64SZero, UnaryOp.TruncSatSVecF64x2ToI32x4Zero],
  [R.truncF64UZero, UnaryOp.TruncSatUVecF64x2ToI32x4Zero],
]);
const LANESELECT: ReadonlySet<number> = new Set([
  R.laneselectI8,
  R.laneselectI16,
  R.laneselectI32,
  R.laneselectI64,
]);
/** madd / nmadd: the add, mul and (nmadd only) neg of the shape. */
const FMA: ReadonlyMap<number, { add: BinaryOp; mul: BinaryOp; neg: UnaryOp | null }> = new Map([
  [R.maddF32, { add: BinaryOp.AddVecF32x4, mul: BinaryOp.MulVecF32x4, neg: null }],
  [R.nmaddF32, { add: BinaryOp.AddVecF32x4, mul: BinaryOp.MulVecF32x4, neg: UnaryOp.NegVecF32x4 }],
  [R.maddF64, { add: BinaryOp.AddVecF64x2, mul: BinaryOp.MulVecF64x2, neg: null }],
  [R.nmaddF64, { add: BinaryOp.AddVecF64x2, mul: BinaryOp.MulVecF64x2, neg: UnaryOp.NegVecF64x2 }],
]);

const V128 = ValType.V128;
/** The 16-bit lanes 0, 2, 4, 6 of `left` then of `right` (bytes 0–15 left, 16–31 right). */
const EVENS = Uint8Array.from([0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25, 28, 29]);
/** The 16-bit lanes 1, 3, 5, 7 of `left` then of `right`. */
const ODDS = Uint8Array.from([2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 23, 26, 27, 30, 31]);

/**
 * The deterministic `i16x8.relaxed_dot_i8x16_i7x16_s (a b)`: lane k is `a[2k]·b[2k] + a[2k+1]·b[2k+1]`,
 * both operands signed, wrapping — the signed products of the low and high halves (`extmul`), then
 * their even and odd 16-bit lanes added.
 */
function dotBody(): Expression {
  // A fresh node per use: one node must never sit in the tree twice.
  const get = (i: number) => makeLocalGet(varIndex(i), V128);
  const low = () => makeBinary(BinaryOp.ExtmulLowSVecI8x16ToI16x8, get(0), get(1));
  const high = () => makeBinary(BinaryOp.ExtmulHighSVecI8x16ToI16x8, get(0), get(1));
  return makeBinary(
    BinaryOp.AddVecI16x8,
    makeSIMDShuffle(low(), high(), EVENS),
    makeSIMDShuffle(low(), high(), ODDS),
  );
}

/** Lowers the relaxed-SIMD instructions to the specification's deterministic profile. */
export class RelaxedSimdLoweringPass implements Pass {
  readonly name = 'RelaxedSimdLowering';
  readonly description =
    "Lowers relaxed SIMD to the specification's deterministic profile in plain SIMD-128, for engines without relaxed SIMD.";
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    let dotName: string | null = null;
    const dot = () => {
      if (dotName === null) {
        const taken = new Set(module.functions.map((f) => f.name));
        dotName = '$relaxed-simd-lowering.dot';
        for (let i = 1; taken.has(dotName); i++) dotName = `$relaxed-simd-lowering.dot.${i}`;
      }
      return varName(dotName);
    };
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, (e) => {
        const op = (e as { opcode?: number }).opcode;
        if (op === undefined || op < R.swizzle || op > R.dotAdd) return e;
        const binary = SAME_BINARY.get(op);
        if (binary !== undefined && e.kind === ExpressionKind.Binary) {
          return makeBinary(binary, e.left, e.right);
        }
        const unary = SAME_UNARY.get(op);
        if (unary !== undefined && e.kind === ExpressionKind.Unary) {
          return makeUnary(unary, e.value);
        }
        if (e.kind === ExpressionKind.SIMDTernary) {
          if (LANESELECT.has(op)) return makeSIMDTernary(SIMDTernaryOp.Bitselect, e.a, e.b, e.c);
          const fma = FMA.get(op);
          if (fma !== undefined) {
            const a = fma.neg === null ? e.a : makeUnary(fma.neg, e.a);
            return makeBinary(fma.add, makeBinary(fma.mul, a, e.b), e.c);
          }
          if (op === R.dotAdd) {
            return makeBinary(
              BinaryOp.AddVecI32x4,
              makeUnary(UnaryOp.ExtaddPairwiseSVecI16x8ToI32x4, makeCall(dot(), [e.a, e.b], V128)),
              e.c,
            );
          }
        }
        if (e.kind === ExpressionKind.Binary && op === R.dot) {
          return makeCall(dot(), [e.left, e.right], V128);
        }
        // An instruction in the range, in a shape not handled above: refuse, never pass it through.
        throw new Error(
          `RelaxedSimdLowering: unhandled ${e.kind} with opcode 0x${op.toString(16)}`,
        );
      });
    }
    if (dotName !== null) {
      module.functions.push({
        name: dotName,
        sig: { params: [V128, V128], results: [V128] },
        // Every slot, PARAMS FIRST (the IR's `Func.locals` is the one index space).
        locals: [{ type: V128 }, { type: V128 }],
        body: asRegion([dotBody()]),
      });
    }
  }
}

registerPass(RelaxedSimdLoweringPass);
