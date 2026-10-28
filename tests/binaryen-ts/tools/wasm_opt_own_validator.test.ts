// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 52 (c), 2026-10-28: wasm-opt checked its OUTPUT with the host engine's
// `WebAssembly.compile`, so the verdict depended on the runtime running the tool — on Bun
// (JavaScriptCore) a valid memory64 module failed "optimized module failed validation …
// Memory64 is not enabled" with no pass run at all, and an input JSC refuses was blamed on the
// optimizer. The output is checked by this project's validator now, with every feature, as the
// input is. This test runs on Node and on Bun alike, and must pass on both.

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { Result } from '../../../src/core/result.ts';

const bytes = (wat: string) => wat2wasm(wat, { features: allFeatures() }).binary;

describe('open-work 52 — wasm-opt judges its output with its own validator', () => {
  it('a valid memory64 module optimizes on any runtime', async () => {
    const out = await wasmOpt(
      bytes(
        '(module (memory i64 1) (func (export "f") (param i64) (result i32) (i32.load (local.get 0))))',
      ),
      { optimizeLevel: 2 },
    );
    assert(out instanceof Uint8Array);
    assert(wasmValidate(out, { features: allFeatures() }).result === Result.Ok);
  });

  it('and with no pass at all', async () => {
    const out = await wasmOpt(bytes('(module (memory i64 1))'), { passes: [] });
    assert(out instanceof Uint8Array && out.length > 8);
  });
});
