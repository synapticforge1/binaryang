// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `wasm-objdump` shows what its flags ask for, as upstream's does: no flag is
// the headers, `-d` alone the details alone, `-h -d` both. `headers` started
// `true`, so `-h` re-set a default and could never mean anything, and `-d`
// always came with the headers.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const canRun = (await Deno.permissions.query({ name: 'run' })).state === 'granted' &&
  (await Deno.permissions.query({ name: 'write' })).state === 'granted';

/** `wasm-objdump <flags> <a module with one function>`'s stdout, through `main.ts`. */
async function objdump(flags: string[]): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: '.wasm' });
  try {
    await Deno.writeFile(path, wat2wasm('(module (func (param i32)))').binary);
    const entry = new URL('../../../main.ts', import.meta.url);
    const { code, stdout } = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', '--quiet', entry.pathname, 'wasm-objdump', ...flags, path],
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    assertEquals(code, 0);
    return new TextDecoder().decode(stdout);
  } finally {
    await Deno.remove(path);
  }
}

describe('wasm-objdump shows what its flags ask for', { ignore: !canRun }, () => {
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
