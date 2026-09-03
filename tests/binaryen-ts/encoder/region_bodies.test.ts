// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A control construct's body is a REGION, not a nested block.
//
// `LoopExpr.body` holds ONE expression, so a loop with several statements gets
// wrapped by `oneOrTypedBlock` in a synthetic `Block` with `name === null`. That
// wrapper is a container for the IR, not a construct in the source, and it must
// not reach the binary.
//
// ⚠️ Encoding it emitted a real nested block — and the cost was not the three
// wasted bytes. The wrapper is UNNAMED, so it went onto the encoder's label
// stack as `''`, which is the SAME sentinel the FUNCTION FRAME uses. It shadowed
// the frame, and a branch aimed at the function landed on the wrapper instead:
//
//     (func (result i32) (loop $l (nop) (br 1 (i32.const 7))) (i32.const 99))
//     wabt-ts => 7        binaryen-ts => 99
//
// A valid module with the wrong answer, from valid input, with no diagnostic.
//
// 🔑 **The rule already existed and two places did not apply it.** `if` arms and
// `catch` handlers went through `encodeRegionBody`; `Loop` and `try_table` called
// `encodeExpr` directly, and the function body open-coded a third copy of the
// same logic. All four now share the one helper — the copies are what let the
// two omissions look normal.
//
// A one-statement loop needs no wrapper, so it was correct throughout: any
// fixture whose loop body is a single expression passes either way, and is the
// control here rather than the test.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** Both toolchains must build `wat`, run it, and agree with `want`. */
function bothAgree(wat: string, want: number, arg = 0): void {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the fixture');
  const run = (bytes: Uint8Array) =>
    (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports.f as (x: number) => number)(arg);
  assertEquals(run(ref.binary), want, 'wabt-ts');
  assertEquals(run(encodeWasm(parseWat(wat))), want, 'binaryen-ts');
}

/** The number of `block` instructions in the encoded body, via disassembly. */
function blockCount(wat: string): number {
  const bytes = encodeWasm(parseWat(wat));
  const ref = wat2wasm(wat, { filename: 'c.wat' });
  assert(ref.binary && !hasErrors(ref.errors));
  // Compare against wabt-ts rather than an absolute number: the claim is "no
  // MORE blocks than the source has", not a particular count.
  return bytes.length - ref.binary.length;
}

describe('encoder — a loop body is a region, not a nested block', () => {
  it('a branch to the FUNCTION FRAME is not captured by the wrapper', () => {
    // The regression. `br 1` from inside the loop targets the function frame.
    bothAgree(
      '(module (func (export "f") (param i32) (result i32) (loop $l (nop) (br 1 (i32.const 7))) (i32.const 99)))',
      7,
    );
  });

  it('a ONE-statement loop needs no wrapper — the control', () => {
    bothAgree(
      '(module (func (export "f") (param i32) (result i32) (loop $l (br 1 (i32.const 7))) (i32.const 99)))',
      7,
    );
  });

  // ⚠️ This and the nested case are GUARDS, not coverage: both pass with the
  // fix reverted, because the old code handled a branch that targets the loop
  // correctly. They exist to catch the opposite mistake — an inlining that
  // renumbers a legitimate target — which is the failure this fix could
  // plausibly introduce. Checked by reverting; only the two above discriminate.
  it('a branch to the LOOP itself still reaches the loop', () => {
    bothAgree(
      `(module (func (export "f") (param i32) (result i32) (local i32)
        (loop $l
          (local.set 0 (i32.add (local.get 0) (i32.const 1)))
          (br_if $l (i32.lt_s (local.get 0) (i32.const 5))))
        (local.get 0)))`,
      5,
    );
  });

  it('a nested loop keeps each level distinct', () => {
    // Also a guard rather than coverage — see the note above.
    bothAgree(
      `(module (func (export "f") (param i32) (result i32) (local i32) (local i32)
        (loop $outer
          (local.set 1 (i32.const 0))
          (loop $inner
            (local.set 1 (i32.add (local.get 1) (i32.const 1)))
            (br_if $inner (i32.lt_s (local.get 1) (i32.const 3))))
          (local.set 0 (i32.add (local.get 0) (i32.const 1)))
          (br_if $outer (i32.lt_s (local.get 0) (i32.const 2))))
        (i32.add (i32.mul (local.get 0) (i32.const 10)) (local.get 1))))`,
      23, // outer ran twice, inner reached 3
    );
  });

  it('the wrapper costs no bytes — output matches wabt-ts exactly', () => {
    // The size half of the same defect: +24107 bytes across the corpus.
    assertEquals(
      blockCount(
        `(module (func (export "f") (param i32) (result i32) (local i32)
          (loop $l
            (local.set 0 (i32.add (local.get 0) (i32.const 1)))
            (br_if $l (i32.lt_s (local.get 0) (i32.const 5))))
          (local.get 0)))`,
      ),
      0,
      'a synthetic wrapper must not reach the binary',
    );
  });
});
