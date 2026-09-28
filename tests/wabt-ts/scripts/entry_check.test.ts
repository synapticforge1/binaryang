// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The release preflight's entry check (`scripts/release/entry-check.ts`):
// the package root must BE the CLI. Through 1.6.0 it was a module with no
// dispatcher, so `deno run -A jsr:@jrmarcum/binaryang --help` printed nothing
// and exited 0 on every published version.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';

import { checkEntry } from '../../../scripts/release/entry-check.ts';

const canRun = (await Deno.permissions.query({ name: 'run' })).state === 'granted' &&
  (await Deno.permissions.query({ name: 'write' })).state === 'granted';

describe('release preflight — the package root is the CLI', { ignore: !canRun }, () => {
  it('passes on this tree', async () => {
    expect(await checkEntry(Deno.cwd())).toEqual([]);
  });

  it('refuses a root with no dispatcher (the 1.6.0 shape)', async () => {
    const root = await Deno.makeTempDir({ prefix: 'entry-check-fixture-' });
    try {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        JSON.stringify({ version: '9.9.9', exports: { '.': './index.ts' } }),
      );
      await Deno.writeTextFile(`${root}/index.ts`, 'export {};\n');
      const problems = await checkEntry(root);
      expect(problems.some((p) => p.includes('--help'))).toBe(true);
      expect(problems.some((p) => p.includes('--version'))).toBe(true);
      expect(problems.some((p) => p.includes('did a command run at all'))).toBe(true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it('refuses a root that runs its CLI on import', async () => {
    const root = await Deno.makeTempDir({ prefix: 'entry-check-fixture-' });
    try {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        JSON.stringify({ version: '9.9.9', exports: { '.': './cli.ts' } }),
      );
      await Deno.writeTextFile(`${root}/cli.ts`, "console.log('USAGE wat2wasm 9.9.9');\n");
      expect((await checkEntry(root)).some((p) => p.includes('importing'))).toBe(true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
