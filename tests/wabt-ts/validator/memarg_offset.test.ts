// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.11 — only two of the twelve memarg handlers checked the offset.
//
// T9.5 added `checkMemArgOffset`: a memarg `offset=N` must fit the memory's
// INDEX TYPE, u32 for a 32-bit memory. It was wired into `onLoad` and
// `onStore` and into none of the other ten handlers that take an offset —
// `onLoadSplat`, `onLoadZero`, `onSimdLoadLane`, `onSimdStoreLane` and the six
// atomic ones — each of which declared the parameter and then ignored it.
//
// This is the same shape as the T9.6 alignment gap: a check that exists,
// reads as covered, and silently does nothing for a whole opcode family. It
// was found by `deno lint`, which had been reporting ten `offset is never
// used` warnings that looked like dead-parameter noise. They were not noise —
// an unused parameter in a handler whose siblings use it is a missing check.
//
// Three of the ten were reachable and demonstrably wrong: our validator
// accepted `v128.load8_splat`, `v128.load32_zero` and `v128.load8_lane` with
// an offset past 2^32-1 on a 32-bit memory, all of which V8 rejects. The
// atomic ones were already caught earlier in the pipeline, but are wired the
// same way so they cannot drift back.
//
// Campaign metrics unmoved: agreement 2120/2120, assert_invalid 2664/2737 —
// no spec-testsuite module exercises this, which is why four metrics missed it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

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

function ourVerdict(binary: Uint8Array): Result {
  return wasmValidate(binary, { features: allFeatures() }).result;
}

// One past the u32 index-type maximum.
const OVER = '0x100000000';

const OUT_OF_RANGE: [string, string][] = [
  ['i32.load', `(func (result i32) (i32.load offset=${OVER} (i32.const 0)))`],
  ['i32.store', `(func (i32.store offset=${OVER} (i32.const 0) (i32.const 0)))`],
  ['v128.load8_splat', `(func (result v128) (v128.load8_splat offset=${OVER} (i32.const 0)))`],
  ['v128.load32_zero', `(func (result v128) (v128.load32_zero offset=${OVER} (i32.const 0)))`],
  [
    'v128.load8_lane',
    `(func (param v128) (result v128)
       (v128.load8_lane offset=${OVER} 0 (i32.const 0) (local.get 0)))`,
  ],
  [
    'v128.store8_lane',
    `(func (param v128) (v128.store8_lane offset=${OVER} 0 (i32.const 0) (local.get 0)))`,
  ],
  ['i32.atomic.load', `(func (result i32) (i32.atomic.load offset=${OVER} (i32.const 0)))`],
  [
    'i32.atomic.store',
    `(func (i32.atomic.store offset=${OVER} (i32.const 0) (i32.const 0)))`,
  ],
  [
    'i32.atomic.rmw.add',
    `(func (result i32) (i32.atomic.rmw.add offset=${OVER} (i32.const 0) (i32.const 1)))`,
  ],
];

describe('T9.11 — every memarg handler checks the offset against the index type', () => {
  for (const [name, func] of OUT_OF_RANGE) {
    it(`rejects an out-of-range offset on ${name}`, () => {
      const binary = compile(`(module (memory 1) ${func})`);
      // V8 is the oracle: it must agree this is invalid, or the test is wrong.
      assertEquals(v8Accepts(binary), false, `V8 accepts ${name} — check the fixture`);
      assertEquals(ourVerdict(binary), Result.Error, `we accepted ${name}`);
    });
  }

  it('accepts the largest offset a 32-bit memory allows', () => {
    // The boundary matters: 0xffffffff fits the u32 index type. A check
    // written with `>=` instead of `>` would reject every one of these.
    const binary = compile(
      '(module (memory 1) (func (result v128) (v128.load8_splat offset=0xffffffff (i32.const 0))))',
    );
    assertEquals(v8Accepts(binary), true);
    assertEquals(ourVerdict(binary), Result.Ok);
  });

  it('allows a 64-bit memory the wider range', () => {
    // is64 raises the bound to 2^64-1, so what the 32-bit case rejects is fine.
    const binary = compile(
      `(module (memory i64 1) (func (result v128) (v128.load8_splat offset=${OVER} (i64.const 0))))`,
    );
    assertEquals(v8Accepts(binary), true);
    assertEquals(ourVerdict(binary), Result.Ok);
  });
});
