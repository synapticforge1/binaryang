// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `wasmValidate(binary, { features })` takes a feature set, and its own doc
// said "pass `allFeatures`" — but no subpath exported it, so a caller could
// only pass one it wrote by hand (wasmtk's letter of 2026-09-28, item 2: they
// want `wasmValidate` as the oracle for modules V8 refuses only for its own
// limits — 2^48-page memories, 2^64-element tables — and will not copy our
// feature list). Exported now from `./wasm-validate` and `./core/wabt-ts`.

import { assert, assertEquals } from '@std/assert';

import * as validate from '../../../src/wabt-ts/tools/wasm-validate.ts';
import * as core from '../../../src/wabt-ts/core/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';

Deno.test('allFeatures / defaultFeatures are exported where wasmValidate is', () => {
  for (const [where, mod] of [['./wasm-validate', validate], ['./core/wabt-ts', core]] as const) {
    assertEquals(typeof mod.allFeatures, 'function', `${where} allFeatures`);
    assertEquals(typeof mod.defaultFeatures, 'function', `${where} defaultFeatures`);
  }
});

Deno.test('with allFeatures, wasmValidate accepts what the defaults refuse', () => {
  // A 2^48-page memory64: valid by the spec (the limit), refused by V8 for its
  // own implementation limit, and outside the default feature set here.
  const { binary, errors } = wat2wasm('(module (memory i64 0x1_0000_0000_0000))');
  assertEquals(errors.length, 0);
  assertEquals(
    validate.wasmValidate(binary).result,
    Result.Error,
    'default features refuse memory64',
  );
  const all = validate.wasmValidate(binary, { features: validate.allFeatures() });
  assert(all.result === Result.Ok, 'allFeatures accepts it');
  const viaCore = validate.wasmValidate(binary, { features: core.allFeatures() });
  assert(viaCore.result === Result.Ok, "./core/wabt-ts's allFeatures is the same set");
});
