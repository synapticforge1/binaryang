/**
 * @module scripts/check-optimize-corpus
 *
 * Optimizes every corpus module at -O1, -O2, -O3, -Os and -Oz and VALIDATES the
 * result.
 *
 * ## Why this exists
 *
 * `deno task baseline` pins what wabt-ts writes and `deno task bridge` what the
 * bridge round-trips; neither ever optimizes. Corpus checks of the optimizer were
 * one-off hashes of its output — which say whether the output CHANGED, not
 * whether it is a module an engine will load. On 2026-09-14 that let two
 * defects sit unseen: -O3 could not encode three recursive modules at all, and
 * produced output V8 rejected on sixteen more (Inlining's multi-value wrapper).
 * Both were found by accident, while measuring something else.
 *
 * So this fails when any level throws or emits a module `WebAssembly.validate`
 * rejects. It does not judge behaviour; the owner's decisions that moved -O
 * output were each checked under wasmtime at the time (cmem/unreleased.md).
 *
 * ## Usage
 *
 * ```sh
 * deno task optimize-corpus
 * ```
 *
 * @license MIT
 */

import { parseWasm } from '../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors } from '../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../src/wabt-ts/tools/wat2wasm.ts';

const CORPUS = new URL('../tests/wabt-ts/wasmtk/', import.meta.url);
const LEVELS = [
  ['-O1', { optimizeLevel: 1, shrinkLevel: 0 }],
  ['-O2', { optimizeLevel: 2, shrinkLevel: 0 }],
  ['-O3', { optimizeLevel: 3, shrinkLevel: 0 }],
  ['-Os', { optimizeLevel: 2, shrinkLevel: 1 }],
  ['-Oz', { optimizeLevel: 2, shrinkLevel: 2 }],
] as const;

const files = [...Deno.readDirSync(CORPUS)]
  .map((e) => e.name)
  .filter((n) => n.endsWith('.wat'))
  .sort();

const failures: string[] = [];
const bytes = new Map<string, number>();
for (const name of files) {
  const r = wat2wasm(await Deno.readTextFile(new URL(name, CORPUS)));
  if (hasErrors(r.errors)) {
    failures.push(`${name}: does not assemble: ${formatErrors(r.errors).trim().split('\n')[0]}`);
    continue;
  }
  for (const [tag, opts] of LEVELS) {
    try {
      const mod = parseWasm(r.binary);
      new PassRunner(mod, opts).addDefaultOptimizationPasses().run();
      const out = encodeWasm(mod);
      bytes.set(tag, (bytes.get(tag) ?? 0) + out.length);
      if (!WebAssembly.validate(out as BufferSource)) {
        let why = 'invalid';
        try {
          new WebAssembly.Module(out as BufferSource);
        } catch (e) {
          why = (e as Error).message.replace('WebAssembly.Module(): ', '');
        }
        failures.push(`${name} ${tag}: ${why}`);
      }
    } catch (e) {
      failures.push(`${name} ${tag}: threw ${(e as Error).message}`);
    }
  }
}

console.log(
  `  === corpus through the optimizer: ${files.length} modules x ${LEVELS.length} levels ===`,
);
for (const [tag] of LEVELS) console.log(`    ${tag}  ${bytes.get(tag) ?? 0} bytes`);
if (failures.length > 0) {
  console.log(`\n  ${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`    ${f}`);
  Deno.exit(1);
}
console.log('\n  every level of every module encodes and validates');
