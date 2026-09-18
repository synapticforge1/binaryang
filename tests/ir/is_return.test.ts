// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8a2 (cmem/ir-convergence.md, item 6 M8): a call's `isReturn` is `true` or
// ABSENT. binaryen-ts wrote `false` where wabt-ts wrote nothing — two spellings
// of "a plain call" on 24,737 corpus nodes, which every reader already treated
// alike. The type now admits only `true`, so `false` is unrepresentable: the
// inversion is compile-time, and `deno task check` enforces it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import type * as W from '../../src/wabt-ts/ir/ir.ts';
import { varIndex } from '../../src/wabt-ts/ir/ir.ts';
import {
  makeCall,
  makeCallIndirect,
  makeCallRef,
  makeI32Const,
} from '../../src/binaryen-ts/ir/expressions.ts';

describe('M8a2 — isReturn is true or absent, never false', () => {
  it('`false` does not type-check (compile-time)', () => {
    // @ts-expect-error — a plain call is spelled by leaving `isReturn` out
    const c: W.CallExpr = { kind: 'call', func: varIndex(0), operands: [], isReturn: false };
    assert(c);
  });

  it('the factories write the key only for a tail call', () => {
    const plain = makeCall(varIndex(0), [], 'none');
    assert(!('isReturn' in plain), 'a plain call must not carry isReturn at all');
    assertEquals(makeCall(varIndex(0), [], 'none', true).isReturn, true);

    const sig = { params: [], results: [] };
    assert(!('isReturn' in makeCallIndirect(varIndex(0), makeI32Const(0), [], sig)));
    assertEquals(makeCallIndirect(varIndex(0), makeI32Const(0), [], sig, true).isReturn, true);

    assert(!('isReturn' in makeCallRef(varIndex(0), makeI32Const(0), [], [])));
    assertEquals(makeCallRef(varIndex(0), makeI32Const(0), [], [], true).isReturn, true);
  });
});
