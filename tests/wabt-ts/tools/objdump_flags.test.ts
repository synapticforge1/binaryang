// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `wasm-objdump` shows what its flags ask for, as upstream's does: no flag is
// the headers, `-x` alone the details alone, `-h -x` both. `headers` started
// `true`, so `-h` re-set a default and could never mean anything, and the
// details always came with the headers.
//
// CL7 (owner, 2026-11-05: upstream's flags): the details flag is `-x` /
// `--details`, as upstream's. `-d` — ours for details since 2.2, upstream's
// `--disassemble` — still prints the details, with a warning on stderr, until
// the next major release.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import * as fsx from '../../test_fs.ts';
import { runTsAsync } from '../../run_ts.ts';

/** `wasm-objdump <flags> <a module with one function>`, through `main.ts`. */
async function objdump(flags: string[]): Promise<{ stdout: string; stderr: string }> {
  const path = await fsx.makeTempFile({ suffix: '.wasm' });
  try {
    await fsx.writeFile(path, wat2wasm('(module (func (param i32)))').binary);
    const entry = new URL('../../../main.ts', import.meta.url);
    const { code, stdout, stderr } = await runTsAsync(entry, ['wasm-objdump', ...flags, path]);
    assertEquals(code, 0, stderr);
    return { stdout, stderr };
  } finally {
    await fsx.remove(path);
  }
}

describe('wasm-objdump shows what its flags ask for', () => {
  for (
    const [flags, headers, details] of [
      [[], true, false],
      [['-h'], true, false],
      [['-x'], false, true],
      [['--details'], false, true],
      [['-h', '-x'], true, true],
    ] as const
  ) {
    it(`[${flags.join(' ')}]`, async () => {
      const { stdout, stderr } = await objdump([...flags]);
      assertEquals(stdout.includes('Sections:'), headers, `headers\n${stdout}`);
      assertEquals(stdout.includes('type[0] (i32) -> nil'), details, `details\n${stdout}`);
      assert(stdout.includes('file format wasm 0x1'), stdout);
      assertEquals(stderr, '');
    });
  }
});

describe('CL7 — -d is deprecated for details', () => {
  it('prints the details, as -x does, and warns', async () => {
    const d = await objdump(['-d']);
    const x = await objdump(['-x']);
    // The first line names the temp file, which differs between the two runs.
    const body = (s: string) => s.split('\n').slice(1).join('\n');
    assertEquals(body(d.stdout), body(x.stdout));
    assert(d.stdout.includes('Section Details:'), d.stdout);
    assert(d.stderr.includes('-d is deprecated for details; use -x'), d.stderr);
  });
});
