// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 50, divergence CL14 (2026-10-28): wasm2wat took no feature flags and never
// validated — it printed an invalid module, and a module using a feature the caller turned off.
// Upstream wasm2wat 1.0.41 validates by default with its default features, takes the
// `--enable-*` / `--disable-*` flags, and `--no-check` to skip (measured). So does ours now: the
// CLI validates, with exactly `wasm-validate`'s verdict; the LIBRARY function does only when
// asked (`validate: true`), as `wat2wasm`'s (DG5).

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { join } from 'node:path';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { defaultFeatures } from '../../../src/core/feature.ts';
import { Result } from '../../../src/core/result.ts';
import * as fsx from '../../test_fs.ts';
import { runTs } from '../../run_ts.ts';

const main = new URL('../../../main.ts', import.meta.url);
const SIMD = wat2wasm('(module (func (export "f") (result v128) (v128.const i32x4 1 2 3 4)))')
  .binary;
const INVALID = wat2wasm('(module (func (result i32)))', { validate: false }).binary;

describe('open-work 50 — wasm2wat validates, with feature flags, as upstream', () => {
  it('the CLI refuses an invalid module, unless --no-check', async () => {
    const dir = await fsx.makeTempDir({ prefix: 'binaryang-w2w-' });
    try {
      const bad = join(dir, 'bad.wasm');
      const simd = join(dir, 'simd.wasm');
      await fsx.writeFile(bad, INVALID);
      await fsx.writeFile(simd, SIMD);
      const refused = runTs(main, ['wasm2wat', bad]);
      assertEquals([refused.code, refused.stdout], [1, '']);
      assert(refused.stderr.includes('type mismatch'), refused.stderr);
      const unchecked = runTs(main, ['wasm2wat', '--no-check', bad]);
      assertEquals(unchecked.code, 0, unchecked.stderr);
      assert(unchecked.stdout.includes('(result i32)'), unchecked.stdout);

      const off = runTs(main, ['wasm2wat', '--disable-simd', simd]);
      assertEquals(off.code, 1, off.stdout);
      assert(off.stderr.includes('simd'), off.stderr);
      const on = runTs(main, ['wasm2wat', simd]);
      assertEquals(on.code, 0, on.stderr);
      assert(on.stdout.includes('v128.const'), on.stdout);
    } finally {
      await fsx.remove(dir, { recursive: true });
    }
  });

  it('the library validates only when asked', () => {
    assertEquals(wasm2wat(INVALID).result, Result.Ok);
    assertEquals(wasm2wat(INVALID, { validate: true }).result, Result.Error);
    const noSimd = { ...defaultFeatures(), simd: false };
    assertEquals(wasm2wat(SIMD, { validate: true, features: noSimd }).result, Result.Error);
    assertEquals(wasm2wat(SIMD, { validate: true }).result, Result.Ok);
  });
});
