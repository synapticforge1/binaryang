// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The `wasm-opt` SIZE RATCHET (security review round 4, C-R2-2): binaryang's optimizer against
 * REAL binaryen `wasm-opt`, on the real-compiler modules, pinned in a checked-in baseline.
 *
 * Until it existed nothing stopped the size gap to upstream growing; only a measurement said
 * what it was (at the baseline, binaryen 133: corpus -Oz +0.134%, six -Oz +0.573%, six -O2 -2.09%).
 *
 * What is measured (BYTES OUTSIDE CUSTOM SECTIONS: what each optimizer made of the code, not
 * the debug info binaryang and binaryen treat differently):
 *
 * - `corpus -Oz`: the 421 wasmtk corpus modules (`tests/wabt-ts/wasmtk`), `wat2wasm`'s bytes in;
 * - `six -Oz`, `six -O2`: the six real-compiler modules (`benches/browser-opt/modules`: rustc,
 *   Zig, TinyGo), the yardstick of open-work 31.
 *
 * The gate FAILS when binaryang's total, as a ratio of binaryen's, is above the baseline's
 * (`optimize-size-baseline.json`), when binaryen is not the version the baseline was taken with
 * (ratios of different versions are not comparable), when the modules binaryen refuses are not
 * the ones it refused at the baseline, and when `wasm-opt` is not on PATH: a missing tool
 * FAILS, never skips. When binaryang gets smaller it FAILS too, printing the command that records
 * the new baseline (a gain left unrecorded could be given back unseen); recording is a deliberate
 * act (`--update-baseline`), never automatic.
 *
 * Binaryen is called with an EXPLICIT feature list, never `--all-features` (which switches on
 * compact imports our reader refuses; cmem/optimizer.md § The method) and `--strip-dwarf`
 * (binaryen dies on some DWARF).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BASELINE = new URL('./optimize-size-baseline.json', import.meta.url);

/** What binaryen is told it may use: everything the corpus modules use, compact imports off. */
const FEATURES = [
  'sign-ext',
  'threads',
  'mutable-globals',
  'nontrapping-float-to-int',
  'simd',
  'bulk-memory',
  'exception-handling',
  'tail-call',
  'reference-types',
  'multivalue',
  'gc',
  'memory64',
  'relaxed-simd',
  'extended-const',
  'multimemory',
].map((f) => `--enable-${f}`);

/** One measured set: what binaryang made of it, what binaryen made of it. */
export interface SizeEntry {
  /** binaryang's total bytes outside custom sections, over the modules binaryen also took. */
  ours: number;
  /** binaryen's. */
  binaryen: number;
  /** Modules in the totals. */
  modules: number;
  /** Modules binaryen refused (left out of both totals), by name. */
  refused: string[];
}

export interface SizeBaseline {
  /** `wasm-opt --version` as it printed. */
  binaryen: string;
  entries: Record<string, SizeEntry>;
}

/** Bytes outside custom sections (id 0): what the optimizer decided. */
export function codeBytes(wasm: Uint8Array): number {
  let at = 8;
  let total = 8;
  while (at < wasm.length) {
    const id = wasm[at++]!;
    let size = 0;
    let shift = 0;
    let b: number;
    const start = at;
    do {
      b = wasm[at++]!;
      size += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    if (id !== 0) total += 1 + (at - start) + size;
    at += size;
  }
  return total;
}

/** `wasm-opt --version`, or a failure that says how to get it. */
export function binaryenVersion(): string {
  const r = spawnSync('wasm-opt', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error(
      'binaryen `wasm-opt` is REQUIRED (the size ratchet compares against it) and was not found ' +
        'on PATH: install binaryen (scoop install binaryen / brew install binaryen / a release ' +
        'from https://github.com/WebAssembly/binaryen/releases); the baseline was taken with ' +
        'version 133',
    );
  }
  return r.stdout.trim();
}

/** A scratch folder for binaryen's files; `done()` removes it. */
export function scratch(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-optsize-'));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** binaryen's `wasm-opt <level>` of `wasm`: its code bytes, or `undefined` if it refused. */
export function binaryenSize(
  dir: string,
  wasm: Uint8Array,
  level: '-Oz' | '-O2',
): number | undefined {
  const input = join(dir, 'in.wasm');
  const output = join(dir, 'out.wasm');
  writeFileSync(input, wasm);
  const r = spawnSync(
    'wasm-opt',
    [input, level, '--strip-dwarf', '--disable-compact-imports', ...FEATURES, '-o', output],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return undefined;
  return codeBytes(readFileSync(output));
}

/** Compares a measurement with the baseline: failures, and notes (a gain to keep). */
export function judge(
  name: string,
  now: SizeEntry,
  base: SizeEntry | undefined,
  fails: string[],
  notes: string[],
): void {
  const over = (e: SizeEntry) => `${((e.ours / e.binaryen - 1) * 100).toFixed(3)}%`;
  const line = `${name}: ours ${now.ours} vs binaryen ${now.binaryen} (${over(now)} over)`;
  if (!base) {
    fails.push(`${name}: no baseline entry (run with --update-baseline and commit it)`);
    return;
  }
  if (now.refused.join() !== base.refused.join() || now.modules !== base.modules) {
    fails.push(
      `${name}: binaryen refused [${now.refused.join(', ')}] over ${now.modules} modules; the ` +
        `baseline has [${base.refused.join(', ')}] over ${base.modules}`,
    );
  }
  // ours/binaryen above baseline.ours/baseline.binaryen, in integers.
  const grown = now.ours * base.binaryen - base.ours * now.binaryen;
  if (grown > 0) {
    fails.push(
      `${line}: GREW past the baseline (${over(base)} over: ours ${base.ours} vs binaryen ` +
        `${base.binaryen}). A size regression: find what grew, or, if the growth is the ` +
        "owner's deliberate trade, record it with --update-baseline",
    );
  } else if (grown < 0) {
    // A gain FAILS until it is recorded: an unrecorded gain could be given back later unseen.
    fails.push(
      `${line}: SMALLER than the baseline (${over(base)} over). Record the gain: ` +
        '`bun scripts/v8.ts scripts/check-optimize-corpus.ts --update-baseline`, then commit ' +
        'scripts/optimize-size-baseline.json',
    );
  } else notes.push(`${line}: equals the baseline`);
}

/** Reads the baseline, or fails naming how to make it. */
export function readBaseline(): SizeBaseline {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')) as SizeBaseline;
  } catch {
    throw new Error(
      'scripts/optimize-size-baseline.json is missing or unreadable: record it with ' +
        '`bun scripts/v8.ts scripts/check-optimize-corpus.ts --update-baseline`',
    );
  }
}
