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

  // The placeholders are TYPED, which is what lets an unconsumed one survive:
  // `Frame.flush` keeps a typed `pop` and drops an untyped one, and a typed one
  // is emitted where it was PUSHED. Untyped, a two-result call whose first value
  // nothing consumed came back as the call alone where the decoder had `pop`
  // then call — 345 corpus functions, the largest route difference left after
  // R13 / R14 (One front end, stage 2, 2026-09-20).
  describe('a placeholder carries its value type, and its position', () => {
    // Nothing consumes the pair's FIRST value: the function returns two values,
    // so both stay on the stack to the end.
    const tail = wat2wasm(
      `(module
      (func $pair (result i32 f64) (i32.const 1) (f64.const 2))
      (func (export "f") (result i32 f64) (call $pair)))`,
      { textForm: false },
    ).binary;

    it('an unconsumed value is a typed `pop`, in the place it was pushed', () => {
      const m = readBinaryIr(tail, makeErrorList());
      const d = parseWasm(tail);
      const shape = (x: { functions: readonly { body: { children: readonly Expr[] } }[] }) =>
        x.functions[1]!.body.children.map((e) =>
          `${e.kind}(${JSON.stringify((e as { type?: unknown }).type)})`
        );
      // The pair's first value (i32) as a `pop` BEFORE the call, which stands
      // for the second (f64) — the decoder's shape, now the reader's too.
      assertEquals(shape(m), ['pop(127)', 'call(undefined)']);
      assertEquals(shape(d).map((s) => s.replace(/\(.*\)/, '')), ['pop', 'call']);
      assertEquals(shape(m)[0], shape(d)[0], 'the same typed placeholder');
    });

    it('a placeholder nothing consumes still writes nothing', () => {
      const again = wat2wasm(wasm2wat(tail).text, { textForm: false }).binary;
      assertEquals([...again], [...tail], 'byte-identical through text');
      assert(WebAssembly.validate(tail as BufferSource));
      const x = new WebAssembly.Instance(new WebAssembly.Module(tail as BufferSource)).exports;
      assertEquals((x.f as () => unknown[])(), [1, 2], 'and the values come back in order');
    });
  });
});
