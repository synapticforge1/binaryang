// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S5's named acceptance criterion: wide arithmetic round-trips through
// binaryen-ts, byte-identically, the way it already did through wabt-ts.
//
// `i64.add128`, `i64.sub128`, `i64.mul_wide_s`, `i64.mul_wide_u` were the one
// one-sided kind causing a REAL failure rather than a theoretical gap —
// wabt-ts decoded, validated and wrote all four; binaryen-ts refused the whole
// module with `unsupported bulk-memory/table opcode: 0xFC 0x13`.
//
// ## Why the shape is wabt-ts's
//
// wabt-ts was the only side that implemented these at all, so under "the worst
// condition controls the design of the element" its shape controls: binaryen-ts
// gained a `Quaternary` node mirroring wabt-ts's, rather than a binaryen-ts
// invention that would leave S6 three shapes to reconcile instead of one.
//
// The split between the two node kinds follows wabt-ts as well, and it is a
// real split rather than an accident: `add128`/`sub128` take FOUR operands and
// are quaternary; `mul_wide_s`/`_u` take TWO and are binary. wabt-ts's type
// checker already encoded exactly that, special-casing the result arity for the
// multiply pair inside `onBinary` via `isWideMul`.
//
// ⚠️ All four produce TWO i64 results, so the node's type is a tuple. That is
// what makes them a good acceptance case rather than an awkward one: they
// exercise the multi-value machinery, not just a new opcode.
//
// 🔑 The expected bytes here were cross-checked against UPSTREAM wabt, not
// against our own second implementation: `wat2wasm --enable-wide-arithmetic`
// produces the same 40 bytes and `wasm-objdump` reads `fc 13` as `i64.add128`.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { type Var, varIndex } from '../../../src/wabt-ts/ir/ir.ts';

function assemble(wat: string): Uint8Array {
  const asm = wat2wasm(wat, { filename: 'wide.wat' });
  assert(asm.binary, `fixture must assemble: ${wat.slice(0, 60)}`);
  return asm.binary;
}

/** Every node in a parsed body, depth-first. */
function nodesOf(root: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const go = (e: unknown): void => {
    if (e === null || typeof e !== 'object') return;
    const rec = e as Record<string, unknown>;
    if (rec['kind'] === undefined) return;
    out.push(rec);
    for (const key of ['children', 'body', 'a', 'b', 'c', 'd', 'left', 'right', 'operands']) {
      const v = rec[key];
      if (Array.isArray(v)) { for (const x of v) go(x); }
      else if (v && typeof v === 'object') go(v);
    }
  };
  go(root);
  return out;
}

const FOUR_OPERAND = (opcode: string) =>
  `(module (func $f (param i64 i64 i64 i64) (result i64 i64)
     (${opcode} (local.get 0) (local.get 1) (local.get 2) (local.get 3))))`;
const TWO_OPERAND = (opcode: string) =>
  `(module (func $f (param i64 i64) (result i64 i64)
     (${opcode} (local.get 0) (local.get 1))))`;

describe('S5 — wide arithmetic round-trips through binaryen-ts', () => {
  const cases: Array<[string, string]> = [
    ['i64.add128', FOUR_OPERAND('i64.add128')],
    ['i64.sub128', FOUR_OPERAND('i64.sub128')],
    ['i64.mul_wide_s', TWO_OPERAND('i64.mul_wide_s')],
    ['i64.mul_wide_u', TWO_OPERAND('i64.mul_wide_u')],
  ];

  for (const [name, wat] of cases) {
    it(`${name} re-encodes byte-identically`, () => {
      const input = assemble(wat);
      // The whole module used to be refused here.
      const out = encodeWasm(parseWasm(input));
      assertEquals(Array.from(out), Array.from(input));
    });
  }

  it('add128 decodes as a four-operand node, not a mis-shaped one', () => {
    const mod = parseWasm(assemble(FOUR_OPERAND('i64.add128')));
    const quad = nodesOf(mod.functions[0]?.body)
      .find((n) => n['kind'] === ExpressionKind.Quaternary);
    assert(quad, 'a quaternary node must be present');
    // S6 stage 1: an operator is an opcode, not a name.
    assertEquals(quad['opcode'], (0xfc << 16) | 19); // i64.add128
    // Four distinct operands, in source order — a reversed pop would swap them.
    for (const k of ['a', 'b', 'c', 'd']) assert(quad[k], `operand ${k} must be present`);
    assertEquals((quad['a'] as { var: Var }).var, varIndex(0));
    assertEquals((quad['d'] as { var: Var }).var, varIndex(3));
  });

  it('the pair produces TWO results, so the node type is a tuple', () => {
    const mod = parseWasm(assemble(FOUR_OPERAND('i64.add128')));
    const quad = nodesOf(mod.functions[0]?.body)
      .find((n) => n['kind'] === ExpressionKind.Quaternary);
    assert(quad, 'a quaternary node must be present');
    assert(Array.isArray(quad['type']), 'type must be a tuple, not a value type');
    assertEquals((quad['type'] as unknown[]).length, 2);
  });

  it('mul_wide stays BINARY — two operands, two results', () => {
    const mod = parseWasm(assemble(TWO_OPERAND('i64.mul_wide_s')));
    const bin = nodesOf(mod.functions[0]?.body)
      .find((n) => n['opcode'] === ((0xfc << 16) | 21)); // i64.mul_wide_s;
    assert(bin, 'a binary node must carry the wide multiply');
    assertEquals(bin['kind'], ExpressionKind.Binary);
    assert(Array.isArray(bin['type']), 'two results means a tuple type');
    assertEquals((bin['type'] as unknown[]).length, 2);
  });
});
