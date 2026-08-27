// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.3 — a non-power-of-two `align=N` was accepted and silently CHANGED.
//
// The text grammar requires the alignment to be a power of two, so anything
// else is MALFORMED. `parseAlignOpt` returned the raw number, which then flowed
// into a `log2` that FLOORS:
//
//     align=3   ->  emitted as align=2
//     align=7   ->  emitted as the natural alignment (4 for i32.load)
//     align=0   ->  emitted as the natural alignment
//
// That is a changed module, not a cosmetic difference. binaryen's optimizer
// reads the alignment as a HARD CONSTRAINT — the `naturalAlignForOpcode` note
// in design-decisions.md records a case where getting this field wrong made the
// optimizer bail on rewrites and produce out-of-bounds accesses at runtime.
//
// `align=0` had a second problem: 0 is also the "no `align=` keyword given"
// sentinel `parseAlignOpt` returns, so an explicit `align=0` was
// indistinguishable from writing no alignment at all.
//
// The SIZE of the alignment is a separate, VALIDATION-time rule — `align` must
// not exceed the operand's natural alignment. `align=8` on an `i32.load` is
// well-formed and INVALID, and the validator already rejected it (T9.6). Only
// the power-of-two rule belongs at parse time; conflating the two would have
// moved a diagnostic to the wrong layer.
//
// assert_malformed (quoted): 714 -> 828 / 1229 — the whole alignment category.
// Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function loadModule(instr: string, ty = 'i32'): string {
  return `(module (memory 1) (func (export "f") (result ${ty}) ${instr}))`;
}
function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}

describe('T12.3 — align must be a power of two', () => {
  for (const n of ['0', '3', '5', '6', '7', '9', '12', '100']) {
    it(`rejects align=${n}`, () => {
      assert(
        !accepts(loadModule(`(i32.load align=${n} (i32.const 0))`)),
        `accepted align=${n}`,
      );
    });
  }

  it('rejects it on every memarg-bearing family, not just i32.load', () => {
    for (
      const instr of [
        '(i32.load8_s align=0 (i32.const 0))',
        '(i32.load16_u align=3 (i32.const 0))',
        '(i32.atomic.load align=3 (i32.const 0))',
      ]
    ) {
      assert(!accepts(loadModule(instr)), `accepted: ${instr}`);
    }
    assert(
      !accepts(loadModule('(v128.load align=0 (i32.const 0))', 'v128')),
      'accepted v128.load align=0',
    );
    assert(
      !accepts('(module (memory 1) (func (i32.store align=3 (i32.const 0) (i32.const 0))))'),
      'accepted i32.store align=3',
    );
  });

  it('says what is wrong', () => {
    const { errors } = wat2wasm(loadModule('(i32.load align=3 (i32.const 0))'));
    assert(/alignment must be a power of two/.test(formatErrors(errors)), formatErrors(errors));
  });
});

describe('T12.3 — legal alignments are untouched', () => {
  it('accepts every power of two up to natural, and preserves it', () => {
    for (const [n, printed] of [['1', 'align=1'], ['2', 'align=2']] as const) {
      const { binary, errors } = wat2wasm(loadModule(`(i32.load align=${n} (i32.const 0))`));
      assert(!hasErrors(errors), `rejected align=${n}:\n${formatErrors(errors)}`);
      assert(binary);
      const text = wasm2wat(binary).text!;
      assert(text.includes(printed), `align=${n} came back as: ${text}`);
    }
  });

  it('accepts the natural alignment and omits it, as before', () => {
    const { binary, errors } = wat2wasm(loadModule('(i32.load align=4 (i32.const 0))'));
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);
    // align=4 IS natural for i32.load, so the writer leaves it implicit.
    assert(!/align=/.test(wasm2wat(binary).text!));
  });

  it('accepts a module with no align= at all', () => {
    assert(accepts(loadModule('(i32.load (i32.const 0))')));
  });
});

describe('T12.3 — oversized alignment stays a VALIDATION error, not a parse one', () => {
  it('parses align=8 on i32.load and lets the validator reject it', () => {
    // Well-formed but invalid: the power-of-two rule is the parser's, the
    // "not larger than natural" rule is the validator's. Keeping them in
    // separate layers is what lets each report the right thing.
    const { binary, errors } = wat2wasm(loadModule('(i32.load align=8 (i32.const 0))'));
    assert(!hasErrors(errors), `parse should accept align=8:\n${formatErrors(errors)}`);
    assert(binary);
    assertEquals(wasmValidate(binary, { features: allFeatures() }).result, Result.Error);
  });
});
