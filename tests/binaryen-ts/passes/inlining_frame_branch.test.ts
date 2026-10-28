// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): a callee's branch to its own FUNCTION FRAME — `br_if 0` at the
// top of its body, the label passes name `bodyFrameLabel` — was copied into the caller unchanged
// when the callee was inlined, naming a label the caller does not have. -O2, -O3, -Os and -Oz
// refused the valid module ("cfg: branch to "$l0_frame", which no enclosing construct declares");
// the fuzzer met it on 3 of ~390 modules. Every such branch now leaves the wrapper block.
//
// Each callee's result depends on which way its frame branch went, and every input runs in a
// fresh instance, so the comparison sees the branch, not left-over state.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';

const INPUTS = [0, 1, 2, 5];

function outputs(bytes: Uint8Array): number[] {
  const mod = new WebAssembly.Module(bytes as BufferSource);
  return INPUTS.map((x) =>
    (new WebAssembly.Instance(mod).exports['f'] as (x: number) => number)(x)
  );
}

function inlined(wat: string): [number[], number[]] {
  const r = wat2wasm(wat, { features: allFeatures() });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = readForPasses(r.binary);
  new PassRunner(mod, { optimizeLevel: 3, shrinkLevel: 0 }).add('Inlining').run();
  assertEquals(mod.functions.length, 1, 'the callee was not inlined');
  const after = writeWasm(mod);
  assert(WebAssembly.validate(after as BufferSource), 'the inlined module does not validate');
  return [outputs(r.binary), outputs(after)];
}

const CASES: Record<string, [string, number[]]> = {
  'br_if to the frame, with a value': [
    `(module
      (func $c (param i32) (result i32) (drop (br_if 0 (i32.const 7) (local.get 0))) (i32.const 3))
      (func (export "f") (param i32) (result i32) (i32.add (call $c (local.get 0)) (i32.const 100))))`,
    [103, 107, 107, 107],
  ],
  'br to the frame from a nested block': [
    `(module
      (func $c (param i32) (result i32)
        (block (br_if 0 (i32.eqz (local.get 0))) (br 1 (i32.const 9)))
        (i32.const 4))
      (func (export "f") (param i32) (result i32) (i32.mul (call $c (local.get 0)) (i32.const 10))))`,
    [40, 90, 90, 90],
  ],
  'br_table with the frame as a target and as the default': [
    `(module
      (func $c (param i32) (result i32)
        (block $a (result i32)
          (br_table $a 1 $a 1 (i32.const 11) (local.get 0)))
        (drop) (i32.const 22))
      (func (export "f") (param i32) (result i32) (i32.sub (call $c (local.get 0)) (i32.const 1))))`,
    [21, 10, 21, 10],
  ],
  'a try_table catch to the frame': [
    `(module (tag $t (param i32))
      (func $c (param i32) (result i32)
        (try_table (catch $t 0)
          (if (local.get 0) (then (throw $t (i32.const 50)))))
        (i32.const 6))
      (func (export "f") (param i32) (result i32) (i32.add (call $c (local.get 0)) (i32.const 1))))`,
    [7, 51, 51, 51],
  ],
};

describe('code lens 3 — inlining a callee that branches to its own function frame', () => {
  for (const [name, [wat, want]] of Object.entries(CASES)) {
    it(name, () => {
      const [before, after] = inlined(wat);
      assertEquals(before, want, 'the case itself');
      assertEquals(after, before);
    });
  }
});
