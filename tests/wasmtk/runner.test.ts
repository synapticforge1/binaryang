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

/**
 * True when every error in the list is a name-resolution failure for an
 * external symbol. Those indicate the WAT is a pre-link unit (e.g.
 * wasmtk's Math library calling `$mathlib_exp` etc. before linking) —
 * not a wabt-ts bug. We surface them in the test output as a skip rather
 * than a hard failure.
 */
function isOnlyUnresolvedExternals(errs: { message: string }[]): boolean {
  if (errs.length === 0) return false;
  return errs.every((e) => /^undefined (func|global|table|memory|tag) "/.test(e.message));
}

describe(`wasmtk WAT corpus (${files.length} files)`, () => {
  for (const file of files) {
    it(file, async () => {
      const path = new URL(file, WAT_DIR);
      const src = await Deno.readTextFile(path);
      const result = wat2wasm(src);
      // wat2wasm returns Result.Ok on a clean compile + validate. Errors
      // are accumulated in the result.errors list (parse, resolveNames,
      // synthesizeTypes, write, validate — all share one list).
      if (result.result === Result.Ok && !hasErrors(result.errors)) return;
      if (isOnlyUnresolvedExternals(result.errors)) {
        // Pre-link file — symbols would be provided by another module at
        // link time. Not a wabt-ts bug. Reported as a pass with a console
        // note so the file isn't silently swept under the rug.
        console.log(`  (skip: ${file} — pre-link file with unresolved externals)`);
        return;
      }
      assert(
        false,
        `${file} failed to compile:\n${formatErrors(result.errors)}`,
      );
    });
  }
});
