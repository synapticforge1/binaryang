// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, stage B3: a `br_on` carries its branch VALUES, on both sides.
//
// `br_on_null $l` takes `t* (ref null ht)` and, when the ref is null, branches
// to `$l` WITH the `t*`. wabt-ts's node folds those into `values`, as decision
// 6 made every other branch do; binaryen-ts's `br_on` had no slot for them, so
// its decoder left them as preceding stack entries (which encode identically in
// linear order) and the bridge REFUSED a wabt-ts `br_on` that carried any.
//
// One node now: binaryen-ts's `BrOnExpr` has `values`, empty from its own
// decoder. This pins what a NON-empty list needs from everything that handles
// the node by hand -- both walkers must see the values, and the encoder must
// emit them before the ref -- because a wabt-ts tree will bring them.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import {
  type BrOnExpr,
  BrOnOp,
  ExpressionKind,
  makeBlock,
  makeBrOn,
  makeDrop,
  makeI32Const,
  makeLocalGet,
  makePop,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { mapExpression, walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { heapAbstract } from '../../../src/binaryen-ts/ir/gc-types.ts';
import { varIndex } from '../../../src/wabt-ts/ir/ir.ts';

const EXTERN = { heapType: heapAbstract('extern'), nullable: false };

/** `(block $l (result i32) (drop (br_on_null $l (i32.const 7) (local.get 0))) (i32.const 9))` */
function brOnNullCarrying7(): BrOnExpr {
  return {
    ...makeBrOn(BrOnOp.Null, '$l', makeLocalGet(varIndex(0), ValType.ExternRef), EXTERN),
    values: [makeI32Const(7)],
  };
}

describe('br_on carries its branch values', () => {
  it('both walkers see a carried value', () => {
    const seen: number[] = [];
    walkExpression(brOnNullCarrying7(), (e) => {
      if (e.kind === ExpressionKind.Const && 'i32' in e.value) seen.push(e.value.i32);
    });
    assertEquals(seen, [7], 'walkExpression');

    const mapped = mapExpression(
      brOnNullCarrying7(),
      (e) => e.kind === ExpressionKind.Const ? makeI32Const(8) : e,
    ) as BrOnExpr;
    assertEquals(
      mapped.values.map((v) => v.kind === ExpressionKind.Const && 'i32' in v.value && v.value.i32),
      [8],
    );
  });

  it('the encoder emits the values before the ref, so the branch delivers them', async () => {
    const m = new ModuleBuilder();
    m.addFunction(
      'f',
      [ValType.ExternRef],
      [ValType.I32],
      // `br_on_null` is `[t* (ref null ht)] -> [t* (ref ht)]`: on fall-through the
      // carried 7 STAYS on the stack, so drop the ref, then the 7 (a `Pop` stands
      // for a value already there), then yield 9. A first draft of this test
      // forgot that, and the engine said so: "expected 1 elements … found 2".
      makeBlock(
        [makeDrop(brOnNullCarrying7()), makeDrop(makePop(ValType.I32)), makeI32Const(9)],
        '$l',
        ValType.I32,
      ),
    );
    m.addExport('f', 'f');
    const bytes = encodeWasm(m.build());
    assert(WebAssembly.validate(bytes as BufferSource), 'the carried value must be on the stack');
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
    const f = instance.exports.f as (r: unknown) => number;
    assertEquals(f(null), 7, 'null ref: branch to $l with the carried 7');
    assertEquals(f({}), 9, 'non-null ref: fall through');
  });

  it('a br_on from the factory carries none', () => {
    assertEquals(
      makeBrOn(BrOnOp.Null, '$l', makeLocalGet(varIndex(0), ValType.ExternRef), EXTERN).values,
      [],
    );
  });
});
