// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): binaryen.js's `align` of 0 means NATURAL alignment, and the
// compat facade passed it into our IR, which takes alignment in bytes: `m.i32.load(0, 0, ptr)`
// built fine and then could not be WRITTEN ("cannot encode alignment 0: not a power of two").
// binaryen.js 132 writes `i32.load` with its natural alignment (measured against the real
// package in comparison/). The facade now maps 0 to the opcode's natural alignment; any other
// value is passed through as before.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import * as binaryen from '../../../src/compat/binaryen-compat.ts';

describe('code lens 3 — compat load/store align 0 is natural alignment', () => {
  it('writes every load and store with align 0, at its natural alignment exponent', () => {
    const m = new binaryen.Module();
    m.setMemory(1, 1, null);
    const p = () => m.i32.const(0);
    // [expression, opcode byte, natural alignment exponent]
    const cases: [ReturnType<typeof m.drop>, number, number][] = [
      [m.drop(m.i32.load(0, 0, p())), 0x28, 2],
      [m.drop(m.i32.load8_s(0, 0, p())), 0x2c, 0],
      [m.drop(m.i32.load8_u(0, 0, p())), 0x2d, 0],
      [m.drop(m.i32.load16_s(0, 0, p())), 0x2e, 1],
      [m.drop(m.i32.load16_u(0, 0, p())), 0x2f, 1],
      [m.drop(m.i64.load(0, 0, p())), 0x29, 3],
      [m.drop(m.f32.load(0, 0, p())), 0x2a, 2],
      [m.drop(m.f64.load(0, 0, p())), 0x2b, 3],
      [m.i32.store(0, 0, p(), m.i32.const(1)), 0x36, 2],
      [m.i32.store8(0, 0, p(), m.i32.const(1)), 0x3a, 0],
      [m.i32.store16(0, 0, p(), m.i32.const(1)), 0x3b, 1],
      [m.i64.store(0, 0, p(), m.i64.const(1)), 0x37, 3],
      [m.f32.store(0, 0, p(), m.f32.const(1)), 0x38, 2],
      [m.f64.store(0, 0, p(), m.f64.const(1)), 0x39, 3],
    ];
    for (const [i, [e]] of cases.entries()) {
      m.addFunction(`f${i}`, binaryen.none, binaryen.none, [], e);
    }
    const bytes = m.emitBinary();
    assert(WebAssembly.validate(bytes as BufferSource), 'the module does not validate');
    // Each body is `i32.const 0; [value;] <op> <align> <offset 0>`: find each opcode followed by
    // a memarg, in function order.
    let at = 0;
    for (const [, op, exp] of cases) {
      at = bytes.indexOf(op, at);
      assert(at > 0, `opcode 0x${op.toString(16)} not found`);
      assertEquals([bytes[at + 1], bytes[at + 2]], [exp, 0], `0x${op.toString(16)}'s memarg`);
      at += 3;
    }
  });

  it('passes an explicit alignment through unchanged', () => {
    const m = new binaryen.Module();
    m.setMemory(1, 1, null);
    m.addFunction('f', binaryen.none, binaryen.none, [], m.drop(m.i32.load(0, 1, m.i32.const(0))));
    const bytes = m.emitBinary();
    const at = bytes.indexOf(0x28);
    assertEquals([bytes[at + 1], bytes[at + 2]], [0, 0], 'align=1 is exponent 0');
  });
});
