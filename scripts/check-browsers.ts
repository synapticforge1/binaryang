// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The library in REAL browsers (open-work 28.3, 2026-10-13; owner: "Playwright"; the browsers:
 * "chromium based, firefox, opera, vivaldi, brave, edge", and Safari, as WebKit, its engine).
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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { bundleExports, bundleName } from './check-browser.ts';
import { nodeCommand, REFEREE } from './v8.ts';
import type { BrowserSpec } from './browsers/driver.ts';
import type { HarnessResult } from './browsers/harness.ts';
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

/** The browsers, in the owner's words, and how each is found. */
export function browserSpecs(): (BrowserSpec & { missing?: string })[] {
  const path = (name: string, envVar: string, ...candidates: string[]) => {
    const p = firstExisting(env[envVar], ...candidates);
    return p
      ? { name, engine: 'chromium' as const, executablePath: p }
      : { name, engine: 'chromium' as const, missing: `not installed (or set ${envVar})` };
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
      '/usr/lib/x86_64-linux-gnu/opera/opera',
    ),
    path(
      'vivaldi',
      'BINARYANG_VIVALDI',
      `${LOCALAPP}/Vivaldi/Application/vivaldi.exe`,
      'C:/Program Files/Vivaldi/Application/vivaldi.exe',
      '/usr/bin/vivaldi',
      '/opt/vivaldi/vivaldi',
    ),
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

/** The referee Node (fnm when installed, else `node` on PATH if it IS that major), running `script`. */
function nodeRun(script: string, args: string[]): [string, string[]] | string {
  if (spawnSync('fnm', ['--version'], { stdio: 'ignore' }).status === 0) {
    return nodeCommand(REFEREE, [], script, args);
  }
  const v = spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  if (!v.startsWith(`v${REFEREE}.`)) return `needs Node ${REFEREE} (found ${v || 'none'}) or fnm`;
  return ['node', ['--no-warnings', script, ...args]];
}

function runDriver(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const argv = process.argv.slice(2);
  const requireAll = argv.includes('--require-all');
  const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',');
  const known = JSON.parse(
    readFileSync(join(root, 'tests/browser-known-differences.json'), 'utf8'),
  ) as Record<
    string,
    KnownDifference[]
  >;
  const files = spawnSync('git', ['ls-files', 'tests/wabt-ts/wasmtk'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout
    .split('\n').filter((f) => f.endsWith('.wat'));
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
    const expected = await hostExpectations(root, files);

    // 2. Serve them.
    const byName = new Map(files.map((f) => [basename(f), f]));
    const exportsList = Object.keys(exports).map((sub) => [sub, `/bundles/${bundleName(sub)}`]);
    // node:http, not Bun.serve: scripts are checked against Node's types (a Bun-only API fails tsc).
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
    const all = browserSpecs().filter((s) => !only || only.includes(s.name));
    const skipped = all.filter((s) => s.missing);
    const toRun = all.filter((s) => !s.missing);
    const cmd = nodeRun(join(root, 'scripts/browsers/driver.ts'), [
      `http://127.0.0.1:${port}/`,
      JSON.stringify(toRun),
    ]);
    if (typeof cmd === 'string') throw new Error(cmd);
    const out = await runDriver(cmd[0], cmd[1]);
    server.close();

    // 4. The verdict.
    const reports = out.split('\n').filter((l) => l.startsWith('{')).map((l) =>
      JSON.parse(l) as {
        name: string;
        version?: string;
        result?: HarnessResult;
        error?: string;
        consoleErrors?: string[];
      }
    );
    for (const s of skipped) {
      console.log(`- ${s.name}: SKIPPED, ${s.missing}`);
      if (requireAll && env['GITHUB_ACTIONS'] === 'true') {
        console.log(`::error title=browsers: ${s.name}::${s.missing}`);
      }
      if (requireAll) failed = true;
    }
    for (const spec of toRun) {
      const r = reports.find((x) => x.name === spec.name);
      const bad: string[] = [];
      if (!r) bad.push('no report from the driver');
      else if (r.error) {
        const notInstalled = /is not found|not installed|Executable doesn't exist/i.test(r.error);
        if (notInstalled && !requireAll) {
          console.log(`- ${spec.name}: SKIPPED, not installed`);
          continue;
        }
        bad.push(`could not run: ${r.error}`);
      } else if (r.result) {
        const res = r.result;
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
          } else if (m.opt !== want?.opt) bad.push(`${m.file}: wasmOpt hash differs from the host`);
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
        console.log(
          `${bad.length === 0 ? '✓' : '✗'} ${spec.name} ${
            r.version ?? ''
          }: ${res.loaded.length} exports loaded, ` +
            `${res.modules.length} modules, ${refusals.length} engine refusals (${listed.length} listed)`,
        );
      }
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
