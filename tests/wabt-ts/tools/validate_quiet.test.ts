// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 50, divergence CL13 (2026-10-28): wasm-validate printed `<file>: OK` on success and
// `<file>: INVALID` after an invalid module's errors. Upstream wasm-validate 1.0.41 writes
// neither: nothing on success, the errors alone otherwise — the exit code is the verdict.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { join } from 'node:path';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import * as fsx from '../../test_fs.ts';
import { runTs } from '../../run_ts.ts';

const main = new URL('../../../main.ts', import.meta.url);

describe('open-work 50 — wasm-validate is silent on success, as upstream', () => {
  it('prints nothing for a valid module and only the errors for an invalid one', async () => {
    const dir = await fsx.makeTempDir({ prefix: 'binaryang-validate-' });
    try {
      const good = join(dir, 'good.wasm');
      const bad = join(dir, 'bad.wasm');
      await fsx.writeFile(good, wat2wasm('(module (func (result i32) (i32.const 1)))').binary);
      // A body with no value for its i32 result, written without validating.
      await fsx.writeFile(
        bad,
        wat2wasm('(module (func (result i32)))', { validate: false }).binary,
      );

      const ok = runTs(main, ['wasm-validate', good]);
      assertEquals([ok.code, ok.stdout, ok.stderr], [0, '', '']);

      const no = runTs(main, ['wasm-validate', bad]);
      assertEquals(no.code, 1);
      assertEquals(no.stdout, '');
      assert(no.stderr.includes('type mismatch'), no.stderr);
      assert(!no.stderr.includes('INVALID'), no.stderr);
    } finally {
      await fsx.remove(dir, { recursive: true });
    }
  });
});
