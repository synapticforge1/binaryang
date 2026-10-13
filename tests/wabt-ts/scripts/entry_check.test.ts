// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The release preflight's entry check (`scripts/release/entry-check.ts`):
// the package root must BE the CLI. Through 1.6.0 it was a module with no
// dispatcher, so `deno run -A jsr:@jrmarcum/binaryang --help` printed nothing
// and exited 0 on every published version.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import { checkEntry } from '../../../scripts/release/entry-check.ts';
import * as fsx from '../../test_fs.ts';
import process from 'node:process';

describe('release preflight — the package root is the CLI', () => {
  it('passes on this tree', async () => {
    expect(await checkEntry(process.cwd())).toEqual([]);
  });

  it('refuses a root with no dispatcher (the 1.6.0 shape)', async () => {
    const root = await fsx.makeTempDir({ prefix: 'entry-check-fixture-' });
    try {
      await fsx.writeTextFile(
        `${root}/jsr.json`,
        JSON.stringify({ version: '9.9.9', exports: { '.': './index.ts' } }),
      );
      await fsx.writeTextFile(`${root}/index.ts`, 'export {};\n');
      const problems = await checkEntry(root);
      expect(problems.some((p) => p.includes('--help'))).toBe(true);
      expect(problems.some((p) => p.includes('--version'))).toBe(true);
      expect(problems.some((p) => p.includes('did a command run at all'))).toBe(true);
    } finally {
      await fsx.remove(root, { recursive: true });
    }
  });

  it('refuses a root that runs its CLI on import', async () => {
    const root = await fsx.makeTempDir({ prefix: 'entry-check-fixture-' });
    try {
      await fsx.writeTextFile(
        `${root}/jsr.json`,
        JSON.stringify({ version: '9.9.9', exports: { '.': './cli.ts' } }),
      );
      await fsx.writeTextFile(`${root}/cli.ts`, "console.log('USAGE wat2wasm 9.9.9');\n");
      expect((await checkEntry(root)).some((p) => p.includes('importing'))).toBe(true);
    } finally {
      await fsx.remove(root, { recursive: true });
    }
  });
});
