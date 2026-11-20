/**
 * @module scripts/check-optimize-corpus
 *
 * Optimizes every corpus module at -O1, -O2, -O3, -Os and -Oz and VALIDATES the
 * result.
 *
 * ## Why this exists
 *
 * `bun run baseline` pins what wabt-ts writes and `bun run direct` what a
 * text-read tree encodes to (it optimizes too, but a TEXT-read tree; this gate
 * optimizes and WRITES what `wasm-opt` does: `readForPasses` in, `writeWasm` out — the
 * wabt-ts reader and writer since One front end stages 3a and 4; binaryen-ts's
 * decoder and encoder until then). Before them neither ever optimized. Corpus checks of the optimizer were
 * one-off hashes of its output — which say whether the output CHANGED, not
 * whether it is a module an engine will load. On 2026-09-14 that let two
 * defects sit unseen: -O3 could not encode three recursive modules at all, and
 * produced output V8 rejected on sixteen more (Inlining's multi-value wrapper).
 * Both were found by accident, while measuring something else.
 *
 * So this fails when any level throws or emits a module `WebAssembly.validate`
 * rejects — or (open-work 34, 2026-10-24) emits one that NEEDS a feature its input
 * does not (`featuresNeeded`, the validator's rule): no pass consults features,
 * so none may introduce one. It does not judge behaviour; the owner's decisions that moved -O
 * output were each checked under wasmtime at the time (cmem/unreleased.md).
 *
 * ## The size ratchet against real binaryen (security review round 4, C-R2-2)
 *
 * It also measures binaryang's -Oz on the corpus, and -O2 / -Oz on the six real-compiler modules,
 * against REAL `wasm-opt` (`opt-size.ts`) and fails when the ratio grows past
 * `optimize-size-baseline.json` — or when `wasm-opt` is missing or not the baseline's version.
 * `--update-baseline` records a new baseline, deliberately (after a gain, or an owner-approved
 * trade).
 *
 * ## Usage
 *
 * ```sh
 * bun run optimize-corpus
 * bun run optimize-corpus --update-baseline
 * ```
 *
 * @license MIT
 */

import { readForPasses } from '../src/ir/prepare.ts';
import { writeWasm } from '../src/ir/write-wasm.ts';
import { PassRunner } from '../src/passes/index.ts';
import { formatErrors, hasErrors } from '../src/core/error.ts';
import { wat2wasm } from '../src/tools/wat2wasm.ts';
import { featuresNeeded } from '../src/tools/target.ts';
import {
  BASELINE,
  binaryenSize,
  binaryenVersion,
  codeBytes,
  judge,
  readBaseline,
  refusedChanges,
  requireSix,
  scratch,
  type SizeBaseline,
  type SizeEntry,
} from './opt-size.ts';

import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { readdirSync, readFileSync } from 'node:fs';

const CORPUS = new URL('../tests/wabt-ts/wasmtk/', import.meta.url);
const LEVELS = [
  ['-O1', { optimizeLevel: 1, shrinkLevel: 0 }],
  ['-O2', { optimizeLevel: 2, shrinkLevel: 0 }],
  ['-O3', { optimizeLevel: 3, shrinkLevel: 0 }],
  ['-Os', { optimizeLevel: 2, shrinkLevel: 1 }],
  ['-Oz', { optimizeLevel: 2, shrinkLevel: 2 }],
] as const;

const files = readdirSync(CORPUS, { withFileTypes: true })
  .map((e) => e.name)
  .filter((n) => n.endsWith('.wat'))
  .sort();

const failures: string[] = [];
/** The corpus's modules as bytes and what -Oz made of each, for the size ratchet. */
const inputs: { name: string; wasm: Uint8Array; ozBytes: number }[] = [];
const bytes = new Map<string, number>();
let featureChecks = 0;
for (const name of files) {
  const r = wat2wasm(await readFile(new URL(name, CORPUS), 'utf8'));
  if (hasErrors(r.errors)) {
    failures.push(`${name}: does not assemble: ${formatErrors(r.errors).trim().split('\n')[0]}`);
    continue;
  }
  const before = new Set(featuresNeeded(r.binary));
  for (const [tag, opts] of LEVELS) {
    try {
      const mod = readForPasses(r.binary);
      new PassRunner(mod, opts).addDefaultOptimizationPasses().run();
      const out = writeWasm(mod);
      bytes.set(tag, (bytes.get(tag) ?? 0) + out.length);
      if (tag === '-Oz') inputs.push({ name, wasm: r.binary, ozBytes: codeBytes(out) });
      // The optimizer must never introduce a feature its input does not need (open-work 34: a
      // target's profile is the input's, unless a target says otherwise).
      const introduced = featuresNeeded(out).filter((f) => !before.has(f));
      featureChecks++;
      if (introduced.length > 0) {
        failures.push(`${name} ${tag}: introduced ${introduced.join(', ')}`);
      }
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
  process.exit(1);
}
// A step that checked nothing passes nothing.
if (featureChecks === 0) {
  console.log('\n  no output was checked for introduced features');
  process.exit(1);
}
sizeRatchet();
console.log(
  `\n  every level of every module encodes and validates, and none of ${featureChecks} outputs needs a feature its input does not`,
);

/**
 * The size ratchet (`opt-size.ts`): binaryang against real binaryen `wasm-opt`, pinned in
 * `optimize-size-baseline.json`. `--update-baseline` records it (a deliberate act).
 */
function sizeRatchet(): void {
  const update = process.argv.includes('--update-baseline');
  let version: string;
  try {
    version = binaryenVersion();
  } catch (e) {
    console.log(`\n  ${(e as Error).message}`);
    process.exit(1);
  }
  const tmp = scratch();
  const entries: Record<string, SizeEntry> = {};
  try {
    const measure = (
      sets: { name: string; wasm: Uint8Array; ours: number }[],
      level: '-Oz' | '-O2',
    ): SizeEntry => {
      const e: SizeEntry = { ours: 0, binaryen: 0, modules: 0, refused: [] };
      for (const s of sets) {
        const theirs = binaryenSize(tmp.dir, s.wasm, level, s.name);
        if (theirs === undefined) e.refused.push(s.name);
        else {
          e.ours += s.ours;
          e.binaryen += theirs;
          e.modules++;
        }
      }
      return e;
    };
    entries['corpus -Oz'] = measure(
      inputs.map((i) => ({ name: i.name, wasm: i.wasm, ours: i.ozBytes })),
      '-Oz',
    );
    const six = new URL('../benches/browser-opt/modules/', import.meta.url);
    const sixInputs = readdirSync(six).filter((n) => n.endsWith('.wasm')).sort()
      .map((n) => ({ name: n, wasm: new Uint8Array(readFileSync(new URL(n, six))) }));
    try {
      requireSix(sixInputs.map((i) => i.name));
    } catch (e) {
      console.log(`\n  ${(e as Error).message}`);
      process.exit(1);
    }
    for (const [tag, opts] of [['-O2', LEVELS[1][1]], ['-Oz', LEVELS[4][1]]] as const) {
      entries[`six ${tag}`] = measure(
        sixInputs.map((i) => {
          const mod = readForPasses(i.wasm);
          new PassRunner(mod, opts).addDefaultOptimizationPasses().run();
          return { ...i, ours: codeBytes(writeWasm(mod)) };
        }),
        tag,
      );
    }
  } finally {
    tmp.done();
  }
  if (update) {
    // A refusal that came or went is read by a person before it is recorded.
    let existing: SizeBaseline | undefined;
    try {
      existing = readBaseline();
    } catch { /* none yet: the first recording */ }
    const changes = refusedChanges(entries, existing);
    if (changes.length > 0 && !process.argv.includes('--accept-refused-change')) {
      console.log(
        `\n  --update-baseline would CHANGE the refused set (a transient wasm-opt failure is never ` +
          `recorded as a refusal: it throws; this is a real difference):`,
      );
      for (const c of changes) console.log(`    ${c}`);
      console.log(
        '  Read them; if they are right, record with --update-baseline --accept-refused-change',
      );
      process.exit(1);
    }
    const next: SizeBaseline = { binaryen: version, entries };
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    console.log(`\n  size baseline RECORDED against ${version}: ${JSON.stringify(entries)}`);
    return;
  }
  const base = readBaseline();
  const fails: string[] = [];
  const notes: string[] = [];
  if (base.binaryen !== version) {
    fails.push(
      `binaryen is "${version}", the baseline was taken with "${base.binaryen}": ratios of ` +
        'different versions do not compare; install that version, or re-record deliberately ' +
        'with --update-baseline',
    );
  }
  for (const [name, e] of Object.entries(entries)) judge(name, e, base.entries[name], fails, notes);
  for (const name of Object.keys(base.entries)) {
    if (!(name in entries)) fails.push(`${name}: in the baseline, not measured`);
  }
  console.log('\n  === size against binaryen wasm-opt (bytes outside custom sections) ===');
  for (const n of notes) console.log(`    ${n}`);
  if (fails.length > 0) {
    console.log(`\n  ${fails.length} SIZE FAILURE(S):`);
    for (const f of fails) console.log(`    ${f}`);
    process.exit(1);
  }
}
