// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): `memory.copy` typed its COUNT at the destination's address type.
// The spec (memory64 + multi-memory) types it at the smaller of the two — as `table.copy`'s check
// beside it already did — so a valid copy from a 32-bit memory into a 64-bit one was refused by
// wat2wasm, wasm-validate and wasm-interp alike. Upstream wabt 1.0.41 and wasm-tools accept it,
// and V8 runs it.

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

const copy = (dst: string, src: string, d: string, s: string, n: string) =>
  `(module (memory $m64 i64 1) (memory $m32 1) (memory $o64 i64 1)
     (func (memory.copy ${dst} ${src} (${d}.const 0) (${s}.const 0) (${n}.const 4))))`;

const verdict = (wat: string) => {
  const r = wat2wasm(wat, { validate: true, features: allFeatures() });
  return { ok: !hasErrors(r.errors), text: formatErrors(r.errors) };
};

describe('code lens 3 — memory.copy types its count at the smaller address type', () => {
  it('accepts an i32 count for 64-bit ← 32-bit and 32-bit ← 64-bit', () => {
    for (
      const w of [
        copy('$m64', '$m32', 'i64', 'i32', 'i32'),
        copy('$m32', '$m64', 'i32', 'i64', 'i32'),
      ]
    ) {
      const v = verdict(w);
      assert(v.ok, v.text);
    }
  });

  it('refuses an i64 count when either memory is 32-bit', () => {
    for (
      const w of [
        copy('$m64', '$m32', 'i64', 'i32', 'i64'),
        copy('$m32', '$m64', 'i32', 'i64', 'i64'),
      ]
    ) {
      const v = verdict(w);
      assert(!v.ok, 'an i64 count between a 64- and a 32-bit memory was accepted');
      assert(v.text.includes('memory.copy'), v.text);
    }
  });

  it('still wants i64 between two 64-bit memories, and i32 between two 32-bit ones', () => {
    assert(verdict(copy('$m64', '$o64', 'i64', 'i64', 'i64')).ok);
    assert(!verdict(copy('$m64', '$o64', 'i64', 'i64', 'i32')).ok);
    assert(verdict(copy('$m32', '$m32', 'i32', 'i32', 'i32')).ok);
  });
});
