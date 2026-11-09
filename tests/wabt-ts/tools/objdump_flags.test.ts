// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `wasm-objdump` shows what its flags ask for, as upstream's does: no flag is
// the headers, `-x` alone the details alone, `-h -x` both. `headers` started
// `true`, so `-h` re-set a default and could never mean anything, and the
// details always came with the headers.
//
// CL7 (owner, 2026-11-05: upstream's flags): the details flag is `-x` /
// `--details`, as upstream's. `-d` is upstream's `--disassemble`: since 3.0.0
// (step 2) both spellings are REFUSED until binaryang has a disassembler; in
// 2.2.x `-d` printed the details.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import * as fsx from '../../test_fs.ts';
import { runTsAsync } from '../../run_ts.ts';

/** `wasm-objdump <flags> <a module with one function>`, through `main.ts`; exit 0 expected. */
async function objdump(flags: string[]): Promise<{ stdout: string; stderr: string }> {
  const r = await objdumpAny(flags);
  assertEquals(r.code, 0, r.stderr);
  return r;
}

/** The same, any exit code. */
async function objdumpAny(
  flags: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const path = await fsx.makeTempFile({ suffix: '.wasm' });
  try {
    await fsx.writeFile(path, wat2wasm('(module (func (param i32)))').binary);
    const entry = new URL('../../../main.ts', import.meta.url);
    return await runTsAsync(entry, ['wasm-objdump', ...flags, path]);
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

describe("CL7 step 2 — -d is upstream's --disassemble, refused until there is a disassembler", () => {
  for (const flag of ['-d', '--disassemble']) {
    it(`${flag}: exit 1, nothing printed, -x named — never the details silently`, async () => {
      const r = await objdumpAny([flag]);
      assertEquals(r.code, 1, r.stdout);
      assertEquals(r.stdout, '');
      assert(r.stderr.includes(`${flag} (disassembly) is not supported yet; use -x`), r.stderr);
    });
  }
});
