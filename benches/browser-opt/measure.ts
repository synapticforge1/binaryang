// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The in-browser optimization measurement (open-work 28.6). A recorded LOCAL measurement, not a
 * gate: it cites committed modules (./modules, built by ./build.ts) and an installed upstream
 * `wasm-opt` as the quality reference.
 *
 * Bun bundles the `./tools/wasm-opt` export and the page / worker (./page.ts, ./worker.ts), makes
 * upstream's -O2 / -Oz variants, serves it all, and runs scripts/browsers/driver.ts on the referee
 * Node in each named browser. It prints a table per browser and writes the raw results to
 * `results.json` beside this file.
 *
 *   bun benches/browser-opt/measure.ts [--browsers=chrome,firefox,safari]
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { bundleExports } from '../../scripts/check-browser.ts';
import { browserSpecs } from '../../scripts/check-browsers.ts';
import { nodeCommand, REFEREE } from '../../scripts/v8.ts';
import type { ModuleReport } from './worker.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..');
const MODULES = [
  'rust-debug',
  'rust-release',
  'zig-debug',
  'zig-releasefast',
  'tinygo-opt1',
  'tinygo-optz',
];
const wanted =
  (process.argv.find((a) => a.startsWith('--browsers='))?.slice('--browsers='.length) ??
    'chrome,firefox,safari').split(',');

const dir = mkdtempSync(join(tmpdir(), 'binaryang-measure-'));
try {
  // 1. Bundles: the library's wasm-opt export, the page, the worker.
  const { problems } = bundleExports(root, dir);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  for (const f of ['page', 'worker']) {
    const r = spawnSync('bun', [
      'build',
      join(here, `${f}.ts`),
      '--target=browser',
      '--format=esm',
      `--outfile=${join(dir, `${f}.js`)}`,
    ], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${f}.ts does not bundle: ${r.stderr}`);
  }
  // 2. Upstream's variants, the reference. `--strip-dwarf` first, on every module: wasm-opt 133 dies
  // reading zig-debug's DWARF ("Fatal: TODO: DW_LNE_define_file", 2026-10-13), and stripping it on
  // all of them keeps the variants comparable (DWARF never enters the sizes).
  const upstreamVersion = spawnSync('wasm-opt', ['--version'], { encoding: 'utf8' }).stdout.trim();
  for (const m of MODULES) {
    for (const level of ['O2', 'Oz']) {
      const r = spawnSync('wasm-opt', [
        join(here, 'modules', `${m}.wasm`),
        '--strip-dwarf',
        `-${level}`,
        '--all-features',
        '-o',
        join(dir, `${m}.${level}.wasm`),
      ], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`upstream wasm-opt -${level} ${m}: ${r.stderr}`);
    }
  }
  // 3. Serve.
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const send = (type: string, body: string | Buffer) => {
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    };
    const JS = 'text/javascript';
    const WASM = 'application/wasm';
    if (p === '/') {
      return send('text/html', '<!doctype html><script type="module" src="/page.js"></script>');
    }
    if (p === '/page.js' || p === '/worker.js') {
      return send(JS, readFileSync(join(dir, basename(p))));
    }
    if (p.startsWith('/bundles/')) return send(JS, readFileSync(join(dir, basename(p))));
    if (p === '/modules.json') return send('application/json', JSON.stringify(MODULES));
    if (p.startsWith('/modules/')) {
      return send(WASM, readFileSync(join(here, 'modules', basename(p))));
    }
    if (p.startsWith('/upstream/')) return send(WASM, readFileSync(join(dir, basename(p))));
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;

  // 4. The browsers, through the 28.3 driver on the referee Node.
  const specs = browserSpecs().filter((s) => wanted.includes(s.name) && !s.missing);
  const args = [
    join(root, 'scripts/browsers/driver.ts'),
    `http://127.0.0.1:${port}/`,
    JSON.stringify(specs),
  ];
  const haveFnm = spawnSync('fnm', ['--version'], { stdio: 'ignore' }).status === 0;
  const [bin, argv] = haveFnm ? nodeCommand(REFEREE, [], args[0]!, args.slice(1)) : ['node', args];
  const out = await new Promise<string>((ok, bad) => {
    const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'inherit'] });
    let s = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (s += d));
    child.on('error', bad);
    child.on('close', () => ok(s));
  });
  server.close();

  // 5. The tables.
  const results = out.split('\n').filter((l) => l.startsWith('{')).map((l) =>
    JSON.parse(l) as {
      name: string;
      version?: string;
      error?: string;
      result?: { reports?: ModuleReport[]; error?: string };
    }
  );
  writeFileSync(
    join(here, 'results.json'),
    `${
      JSON.stringify(
        { date: new Date().toISOString(), upstream: upstreamVersion, results },
        null,
        2, // dprint's JSON layout, byte for byte, so `fmt:check` passes after a run
      )
    }\n`,
  );
  const f = (
    x: number | undefined,
    d = 1,
  ) => (x === undefined || Number.isNaN(x) ? '-' : x.toFixed(d));
  for (const r of results) {
    console.log(
      `\n## ${r.name} ${r.version ?? ''}${r.error ? ` — ERROR ${r.error}` : ''}${
        r.result?.error ? ` — ${r.result.error}` : ''
      }`,
    );
    for (const m of r.result?.reports ?? []) {
      console.log(`\n${m.module}`);
      console.log(
        '| variant | bytes | code bytes | custom sections | optimize ms | compile ms | run ms | same result |',
      );
      console.log('| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |');
      for (const v of m.variants) {
        console.log(
          `| ${v.variant} | ${v.bytes} | ${v.codeBytes} | ${v.custom.join(' ') || '-'} | ${
            f(v.optimizeMs, 0)
          } | ${f(v.compileMs, 2)} | ${f(v.runMs, 2)} | ${
            v.sameResult ? 'yes' : `NO (${v.checksum})`
          } |`,
        );
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
