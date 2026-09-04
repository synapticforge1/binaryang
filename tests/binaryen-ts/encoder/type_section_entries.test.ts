// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The type section holds an entry for every signature something ADDRESSES, and
// no others.
//
// C7 from the 1.5.5 register. `collectExprTypes` registered a type for ANY
// expression whose type was multi-value. Only a CONTROL construct writes a
// blocktype, though, and a blocktype above the inline forms is an index into the
// type section — so every other multi-value expression was registering an entry
// nothing could reference.
//
// ⚠️ The one that actually fired was subtler than "any expression". A
// multi-value FUNCTION's body is wrapped by `oneOrTypedBlock` in a synthetic
// unnamed `Block` carrying the function's result type. That wrapper IS a block
// by kind — but `encodeRegionBody` inlines it, so it never writes a blocktype.
// It registered `(func (result i32 i32))`, which the function itself does not
// use (its own signature has parameters), and nothing else addressed.
//
// 🔑 The two rules must agree: **inlined means no blocktype means no type
// entry.** `isBlockTypeCarrier` and `encodeRegionBody` encode the same fact and
// are placed to be read together.
//
// This was the last measured difference between this encoder's output and
// wabt-ts's: 111 corpus modules carried an orphan entry, 643 bytes in total.
// Closing it took byte-identical output from 309/421 to 420/421 with a total
// size delta of ZERO.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** The `(type …)` lines of a module's disassembly. */
function typeLines(bytes: Uint8Array): string[] {
  return wasm2wat(bytes, { fold: false }).text
    .split('\n')
    .filter((l) => /^\s*\(type /.test(l))
    .map((l) => l.trim().replace(/\$t\d+ /, ''));
}

/**
 * binaryen-ts must emit the same SET of type-section entries wabt-ts does.
 *
 * ⚠️ Sorted, not in order. The two encoders discover types in different orders —
 * wabt-ts reaches a block header before the enclosing function's signature,
 * binaryen-ts the reverse — and both are correct, because each resolves indices
 * against its own section. The claim under test is that no entry is MISSING and
 * none is ORPHANED; ordering is not part of it. Validity is asserted separately,
 * which is what would catch an index resolved against the wrong ordering.
 */
function assertSameTypes(wat: string): void {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the fixture');
  const got = encodeWasm(parseWat(wat));
  new WebAssembly.Module(got as BufferSource); // validity before comparison
  assertEquals(typeLines(got).sort(), typeLines(ref.binary).sort());
}

describe('encoder — no orphan type-section entries', () => {
  // The regression: a multi-value function whose body wrapper carried the same
  // result type. The wrapper is inlined, so nothing addresses `() -> (i32 i32)`.
  it('a multi-value FUNCTION adds no entry for its own results', () => {
    assertSameTypes(
      `(module (func (export "f") (param i32 i32) (result i32 i32)
        (local.get 0) (local.get 1)))`,
    );
  });

  it('a multi-value function with a multi-statement body', () => {
    // Two statements force the synthetic wrapper, which is the shape that
    // registered the orphan.
    assertSameTypes(
      `(module (func (export "f") (param i32 i32) (result i32 i32)
        (nop)
        (local.get 0) (local.get 1)))`,
    );
  });

  it('a multi-value RETURN adds no entry either', () => {
    assertSameTypes(
      `(module (func (export "f") (result i32 i32)
        (return (i32.const 1) (i32.const 2))))`,
    );
  });

  // The other direction, and the reason the rule cannot simply be "never
  // register": a multi-result BLOCK genuinely writes a blocktype index, so its
  // entry MUST exist or the index is unresolvable.
  it('a multi-result BLOCK still gets its entry', () => {
    const wat = `(module (func (export "f") (result i32 i32)
      (block (result i32 i32) (i32.const 1) (i32.const 2))))`;
    assertSameTypes(wat);
    const got = encodeWasm(parseWat(wat));
    assert(
      typeLines(got).some((l) => /result i32 i32/.test(l)),
      'the block header needs an addressable type',
    );
  });

  it('a multi-result LOOP still gets its entry', () => {
    assertSameTypes(
      `(module (func (export "f") (result i32 i32)
        (loop (result i32 i32) (i32.const 1) (i32.const 2))))`,
    );
  });

  it('a multi-result IF still gets its entry', () => {
    assertSameTypes(
      `(module (func (export "f") (param i32) (result i32 i32)
        (if (result i32 i32) (local.get 0)
          (then (i32.const 1) (i32.const 2))
          (else (i32.const 3) (i32.const 4)))))`,
    );
  });

  it('call_indirect signatures are unaffected', () => {
    assertSameTypes(
      // ⚠️ Every signature must be DECLARED: an explicit `(type ...)` puts the
      // encoder in GC mode, where a function's type is resolved by lookup
      // rather than appended, so `f`'s own `() -> (i32)` has to be present too.
      // A fixture missing it fails with the same diagnostic from a different
      // section, which reads exactly like the defect under test.
      `(module (table 1 funcref)
        (type $t (func (param i32) (result i32)))
        (type $g (func (result i32)))
        (func $a (param i32) (result i32) (local.get 0))
        (elem (i32.const 0) $a)
        (func (export "f") (result i32) (call_indirect (type $t) (i32.const 5) (i32.const 0))))`,
    );
  });

  it('a single-result function adds nothing — the control', () => {
    assertSameTypes('(module (func (export "f") (result i32) (i32.const 1)))');
  });
});
