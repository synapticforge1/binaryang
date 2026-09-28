// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A named heap type inside a `call_indirect` / `return_call_indirect` INLINE
// signature — `(call_indirect $tab (result (ref null $t)) …)` — must be
// resolved like any other. `resolveNames` walked declarations and the type
// USE (`typeVar`) but not the node's own `sig`, so `$t` reached the writer as a
// name and it refused: `writeHeapType: type "$$t" is not resolved` (the `$$`
// is the message's own `$` in front of `$t`). It was the whole main module of
// the testsuite's `return_call_indirect.wast` — 51 assertions skipped by
// wasmtk (their letter of 2026-09-28, item 1). The numeric `(ref null 0)`
// always worked.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';
import initWabt from '../../../src/wabt-ts/api/wabt-compat.ts';

const module = (call: string) =>
  `(module
  (type $t (func))
  (func $f (result (ref null $t)) (ref.null $t))
  (table $tab funcref (elem $f))
  (func (export "g") (result (ref null $t)) (${call} $tab (result (ref null $t)) (i32.const 0))))`;

describe('a named heap type in an inline call_indirect signature is resolved', () => {
  for (const call of ['call_indirect', 'return_call_indirect']) {
    it(`${call}, through wat2wasm`, () => {
      const r = wat2wasm(module(call));
      assertEquals(r.errors.length, 0, formatErrors(r.errors));
      assert(WebAssembly.validate(r.binary as BufferSource), 'valid');
      const g = new WebAssembly.Instance(new WebAssembly.Module(r.binary as BufferSource)).exports
        .g as () => unknown;
      assertEquals(g(), null); // $f returns ref.null, through the table
    });

    it(`${call}, through compat parseWat → toBinary (wasmtk's route)`, async () => {
      const wabt = await initWabt();
      const m = wabt.parseWat('t.wat', module(call));
      const { buffer } = m.toBinary({});
      assert(WebAssembly.validate(buffer as BufferSource), 'valid');
    });
  }
});
