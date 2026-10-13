// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `wasm-objdump` shows what its flags ask for, as upstream's does: no flag is
// the headers, `-d` alone the details alone, `-h -d` both. `headers` started
// `true`, so `-h` re-set a default and could never mean anything, and `-d`
// always came with the headers.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import * as fsx from '../../test_fs.ts';
import { runTsAsync } from '../../run_ts.ts';

/** `wasm-objdump <flags> <a module with one function>`'s stdout, through `main.ts`. */
async function objdump(flags: string[]): Promise<string> {
  const path = await fsx.makeTempFile({ suffix: '.wasm' });
  try {
    await fsx.writeFile(path, wat2wasm('(module (func (param i32)))').binary);
    const entry = new URL('../../../main.ts', import.meta.url);
    const { code, stdout } = await runTsAsync(entry, ['wasm-objdump', ...flags, path]);
    assertEquals(code, 0);
    return stdout;
  } finally {
    await fsx.remove(path);
  }
}

describe('wasm-objdump shows what its flags ask for', () => {
  for (
    const [flags, headers, details] of [
      [[], true, false],
      [['-h'], true, false],
      [['-d'], false, true],
      [['-h', '-d'], true, true],
    ] as const
  ) {
    it(`[${flags.join(' ')}]`, async () => {
      const out = await objdump([...flags]);
      assertEquals(out.includes('Sections:'), headers, `headers\n${out}`);
      assertEquals(out.includes('type[0] (i32) -> ()'), details, `details\n${out}`);
      assert(out.includes('file format wasm 0x1'), out);
    });
  }
});
