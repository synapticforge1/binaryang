// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The `wasm-opt` SIZE RATCHET (security review round 4, C-R2-2): binaryang's optimizer against
 * REAL binaryen `wasm-opt`, on the real-compiler modules, pinned in a checked-in baseline.
 *
 * Until it existed nothing stopped the size gap to upstream growing; only a measurement said
 * what it was (recorded 2026-11-20, binaryen 133: corpus -Oz +0.101%, six -Oz +0.573%, six -O2 -2.09%).
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
 * act (`--update-baseline`), never automatic. Recording also refuses to change the REFUSED set
 * (`--accept-refused-change` says it is meant), and to record over a wrong module set.
 *
 * A REFUSAL is wasm-opt exiting 1 with a message. A signal (a kill, the OOM killer), a spawn error,
 * ENOBUFS or the time limit is NOT a refusal: it throws, naming the module, so a transient failure
 * can never be recorded as "binaryen refuses this module".
 *
 * Binaryen is called with an EXPLICIT feature list, never `--all-features` (which switches on
 * compact imports our reader refuses; cmem/optimizer.md § The method) and `--strip-dwarf`
 * (binaryen dies on some DWARF).
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
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

/** The longest one `wasm-opt` run may take (the largest real-compiler module, -Oz, takes seconds). */
export const WASM_OPT_TIMEOUT_MS = 300_000;

/** The most output a `wasm-opt` run may print before it is ended (Node's default is 1 MB). */
export const WASM_OPT_MAX_BUFFER = 64 * 1024 * 1024;

/** The part of a `spawnSync` result the verdict reads. */
export type WasmOptRun = Pick<
  SpawnSyncReturns<string>,
  'status' | 'signal' | 'error' | 'stderr' | 'stdout'
>;

/**
 * Whether one `wasm-opt` run took the module (`'ok'`) or REFUSED it: exit 1 with a message, which is
 * how binaryen reports an input it cannot parse or validate. Anything else — it could not start, a
 * signal ended it, its output overflowed, the time limit ended it, another exit code, or exit 1
 * with nothing said — is a failure of the run, not a fact about the module: it THROWS, naming `what`.
 */
export function judgeRun(
  r: WasmOptRun,
  what: string,
  limitMs: number = WASM_OPT_TIMEOUT_MS,
): 'ok' | 'refused' {
  if (r.error !== undefined) {
    const code = (r.error as { code?: string }).code;
    throw new Error(
      `wasm-opt on ${what} did not finish (${
        code ?? 'error'
      }: ${r.error.message}): not a refusal; ` +
        (code === 'ETIMEDOUT' ? `it ran past ${limitMs / 1000} s` : 'run it again'),
    );
  }
  if (r.signal !== null) {
    throw new Error(`wasm-opt on ${what} was ended by ${r.signal}: not a refusal; run it again`);
  }
  if (r.status === 0) return 'ok';
  const said = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim();
  if (r.status === 1 && said !== '') return 'refused';
  throw new Error(
    `wasm-opt on ${what} exited ${r.status}${
      said === '' ? ' with no message' : `: ${said.slice(0, 200)}`
    }: ` +
      'not a binaryen refusal',
  );
}

/** How many wasm-opt runs this process has made: each gets its own file names. */
let runCount = 0;

/**
 * binaryen's `wasm-opt <level>` of `wasm`: its code bytes, or `undefined` if it REFUSED the module
 * (see {@link judgeRun}); any other failure throws, naming `name`. `run` is the spawn seam.
 */
export function binaryenSize(
  dir: string,
  wasm: Uint8Array,
  level: '-Oz' | '-O2',
  name = 'a module',
  run: typeof spawnSync = spawnSync,
  limitMs: number = WASM_OPT_TIMEOUT_MS,
): number | undefined {
  // A fresh name per run: reusing one `in.wasm` failed with EBUSY on Windows when the previous
  // run's file was still held (a scanner, a slow exit; the gate, 2026-11-25). The folder is removed
  // as a whole by `scratch().done()`.
  const n = runCount++;
  const input = join(dir, `in-${n}.wasm`);
  const output = join(dir, `out-${n}.wasm`);
  writeFileSync(input, wasm);
  try {
    const r = run(
      'wasm-opt',
      [input, level, '--strip-dwarf', '--disable-compact-imports', ...FEATURES, '-o', output],
      { encoding: 'utf8', timeout: limitMs, maxBuffer: WASM_OPT_MAX_BUFFER },
    );
    if (judgeRun(r, `${name} (${level})`, limitMs) === 'refused') return undefined;
    return codeBytes(readFileSync(output));
  } finally {
    // Each run's two files go as soon as it is done (round 6: they piled up until the end).
    // Best effort: the lock that made a reused name fail can refuse this too, and the folder
    // is removed whole at the end anyway.
    for (const f of [input, output]) {
      try {
        rmSync(f, { force: true });
      } catch { /* left for scratch().done() */ }
    }
  }
}

/**
 * The six real-compiler modules the `six` entries measure: a different set is a different
 * measurement, so it fails — and never gets recorded.
 */
export function requireSix(found: readonly string[]): void {
  if (found.length !== 6) {
    throw new Error(
      `expected the six real-compiler modules (benches/browser-opt/modules), found ${found.length}: ` +
        `[${found.join(', ')}]; the size ratchet is not recorded or judged over another set`,
    );
  }
}

/**
 * What a recording would change about the REFUSED sets, entry by entry, against the baseline on
 * disk: lines naming each change. A refusal that appears or disappears is a fact about binaryen or
 * about the module set, which a person reads before recording it (`--accept-refused-change`).
 */
export function refusedChanges(
  entries: Record<string, SizeEntry>,
  base: SizeBaseline | undefined,
): string[] {
  if (base === undefined) return [];
  const out: string[] = [];
  for (const [name, e] of Object.entries(entries)) {
    const was = base.entries[name]?.refused ?? [];
    if (was.join() !== e.refused.join()) {
      out.push(`${name}: refused [${e.refused.join(', ')}], the baseline has [${was.join(', ')}]`);
    }
  }
  return out;
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
