// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Bug G regression — `call_indirect (type $name)` resolves to the correct
 * type index when the named type is not the first declared type.
 *
 * Before the fix, `resolveNames` resolved the `table` var on
 * `call_indirect` but skipped the `typeVar`, so any `(type $name)` form
 * with a non-first type silently emitted `(type 0)`. Critical for wasic's
 * higher-order array methods (map/filter/find/reduce…), which compile to
 * named-type call_indirect everywhere.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';

const moduleWat = `(module
  (type $voidret (func (param i32)))
  (type $i32ret (func (param i32) (result i32)))
  (type $bothargs (func (param i32 i32) (result i32)))
  (table funcref (elem $double))
  (func $double (param i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))
  (func (export "via_i32ret") (param $i i32) (result i32)
    (call_indirect (type $i32ret) (i32.const 21) (local.get $i)))
  (func (export "via_voidret") (param $i i32)
    (call_indirect (type $voidret) (i32.const 21) (local.get $i))))`;

describe('Bug G: call_indirect (type $name) resolves the right index', () => {
  it('round-trips through wasm2wat with correct type indices', () => {
    const r = wat2wasm(moduleWat);
    if (r.result !== Result.Ok) console.log(formatErrors(r.errors));
    assertEquals(r.result, Result.Ok);
    const d = wasm2wat(r.binary);
    assertEquals(d.result, Result.Ok);
    // via_i32ret should reference $i32ret which is type index 1.
    // via_voidret should reference $voidret which is type index 0.
    // After Bug G's fix, both should serialize back with the right
    // numeric type indices (not both 0).
    assertEquals(
      d.text.includes('call_indirect (type 1)'),
      true,
      `via_i32ret should reference type 1; full text:\n${d.text}`,
    );
    assertEquals(
      d.text.includes('call_indirect (type 0)'),
      true,
      `via_voidret should reference type 0; full text:\n${d.text}`,
    );
  });

  it('runtime: call_indirect (type $i32ret) returns the right value', async () => {
    const r = wat2wasm(moduleWat);
    assertEquals(r.result, Result.Ok);
    const buf = new ArrayBuffer(r.binary.byteLength);
    new Uint8Array(buf).set(r.binary);
    const inst = (await WebAssembly.instantiate(buf)).instance.exports as {
      via_i32ret: (i: number) => number;
    };
    // $double doubles its arg. call_indirect with i=0 dispatches to $double.
    // Expected: $double(21) = 42.
    assertEquals(inst.via_i32ret(0), 42);
  });
});
