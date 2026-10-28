// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): SimplifyLocals sank a `local.set` past a CALL inside a `try`.
// A call may throw; inside a `try` the throw lands in a catch of the same function, which then
// reads the locals as they were AT the call. The set had moved into a `local.tee` after the call,
// so the handler saw the old value: `f(1)` returned 0 where the module returns 1 (V8), at
// --simplify-locals, -O2, -O3 and -Oz, with `try_table` and with legacy `try` alike. Inside a
// try a call now ends every pending sink, as a branch does; outside every try nothing changes
// (a throw leaves the function, and its locals with it).

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';

const run = (bytes: Uint8Array) => {
  const f = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
    .exports['f'] as (
      x: number,
    ) => number;
  return [0, 1, 2].map((x) => f(x));
};

function simplified(wat: string): [number[], number[]] {
  const r = wat2wasm(wat, { features: allFeatures() });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = readForPasses(r.binary);
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).add('SimplifyLocals').run();
  return [run(r.binary), run(writeWasm(mod))];
}

const body = `(local.set $s (i32.add (local.get $s) (i32.const 1)))
      (call $thrower (local.get 0))
      (local.set $s (i32.add (local.get $s) (i32.const 100)))`;

const TRY_TABLE = `(module (tag $u)
  (func $thrower (param i32) (if (local.get 0) (then (throw $u))))
  (func (export "f") (param i32) (result i32) (local $s i32)
    (block $h (try_table (catch_all $h) ${body}))
    (local.get $s)))`;

const LEGACY_TRY = `(module (tag $u)
  (func $thrower (param i32) (if (local.get 0) (then (throw $u))))
  (func (export "f") (param i32) (result i32) (local $s i32)
    (try (do ${body}) (catch_all))
    (local.get $s)))`;

describe('code lens 3 — SimplifyLocals does not sink a local write past a throwing call in a try', () => {
  it('try_table', () => {
    const [before, after] = simplified(TRY_TABLE);
    assertEquals(before, [101, 1, 1]);
    assertEquals(after, before);
  });

  it('legacy try', () => {
    const [before, after] = simplified(LEGACY_TRY);
    assertEquals(before, [101, 1, 1]);
    assertEquals(after, before);
  });

  it('still sinks past a call outside every try', () => {
    // No try: a throw would leave the function, so the move is unobservable and still made —
    // `$s`'s first set becomes a tee inside the second's value.
    const r = wat2wasm(`(module
      (func $c (param i32))
      (func (export "f") (param i32) (result i32) (local $s i32)
        ${body.replace('$thrower', '$c')}
        (local.get $s)))`);
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    const mod = readForPasses(r.binary);
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).add('SimplifyLocals').run();
    const after = writeWasm(mod);
    assertEquals(run(after), [101, 101, 101]);
    assert(after.indexOf(0x22) > 0, 'no local.tee: the set was not sunk any more');
  });
});
