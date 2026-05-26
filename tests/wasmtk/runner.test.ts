// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Integration tests: every `.wat` file under `tests/wasmtk/` is compiled
 * through `wat2wasm` and validated. These are real-world modules emitted
 * by wasmtk's wasic compiler (port of TypeScript → WAT), so they exercise
 * the parser / IR / writer / validator pipeline together against shapes
 * we don't otherwise hand-craft.
 *
 * Each WAT file becomes one `it(...)` so failures are reported by
 * filename. A failure means either:
 *   - The WAT parser rejected the input (parse error)
 *   - `resolveNames` couldn't resolve some symbolic reference
 *   - `synthesizeTypes` mis-handled an inline signature
 *   - The validator rejected the resulting module
 *
 * We don't run the produced wasm — instantiation depends on imports the
 * test setup doesn't provide. The compile + validate gate is what
 * catches the bugs wasmtk has been surfacing against wabt-ts.
 */

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';

const WAT_DIR = new URL('.', import.meta.url);

async function listWatFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(WAT_DIR)) {
    if (entry.isFile && entry.name.endsWith('.wat')) out.push(entry.name);
  }
  return out.sort();
}

const files = await listWatFiles();

describe(`wasmtk WAT corpus (${files.length} files)`, () => {
  for (const file of files) {
    it(file, async () => {
      const path = new URL(file, WAT_DIR);
      const src = await Deno.readTextFile(path);
      const result = wat2wasm(src);
      // wat2wasm returns Result.Ok on a clean compile + validate. Errors
      // are accumulated in result.errors (parse, resolveNames,
      // synthesizeTypes, write, validate — all share one list). Every
      // file in the corpus is a self-contained module; pre-link units
      // that reference unimported externals were removed at curation time.
      if (result.result !== Result.Ok || hasErrors(result.errors)) {
        assert(
          false,
          `${file} failed to compile:\n${formatErrors(result.errors)}`,
        );
      }
    });
  }
});
