// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The binary reader's operand stack holds one entry per VALUE, not per NODE.
//
// It held one entry per node, so a consumer popping N values from a stack whose
// top node produced several took that node AND ITS NEIGHBOURS:
// `(call $three (local.get 0) (call $pair))` — `$pair` returning two values —
// read back with the `local.get` in the middle slot and a placeholder in the
// first. The bytes were right; every consumer of the tree read a different
// program, and binaryen-ts's decoder (which has always modelled it per value)
// disagreed on 41 corpus functions (One front end, stage 2, 2026-09-19).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { formNodes } from '../../../src/wabt-ts/ir/text-form.ts';
import type { Expr } from '../../../src/wabt-ts/ir/ir.ts';

const SRC = `(module
  (func $pair (result i32 i32) (i32.const 1) (i32.const 2))
  (func $three (param i32 i32 i32) (result i32)
    (i32.add (local.get 0) (i32.add (local.get 1) (local.get 2))))
  (func (export "f") (param i32) (result i32)
    (call $three (local.get 0) (call $pair)))
  (func (export "g") (result i32)
    (call $three (call $pair) (i32.const 9))))`;

const bytes = wat2wasm(SRC, { textForm: false }).binary;
const operandKinds = (
  m: { functions: readonly { body: { children: readonly Expr[] } }[] },
  i: number,
) => {
  const call = m.functions[i]!.body.children[0]!;
  return call.kind === 'call' ? call.operands.map((o) => o.kind) : [call.kind];
};

describe('binary reader — one stack entry per value', () => {
  it('a two-result call fills TWO operand slots, the value before it keeps its own', () => {
    const m = readBinaryIr(bytes, makeErrorList());
    // `(call $three (local.get 0) (call $pair))`: slot 0 the local.get, slots
    // 1 and 2 the pair — its first value as a `pop`, the call itself last.
    assertEquals(operandKinds(m, 2), ['local.get', 'pop', 'call']);
    // `(call $three (call $pair) (i32.const 9))`: the pair fills slots 0 and 1.
    assertEquals(operandKinds(m, 3), ['pop', 'call', 'const']);
  });

  it("binaryen-ts's decoder builds the same operand shape", () => {
    const m = readBinaryIr(bytes, makeErrorList());
    const d = parseWasm(bytes);
    for (const i of [2, 3]) assertEquals(operandKinds(m, i), operandKinds(d, i), `function ${i}`);
    // And the same instruction sequence, which is what the text-form record's
    // positions are indexed by.
    for (const i of [2, 3]) {
      const a = formNodes(m.functions[i]!.body.children, false).nodes.map((n) => n.kind);
      const b = formNodes(d.functions[i]!.body.children, false).nodes.map((n) => n.kind);
      assertEquals(a, b, `function ${i} sequence`);
    }
  });

  it('the bytes round-trip, and the module still runs', () => {
    const again = wat2wasm(wasm2wat(bytes).text, { textForm: false }).binary;
    assertEquals([...again], [...bytes]);
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports;
    assert(typeof x.f === 'function');
    assertEquals((x.f as (v: number) => number)(5), 5 + 1 + 2);
    assertEquals((x.g as () => number)(), 1 + 2 + 9);
  });
});
