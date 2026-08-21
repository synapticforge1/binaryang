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
 *
 * **The validate half of that gate was missing.** This file's own comment
 * claimed "wat2wasm returns Result.Ok on a clean compile + validate", and it
 * does not — `wat2wasm` is parse → resolveNames → synthesizeTypes →
 * writeBinaryIr, with no `validateModule` anywhere in it. So for the life of
 * the corpus this asserted something it never checked, and seven invalid
 * modules sat in it unnoticed until the validator got good enough to notice
 * (T9.5's stack-arity check) and someone ran it over the corpus by hand.
 * The gate now really validates.
 */

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';

/**
 * Corpus files that are genuinely INVALID wasm — a wasic bug, not ours.
 *
 * All seven fail the same way: a function falls through without producing its
 * declared result ("expected 1 elements on the stack"). **V8, Wasmtime and
 * Wasmer all reject them**, and so do we; they are listed here so the corpus
 * gate can stay honest without going red on somebody else's defect.
 *
 * These are asserted to STILL be invalid. When wasic is fixed the assertion
 * flips and this list must shrink — that is the point of listing them rather
 * than skipping them.
 */
const KNOWN_INVALID = new Set([
  '19_NestedDiscriminantUnions.wat',
  '19_VariantMaximumMemoryAlignment.wat',
  '3_enums.wat',
  '32_BasicDiscUnion.wat',
  '32_DiscUnionMixed.wat',
  '32_Phase32Combined.wat',
  '5e_MixedSignatures.wat',
]);

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

      // The half that was missing. `wat2wasm` does not validate, so ask the
      // validator directly, with every proposal enabled — wasic emits GC,
      // exceptions, multi-memory and tail calls.
      const v = wasmValidate(result.binary!, { features: allFeatures() });
      const valid = v.result === Result.Ok;
      if (KNOWN_INVALID.has(file)) {
        assert(
          !valid,
          `${file} now VALIDATES — wasic appears fixed. Remove it from ` +
            `KNOWN_INVALID so the corpus gate covers it again.`,
        );
      } else {
        assert(valid, `${file} failed to validate:\n${formatErrors(v.errors)}`);
      }
    });
  }
});
