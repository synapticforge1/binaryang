// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { spawnSync } from 'node:child_process';
import * as fsx from '../../test_fs.ts';
import { DENO, denoCommand } from '../../../scripts/deno.ts';

// Open-work 51 (2026-10-28). Deno comes from npm, run by Bun, so no one installs it; its version
// was then written in four files, and four copies of one fact drift. `scripts/deno.ts` is the one
// copy: code imports `denoCommand`, command lines run the file. This gates that, by reading every
// tracked file, and the owner's CI decision with it.

/** Files that may name a Deno version: the pin itself, and history. */
const ALLOWED = (f: string) =>
  f === 'scripts/deno.ts' || f === 'CHANGELOG.md' || f.startsWith('cmem/') ||
  f === 'tests/wabt-ts/scripts/deno_pin.test.ts';

describe('the Deno pin is written once', () => {
  it('is an exact version of the npm `deno` package', () => {
    expect(DENO).toMatch(/^deno@\d+\.\d+\.\d+$/);
    expect(denoCommand(['doc'])).toEqual(['bun', ['x', DENO, 'doc']]);
  });

  it('appears in no other tracked file', async () => {
    const files = spawnSync('git', ['ls-files'], { encoding: 'utf8' }).stdout.split('\n')
      .filter((f) => /\.(ts|json|jsonc|ya?ml|md)$/.test(f) && !ALLOWED(f));
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) {
      const text = await fsx.readTextFile(f);
      for (const m of text.matchAll(/\bdeno@[\d^~]/g)) hits.push(`${f}@${m.index}`);
    }
    expect(hits).toEqual([]);
  });

  // Owner, 2026-10-28: "the CI should use npm's deno". The gates job and the runtimes matrix's
  // Deno leg run Deno through scripts/deno.ts; only publish.yml keeps setup-deno, because its
  // `deno publish` runs DIRECTLY for provenance (cmem/publishing.md).
  it('CI runs Deno through scripts/deno.ts, and installs none', async () => {
    const ci = await fsx.readTextFile('.github/workflows/ci.yml');
    expect(ci).not.toContain('setup-deno');
    expect(ci).toContain('invoke: bun scripts/deno.ts run -A');
    const publish = await fsx.readTextFile('.github/workflows/publish.yml');
    expect(publish).toContain('setup-deno');
  });
});
