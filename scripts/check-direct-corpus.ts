// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The direct path's corpus gate: a text-read tree, made ready for binaryen-ts
 * (`prepareForPasses` — names M8c, types M8d), against what it must be.
 *
 * - **Unoptimized, its bytes ARE `wat2wasm`'s.** binaryen-ts's encoder over the
 *   prepared tree, compared BYTE FOR BYTE with wabt-ts's writer over the same
 *   parse. The bridge, which this path replaced (S6 step 5, M8e), was held only
 *   to "the engine accepts it", and matched `wat2wasm` on none of the 421.
 * - **Optimized at every level, it is a module the engine accepts.** The same
 *   levels `deno task optimize-corpus` runs over the decoder's tree.
 *
 * What the optimized modules DO is `deno task direct-behaviour`'s question; this
 * one runs nothing. It exits 1 on any failure (the bridge's gate only printed).
 *
 * Usage: `deno task direct`
 */

import { parseWatModule } from '../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../src/wabt-ts/ir/synthesize-types.ts';
import { wat2wasm } from '../src/wabt-ts/tools/wat2wasm.ts';
import { prepareForPasses } from '../src/binaryen-ts/ir/prepare.ts';
import { encodeWasm } from '../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../src/binaryen-ts/passes/index.ts';

const CORPUS = new URL('../tests/wabt-ts/wasmtk/', import.meta.url);

const LEVELS = [
  ['-O1', { optimizeLevel: 1, shrinkLevel: 0 }],
  ['-O2', { optimizeLevel: 2, shrinkLevel: 0 }],
  ['-O3', { optimizeLevel: 3, shrinkLevel: 0 }],
  ['-Os', { optimizeLevel: 2, shrinkLevel: 1 }],
  ['-Oz', { optimizeLevel: 2, shrinkLevel: 2 }],
] as const;

/** A text-read tree, ready for binaryen-ts — or the reason it is not. */
function prepared(wat: string) {
  const parsed = parseWatModule(wat);
  if (!parsed.module) throw new Error('wabt-ts could not parse it');
  // ⚠️ `wat2wasm` is parse -> resolveNames -> synthesizeTypes -> write; the
  // direct path shares that front end, then names and types the tree.
  resolveNames(parsed.module);
  synthesizeTypes(parsed.module);
  return prepareForPasses(parsed.module);
}

/** The engine's complaint, or `null` when it accepts the bytes. */
function rejection(bytes: Uint8Array): string | null {
  if (WebAssembly.validate(bytes as BufferSource)) return null;
  try {
    new WebAssembly.Module(bytes as BufferSource);
  } catch (e) {
    return (e as Error).message;
  }
  return 'engine rejected it';
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const files: string[] = [];
for await (const entry of Deno.readDir(CORPUS)) {
  if (entry.isFile && entry.name.endsWith('.wat')) files.push(entry.name);
}
files.sort((a, b) => a.localeCompare(b));

const failures: { file: string; where: string; detail: string }[] = [];
let identical = 0;
for (const file of files) {
  const wat = await Deno.readTextFile(new URL(file, CORPUS));
  const expected = wat2wasm(wat, { filename: file }).binary;
  try {
    const bytes = encodeWasm(prepared(wat));
    if (same(bytes, expected)) {
      identical++;
    } else {
      const detail = `${bytes.length} bytes, wat2wasm wrote ${expected.length}`;
      failures.push({ file, where: 'bytes', detail });
    }
  } catch (e) {
    failures.push({ file, where: 'prepare', detail: (e as Error).message });
    continue;
  }
  for (const [tag, opts] of LEVELS) {
    try {
      const m = prepared(wat);
      new PassRunner(m, opts).addDefaultOptimizationPasses().run();
      const why = rejection(encodeWasm(m));
      if (why !== null) failures.push({ file, where: tag, detail: why });
    } catch (e) {
      failures.push({ file, where: tag, detail: `threw: ${(e as Error).message}` });
    }
  }
}

console.log('  === direct path: wabt-ts parse -> prepareForPasses -> binaryen-ts ===');
console.log(`    byte-identical to wat2wasm   ${String(identical).padStart(4)} / ${files.length}`);
console.log(`    optimized, engine-valid      ${LEVELS.map(([t]) => t).join(' ')}`);
if (failures.length > 0) {
  console.log(`\n  === ${failures.length} failure(s) (first 30) ===`);
  for (const f of failures.slice(0, 30)) {
    console.log(`    ${f.where.padEnd(8)} ${f.file.padEnd(42)} ${f.detail.slice(0, 100)}`);
  }
  Deno.exit(1);
}
console.log(
  `\n  TOTAL — all ${files.length} byte-identical to wat2wasm, and valid at every level.`,
);
