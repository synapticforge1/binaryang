// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module scripts/gate
 *
 * EVERY gate, run LOCALLY — the workspace review standard (letter H37, `review-process.md` § 10):
 * "every gate, the test suites included, runs locally and is not repeated on GitHub — CI only
 * publishes". Run it with `bun run gate` before a push; `bun run release` runs
 * `bun run gate --release` before it commits the bump, which adds the compatibility gate and the
 * privacy scan of every commit since the previous release tag. One line per step; exit 1 if any
 * step fails.
 *
 * The steps: the formatter, lint, the type check, naming, portability, the privacy scan (the
 * commits not yet on GitHub), the dependency audit, the browser bundle, both test legs (V8 and
 * Bun), the byte baseline, the API surface, the JSR dry run, the npm package, the CLI on Bun and
 * on Deno (the same bytes), every Node LTS line, then the spec testsuite prepared from the sibling
 * wasmtk checkout and every corpus and behaviour check.
 *
 * The prepared corpora go in a fresh folder under the system temp directory, removed at the end
 * (`--keep` keeps it and prints where). Node, Deno (from npm, `scripts/deno.ts`), `wast2json` and
 * `wasm-tools` must be on PATH; a step whose tool is missing FAILS, never skips.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const keep = process.argv.includes('--keep');
const work = mkdtempSync(join(tmpdir(), 'binaryang-gate-'));
// Removed however the run ends — the last step, a throw, or Ctrl-C on POSIX (a step ended by it
// stops the gate) — unless `--keep`; a hard kill runs no handler anywhere (win-x64 Ctrl-C: below):
// the prepared corpora are tens of MB, and a ten-minute run is often interrupted (review H-2).
process.on('exit', () => {
  if (keep) console.log(`prepared corpora kept in ${work}`);
  else rmSync(work, { recursive: true, force: true });
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(130));
const corpus = (name: string) => {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};
// The sibling wasmtk checkout's vendored testsuite (cmem/working-rules.md § Sibling repositories).
const suite = fileURLToPath(
  new URL('../../wasmtk/tests/module/wasm_wast/testsuite-main', import.meta.url),
);
const [spec, legacy, prop, teh, smoke] = ['spec', 'legacy', 'prop', 'teh', 'smoke'].map(corpus);

type Step = [name: string, cmd: string[]];
const bun = (...a: string[]): string[] => ['bun', ...a];
const steps: Step[] = [
  ['fmt:check', bun('run', 'fmt:check')],
  ['lint', bun('run', 'lint')],
  ['check', bun('run', 'check')],
  ['naming', bun('run', 'naming')],
  ['portability', bun('run', 'portability')],
  ['privacy', bun('scripts/check-privacy.ts', '--commits', 'origin/main..HEAD')],
  ['audit', bun('audit')],
  ['browser', bun('run', 'browser')],
  ['test', bun('run', 'test')],
  ['test:bun', bun('run', 'test:bun')],
  ['baseline', bun('run', 'baseline')],
  ['surface:check', bun('run', 'surface:check')],
  ['publish:dry', bun('run', 'publish:dry')],
  ['npm:prove', bun('run', 'npm:prove')],
  ['cli-smoke bun', ['SMOKE', 'bun']],
  ['cli-smoke deno', ['SMOKE', 'deno']],
  ['lts', bun('run', 'lts')],
  ['spec:prepare core', bun('scripts/spec-prepare.ts', suite, spec!)],
  ['spec:prepare legacy', bun('scripts/spec-prepare.ts', join(suite, 'legacy'), legacy!)],
  ['operators', bun('run', 'operators')],
  ['spec', bun('scripts/spec-testsuite.ts', spec!)],
  ['spec-behaviour', bun('scripts/v8.ts', 'scripts/check-spec-behaviour.ts', spec!)],
  ['lowering', bun('scripts/check-lowering.ts', spec!)],
  ['direct', bun('run', 'direct')],
  ['direct-behaviour', bun('run', 'direct-behaviour')],
  [
    'translate-eh',
    bun('scripts/v8.ts', 'scripts/check-translate-eh.ts', join(suite, 'legacy'), teh!),
  ],
  ['optimize-corpus', bun('run', 'optimize-corpus')],
  ['proposals', bun('scripts/check-proposals.ts', suite, prop!)],
  ['interp', bun('scripts/check-interp.ts', spec!, legacy!)],
  ['hostile', bun('scripts/v8.ts', 'scripts/check-hostile.ts', spec!)],
  // Real browsers, REQUIRED (a missing one fails, never skips): the five this repo's dev machine
  // runs (win-x64). Brave and Opera are `pending` until a machine has them (cmem/platforms.md).
  [
    'browsers',
    bun('run', 'browsers', '--require-all', '--only=chromium,firefox,safari,chrome,edge'),
  ],
];

// `--release` (what `bun run release` runs, after the bump): the compatibility gate — the version's
// jump from the previous release tag covers what the surface diff demands (workspace letter H6,
// rule 2) — and the privacy scan over EVERY commit since that tag, before anything is tagged.
if (process.argv.includes('--release')) {
  // GitHub's tags FIRST: CI makes them, so a clone holds a release's tag only once it has fetched
  // it, and "the previous release" read from a stale clone is an older one — the compatibility gate
  // would measure the jump from the wrong release (review B-2, 2026-11-18). A failed fetch fails.
  // Bounded, and never a credential prompt: a hung network or helper FAILS the fetch (review RH-1).
  const fetched = spawnSync('git', ['fetch', '--tags', 'origin'], {
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const prev = fetched.status !== 0 ? '' : spawnSync(
    'git',
    ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD'],
    { encoding: 'utf8' },
  ).stdout.trim();
  steps.push([
    'compatibility gate',
    fetched.status !== 0
      ? ['FETCH-FAILED', (fetched.stderr || String(fetched.error ?? '')).trim()]
      : bun('scripts/release/api-surface.ts', '--release-check'),
  ]);
  steps.push([
    'privacy since the previous release',
    fetched.status !== 0
      ? ['FETCH-FAILED', 'see the compatibility gate']
      : prev === ''
      ? ['NO-PREVIOUS-TAG']
      : bun('scripts/check-privacy.ts', '--commits', `${prev}..HEAD`),
  ]);
}

// The CLI as a user runs it, on Bun and on Deno: the same bytes from the same text.
const smokeWat = join(smoke!, 'smoke.wat');
writeFileSync(
  smokeWat,
  '(module (func (export "add") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1))))',
);
function cliSmoke(runtime: string): { status: number; out: string } {
  const out = join(smoke!, `${runtime}.wasm`);
  const cmd = runtime === 'bun'
    ? ['bun', 'main.ts', 'wasm-opt', smokeWat, '-O2', '-o', out]
    : ['bun', 'scripts/deno.ts', 'run', '-A', 'main.ts', 'wasm-opt', smokeWat, '-O2', '-o', out];
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) return { status: r.status ?? 1, out: (r.stderr || r.stdout).trim() };
  return { status: 0, out: createHash('sha256').update(readFileSync(out)).digest('hex') };
}

let failed = 0;
const hashes: string[] = [];
for (const [name, cmd] of steps) {
  const started = Date.now();
  let status: number;
  let tail: string;
  if (cmd[0] === 'NO-PREVIOUS-TAG') {
    status = 1;
    tail = 'no release tag v* below HEAD, after fetching the tags from origin';
  } else if (cmd[0] === 'FETCH-FAILED') {
    status = 1;
    tail = `git fetch --tags origin failed: ${cmd[1]}`;
  } else if (cmd[0] === 'SMOKE') {
    const r = cliSmoke(cmd[1]!);
    status = r.status;
    tail = r.out;
    if (status === 0) hashes.push(r.out);
    if (status === 0 && hashes.length === 2 && hashes[0] !== hashes[1]) {
      status = 1;
      tail = `differs from Bun's: ${tail}`;
    }
  } else {
    // Each step has 25 minutes; the slowest (the Bun test leg) takes about 2.
    const r = spawnSync(cmd[0]!, cmd.slice(1), {
      encoding: 'utf8',
      timeout: 1_500_000,
      maxBuffer: 1 << 28,
    });
    // Ctrl-C reaches the step's process, not this one's handlers: `spawnSync` blocks them until the
    // loop ends. A step ended by an interrupt (SIGINT / SIGTERM, or a shell's 130) ENDS the gate,
    // through the exit handler (review RH-1; measured on linux-x64, a group SIGINT). NOT a step our
    // own timeout killed: that is `r.error` ETIMEDOUT, a FAIL row, and the gate goes on (RH2-1).
    // win-x64: a console Ctrl-C is UNMEASURED here — Bun reports a child's exit code in 8 bits, so
    // 0xC000013A cannot be matched, and no other code is guessed at (RB2-1).
    if (!r.error && (r.signal === 'SIGINT' || r.signal === 'SIGTERM' || r.status === 130)) {
      console.log(`INTERRUPTED ${name}: the gate stops here`);
      process.exit(130);
    }
    status = r.status ?? 1;
    const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split(/\r?\n/).map((l) => l.trim())
      .filter(Boolean);
    tail = r.error ? String(r.error) : lines.slice(-3).join(' | ');
  }
  if (status !== 0) failed++;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`${status === 0 ? 'ok  ' : 'FAIL'} ${name} (${seconds} s) ${tail.slice(0, 200)}`);
}
console.log(`gate: ${steps.length - failed} / ${steps.length} passed`);
process.exit(failed === 0 ? 0 : 1);
