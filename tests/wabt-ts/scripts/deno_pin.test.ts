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

/**
 * Files that may name a Deno version: the pin itself (`package.json`'s locked devDependency, read
 * by `scripts/deno.ts` — round 4, B2), and history.
 */
const ALLOWED = (f: string) =>
  f === 'scripts/deno.ts' || f === 'CHANGELOG.md' || f.startsWith('cmem/') ||
  f === 'tests/wabt-ts/scripts/deno_pin.test.ts';

describe('the Deno pin is written once', () => {
  it('is an exact version of the npm `deno` package, locked', async () => {
    expect(DENO).toMatch(/^deno@\d+\.\d+\.\d+$/);
    // the INSTALLED binary, never a fetched one (`bun x deno@<v>` ignored the lock)
    expect(denoCommand(['doc'])).toEqual(['bun', ['run', 'deno', 'doc']]);
    // the lockfile holds that exact version, with its integrity hash
    const lock = await fsx.readTextFile('bun.lock');
    expect(lock).toContain(`"${DENO}"`);
    // and the command runs the copy installed under node_modules — the locked one
    const [cmd, argv] = denoCommand(['eval', 'console.log(Deno.version.deno, Deno.execPath())']);
    const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: 60_000 });
    expect(r.stdout).toContain(DENO.slice('deno@'.length));
    expect(r.stdout.replaceAll('\\', '/')).toContain('node_modules/deno/');
  });

  it('appears in no other tracked file', async () => {
    const files = spawnSync('git', ['ls-files'], { encoding: 'utf8' }).stdout.split('\n')
      .filter((f) => /\.(ts|json|jsonc|ya?ml|md)$/.test(f) && !ALLOWED(f));
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) {
      const text = await fsx.readTextFile(f);
      // `deno` as its own name: `setup-deno@<commit>` (an action pinned by hash) is not a pin.
      for (const m of text.matchAll(/(?<![\w-])deno@[\d^~]/g)) hits.push(`${f}@${m.index}`);
    }
    expect(hits).toEqual([]);
  });

  // Owner, 2026-10-28: "the CI should use npm's deno". Since 2026-11-18 CI runs no checks (letter
  // H37): the local gate runs Deno through scripts/deno.ts; publish.yml's `jsr` job alone needs
  // Deno, for `deno publish` run DIRECTLY (provenance, cmem/publishing.md), from the pinned,
  // sha256-checked installer — never a setup action.
  it('the gate runs Deno through scripts/deno.ts; publish.yml installs it only for the publish', async () => {
    const gate = await fsx.readTextFile('scripts/gate.ts');
    expect(gate).toContain("'scripts/deno.ts', 'run', '-A'");
    const publish = await fsx.readTextFile('.github/workflows/publish.yml');
    expect(publish).not.toContain('setup-deno');
    expect(publish).toMatch(
      /uses: \.\/\.github\/actions\/install-pinned\n\s+with:\n\s+tools: [^\n]*deno/,
    );
  });
});
