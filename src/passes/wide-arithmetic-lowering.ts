// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/wide-arithmetic-lowering
 * Lowers the wide-arithmetic proposal's four instructions to plain `i64` arithmetic, so a module
 * runs on the engines that do not have it — V8 (Chrome, Edge, Node, Deno), WasmEdge, wasmer, wazero
 * and Firefox ESR 153, measured 2026-10-23 (cmem/portability.md). `wasm-opt
 * --wide-arithmetic-lowering`. Owner decision 2 of open-work 34: "we should build the two
 * lowerings for maximum compatibility".
 *
 * ## What each becomes
 *
 * Each instruction becomes a `call` to a helper function this pass adds to the module, ONE per
 * instruction actually used (so a module using only `i64.add128` gains one small function). The
 * helpers return two `i64`s (multi-value, which every engine in the portable profile runs), so a
 * call stands where the instruction stood, with the same operands and results.
 *
 * - `i64.add128 (lo1 hi1 lo2 hi2)` → `lo = lo1 + lo2`; the carry is `lo <u lo1`;
 *   `hi = hi1 + hi2 + carry`.
 * - `i64.sub128 (lo1 hi1 lo2 hi2)` → `lo = lo1 - lo2`; the borrow is `lo1 <u lo2`;
 *   `hi = hi1 - hi2 - borrow`.
 * - `i64.mul_wide_u (a b)` → `lo = a * b`; `hi` from the four 32×32 partial products of `a`'s and
 *   `b`'s 32-bit halves (each fits an `i64` exactly), the middle sum carrying its top half up.
 * - `i64.mul_wide_s (a b)` → as `_u`, then `hi -= (a >>s 63) & b` and `hi -= (b >>s 63) & a` — the
 *   two's-complement correction for each negative operand.
 *
 * Exact for every input: a 128-bit result modulo 2^128, as the proposal defines it. Nothing traps,
 * in the original or the lowering.
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
  makeI64Const,
  makeLocalGet,
  makeLocalSet,
  makeUnary,
  QuaternaryOp,
  UnaryOp,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { varIndex, varName } from '../ir/ir.ts';
import { mapExpression } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

/** The four instructions, by the opcode their IR node carries. */
const OPS = {
  add128: QuaternaryOp.Add128,
  sub128: QuaternaryOp.Sub128,
  mulWideS: BinaryOp.MulWideSInt64,
  mulWideU: BinaryOp.MulWideUInt64,
} as const;
type Op = keyof typeof OPS;

const I64 = ValType.I64;
const PAIR = [I64, I64];
const get = (i: number) => makeLocalGet(varIndex(i), I64);
const bin = (op: BinaryOp, l: Expression, r: Expression) => makeBinary(op, l, r);
const LOW32 = () => makeI64Const(0xffff_ffffn);
const k = (n: bigint) => makeI64Const(n);

/** The helper's body: its locals (beyond the parameters) and its expressions, results last. */
function helperBody(op: Op): { params: number; locals: number; body: Expression[] } {
  switch (op) {
    case 'add128':
      // params lo1 hi1 lo2 hi2; local 4 = lo
      return {
        params: 4,
        locals: 1,
        body: [
          makeLocalSet(varIndex(4), bin(BinaryOp.AddI64, get(0), get(2))),
          get(4),
          bin(
            BinaryOp.AddI64,
            bin(BinaryOp.AddI64, get(1), get(3)),
            makeUnary(UnaryOp.ExtendUI32, bin(BinaryOp.LtUI64, get(4), get(0))),
          ),
        ],
      };
    case 'sub128':
      // params lo1 hi1 lo2 hi2
      return {
        params: 4,
        locals: 0,
        body: [
          bin(BinaryOp.SubI64, get(0), get(2)),
          bin(
            BinaryOp.SubI64,
            bin(BinaryOp.SubI64, get(1), get(3)),
            makeUnary(UnaryOp.ExtendUI32, bin(BinaryOp.LtUI64, get(0), get(2))),
          ),
        ],
      };
    case 'mulWideU':
    case 'mulWideS': {
      // params a b; locals 2 = a0·b1, 3 = a1·b0, 4 = mid
      const lo32 = (e: Expression) => bin(BinaryOp.AndI64, e, LOW32());
      const hi32 = (e: Expression) => bin(BinaryOp.ShrUI64, e, k(32n));
      let hi: Expression = bin(
        BinaryOp.AddI64,
        bin(
          BinaryOp.AddI64,
          bin(BinaryOp.AddI64, bin(BinaryOp.MulI64, hi32(get(0)), hi32(get(1))), hi32(get(2))),
          hi32(get(3)),
        ),
        hi32(get(4)),
      );
      if (op === 'mulWideS') {
        const sign = (e: Expression) => bin(BinaryOp.ShrSI64, e, k(63n));
        hi = bin(
          BinaryOp.SubI64,
          bin(BinaryOp.SubI64, hi, bin(BinaryOp.AndI64, sign(get(0)), get(1))),
          bin(BinaryOp.AndI64, sign(get(1)), get(0)),
        );
      }
      return {
        params: 2,
        locals: 3,
        body: [
          makeLocalSet(varIndex(2), bin(BinaryOp.MulI64, lo32(get(0)), hi32(get(1)))),
          makeLocalSet(varIndex(3), bin(BinaryOp.MulI64, hi32(get(0)), lo32(get(1)))),
          makeLocalSet(
            varIndex(4),
            bin(
              BinaryOp.AddI64,
              bin(
                BinaryOp.AddI64,
                hi32(bin(BinaryOp.MulI64, lo32(get(0)), lo32(get(1)))),
                lo32(get(2)),
              ),
              lo32(get(3)),
            ),
          ),
          bin(BinaryOp.MulI64, get(0), get(1)),
          hi,
        ],
      };
    }
  }
}

/** Which of the four an expression is, or null. */
function opOf(e: Expression): Op | null {
  if (e.kind === ExpressionKind.Quaternary) {
    if (e.opcode === OPS.add128) return 'add128';
    if (e.opcode === OPS.sub128) return 'sub128';
  }
  if (e.kind === ExpressionKind.Binary) {
    if (e.opcode === OPS.mulWideS) return 'mulWideS';
    if (e.opcode === OPS.mulWideU) return 'mulWideU';
  }
  return null;
}

/** Lowers `i64.add128`, `i64.sub128`, `i64.mul_wide_s` and `i64.mul_wide_u` to `i64` arithmetic. */
export class WideArithmeticLoweringPass implements Pass {
  readonly name = 'WideArithmeticLowering';
  readonly description =
    'Lowers wide-arithmetic (i64.add128, i64.sub128, i64.mul_wide_s/u) to i64 arithmetic, for engines without the proposal.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    const helperName = new Map<Op, string>();
    const taken = new Set(module.functions.map((f) => f.name));
    const nameFor = (op: Op) => {
      let name = helperName.get(op);
      if (name === undefined) {
        name = `$wide-arithmetic-lowering.${op}`;
        for (let i = 1; taken.has(name); i++) name = `$wide-arithmetic-lowering.${op}.${i}`;
        taken.add(name);
        helperName.set(op, name);
      }
      return name;
    };
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, (e) => {
        const op = opOf(e);
        if (op === null) return e;
        const operands = e.kind === ExpressionKind.Quaternary
          ? [e.a, e.b, e.c, e.d]
          : e.kind === ExpressionKind.Binary
          ? [e.left, e.right]
          : [];
        return makeCall(varName(nameFor(op)), operands, PAIR);
      });
    }
    // The helpers go last, so no existing function's index moves.
    for (const [op, name] of helperName) {
      const { params, locals, body } = helperBody(op);
      module.functions.push({
        name,
        sig: { params: new Array(params).fill(I64), results: PAIR },
        // Every slot, PARAMS FIRST (the IR's `Func.locals` is the one index space `local.get`
        // addresses); listing only the extra locals declared too few.
        locals: new Array(params + locals).fill(null).map(() => ({ type: I64 })),
        body: asRegion(body),
      });
    }
  }
}

registerPass(WideArithmeticLoweringPass);
