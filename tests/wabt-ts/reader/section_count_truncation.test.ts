// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.33 — the type section silently truncated when its declared count
// exceeded the entries actually present.
//
//     (type count 4294967295)  with no entries  ->  decoded to ZERO types,
//                                                   reported nothing, validated
//                                                   clean. V8 rejects it.
//
// Ten of the eleven section readers check the section bound INSIDE the loop and
// call `shortSection()` (or `this.err`) when the input runs out:
//
//     for (let i = 0; i < count && this.ok(); i++) {
//       if (this.pos >= end) return this.shortSection();
//       ...
//
// `readTypeSection` put the same bound in the loop CONDITION instead:
//
//     for (let g = 0; g < groupCount && this.pos < end && this.ok(); g++) {
//
// so running out of input was indistinguishable from finishing normally. Both
// its loops — the rec-group loop too — had it.
//
// Found through a HARDENING lens rather than a bug hunt: probing the decoder
// with enormous declared counts to see whether it would hang or allocate before
// checking the remaining input. It does neither (all eleven sections bail in
// 0ms), but the type section bailed SILENTLY, which the throw-and-hang fuzzing
// of T13.29 could never have seen — that asked whether the decoder survives
// malformed input, not whether it NOTICES.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';

/** A module with one section carrying `body` verbatim. */
function withSection(sectionId: number, body: number[]): Uint8Array {
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, sectionId, body.length, ...body]);
}

const LEB_MAX_U32 = [0xff, 0xff, 0xff, 0xff, 0x0f]; // 4294967295
const FUNC_TYPE = [0x60, 0x00, 0x00]; // (func)

function v8Accepts(bytes: Uint8Array): boolean {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return WebAssembly.validate(buf);
}

/** Declared count vs entries supplied, for the TYPE section. */
const MISMATCHED: [string, Uint8Array][] = [
  ['count 4294967295, no entries', withSection(1, LEB_MAX_U32)],
  ['count 5, no entries', withSection(1, [0x05])],
  ['count 1, no entries', withSection(1, [0x01])],
  ['count 2, one entry', withSection(1, [0x02, ...FUNC_TYPE])],
  ['count 3, two entries', withSection(1, [0x03, ...FUNC_TYPE, ...FUNC_TYPE])],
  // The rec-group inner loop had the same shape.
  ['rec group of 4, one entry', withSection(1, [0x01, 0x4e, 0x04, ...FUNC_TYPE])],
];

describe('T13.33 — a declared section count must match the entries present', () => {
  for (const [name, bytes] of MISMATCHED) {
    it(`rejects a type section with ${name}`, () => {
      // V8 is the oracle: it must agree these are malformed.
      assertEquals(v8Accepts(bytes), false, `V8 accepts "${name}" — check the fixture`);

      const errs = makeErrorList();
      readBinaryIr(bytes, errs);
      assert(
        hasErrors(errs),
        `the reader accepted "${name}" and silently truncated — a declared count ` +
          `that outruns the section is malformed, not the end of the loop`,
      );

      const { result } = wasmValidate(bytes, { features: allFeatures() });
      assertEquals(result, Result.Error, `wasm-validate accepted "${name}"`);
    });
  }

  it('still accepts a type section whose count is exact', () => {
    // The guard against over-correcting — rejecting everything would satisfy
    // every assertion above.
    const bytes = withSection(1, [0x01, ...FUNC_TYPE]);
    assertEquals(v8Accepts(bytes), true, 'fixture is wrong: V8 rejects the valid module');
    const errs = makeErrorList();
    const m = readBinaryIr(bytes, errs);
    assert(!hasErrors(errs), `rejected a valid type section:\n${formatErrors(errs)}`);
    assertEquals(m.types.length, 1);
  });

  it('still round-trips a real module with several types and a rec group', () => {
    const { binary, errors } = wat2wasm(`(module
      (type $a (func (param i32) (result i32)))
      (type $b (func))
      (rec (type $c (struct (field i32))) (type $d (struct (field (ref null $c)))))
      (func (type $b)))`);
    if (hasErrors(errors)) throw new Error(formatErrors(errors));
    assert(binary);
    const errs = makeErrorList();
    const m = readBinaryIr(binary, errs);
    assert(!hasErrors(errs), `a valid multi-type module failed to decode:\n${formatErrors(errs)}`);
    assertEquals(m.types.length, 4, 'lost a type entry');
  });

  it('does not hang or over-allocate on an enormous count in ANY section', () => {
    // The hardening question that started this: a 14-byte module declaring
    // 4.29 billion entries must fail fast, not loop or allocate first.
    for (const id of [1, 2, 3, 4, 5, 6, 7, 9, 10, 11]) {
      const bytes = withSection(id, LEB_MAX_U32);
      const t0 = performance.now();
      const errs = makeErrorList();
      readBinaryIr(bytes, errs);
      const ms = performance.now() - t0;
      assert(ms < 1000, `section ${id} took ${Math.round(ms)}ms on a 4.29-billion count`);
      assert(hasErrors(errs), `section ${id} accepted a 4.29-billion declared count`);
    }
  });
});
