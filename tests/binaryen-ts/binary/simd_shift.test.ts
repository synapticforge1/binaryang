// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// K3 (owner decision 2026-09-14: MERGE). The twelve SIMD lane shifts are a
// `binary` in binaryen-ts, as they are in wabt-ts and upstream wabt — there is
// no `simd.shift` kind. Measured before it was decided (cmem/ir-convergence.md
// § "K3"): fidelity did not bind, and optimization bound AGAINST the split
// form, because LocalCSE keys a `Binary` and never keyed a `SIMDShift`.
//
// This is the gate the scoping asked for. The 421-module corpus holds ZERO SIMD
// shifts, so `deno task baseline` and `deno task bridge` cannot see K3 at all.
// Every entry path is covered, because before the merge binaryen-ts held TWO
// shapes for one instruction depending on how the module arrived (the bridge
// built `binary`, the decoder and parseWat built `simd.shift`):
//
//   - binaryen-ts's internal `parseWat`, against wabt-ts's bytes;
//   - the decoder, decode → encode byte-identical;
//   - the bridge;
//   - LocalCSE reusing a repeated shift, as upstream `wasm-opt --local-cse` does.
//
// Each module is RUN in V8. A shift is non-commutative and its operands have
// different types, so a swapped operand pair fails validation, and a wrong
// opcode is a wrong value on these inputs.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import {
  type BinaryExpr,
  BinaryOp,
  type Expression,
  ExpressionKind,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { bridgeToBinaryen } from '../../../src/bridge/bridge.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wabtReference } from '../wabt_reference.ts';

type Lane = 'i8x16' | 'i16x8' | 'i32x4' | 'i64x2';
type Op = 'shl' | 'shr_s' | 'shr_u';

/** The spec's 0xFD sub-opcodes, written out here rather than read from our tables. */
const SUB: Record<Lane, Record<Op, number>> = {
  i8x16: { shl: 0x6b, shr_s: 0x6c, shr_u: 0x6d },
  i16x8: { shl: 0x8b, shr_s: 0x8c, shr_u: 0x8d },
  i32x4: { shl: 0xab, shr_s: 0xac, shr_u: 0xad },
  i64x2: { shl: 0xcb, shr_s: 0xcc, shr_u: 0xcd },
};

const MEMBER: Record<Lane, Record<Op, BinaryOp>> = {
  i8x16: { shl: BinaryOp.ShlVecI8x16, shr_s: BinaryOp.ShrSVecI8x16, shr_u: BinaryOp.ShrUVecI8x16 },
  i16x8: { shl: BinaryOp.ShlVecI16x8, shr_s: BinaryOp.ShrSVecI16x8, shr_u: BinaryOp.ShrUVecI16x8 },
  i32x4: { shl: BinaryOp.ShlVecI32x4, shr_s: BinaryOp.ShrSVecI32x4, shr_u: BinaryOp.ShrUVecI32x4 },
  i64x2: { shl: BinaryOp.ShlVecI64x2, shr_s: BinaryOp.ShrSVecI64x2, shr_u: BinaryOp.ShrUVecI64x2 },
};

const BITS: Record<Lane, number> = { i8x16: 8, i16x8: 16, i32x4: 32, i64x2: 64 };

/**
 * Splat `x`, shift lane-wise by `s`, read lane 0 back — sign-extended for
 * `shl` / `shr_s`, zero-extended for `shr_u`, so the two right shifts differ.
 */
function watFor(lane: Lane, op: Op, repeat = 1): string {
  const scalar = lane === 'i64x2' ? 'i64' : 'i32';
  const extract = BITS[lane] >= 32
    ? `${lane}.extract_lane`
    : `${lane}.extract_lane_${op === 'shr_u' ? 'u' : 's'}`;
  const shift = `(${lane}.${op} (${lane}.splat (local.get 0)) (local.get 1))`;
  const body = repeat === 1
    ? `(${extract} 0 ${shift})`
    // The same shift twice, summed lane-wise. Under a `local.set` rather than
    // the extract: LocalCSE descends into a set's value, but `extract_lane` is
    // not on its kind allow-list (a separate gap, cmem/open-work.md), so there
    // it would see neither shift.
    : `(local $v v128) (local.set $v (${lane}.add ${shift} ${shift})) (${extract} 0 (local.get $v))`;
  return `(module (func (export "f") (param ${scalar} i32) (result ${scalar}) ${body}))`;
}

/** What `watFor(lane, op, repeat)` returns for `f(x, s)`, computed in JS. */
function expected(lane: Lane, op: Op, x: bigint, s: number, repeat = 1): bigint {
  const bits = BITS[lane];
  const k = BigInt(s % bits); // wasm masks the shift count by the lane width
  const signed = BigInt.asIntN(bits, x);
  const unsigned = BigInt.asUintN(bits, x);
  let lane0 = op === 'shl'
    ? BigInt.asIntN(bits, signed << k)
    : op === 'shr_s'
    ? signed >> k
    : unsigned >> k;
  if (repeat === 2) {
    lane0 = op === 'shr_u' ? BigInt.asUintN(bits, lane0 * 2n) : BigInt.asIntN(bits, lane0 * 2n);
  }
  // A result reaches JS signed: an i64 as a BigInt, everything else as an i32.
  return BigInt.asIntN(bits === 64 ? 64 : 32, lane0);
}

const INPUTS: [bigint, number][] = [[-100n, 0], [-100n, 1], [-100n, 3], [0x1234_5678n, 9], [
  -7n,
  33,
]];

function run(wasm: Uint8Array, lane: Lane, op: Op, repeat = 1): void {
  const f = new WebAssembly.Instance(new WebAssembly.Module(wasm as BufferSource)).exports
    .f as (x: number | bigint, s: number) => number | bigint;
  for (const [x, s] of INPUTS) {
    const got = lane === 'i64x2' ? f(x, s) as bigint : BigInt(f(Number(x), s) as number);
    assertEquals(got, expected(lane, op, x, s, repeat), `${lane}.${op} f(${x}, ${s})`);
  }
}

/** Every node in the module's functions whose opcode is `opcode`. */
function nodesWithOpcode(mod: WasmModule, opcode: number): Expression[] {
  const out: Expression[] = [];
  for (const fn of mod.functions) {
    walkExpression(fn.body, (e) => {
      if ((e as { opcode?: unknown }).opcode === opcode) out.push(e);
    });
  }
  return out;
}

/** The node is a `binary` carrying the shift, vec on the left and the count on the right. */
function assertBinaryShift(e: Expression | undefined, opcode: number, where: string): void {
  assert(e !== undefined, `${where}: no node carries the shift opcode`);
  assertEquals(e.kind, ExpressionKind.Binary, `${where}: kind`);
  const b = e as BinaryExpr;
  assertEquals(b.opcode, opcode, `${where}: opcode`);
  assertEquals(b.type, ValType.V128, `${where}: type`);
  // The fixture's vec is `(<lane>.splat (local.get 0))`, its count `(local.get 1)`.
  assertEquals(b.left.kind, ExpressionKind.Unary, `${where}: vec (the splat) is left`);
  assertEquals(b.right.kind, ExpressionKind.LocalGet, `${where}: count is right`);
}

const CASES: [Lane, Op][] = (Object.keys(SUB) as Lane[]).flatMap((lane) =>
  (['shl', 'shr_s', 'shr_u'] as Op[]).map((op): [Lane, Op] => [lane, op])
);

Deno.test('K3: the twelve lane shifts are BinaryOp members with their spec opcodes', () => {
  assertEquals(CASES.length, 12);
  for (const [lane, op] of CASES) {
    assertEquals(MEMBER[lane][op], (0xfd << 16) | SUB[lane][op], `${lane}.${op}`);
  }
});

for (const [lane, op] of CASES) {
  const name = `${lane}.${op}`;
  const opcode = (0xfd << 16) | SUB[lane][op];

  Deno.test(`K3: ${name} — parseWat builds a binary, encodes as wabt-ts does, and runs`, () => {
    const wat = watFor(lane, op);
    const mod = parseWat(wat);
    assertBinaryShift(nodesWithOpcode(mod, opcode)[0], opcode, 'parseWat');
    const bytes = encodeWasm(mod);
    assertEquals(bytes, wabtReference(wat).binary);
    run(bytes, lane, op);
  });

  Deno.test(`K3: ${name} — the decoder builds a binary and re-encodes byte-identically`, () => {
    const ref = wat2wasm(watFor(lane, op));
    assert(!hasErrors(ref.errors), formatErrors(ref.errors));
    const mod = parseWasm(ref.binary);
    assertBinaryShift(nodesWithOpcode(mod, opcode)[0], opcode, 'decoder');
    const bytes = encodeWasm(mod);
    assertEquals(bytes, ref.binary);
    run(bytes, lane, op);
  });

  // A GUARD, not coverage of K3: the bridge already built `binary` before the
  // merge, so this passed on both sides. It pins that the three entry paths now
  // agree, which is what K3 removed the exception to.
  Deno.test(`K3: ${name} — the bridge builds the same binary`, () => {
    const { module, errors } = parseWatModule(new LexerSource(watFor(lane, op), '<k3>'));
    assert(!hasErrors(errors), formatErrors(errors));
    const rerrs = makeErrorList();
    resolveNames(module, rerrs);
    assert(!hasErrors(rerrs), formatErrors(rerrs));
    const mod = bridgeToBinaryen(module);
    assertBinaryShift(nodesWithOpcode(mod, opcode)[0], opcode, 'bridge');
    run(encodeWasm(mod), lane, op);
  });

  // The reason K3 went this way. LocalCSE is an allow-list of kinds; as a
  // `simd.shift` a repeated shift was never keyed, where upstream reuses it.
  Deno.test(`K3: ${name} — LocalCSE reuses a repeated shift, and the result still runs`, () => {
    const ref = wat2wasm(watFor(lane, op, 2));
    assert(!hasErrors(ref.errors), formatErrors(ref.errors));
    const mod = parseWasm(ref.binary);
    assertEquals(nodesWithOpcode(mod, opcode).length, 2, 'two shifts before');
    const localsBefore = mod.functions[0]!.locals.length;
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).add('LocalCSE').run();
    assertEquals(mod.functions[0]!.locals.length, localsBefore + 1, 'one CSE local added');
    assertEquals(nodesWithOpcode(mod, opcode).length, 1, 'one shift after');
    run(encodeWasm(mod), lane, op, 2);
  });
}

Deno.test('K3: there is no simd.shift kind to build', () => {
  // @ts-expect-error K3 — the lane shifts are `ExpressionKind.Binary`.
  const gone: unknown = ExpressionKind.SIMDShift;
  assertEquals(gone, undefined);
  assertEquals(Object.values(ExpressionKind).includes('simd.shift' as ExpressionKind), false);
});
