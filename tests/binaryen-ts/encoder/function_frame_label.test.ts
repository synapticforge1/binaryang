// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A `br` that exits the FUNCTION must not be captured by an unnamed construct
// between it and the function frame.
//
// The encoder's label stack was `string[]`: the function frame was seeded as
// `''` (which is also how the WAT path names it), and every unnamed block, `if`
// and `try` pushed `''` too. So an unnamed construct that was actually emitted
// shadowed the frame, and the branch exited the construct instead of the
// function — valid wasm, wrong answer. C6 fixed one way of reaching it (region
// wrappers stopped being emitted); these reach it the other way, with an
// unnamed construct that is a real node.
//
// Each function is built so the two readings give different answers: 1 if the
// `br` leaves the function, 2 if it only leaves the inner construct (whose value
// is then dropped).

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import {
  type Expression,
  makeBlock,
  makeBreak,
  makeDrop,
  makeI32Const,
  makeIf,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';

/** `br` to the function frame, carrying 1. */
const exitFunctionWith1 = () => makeBreak('', null, [makeI32Const(1)]);

/** func (result i32): drop(<inner>); i32.const 2 — exported as `f`, then run. */
function run(inner: Expression): number {
  const body = makeBlock([makeDrop(inner), makeI32Const(2)], null, ValType.I32);
  const mod = new ModuleBuilder()
    .addFunction('$f', [], [ValType.I32], body)
    .addExport('f', '$f')
    .build();
  const bytes = encodeWasm(mod);
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {});
  return (inst.exports.f as () => number)();
}

describe('a br to the function frame is not captured by an unnamed construct', () => {
  it('unnamed block', () => {
    // Declared, as WAT's `(block (result i32) …)` is.
    assertEquals(run(makeBlock([exitFunctionWith1()], null, ValType.I32)), 1);
  });

  it('unnamed if', () => {
    // The then-arm exits the function; the else-arm falls through with 3.
    assertEquals(
      run(makeIf(makeI32Const(1), exitFunctionWith1(), makeI32Const(3), '', ValType.I32)),
      1,
    );
  });
});
