// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The library in REAL browsers (open-work 28.3, 2026-10-13; owner: "Playwright"; the browsers:
 * "chromium based, firefox, opera, vivaldi, brave, edge", and Safari, as WebKit, its engine;
 * Vivaldi removed again, see `browserSpecs`).
 *
 * `bun run browser` proves every export BUNDLES for a browser; this proves the bundles RUN in one.
 * Bun builds the export bundles (`bundleExports`, shared with check-browser.ts) and a harness page
 * (scripts/browsers/harness.ts), serves them, and starts the Playwright driver on Node (which
 * Playwright supports). In each browser the page loads every export by URL, hashes the smoke
 * module's `wat2wasm` output, and runs the committed corpus (tests/wabt-ts/wasmtk/*.wat) through
 * `wat2wasm` and `wasmOpt -O2`, asking THAT browser's engine to validate each result.
 *
 * Verdict, per browser: every export loads; the smoke hash and every module's two hashes equal the
 * host's (a mismatch is a portability bug, never allowed); an engine refusal must be listed in
 * tests/browser-known-differences.json, and a listed refusal that no longer happens fails too.
 *
 * ```sh
 * bun run browsers                       # the installed ones; the rest are named and skipped
 * bun run browsers --only=firefox,safari
 * bun run browsers --require-all         # CI: a browser that cannot be launched fails
 * ```
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { bundleExports, bundleName } from './check-browser.ts';
import { nodeCommand, REFEREE } from './v8.ts';
import type { BrowserSpec } from './browsers/driver.ts';
import type { HarnessResult, RecipeResult } from './browsers/harness.ts';
import { RECIPE_MODULES } from './browsers/shared.ts';
import { wat2wasm } from '../src/tools/wat2wasm.ts';
import { wasmOpt } from '../src/tools/wasm-opt.ts';

/** The cli-smoke module (scripts/cli-smoke.ts): every runtime's `wat2wasm` gives one hash for it. */
export const SMOKE_WAT = `(module
  (func (export "add") (param i32 i32) (result i32)
    (i32.add (local.get 0) (local.get 1))))
`;

const env = process.env;
const LOCALAPP = env['LOCALAPPDATA'] ?? '';
const firstExisting = (...paths: (string | undefined)[]) => paths.find((p) => p && existsSync(p));

/**
 * Whether an executable is the named vendor's: its REAL path (symlinks resolved, as the apt
 * wrappers in /usr/bin are) names the vendor. Chrome and Edge are found by Playwright's channels,
 * which resolve to the vendor's install; Brave and Opera are found by path, or by an environment
 * variable that could name any binary (review round 1, 2026-11-13: nothing checked that the binary
 * launched was the browser named).
 */
export function isVendorBinary(path: string, vendor: string): boolean {
  let real = path;
  try {
    real = realpathSync(path);
  } catch { /* the path as given */ }
  // The FILE's name, exactly one the vendor's installs use (review rounds 2–3, 2026-11-13: a
  // substring of the path passed `/home/brave/chrome`; a prefix passed `bravery`, `operabeta`).
  const file = real.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
  return VENDOR_FILES[vendor]?.includes(file) ?? false;
}

/**
 * The executables' file names, per vendor, as their installs name them (Brave's deb: `brave`, the
 * `brave-browser` launcher, `brave-browser-stable`; Opera's deb: `opera`; Windows: `.exe`).
 */
export const VENDOR_FILES: Readonly<Record<string, readonly string[]>> = {
  brave: ['brave', 'brave-browser', 'brave-browser-stable', 'brave.exe'],
  opera: ['opera', 'opera.exe'],
};

/** The browsers, in the owner's words, and how each is found. */
export function browserSpecs(): (BrowserSpec & { missing?: string })[] {
  const path = (name: string, envVar: string, ...candidates: string[]) => {
    const p = firstExisting(env[envVar], ...candidates);
    if (!p) {
      return { name, engine: 'chromium' as const, missing: `not installed (or set ${envVar})` };
    }
    return isVendorBinary(p, name) ? { name, engine: 'chromium' as const, executablePath: p } : {
      name,
      engine: 'chromium' as const,
      missing: `${p} is not a ${name} executable (its file name is none of ${
        (VENDOR_FILES[name] ?? []).join(', ')
      })`,
    };
  };
  return [
    { name: 'chromium', engine: 'chromium' },
    { name: 'chrome', engine: 'chromium', channel: 'chrome' },
    { name: 'edge', engine: 'chromium', channel: 'msedge' },
    path(
      'brave',
      'BINARYANG_BRAVE',
      'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
      `${LOCALAPP}/BraveSoftware/Brave-Browser/Application/brave.exe`,
      '/usr/bin/brave-browser',
      '/opt/brave.com/brave/brave',
    ),
    path(
      'opera',
      'BINARYANG_OPERA',
      `${LOCALAPP}/Programs/Opera/opera.exe`,
      '/usr/bin/opera',
      // The opera-stable package installs here (its deb, listed in review round 3, 2026-11-13);
      // `/usr/bin/opera` is a symlink to it. An `opera/` directory never existed.
      '/usr/lib/x86_64-linux-gnu/opera-stable/opera',
    ),
    // No Vivaldi (owner, 2026-10-13: "lets remove vivaldi from the checks. most of the other
    // chromium distributions are applicable"): headless under Playwright on CI's Linux it never
    // became usable (a new context's `newPage()`, then a default context's launch, never settled).
    { name: 'firefox', engine: 'firefox' },
    // Safari's engine, JavaScriptCore, as Playwright ships it: Safari itself is automatable only
    // on macOS (safaridriver).
    { name: 'safari', engine: 'webkit' },
  ];
}

/** A browser difference the list allows: this browser's engine refuses this module's output. */
interface KnownDifference {
  file: string;
  check: 'valid' | 'optValid';
  reason: string;
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** The host's hashes for the smoke module and every corpus module (Bun runs the library here). */
async function hostExpectations(root: string, files: string[]) {
  const smoke = wat2wasm(SMOKE_WAT).binary;
  if (!smoke) throw new Error('the smoke module does not assemble on the host');
  const modules = new Map<string, { wat2wasm: string; opt: string }>();
  for (const f of files) {
    const w = wat2wasm(readFileSync(join(root, f), 'utf8'));
    if (!w.binary) {
      modules.set(basename(f), { wat2wasm: `error: ${w.errors[0]?.message ?? '?'}`, opt: '' });
      continue;
    }
    let opt: string;
    try {
      const out = await wasmOpt(w.binary, { optimizeLevel: 2, validate: false });
      opt = typeof out === 'string' ? 'error: text' : sha(out);
    } catch (e) {
      opt = `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
    }
    modules.set(basename(f), { wat2wasm: sha(w.binary), opt });
  }
  return { smoke: sha(smoke), modules };
}

/**
 * What the browser recipe must return for the first RECIPE_MODULES corpus modules that assemble:
 * `wasmOpt -Oz` (its defaults: optimizeLevel 2, shrinkLevel 2) when that is smaller, else the
 * original, exactly as optimize.ts decides.
 */
async function recipeExpectations(root: string, files: string[]) {
  const oz = async (b: Uint8Array) => {
    const o = await wasmOpt(b, { optimizeLevel: 2, shrinkLevel: 2, validate: true });
    if (typeof o === 'string') throw new Error('wasmOpt returned text');
    return o;
  };
  const modules: { file: string; hash: string; optimized: boolean }[] = [];
  /** Whether -Oz shrinks the first optimized output AGAIN (it must not: the "no smaller" case). */
  let reoptShrinks: boolean | undefined;
  for (const f of files) {
    if (modules.length === RECIPE_MODULES) break;
    const bin = wat2wasm(readFileSync(join(root, f), 'utf8')).binary;
    if (!bin) continue;
    const opt = await oz(bin);
    const smaller = opt.length < bin.length;
    if (smaller && reoptShrinks === undefined) reoptShrinks = (await oz(opt)).length < opt.length;
    modules.push({ file: basename(f), hash: sha(smaller ? opt : bin), optimized: smaller });
  }
  return { modules, reoptShrinks };
}

/** The recipe's verdict: each problem as one line. */
function recipeProblems(
  got: RecipeResult | undefined,
  want: Awaited<ReturnType<typeof recipeExpectations>>,
): string[] {
  if (!got) return ['recipe: no result'];
  if (got.error) return [`recipe: ${got.error}`];
  const bad: string[] = [];
  if (!want.modules.some((w) => w.optimized)) {
    bad.push('recipe: no input shrinks, so the cache path is untested');
  }
  if (want.reoptShrinks) {
    bad.push('recipe: -Oz shrinks its own output again, so "already-optimized" tests nothing');
  }
  for (const w of want.modules) {
    const r = got.runs.find((x) => x.file === w.file);
    if (!r) {
      bad.push(`recipe: ${w.file} did not run`);
      continue;
    }
    if (r.first.hash !== w.hash || r.first.optimized !== w.optimized) {
      bad.push(`recipe: ${w.file}: ${r.first.reason}, not the host's result`);
    }
    if (r.first.fromCache) bad.push(`recipe: ${w.file}: a FIRST run came from the cache`);
    if (w.optimized && (!r.second.fromCache || r.second.hash !== w.hash)) {
      bad.push(
        `recipe: ${w.file}: the second run did not come from the cache (${r.second.reason})`,
      );
    }
  }
  for (const c of ['malformed', 'not-binary', 'timeout', 'already-optimized'] as const) {
    const k = got.kept.find((x) => x.case === c);
    if (!k) bad.push(`recipe: the ${c} case did not run`);
    else if (k.optimized || !k.same) {
      bad.push(`recipe: ${c}: the original was not kept (${k.reason})`);
    }
  }
  return bad;
}

/** The referee Node (fnm when installed, else `node` on PATH if it IS that major), running `script`. */
function nodeRun(script: string, args: string[]): [string, string[]] | string {
  if (spawnSync('fnm', ['--version'], { stdio: 'ignore' }).status === 0) {
    return nodeCommand(REFEREE, [], script, args);
  }
  const v = spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  if (!v.startsWith(`v${REFEREE}.`)) return `needs Node ${REFEREE} (found ${v || 'none'}) or fnm`;
  return ['node', ['--no-warnings', script, ...args]];
}

/** Runs the driver; its stderr is passed through, and its tail kept for a report. */
function runDriver(
  bin: string,
  args: string[],
): Promise<{ out: string; code: number | null; errTail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      process.stderr.write(d);
      err = (err + d).slice(-600);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ out, code, errTail: err.trim() }));
  });
}

/**
 * The browsers `--only=` names, each exactly once; every name must be a known browser. An unknown
 * or empty list is an ERROR, never a run of nothing (review round 1, 2026-11-13: `--only=chrom,edgee
 * --require-all` checked no browser and exited 0 — CI's two jobs each name their browsers).
 */
export function selectSpecs<S extends { name: string }>(specs: S[], only?: string[]): S[] {
  if (only === undefined) return specs;
  const names = new Set(specs.map((s) => s.name));
  const unknown = only.filter((n) => !names.has(n));
  if (only.length === 0 || unknown.length > 0) {
    throw new Error(
      `--only names no known browser: ${
        unknown.map((n) => JSON.stringify(n)).join(', ') || '(empty)'
      } — known: ${[...names].join(', ')}`,
    );
  }
  if (new Set(only).size !== only.length) throw new Error(`--only names a browser twice: ${only}`);
  return specs.filter((s) => only.includes(s.name));
}

/**
 * What a driver report is: none at all, an error, a result — or EMPTY, neither, which is a
 * failure, never a pass (review round 4, 2026-11-13: an empty report added nothing to the
 * browser's problems, so it counted as passed).
 */
export function reportKind(
  r?: { error?: string; result?: unknown },
): 'none' | 'error' | 'result' | 'malformed' | 'empty' {
  if (!r) return 'none';
  if (r.error) return 'error';
  if (!r.result) return 'empty';
  // A result without the harness's lists would crash the verdict loop — and a crash on one
  // browser hid the verdict on every browser after it (review round 5, 2026-11-13).
  const res = r.result as Partial<Record<'loaded' | 'loadFailed' | 'modules', unknown>>;
  return typeof r.result === 'object' && Array.isArray(res.loaded) &&
      Array.isArray(res.loadFailed) && Array.isArray(res.modules)
    ? 'result'
    : 'malformed';
}

/** One browser's report, as the driver prints it (one JSON line). */
export interface DriverReport {
  name: string;
  version?: string;
  result?: HarnessResult;
  error?: string;
  consoleErrors?: string[];
}

/**
 * The driver reports in `out`, one per line — and the lines that are not a report (not JSON, or
 * no string `name`), set aside instead of thrown: one bad line used to stop the verdict on EVERY
 * browser (review round 6, 2026-11-13, run). A browser whose line was unreadable has no report,
 * which fails it.
 */
export function parseReports(out: string): { reports: DriverReport[]; unreadable: string[] } {
  const reports: DriverReport[] = [];
  const unreadable: string[] = [];
  for (const l of out.split('\n').filter((x) => x.startsWith('{'))) {
    try {
      const r = JSON.parse(l) as Partial<DriverReport> | null;
      if (r !== null && typeof r === 'object' && typeof r.name === 'string') {
        reports.push(r as DriverReport);
      } else unreadable.push(l);
    } catch {
      unreadable.push(l);
    }
  }
  return { reports, unreadable };
}

/**
 * ONE browser's driver output, read on its own: its report, and every way the output is not
 * exactly that one report — an unreadable line, a report naming another browser, a second report
 * (review rounds 7–8, 2026-11-13, run: a second report was dropped, the first winning; an
 * unreadable line only printed a note; and, once those failed the run, the browser's own line
 * still read ✓). The problems become THAT browser's failure, so its line reads ✗ and says why.
 */
export function judgeDriverOutput(
  name: string,
  out: string,
): { report: DriverReport | undefined; problems: string[] } {
  const { reports, unreadable } = parseReports(out);
  const problems = unreadable.map((l) => `a driver line that is not a report: ${l.slice(0, 200)}`);
  for (const r of reports) {
    if (r.name !== name) {
      problems.push(`a report naming another browser: ${JSON.stringify(r.name)}`);
    }
  }
  const own = reports.filter((r) => r.name === name);
  if (own.length > 1) problems.push(`${own.length} reports for ${name}; the driver prints one`);
  return { report: own[0], problems };
}

/**
 * Runs one browser's judgement; anything it throws becomes THAT browser's failure, so every other
 * browser is still judged (review round 6, 2026-11-13, run: a malformed result crashed the loop).
 */
export function guarded(bad: string[], judge: () => void): void {
  try {
    judge();
  } catch (e) {
    bad.push(`the report could not be judged: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * The `--only=` list from the arguments: `undefined` when there is none. ONE `--only=` flag only,
 * and only in its `=` form: a second flag used to be ignored silently, so `--only=chrome
 * --only=edge` tested Chrome alone (review round 2, 2026-11-13); a bare `--only` or the space form
 * (`--only chrome`) ran every browser. Any OTHER argument is refused too (review round 3: a
 * mistyped `--onlyx=chrome` was ignored, and every browser ran).
 */
export function parseOnly(argv: string[]): string[] | undefined {
  const flags = argv.filter((a) =>
    a === '--only' || a.startsWith('--only=') || a.startsWith('--only ')
  );
  if (flags.length > 1) throw new Error(`--only is given ${flags.length} times; give one list`);
  const flag = flags[0];
  if (flag !== undefined && !flag.startsWith('--only=')) {
    throw new Error(`write --only=<names>, not ${JSON.stringify(flag)}`);
  }
  const unknown = argv.filter((a) => a !== '--require-all' && !a.startsWith('--only='));
  if (unknown.length > 0) {
    throw new Error(
      `unknown argument(s): ${
        unknown.map((a) => JSON.stringify(a)).join(', ')
      } — usage: [--require-all] [--only=<names>]`,
    );
  }
  return flag === undefined
    ? undefined
    : flag.slice('--only='.length).split(',').filter((n) => n !== '');
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const argv = process.argv.slice(2);
  const requireAll = argv.includes('--require-all');
  const only = parseOnly(argv);
  // Before anything is built: a wrong `--only` must not cost a bundle and a server first.
  selectSpecs(browserSpecs(), only);
  const known = JSON.parse(
    readFileSync(join(root, 'tests/browser-known-differences.json'), 'utf8'),
  ) as Record<
    string,
    KnownDifference[]
  >;
  // A failed `git` is an error, never an empty list (2026-11-11: in Playwright's container git
  // refused the root-owned run's workspace, and this read "only 0 corpus modules").
  const ls = spawnSync('git', ['ls-files', 'tests/wabt-ts/wasmtk'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (ls.status !== 0) {
    throw new Error(
      `git ls-files failed (${ls.error?.message ?? `exit ${ls.status}`}): ${ls.stderr?.trim()}`,
    );
  }
  const files = ls.stdout.split('\n').filter((f) => f.endsWith('.wat'));
  if (files.length < 100) throw new Error(`only ${files.length} corpus modules found`);

  const dir = mkdtempSync(join(tmpdir(), 'binaryang-browsers-'));
  let failed = false;
  try {
    // 1. The export bundles and the harness, for the browser target.
    const { exports, problems } = bundleExports(root, dir);
    if (problems.length > 0) throw new Error(`exports do not bundle:\n${problems.join('\n')}`);
    const h = spawnSync('bun', [
      'build',
      join(root, 'scripts/browsers/harness.ts'),
      '--target=browser',
      '--format=esm',
      `--outfile=${join(dir, 'harness.js')}`,
    ], { encoding: 'utf8' });
    if (h.status !== 0) throw new Error(`the harness does not bundle: ${h.stderr}`);
    // The README's browser recipe (open-work 28.7), bundled as a user would: its two entry points
    // side by side, the published specifier resolved through examples/browser-optimize/tsconfig.json.
    const recipeDir = join(dir, 'recipe');
    const rb = spawnSync('bun', [
      'build',
      join(root, 'examples/browser-optimize/optimize.ts'),
      join(root, 'examples/browser-optimize/optimize-worker.ts'),
      '--target=browser',
      '--format=esm',
      '--external',
      'node:*',
      `--outdir=${recipeDir}`,
    ], { encoding: 'utf8' });
    if (rb.status !== 0) throw new Error(`the browser recipe does not bundle: ${rb.stderr}`);
    const expected = await hostExpectations(root, files);
    const expectedRecipe = await recipeExpectations(root, files);

    // 2. Serve them.
    const byName = new Map(files.map((f) => [basename(f), f]));
    const exportsList = Object.keys(exports).map((sub) => [sub, `/bundles/${bundleName(sub)}`]);
    // node:http, not Bun.serve: scripts are checked against Node's types (a Bun-only API fails the type check).
    const server = createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      const send = (type: string, body: string | Buffer) => {
        res.writeHead(200, { 'content-type': type });
        res.end(body);
      };
      const JS = 'text/javascript';
      if (p === '/') {
        return send(
          'text/html',
          '<!doctype html><script type="module" src="/harness.js"></script>',
        );
      }
      if (p === '/harness.js') return send(JS, readFileSync(join(dir, 'harness.js')));
      if (p.startsWith('/recipe/')) return send(JS, readFileSync(join(recipeDir, basename(p))));
      if (p.startsWith('/bundles/')) return send(JS, readFileSync(join(dir, basename(p))));
      if (p === '/exports.json') return send('application/json', JSON.stringify(exportsList));
      if (p === '/smoke.wat') return send('text/plain', SMOKE_WAT);
      if (p === '/corpus.json') return send('application/json', JSON.stringify([...byName.keys()]));
      if (p.startsWith('/corpus/')) {
        const f = byName.get(p.slice('/corpus/'.length));
        if (f) return send('text/plain', readFileSync(join(root, f)));
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;

    // 3. The browsers, through the driver on Node.
    const all = selectSpecs(browserSpecs(), only);
    const skipped = all.filter((s) => s.missing);
    const toRun = all.filter((s) => !s.missing);
    // One driver process PER BROWSER: the first CI run lost Vivaldi (since removed), Firefox and
    // Safari to one process that died at Vivaldi ("no report from the driver"); now a crash costs one browser,
    // and its exit code and stderr become that browser's error.
    // Each browser's driver output is KEPT WITH ITS BROWSER (review round 8): a problem in it is
    // that browser's failure, never a note beside a ✓.
    const outputs = new Map<string, string>();
    for (const spec of toRun) {
      const cmd = nodeRun(join(root, 'scripts/browsers/driver.ts'), [
        `http://127.0.0.1:${port}/`,
        JSON.stringify([spec]),
      ]);
      if (typeof cmd === 'string') throw new Error(cmd);
      const r = await runDriver(cmd[0], cmd[1]);
      if (r.out.split('\n').some((l) => l.startsWith('{'))) outputs.set(spec.name, r.out);
      else {
        const error = `driver exited ${r.code} with no report: ${r.errTail || '(no stderr)'}`;
        outputs.set(spec.name, JSON.stringify({ name: spec.name, error }));
      }
    }
    server.close();

    // 4. The verdict, browser by browser: no line can stop it for another browser (round 6).
    for (const s of skipped) {
      console.log(`- ${s.name}: SKIPPED, ${s.missing}`);
      if (requireAll && env['GITHUB_ACTIONS'] === 'true') {
        console.log(`::error title=browsers: ${s.name}::${s.missing}`);
      }
      if (requireAll) failed = true;
    }
    for (const spec of toRun) {
      const { report: r, problems } = judgeDriverOutput(spec.name, outputs.get(spec.name) ?? '');
      const bad: string[] = [...problems];
      let summarized = false;
      const kind = reportKind(r);
      if (kind === 'none') bad.push('no report from the driver');
      else if (kind === 'empty') {
        // Review round 4 (2026-11-13): a report with neither added nothing to `bad` — a pass.
        bad.push('the driver reported neither a result nor an error');
      } else if (kind === 'malformed') {
        bad.push(
          `the driver's result is not a harness result: ${JSON.stringify(r!.result).slice(0, 200)}`,
        );
      } else if (kind === 'error') {
        const error = r!.error!;
        const notInstalled = /is not found|not installed|Executable doesn't exist/i.test(error);
        // A skip only when the output was otherwise clean: a problem in it is never skipped.
        if (notInstalled && !requireAll && problems.length === 0) {
          console.log(`- ${spec.name}: SKIPPED, not installed`);
          continue;
        }
        bad.push(`could not run: ${error}`);
      } else {
        // Judged GUARDED: any shape the checks below do not expect fails THIS browser, and every
        // other browser is still judged (review round 6: `modules: [null]`, a `loadFailed` entry
        // that is not a pair, `recipe: {}` each crashed the loop).
        guarded(bad, () => {
          const res = r!.result!;
          if (res.error) bad.push(`harness error: ${res.error}`);
          for (const [sub, why] of res.loadFailed) bad.push(`export ${sub} does not load: ${why}`);
          if (res.smoke !== expected.smoke) {
            bad.push(`smoke hash ${res.smoke} != host ${expected.smoke}`);
          }
          if (res.modules.length !== files.length) {
            bad.push(`ran ${res.modules.length} of ${files.length} modules`);
          }
          const refusals: string[] = [];
          for (const m of res.modules) {
            const want = expected.modules.get(m.file);
            if (m.wat2wasm !== want?.wat2wasm) {
              bad.push(`${m.file}: wat2wasm hash differs from the host`);
            } else if (m.opt !== want?.opt) {
              bad.push(`${m.file}: wasmOpt hash differs from the host`);
            }
            if (!m.valid) refusals.push(`${m.file} :: valid`);
            if (m.opt && !m.opt.startsWith('error') && !m.optValid) {
              refusals.push(`${m.file} :: optValid`);
            }
          }
          const listed = (known[spec.name] ?? []).map((k) => `${k.file} :: ${k.check}`);
          for (const x of refusals.filter((x) => !listed.includes(x))) {
            bad.push(`engine refuses, not listed: ${x}`);
          }
          for (const x of listed.filter((x) => !refusals.includes(x))) {
            bad.push(`listed, but accepted now (delete it): ${x}`);
          }
          bad.push(...recipeProblems(res.recipe, expectedRecipe));
          const shrunk = res.recipe?.runs.filter((x) => x.first.optimized).length ?? 0;
          console.log(
            `${bad.length === 0 ? '✓' : '✗'} ${spec.name} ${
              r!.version ?? ''
            }: ${res.loaded.length} exports loaded, ` +
              `${res.modules.length} modules, ${refusals.length} engine refusals (${listed.length} listed), ` +
              `recipe ${shrunk} of ${res.recipe?.runs.length ?? 0} shrunk, ${
                res.recipe?.kept.length ?? 0
              } kept`,
          );
          summarized = true;
        });
      }
      if (bad.length > 0 && !summarized) console.log(`✗ ${spec.name}`);
      // On GitHub Actions each failure is ALSO an annotation: the job log needs admin rights to read
      // through the API, annotations do not (the first CI run failed with nothing else to go on).
      if (env['GITHUB_ACTIONS'] === 'true') {
        for (const b of bad.slice(0, 3)) {
          console.log(`::error title=browsers: ${spec.name}::${b.replace(/\r?\n/g, ' ')}`);
        }
      }
      for (const b of bad.slice(0, 15)) console.log(`    ${b}`);
      if (bad.length > 15) console.log(`    … ${bad.length - 15} more`);
      if (bad.length > 0) failed = true;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}
