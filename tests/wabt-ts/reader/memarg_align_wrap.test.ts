// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.26 — an absurd alignment exponent WRAPPED into a plausible one, and the
// pipeline turned an invalid module into a valid, different one.
//
// `readMemArg` decoded the memarg alignment as `1 << alignLog2`. JS shift
// operands are taken mod 32, so:
//
//     exponent 32  ->  1 << 32  ===  1     (decoded as align=1)
//     exponent 33  ->  1 << 33  ===  2     (decoded as align=2)
//
// A small alignment is smaller than the opcode's natural alignment, so
// `checkAlign` waved it through. V8 and Wasmtime both REJECT those modules.
// Worse, the round trip repairs them:
//
//     input (exp=32)            V8 reject / Wasmtime reject
//     wasm2wat                  ->  `i32.load align=1`
//     wat2wasm                  V8 ACCEPT / Wasmtime ACCEPT
//
// That is the T11 class — the pipeline must never turn invalid input into
// valid output — reached through the DECODER rather than the encoder, which is
// where T11 was fixed in five places at once.
//
// **Why it read as covered.** Exponents 31 and 63 wrap to a NEGATIVE number
// (`1 << 31` is -2147483648), which is smaller than any natural alignment in a
// different way and happened to be rejected. So spot-checking a big exponent
// gave the right answer for the wrong reason; only 32..62 expose it, and the
// interesting boundary is exactly where the shift wraps rather than anywhere a
// human would think to probe.
//
// Fix: `2 ** alignLog2`, which cannot wrap. The decoder keeps decoding
// faithfully and the validator does the judging, which is the division of
// labour everywhere else in this reader.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** A minimal `i32.load` module, with the memarg align byte located. */
function loadModule(): { bytes: Uint8Array; alignOffset: number } {
  const { binary, errors } = wat2wasm(
    '(module (memory 1) (func (result i32) (i32.load (i32.const 0))))',
  );
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  assert(binary);
  const op = binary.indexOf(0x28); // i32.load
  assert(op > 0, 'could not find i32.load in the fixture');
  return { bytes: binary, alignOffset: op + 1 };
}

function withAlignExponent(exp: number): Uint8Array {
  const { bytes, alignOffset } = loadModule();
  const b = Uint8Array.from(bytes);
  b[alignOffset] = exp;
  return b;
}

function v8Accepts(bytes: Uint8Array): boolean {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return WebAssembly.validate(buf);
}

function ourVerdict(bytes: Uint8Array): Result {
  return wasmValidate(bytes, { features: allFeatures() }).result;
}

// Natural alignment for i32.load is 4 (exponent 2). Anything larger is invalid.
// 32 and 33 are the wrap cases; 31 and 63 wrapped to a negative and were
// rejected by accident, so they are here to stay rejected for the right reason.
const OVERSIZED = [3, 4, 5, 31, 32, 33, 34, 62, 63];

describe('T13.26 — a memarg alignment exponent cannot wrap', () => {
  it('accepts the natural alignment', () => {
    const b = withAlignExponent(2);
    assertEquals(v8Accepts(b), true, 'fixture is wrong: V8 rejects the natural alignment');
    assertEquals(ourVerdict(b), Result.Ok);
  });

  for (const exp of OVERSIZED) {
    it(`rejects alignment exponent ${exp}`, () => {
      const b = withAlignExponent(exp);
      // V8 is the oracle. Every one of these was also confirmed against
      // Wasmtime 47.0.3 when the bug was found.
      assertEquals(v8Accepts(b), false, `V8 accepts exponent ${exp} — check the fixture`);
      assertEquals(ourVerdict(b), Result.Error, `we accepted exponent ${exp}`);
    });
  }

  it('does not REPAIR an invalid module through a round trip', () => {
    // The severity of the original bug: `wasm2wat` printed exponent 32 as
    // `align=1`, and re-encoding produced a module both engines accept — an
    // invalid input silently became a valid, different program.
    const bad = withAlignExponent(32);
    assertEquals(v8Accepts(bad), false, 'fixture should be invalid');

    const { text } = wasm2wat(bad);
    if (!text) return; // a decoder that refuses outright is also fine
    const { binary } = wat2wasm(text);
    if (!binary) return; // as is a re-encode that refuses
    assertEquals(
      v8Accepts(binary),
      false,
      `the round trip repaired an invalid module into a valid one:\n${text}`,
    );
  });

  it('keeps the multi-memory flag bit working alongside a large exponent', () => {
    // Bit 6 of the flags byte selects an explicit memidx. The exponent lives in
    // bits 0-5, so a fix that masked differently could break multi-memory.
    const src = `(module (memory $a 1) (memory $b 1)
      (func (result i32) (i32.load $b (i32.const 0))))`;
    const { binary, errors } = wat2wasm(src);
    if (hasErrors(errors)) throw new Error(formatErrors(errors));
    assert(binary);
    assertEquals(v8Accepts(binary), true);
    assertEquals(ourVerdict(binary), Result.Ok);
    // And it survives a round trip pointing at the same memory.
    const { text } = wasm2wat(binary);
    assert(text && /i32\.load/.test(text), 'disassembly lost the load');
    const again = wat2wasm(text!);
    assert(again.binary);
    assertEquals([...again.binary], [...binary], 'multi-memory load did not round-trip');
  });
});
