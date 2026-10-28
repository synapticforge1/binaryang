// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 50, divergence CL6 (2026-10-28): `wasm2wat --generate-names` named every entity by
// index (`$f0`, `$g0`, …), no param or local, and every label `$B`. Upstream wabt 1.0.41's
// scheme (src/generate-names.cc): imports first, `$module.field`; then exports, the export's
// name; then the index names for what is still unnamed; `$p<i>` / `$l<i>` for params and locals;
// labels `$B` block, `$L` loop, `$I` if, `$T` try, one counter per function. On one unnamed
// binary, ours now gives upstream's exact set of names (measured).

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { allFeatures } from '../../../src/core/feature.ts';

const WAT = `(module
  (type (func (param i32) (result i32)))
  (type (func (param i32 i32) (result i32)))
  (import "env" "imp" (func (type 0)))
  (import "env" "g" (global i32))
  (global (export "gexp") i32 (i32.const 1))
  (global (mut i32) (i32.const 0))
  (func (export "add") (type 1) (local i64)
    (block (result i32)
      (loop (result i32)
        (if (result i32) (local.get 0)
          (then (local.get 1))
          (else (call 0 (local.get 0)))))))
  (func (type 0) (local.get 0)))`;

const names = () => {
  const bytes = wat2wasm(WAT, { features: allFeatures(), textForm: false }).binary;
  // Strip the name section the assembler writes, so every entity is unnamed.
  const r = wasm2wat(bytes, { readDebugNames: false, generateNames: true, fold: false });
  return new Set(r.text.match(/\$[A-Za-z0-9_.]+/g) ?? []);
};

describe('open-work 50 — --generate-names follows upstream wabt', () => {
  it('imports are $module.field, exported entities their export name', () => {
    const n = names();
    for (const want of ['$env.imp', '$env.g', '$add', '$gexp']) {
      assert(n.has(want), `${want}: ${[...n]}`);
    }
  });

  it('the rest by index, params and locals $p / $l, labels by kind', () => {
    const n = names();
    for (const want of ['$f2', '$g2', '$t0', '$t1', '$p0', '$p1', '$l2', '$B0', '$L1', '$I2']) {
      assert(n.has(want), `${want}: ${[...n]}`);
    }
    assert(!n.has('$f0') && !n.has('$f1'), 'an import or export got an index name');
  });
});
