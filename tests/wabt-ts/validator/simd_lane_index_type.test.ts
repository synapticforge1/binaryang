// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.15 — the SIMD lane memory ops ignored the memory's INDEX TYPE.
//
// `onSimdLoadLane` and `onSimdStoreLane` in `type-checker.ts` each declared
// `_is64` and dropped it, hard-coding the address operand as i32. Their
// siblings `onLoadSplat` and `onLoadZero`, two screens up in the same file, do
// exactly `const addrType = is64Memory ? _I64 : _I32` — and the SharedValidator
// was already computing and passing the right value to all four.
//
// So on a 64-bit memory this is wrong in BOTH directions at once:
//
//   * `v128.load8_lane` / `v128.store8_lane` with a correct i64 address were
//     REJECTED — valid input refused, the loud T13.11 failure mode;
//   * the same instructions with an incorrect i32 address were ACCEPTED — the
//     silent T13.14 failure mode.
//
// V8 and Wasmtime 47.0.3 agree with each other on all six cases below.
//
// This is the SECOND time this exact pair of handlers has been caught dropping
// a parameter its siblings use: T9.11 fixed `offset` for `onSimdLoadLane` /
// `onSimdStoreLane` (among ten memarg handlers) and left `is64` behind, because
// that audit enumerated one parameter rather than the handler's whole
// signature. **When a family turns up one missing parameter, check the rest of
// the signature before closing it.**
//
// Nothing in the seven metrics reaches this: the spec testsuite pairs memory64
// with SIMD lane ops nowhere, and the wasmtk corpus has no memory64 at all.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(binary: Uint8Array): boolean {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

/** Valid: the address operand matches the memory's index type. */
const VALID: [string, string][] = [
  [
    'v128.load8_lane with an i64 address on a 64-bit memory',
    `(module (memory i64 1)
       (func (param v128) (result v128) (v128.load8_lane 0 (i64.const 0) (local.get 0))))`,
  ],
  [
    'v128.store8_lane with an i64 address on a 64-bit memory',
    `(module (memory i64 1)
       (func (param v128) (v128.store8_lane 0 (i64.const 0) (local.get 0))))`,
  ],
  [
    'v128.load32_lane with an i64 address on a 64-bit memory',
    `(module (memory i64 1)
       (func (param v128) (result v128) (v128.load32_lane 0 (i64.const 0) (local.get 0))))`,
  ],
  [
    // The sibling that was already right — it is here so a future edit that
    // "simplifies" all four back onto one shared helper cannot quietly undo
    // the distinction.
    'v128.load8_splat with an i64 address on a 64-bit memory (the correct sibling)',
    '(module (memory i64 1) (func (result v128) (v128.load8_splat (i64.const 0))))',
  ],
  [
    'v128.load8_lane with an i32 address on a 32-bit memory (control)',
    `(module (memory 1)
       (func (param v128) (result v128) (v128.load8_lane 0 (i32.const 0) (local.get 0))))`,
  ],
  [
    'v128.store8_lane with an i32 address on a 32-bit memory (control)',
    '(module (memory 1) (func (param v128) (v128.store8_lane 0 (i32.const 0) (local.get 0))))',
  ],
];

/** Invalid: the address operand contradicts the memory's index type. */
const INVALID: [string, string][] = [
  [
    'v128.load8_lane with an i32 address on a 64-bit memory',
    `(module (memory i64 1)
       (func (param v128) (result v128) (v128.load8_lane 0 (i32.const 0) (local.get 0))))`,
  ],
  [
    'v128.store8_lane with an i32 address on a 64-bit memory',
    `(module (memory i64 1)
       (func (param v128) (v128.store8_lane 0 (i32.const 0) (local.get 0))))`,
  ],
  [
    'v128.load8_lane with an i64 address on a 32-bit memory',
    `(module (memory 1)
       (func (param v128) (result v128) (v128.load8_lane 0 (i64.const 0) (local.get 0))))`,
  ],
  [
    'v128.store8_lane with an i64 address on a 32-bit memory',
    '(module (memory 1) (func (param v128) (v128.store8_lane 0 (i64.const 0) (local.get 0))))',
  ],
];

describe('T13.15 — SIMD lane memory ops follow the memory index type', () => {
  for (const [name, wat] of VALID) {
    it(`accepts ${name}`, () => {
      const binary = compile(wat);
      assertEquals(v8Accepts(binary), true, `V8 rejects "${name}" — check the fixture`);
      const { result, errors } = wasmValidate(binary, { features: allFeatures() });
      assertEquals(result, Result.Ok, `we rejected "${name}":\n${formatErrors(errors)}`);
    });
  }

  for (const [name, wat] of INVALID) {
    it(`rejects ${name}`, () => {
      const binary = compile(wat);
      assertEquals(v8Accepts(binary), false, `V8 accepts "${name}" — check the fixture`);
      const { result, errors } = wasmValidate(binary, { features: allFeatures() });
      assertEquals(result, Result.Error, `we accepted "${name}"`);
      // A rejection with no diagnostic is the T9.x silent-path bug.
      assert(hasErrors(errors), `"${name}" was rejected with no diagnostic`);
    });
  }
});
