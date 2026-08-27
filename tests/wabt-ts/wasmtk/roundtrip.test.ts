// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Round-trip integration test: every `.wat` file under `tests/wasmtk/` is run
 * through `wat2wasm` → `wasm2wat` → `wat2wasm`, asserting the disassembly
 * RE-COMPILES cleanly. This is the structural guard for the
 * invalid-`wasm2wat`-output class of bug (e.g. the 2026-06-09 round-5 finding
 * where synthetic names were emitted without the leading `$`, producing WAT
 * that did not round-trip). The plain corpus runner only checks the forward
 * direction (`wat2wasm` + validate); this one closes the loop.
 *
 * A failure means `wasm2wat` produced text the parser rejects — i.e. the
 * disassembler emitted invalid WAT.
 */

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';

const WAT_DIR = new URL('.', import.meta.url);

async function listWatFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(WAT_DIR)) {
    if (entry.isFile && entry.name.endsWith('.wat')) out.push(entry.name);
  }
  return out.sort();
}

const files = await listWatFiles();

describe(`wasmtk WAT corpus — wasm2wat round-trip (${files.length} files)`, () => {
  for (const file of files) {
    it(file, async () => {
      const src = await Deno.readTextFile(new URL(file, WAT_DIR));
      const forward = wat2wasm(src);
      if (forward.result !== Result.Ok) return; // forward failures are the plain runner's concern

      const dis = wasm2wat(forward.binary);
      assert(
        dis.result === Result.Ok,
        `${file}: wasm2wat failed:\n${formatErrors(dis.errors)}`,
      );

      const recompiled = wat2wasm(dis.text);
      assert(
        recompiled.result === Result.Ok,
        `${file}: wasm2wat output did not re-compile (invalid WAT):\n${
          formatErrors(recompiled.errors)
        }`,
      );
    });
  }
});
