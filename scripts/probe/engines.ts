// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The executors the D4 probe runs its modules on: one per way an engine is reached. Each answers its
 * BUILD (asked of the installed program, a dated claim) and runs a directory's modules, one
 * result per module. An executor whose program is not installed answers `null` for its build and
 * is reported "not measured" — never counted as running anything.
 *
 * Standalone runtimes are measured at their MAXIMUM switches (an embedder chooses them);
 * JavaScript engines and browsers at their DEFAULTS (what their users get) — D4's `rules.engines`.
 * `wasm-interp` and binaryang's interpreter run too, reported and not defining.
 *
 * Stock browsers (Chrome, Edge, Firefox release and ESR) are found through the gitignored
 * `cmem/local/probe-browsers.json` (owner, 2026-10-24: their paths are machine facts):
 * `{ "chrome": { "exe": "<path>", "kind": "chromium", "label": "Chrome" }, "firefox-esr": { … } }`
 * (`label` names the build as D4 does, `Chrome 156, stock`; the key, when absent).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { nodeCommand, REFEREE } from '../v8.ts';

export type Outcome = 'ok' | 'trap' | 'refused' | 'error';
export interface Result {
  s: Outcome;
  v?: string;
  m?: string;
}
export interface Executor {
  /** The executor, as results name it (`wazero-compiler`). */
  id: string;
  /** The D4 engine it measures (`wazero`). */
  engine: string;
  /** Defining (D4's engines) or reported (interpreters). */
  defining: boolean;
  /** A browser: a page's main thread may not block, so `memory.atomic.wait` traps there by policy. */
  browser?: true;
  /** The build, asked of the installed program; `null`: not installed, not measured. */
  build(): Promise<string | null>;
  run(dir: string, files: readonly string[]): Promise<Map<string, Result>>;
}

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The first `x.y.z` in a program's version output, or `null` when it does not run. */
function version(cmd: string, args: string[], pattern = /(\d+\.\d+\.\d+)/): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return `${r.stdout}${r.stderr}`.match(pattern)?.[1] ?? null;
}

function exec(cmd: string, args: string[], cwd?: string) {
  return new Promise<{ code: number | null; text: string }>((res) => {
    const p = spawn(cmd, args, { cwd });
    let text = '';
    const t = setTimeout(() => p.kill(), 60_000);
    p.stdout.on('data', (d) => (text += d));
    p.stderr.on('data', (d) => (text += d));
    p.on('error', (e) => (text += String(e)));
    p.on('close', (code) => {
      clearTimeout(t);
      res({ code, text });
    });
  });
}

const TRAP =
  /trap|unreachable|out of bounds|RuntimeError|integer (overflow|divide)|division by zero|invalid conversion|unaligned|atomic.*(wait|shared)|uncaught|exception thrown|null (function )?reference|cast fail|dereferencing a null|illegal cast/i;
/** A terminal colour code (ESC [ … m), which some runtimes print around their errors. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const NOT_RUN = /validat|compil|not (enabled|supported)|unsupported|unknown opcode|parse/i;

type Command = [string, string[], string?];

/**
 * A command-line runtime: one process per module, eight at a time; the value read from its output.
 * `attempts` gives the command lines to try in order: a later one runs only when the module was
 * REFUSED by the one before, so a switch that is itself refused cannot pass for the module's.
 */
function cli(
  id: string,
  engine: string,
  defining: boolean,
  build: () => string | null,
  attempts: (file: string) => Command[],
  value: RegExp,
): Executor {
  const once = async ([cmd, args, cwd]: Command): Promise<Result> => {
    const { code, text } = await exec(cmd, args, cwd);
    const m = text.match(value);
    const msg = text.replace(ANSI, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (code === 0 && m) return { s: 'ok', v: BigInt.asUintN(64, BigInt(m[1]!)).toString(16) };
    if (TRAP.test(text) && !NOT_RUN.test(text)) return { s: 'trap', m: msg };
    return { s: code === 0 ? 'error' : 'refused', m: msg };
  };
  return {
    id,
    engine,
    defining,
    build: async () => build(),
    async run(dir, files) {
      const out = new Map<string, Result>();
      let next = 0;
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (next < files.length) {
          const file = files[next++]!;
          let r: Result = { s: 'error', m: 'no command' };
          for (const c of attempts(`${dir}/wasm/${file}`)) {
            r = await once(c);
            if (r.s !== 'refused') break;
          }
          out.set(file, r);
        }
      }));
      return out;
    },
  };
}

/** An executor that reads the whole index itself and prints one JSON result line per module. */
function lines(cmd: string, args: string[], cwd?: string): Map<string, Result> {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, cwd });
  const out = new Map<string, Result>();
  for (const line of (r.stdout ?? '').split('\n')) {
    if (!line.trim()) continue;
    const { file, ...rest } = JSON.parse(line) as { file: string } & Result;
    out.set(file, rest);
  }
  if (r.status !== 0) console.log(`  ${cmd}: exit ${r.status} ${(r.stderr ?? '').slice(0, 300)}`);
  return out;
}

// Standalone runtimes at their maximum.
const WT =
  'gc=y,function-references=y,exceptions=y,memory64=y,multi-memory=y,tail-call=y,relaxed-simd=y,' +
  'wide-arithmetic=y,custom-page-sizes=y,threads=y,shared-memory=y,extended-const=y';
// wasmer refuses some flag COMBINATIONS outright ("no backend supports"), even for a module that
// needs none of them. So it runs with its base set first, and only a module that set refuses is
// tried again with the flag of the module's feature. ⚠️ Passing the flag first made `tail-call`
// look refused: wasmer 7.5.0 refuses `--enable-tail-call` itself (even a plain `call` module) and
// runs every tail call without it — D4 1.0.0 / 1.1.0 excluded tail calls on that artifact
// (found 2026-10-24).
const WASMER = [
  '--enable-simd',
  '--enable-threads',
  '--enable-bulk-memory',
  '--enable-reference-types',
  '--enable-multi-value',
];
const WASMER_FEATURE: Record<string, string> = {
  relaxedSimd: '--enable-relaxed-simd',
  exceptions: '--enable-exceptions',
  tailCall: '--enable-tail-call',
  memory64: '--enable-memory64',
  multiMemory: '--enable-multi-memory',
  extendedConst: '--enable-extended-const',
};

/** The browser page's runner: compile, instantiate, call `t`, per module. */
async function runInPage(
  evaluate: <T>(
    fn: (mods: { file: string; b64: string }[]) => T,
    arg: { file: string; b64: string }[],
  ) => Promise<T>,
  dir: string,
  files: readonly string[],
) {
  const out = new Map<string, Result>();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50).map((file) => ({
      file,
      b64: readFileSync(`${dir}/wasm/${file}`).toString('base64'),
    }));
    const res = await evaluate((mods) =>
      mods.map(({ file, b64 }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        try {
          const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
          try {
            return {
              file,
              s: 'ok',
              v: BigInt.asUintN(64, BigInt((inst.exports['t'] as () => bigint)())).toString(16),
            };
          } catch (e) {
            const W = WebAssembly as unknown as { Exception?: new () => unknown };
            const trapped = e instanceof WebAssembly.RuntimeError ||
              (W.Exception !== undefined && e instanceof W.Exception);
            return { file, s: trapped ? 'trap' : 'error', m: String((e as Error)?.message ?? e) };
          }
        } catch (e) {
          return { file, s: 'refused', m: String((e as Error)?.message ?? e) };
        }
      }), batch);
    for (const { file, ...rest } of res as ({ file: string } & Result)[]) out.set(file, rest);
  }
  return out;
}

/** A Playwright browser, on a cross-origin-isolated page so a SHARED memory is the engine's call. */
function playwright(kind: 'chromium' | 'firefox' | 'webkit'): Executor {
  const launcher = { chromium, firefox, webkit }[kind];
  let ver: string | null | undefined;
  return {
    id: kind,
    engine: kind,
    defining: true,
    browser: true,
    async build() {
      if (ver !== undefined) return ver;
      try {
        const b = await launcher.launch();
        // D4's form: the major for Chromium and Firefox, WebKit's own two-part version.
        const v = kind === 'webkit' ? b.version() : b.version().split('.')[0];
        ver = `Playwright ${
          { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' }[kind]
        } ${v}`;
        await b.close();
      } catch {
        ver = null;
      }
      return ver;
    },
    async run(dir, files) {
      const browser = await launcher.launch();
      const page = await browser.newPage();
      await page.route('http://probe.test/', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          },
          body: '<!doctype html><title>probe</title>',
        }));
      await page.goto('http://probe.test/');
      const out = await runInPage((fn, arg) => page.evaluate(fn, arg), dir, files);
      await browser.close();
      return out;
    },
  };
}

/**
 * A STOCK browser as its users run it, no automation: a local server serves a page and the
 * modules; the browser (headless) runs each and POSTs the results back.
 */
function stock(name: string, exe: string, kind: 'chromium' | 'firefox', label: string): Executor {
  const PAGE = `<!doctype html><meta charset="utf-8"><title>probe</title><script type="module">
const index = await (await fetch('/index.json')).json();
const out = { ua: navigator.userAgent, results: {} };
for (const { file } of index) {
  const bytes = await (await fetch('/wasm/' + file)).arrayBuffer();
  let r;
  try {
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    try {
      r = { s: 'ok', v: BigInt.asUintN(64, BigInt(inst.exports.t())).toString(16) };
    } catch (e) {
      const trapped = e instanceof WebAssembly.RuntimeError || (WebAssembly.Exception && e instanceof WebAssembly.Exception);
      r = { s: trapped ? 'trap' : 'error', m: String(e && e.message || e) };
    }
  } catch (e) {
    r = { s: 'refused', m: String(e && e.message || e) };
  }
  out.results[file] = r;
}
await fetch('/result', { method: 'POST', body: JSON.stringify(out) });
</script>`;
  let ua: string | null = null;
  const visit = async (dir: string) => {
    const profile = mkdtempSync(join(tmpdir(), `probe-${name}-`));
    // Stop EVERY process whose command line names this run's profile: killing the launcher is not
    // enough (Edge's helpers outlived it, 2026-10-23, and a relaunched helper is not in its tree).
    const stop = () =>
      process.platform === 'win32'
        ? spawnSync('powershell', [
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${
            basename(profile)
          }*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ], { stdio: 'ignore' })
        : spawnSync('pkill', ['-f', basename(profile)], { stdio: 'ignore' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let server: ReturnType<typeof createServer> | undefined;
    try {
      return await new Promise<{ ua: string; results: Record<string, Result> }>(
        (resolve, reject) => {
          server = createServer((req, res) => {
            const url = req.url ?? '/';
            if (req.method === 'POST' && url === '/result') {
              let body = '';
              req.on('data', (d) => (body += d));
              req.on('end', () => {
                res.end('ok');
                resolve(JSON.parse(body));
              });
              return;
            }
            const file = url === '/' ? null : join(dir, decodeURIComponent(url));
            if (file === null) {
              res.writeHead(200, { 'content-type': 'text/html' });
              res.end(PAGE);
            } else if (existsSync(file)) {
              res.writeHead(200, {
                'content-type': file.endsWith('.wasm') ? 'application/wasm' : 'application/json',
              });
              res.end(readFileSync(file));
            } else {
              res.writeHead(404);
              res.end();
            }
          });
          server.listen(0, '127.0.0.1', () => {
            const url = `http://127.0.0.1:${(server!.address() as { port: number }).port}/`;
            const args = kind === 'firefox'
              ? ['-headless', '-no-remote', '-profile', profile, url]
              : [
                '--headless=new',
                `--user-data-dir=${profile}`,
                '--no-first-run',
                '--no-default-browser-check',
                url,
              ];
            spawn(exe, args, { stdio: 'ignore' }).on('error', reject);
            timer = setTimeout(
              () => reject(new Error(`${name}: no results in 10 minutes`)),
              600_000,
            );
          });
        },
      );
    } finally {
      clearTimeout(timer);
      server?.close();
      await new Promise((r) => setTimeout(r, 1000));
      stop();
      for (let i = 0; i < 10; i++) {
        try {
          rmSync(profile, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
          stop();
        }
      }
    }
  };
  return {
    id: name,
    engine: name,
    defining: true,
    browser: true,
    // The build is the user agent's, so it is known after a run; before one, only whether it exists.
    build: async () => (existsSync(exe) ? (ua ?? 'installed') : null),
    async run(dir, files) {
      const r = await visit(dir);
      // D4's form: `<label> <major>, stock`, the major from the browser's own token (Edge's is Edg/).
      const major = r.ua.match(/Edg\/(\d+)/)?.[1] ?? r.ua.match(/(?:Firefox|Chrome)\/(\d+)/)?.[1];
      ua = major ? `${label} ${major}, stock` : r.ua;
      return new Map(files.map((f) => [f, r.results[f] ?? { s: 'error', m: 'no result' }]));
    },
  };
}

/** The stock browsers this machine names (gitignored); none named, none measured. */
function stockBrowsers(): Executor[] {
  const path = join(REPO, 'cmem/local/probe-browsers.json');
  if (!existsSync(path)) return [];
  const conf = JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    { exe: string; kind: 'chromium' | 'firefox'; label?: string }
  >;
  return Object.entries(conf).map(([name, { exe, kind, label }]) =>
    stock(name, exe, kind, label ?? name)
  );
}

/** Every executor, in the order they run. `featureOf` gives wasmer its per-module flag. */
export function executors(featureOf: (file: string) => string): Executor[] {
  const wazeroDir = join(HERE, 'wazero');
  const wazeroBuild = () =>
    readFileSync(join(wazeroDir, 'go.mod'), 'utf8').match(/tetratelabs\/wazero v(\S+)/)?.[1] ??
      null;
  const goAvailable = () => spawnSync('go', ['version']).status === 0;
  const [nodeCmd, nodeArgs] = nodeCommand(REFEREE, [], join(HERE, 'js-run.ts'), []);
  const js = (id: string, build: () => string | null, cmd: string, args: string[]): Executor => ({
    id,
    engine: id,
    defining: true,
    build: async () => build(),
    run: async (dir) => lines(cmd, [...args, dir]),
  });
  return [
    cli(
      'wasmtime',
      'wasmtime',
      true,
      () => version('wasmtime', ['--version']),
      (f) => [['wasmtime', ['run', '-W', WT, '--invoke', 't', f]]],
      /^(-?\d+)\s*$/m,
    ),
    cli(
      'wasmer',
      'wasmer',
      true,
      () => version('wasmer', ['--version']),
      (f) => {
        const flag = WASMER_FEATURE[featureOf(basename(f))];
        const base: Command = ['wasmer', ['run', ...WASMER, '-i', 't', f]];
        return flag ? [base, ['wasmer', ['run', ...WASMER, flag, '-i', 't', f]]] : [base];
      },
      /^(-?\d+)\s*$/m,
    ),
    cli(
      'wasmedge',
      'wasmedge',
      true,
      () => version('wasmedge', ['--version'], /version (\d+\.\d+\.\d+)/),
      (f) => [['wasmedge', ['--enable-all', '--reactor', f, 't']]],
      /^(-?\d+)\s*$/m,
    ),
    ...(['compiler', 'interpreter'] as const).map((mode): Executor => ({
      id: `wazero-${mode}`,
      engine: 'wazero',
      defining: true,
      build: async () => (goAvailable() ? `${wazeroBuild()}, compiler and interpreter` : null),
      run: async (dir) => lines('go', ['run', '.', dir, mode], wazeroDir),
    })),
    js(
      'node',
      () =>
        version(nodeCmd, [
          ...nodeArgs.slice(0, -1).filter((a) => a !== '--no-warnings'),
          '--version',
        ]),
      nodeCmd,
      nodeArgs,
    ),
    js('deno', () => version('deno', ['--version']), 'deno', [
      'run',
      '-A',
      join(HERE, 'js-run.ts'),
    ]),
    js('bun', () => version('bun', ['--version']), 'bun', [join(HERE, 'js-run.ts')]),
    playwright('chromium'),
    playwright('firefox'),
    playwright('webkit'),
    ...stockBrowsers(),
    cli(
      'wasm-interp',
      'wasm-interp',
      false,
      () => version('wasm-interp', ['--version'], /(\d+\.\d+\.\d+)/),
      (f) => [['wasm-interp', ['--enable-all', '--run-all-exports', f]]],
      /t\(\) => i64:(-?\d+)/,
    ),
    cli(
      'binaryang',
      'binaryang',
      false,
      () =>
        (JSON.parse(readFileSync(join(REPO, 'jsr.json'), 'utf8')) as { version: string }).version,
      (f) => [['bun', ['main.ts', 'wasm-interp', f, '--run-all-exports'], REPO]],
      /t\(\) => i64:(-?\d+)/,
    ),
  ];
}
