// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): the `./api` ExprBuilder's `if` and `block` declared NO result,
// so a value-producing one was written as an invalid module with no error — wasm-tools: "values
// remaining on stack at end of block". They are typed from their contents now, as the binaryen.js
// facade types them. And the module's first doc example, which passed a callback as the body and
// threw, is the working form (`createModule((b, e) => …)`), run here.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { BinaryOp, createModule, ValType } from '../../../src/api/index.ts';

const I32 = ValType.I32;

function build(make: Parameters<typeof createModule>[0]): (x: number, y?: number) => number {
  const bytes = createModule(make).toBinary();
  assert(WebAssembly.validate(bytes as BufferSource), 'the module does not validate');
  return new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports['f'] as (
    x: number,
    y?: number,
  ) => number;
}

describe('code lens 3 — ./api if and block yield what their contents yield', () => {
  it('an if with an else yields its arms value', () => {
    const f = build((b, e) => {
      b.addFunction('f', [I32], [I32], e.if(e.localGet(0), e.i32(1), e.i32(2)));
      b.addExport('f', 'f');
    });
    assertEquals([f(0), f(5)], [2, 1]);
  });

  it('a block yields its last child, as an operand too', () => {
    const f = build((b, e) => {
      b.addFunction(
        'f',
        [I32],
        [I32],
        e.binary(BinaryOp.AddI32, e.block([e.nop(), e.i32(7)]), e.localGet(0)),
      );
      b.addExport('f', 'f');
    });
    assertEquals(f(1), 8);
  });

  it('a one-armed if and a statement block still yield nothing', () => {
    const f = build((b, e) => {
      b.addFunction(
        'f',
        [I32],
        [I32],
        e.block([e.if(e.localGet(0), e.drop(e.i32(1))), e.block([e.nop()]), e.i32(3)]),
      );
      b.addExport('f', 'f');
    });
    assertEquals(f(1), 3);
  });

  it("the module doc's example builds and runs", () => {
    const f = build((b, e) => {
      b.addFunction(
        'f',
        [I32, I32],
        [I32],
        e.return(e.binary(BinaryOp.AddI32, e.localGet(0), e.localGet(1))),
      );
      b.addExport('f', 'f');
    });
    assertEquals(f(2, 3), 5);
  });
});
