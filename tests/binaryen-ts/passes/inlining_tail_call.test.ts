// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): inlining a callee that TAIL-calls, at a plain call site.
//
// The substitution rewrote the callee's `return` into a branch to the wrapper block but copied a
// `return_call` / `return_call_indirect` / `return_call_ref` as it was — so in the caller it
// returned from the CALLER. `(i32.add (call $tailer x) (global.get $g))` lost its add (V8: 1000
// for 1007, at -O2, -Oz and --inlining; -O3 for the indirect and ref forms), and a VOID tail call
// inlined into a caller with results was an invalid module ("tail call … with return count 0,
// but the caller's signature has 1 return values"). Upstream's inliner turns such a tail call
// into an ordinary call leaving the wrapper; so does ours now.
//
// Under a `try` in the callee that conversion is not equivalent — the tail call has LEFT the try,
// an ordinary call would be caught by it — so such a callee is not inlined at a plain call site
// (the last case: without that guard it returned 78 where the module returns -1).

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';

const INPUTS = [0, 1, 3, 41];

function results(bytes: Uint8Array): Record<string, (number | string)[]> {
  const exports = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports;
  const out: Record<string, (number | string)[]> = {};
  for (const [name, fn] of Object.entries(exports)) {
    if (typeof fn !== 'function') continue;
    out[name] = INPUTS.map((x) => {
      try {
        return (fn as (x: number) => number)(x);
      } catch (e) {
        return e instanceof WebAssembly.RuntimeError ? 'trap' : String(e);
      }
    });
  }
  return out;
}

function beforeAfter(
  wat: string,
): [Record<string, (number | string)[]>, Record<string, (number | string)[]>, Uint8Array] {
  const r = wat2wasm(wat, { features: allFeatures() });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = readForPasses(r.binary);
  new PassRunner(mod, { optimizeLevel: 3, shrinkLevel: 0 }).add('Inlining').run();
  const after = writeWasm(mod);
  assert(WebAssembly.validate(after as BufferSource), 'the inlined module does not validate');
  return [results(r.binary), results(after), after];
}

const TAILS = `(module
  (type $t2 (func (param i32 i32) (result i32)))
  (type $tv (func (param i32)))
  (table 2 funcref)
  (elem (i32.const 0) $tailee $voidee)
  (elem declare func $tailee $voidee)
  (global $g (mut i32) (i32.const 0))
  (func $tailee (type $t2) (param i32 i32) (result i32)
    (global.set $g (i32.add (global.get $g) (local.get 1)))
    (i32.add (local.get 0) (i32.const 1000)))
  (func $voidee (type $tv) (param i32)
    (global.set $g (i32.add (global.get $g) (local.get 0))))
  (func $viaCall (param i32) (result i32) (return_call $tailee (local.get 0) (i32.const 7)))
  (func $viaIndirect (param i32) (result i32)
    (return_call_indirect (type $t2) (local.get 0) (i32.const 7) (i32.const 0)))
  (func $viaRef (param i32) (result i32)
    (return_call_ref $t2 (local.get 0) (i32.const 7) (ref.func $tailee)))
  (func $viaVoid (param i32) (return_call $voidee (local.get 0)))
  (func $branchy (param i32) (result i32)
    (if (local.get 0) (then (return_call $tailee (local.get 0) (i32.const 1))))
    (i32.const 5))
  (func (export "a") (param i32) (result i32)
    (global.set $g (i32.const 0)) (i32.add (call $viaCall (local.get 0)) (global.get $g)))
  (func (export "b") (param i32) (result i32)
    (global.set $g (i32.const 0)) (i32.add (call $viaIndirect (local.get 0)) (global.get $g)))
  (func (export "c") (param i32) (result i32)
    (global.set $g (i32.const 0)) (i32.add (call $viaRef (local.get 0)) (global.get $g)))
  (func (export "d") (param i32) (result i32)
    (global.set $g (i32.const 0)) (call $viaVoid (local.get 0)) (i32.add (global.get $g) (i32.const 100)))
  (func (export "e") (param i32) (result i32)
    (global.set $g (i32.const 0)) (i32.add (call $branchy (local.get 0)) (global.get $g)))
  (func (export "tc") (param i32) (result i32) (return_call $viaCall (local.get 0))))`;

const UNDER_TRY = `(module
  (tag $e)
  (func $thrower (param i32) (result i32) (if (local.get 0) (then (throw $e))) (i32.const 9))
  (func $tryTail (param i32) (result i32)
    (block $h (try_table (catch_all $h) (return_call $thrower (local.get 0))))
    (i32.const 77))
  (func (export "f") (param i32) (result i32)
    (block $out (try_table (catch_all $out)
      (return (i32.add (call $tryTail (local.get 0)) (i32.const 1)))))
    (i32.const -1)))`;

describe('code lens 3 — inlining a callee that tail-calls', () => {
  it('return_call, return_call_indirect, return_call_ref and a void one leave only the callee', () => {
    const [before, after] = beforeAfter(TAILS);
    assertEquals(before['a'], [1007, 1008, 1010, 1048]);
    assertEquals(before['d'], [100, 101, 103, 141]);
    assertEquals(after, before);
  });

  it('a tail call inside a try in the callee keeps its meaning (the callee is not inlined there)', () => {
    const [before, after] = beforeAfter(UNDER_TRY);
    assertEquals(before['f'], [10, -1, -1, -1]);
    assertEquals(after, before);
  });
});
