// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Proves the npm TARBALL, not the tree (open-work 29; cmem/jsr-deno-exit-guide.md § 5b): builds
 * `dist/`, packs it, installs the tarball into a scratch consumer OUTSIDE the repo, and checks
 * what a user of `@synapticforge/binaryang` gets. Nothing is published.
 *
 * - the tarball holds JavaScript, `.d.ts`, the definitions JSON, README and the licence files,
 *   and no TypeScript source;
 * - on every runtime (each Node LTS fnm has, else `node` from PATH; and Bun): every export
 *   imports, the `.` export imports without running the CLI, and `scripts/cli-smoke.ts` run on the
 *   INSTALLED `main.js` prints the same hash as on the source's `main.ts`;
 * - the `bin`: `npm exec binaryang -- --version` prints the version;
 * - the types: a consumer importing every export type-checks against the shipped `.d.ts`
 *   (`moduleResolution: nodenext`, no `@types/node`);
 * - the browser: every export of the INSTALLED package bundles with no top-level `node:` import;
 * - the export list equals JSR's own npm build of the same version (`npm.jsr.io`), an
 *   independent reference — reported, not failed, when that registry is out of reach.
 *
 * ```sh
 * bun run npm:prove
 * ```
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { bundleExports } from '../check-browser.ts';
import { build, NPM_NAME } from './build.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dist = join(root, 'dist');
const problems: string[] = [];
const fail = (what: string) => {
  problems.push(what);
  console.log(`FAIL ${what}`);
};
const ok = (what: string) => console.log(`ok   ${what}`);

/** Through fnm when it is installed (this machine), on that Node major; else from PATH (CI). */
const hasFnm = spawnSync('fnm', ['--version'], { stdio: 'ignore' }).status === 0;
function onNode(major: number | null, cmd: string[], cwd: string): SpawnSyncReturns<string> {
  const [bin, args] = major !== null && hasFnm
    ? ['fnm', ['exec', `--using=${major}`, ...cmd]]
    : [cmd[0]!, cmd.slice(1)];
  return spawnSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
}
const out = (r: SpawnSyncReturns<string>) => `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();

/**
 * npm, as `node <npm-cli.js>` under the same Node: on Windows `npm` is a `.cmd` shim that neither
 * `fnm exec` nor a shell-less spawn can start ("program not found"). npm sits beside node
 * (Windows) or in `../lib/node_modules` (Linux, macOS).
 */
function npm(major: number | null, args: string[], cwd: string): SpawnSyncReturns<string> {
  const find = onNode(major, [
    'node',
    '-p',
    "const p=require('path'),fs=require('fs'),d=p.dirname(process.execPath);" +
    "[p.join(d,'node_modules/npm/bin/npm-cli.js'),p.join(d,'../lib/node_modules/npm/bin/npm-cli.js')]" +
    '.find((f)=>fs.existsSync(f))',
  ], cwd);
  const cli = (find.stdout ?? '').trim();
  if (find.status !== 0 || cli === '' || cli === 'undefined') {
    throw new Error(`npm-cli.js not found beside node: ${out(find)}`);
  }
  return onNode(major, ['node', cli, ...args], cwd);
}

/** One file's text from an uncompressed tar: 512-byte headers, name at 0, octal size at 124. */
function tarFile(tar: Uint8Array, name: string): string {
  const text = new TextDecoder();
  for (let p = 0; p + 512 <= tar.length;) {
    const header = tar.subarray(p, p + 512);
    const n = text.decode(header.subarray(0, 100)).replace(/\0.*$/s, '');
    if (n === '') break;
    const size = parseInt(text.decode(header.subarray(124, 136)).replace(/\0.*$/s, '').trim(), 8);
    if (n === name) return text.decode(tar.subarray(p + 512, p + 512 + size));
    p += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${name} is not in the tarball`);
}

/** The Node majors to prove on: every LTS line fnm has (22, 24, 26), or PATH's `node` alone. */
function nodeMajors(): (number | null)[] {
  if (!hasFnm) return [null];
  const list = spawnSync('fnm', ['list'], { encoding: 'utf8' }).stdout ?? '';
  const have = new Set([...list.matchAll(/\bv(\d+)\.\d+\.\d+/g)].map((m) => Number(m[1])));
  return [22, 24, 26].filter((m) => have.has(m));
}

const work = mkdtempSync(join(tmpdir(), 'binaryang-npm-'));
try {
  // 1. Build and pack.
  const manifest = build(root);
  const version = String(manifest['version']);
  const exportsMap = manifest['exports'] as Record<string, { types: string; default: string }>;
  const pack = npm(24, ['pack', '--json', '--pack-destination', work], dist);
  if (pack.status !== 0) throw new Error(`npm pack failed: ${out(pack)}`);
  type Packed = { filename: string; files: { path: string }[]; size: number };
  // npm 10 prints an array of packages; npm 11 an object keyed by package name.
  const json = JSON.parse(pack.stdout) as Packed[] | Record<string, Packed>;
  const packed = Array.isArray(json) ? json : Object.values(json);
  const tarball = join(work, packed[0]!.filename);
  const files = packed[0]!.files.map((f) => f.path);
  const source = files.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  if (source.length > 0) fail(`tarball holds TypeScript source: ${source.slice(0, 5).join(', ')}`);
  const unexpected = files.filter((f) =>
    !/\.(js|d\.ts|json|md)$/.test(f) && !/^LICENSE(-MIT|-APACHE)?$/.test(f)
  );
  if (unexpected.length > 0) fail(`tarball holds unexpected files: ${unexpected.join(', ')}`);
  for (
    const must of [
      'package.json',
      'main.js',
      'main.d.ts',
      'README.md',
      'LICENSE',
      'LICENSE-APACHE',
      'NOTICE.md',
    ]
  ) {
    if (!files.includes(must)) fail(`tarball lacks ${must}`);
  }
  // Every path the manifest names is in the tarball. TypeScript would not notice a wrong `types`
  // path (it falls back to the `.d.ts` beside the `.js`), other tools would.
  const named = [
    String(manifest['types']),
    ...Object.values(manifest['bin'] as Record<string, string>),
    ...Object.values(exportsMap).flatMap((e) => [e.types, e.default]),
  ];
  const missing = [...new Set(named)].filter((p) => !files.includes(p.replace(/^\.\//, '')));
  if (missing.length > 0) fail(`the manifest names files the tarball lacks: ${missing.join(', ')}`);
  // The same exports as jsr.json, offline (JSR's npm build below is the independent second look).
  const jsrSubs = Object.keys(
    (JSON.parse(readFileSync(join(root, 'jsr.json'), 'utf8')) as {
      exports: Record<string, string>;
    }).exports,
  ).sort().join(' ');
  if (Object.keys(exportsMap).sort().join(' ') !== jsrSubs) {
    fail(
      `the manifest's exports differ from jsr.json's: ${Object.keys(exportsMap).length} vs ${
        jsrSubs.split(' ').length
      }`,
    );
  }
  if (problems.length === 0) {
    ok(
      `packed ${packed[0]!.filename}: ${files.length} files, ${
        (packed[0]!.size / 1024).toFixed(0)
      } KiB`,
    );
  }

  // 2. A consumer outside the repo, installing the TARBALL.
  const consumer = join(work, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{ "private": true, "type": "module" }\n');
  const install = npm(24, ['install', '--no-audit', '--no-fund', tarball], consumer);
  if (install.status !== 0) throw new Error(`npm install of the tarball failed: ${out(install)}`);
  const pkg = join(consumer, 'node_modules', ...NPM_NAME.split('/'));
  ok(`installed into a scratch consumer`);

  // 3. Every export imports; `.` runs nothing; the CLI gives the source's hash.
  const subs = Object.keys(exportsMap);
  const spec = (sub: string) => (sub === '.' ? NPM_NAME : `${NPM_NAME}${sub.slice(1)}`);
  writeFileSync(
    join(consumer, 'imports.mjs'),
    `const subs = ${JSON.stringify(subs.map(spec))};\nconst n = {};\n` +
      `for (const s of subs) n[s] = Object.keys(await import(s)).length;\n` +
      `console.log('IMPORTS ' + JSON.stringify(n));\n`,
  );
  const want = spawnSync('bun', [join(root, 'scripts', 'cli-smoke.ts'), 'bun'], {
    cwd: root,
    encoding: 'utf8',
  });
  const sourceHash = want.stdout.trim();
  if (want.status !== 0 || !/^[0-9a-f]{64}$/.test(sourceHash)) {
    throw new Error(`cli-smoke on the source failed: ${out(want)}`);
  }
  const smoke = join(root, 'scripts', 'cli-smoke.ts');
  const runtimes: { name: string; run: (cmd: string[]) => SpawnSyncReturns<string> }[] = [
    ...nodeMajors().map((m) => ({
      name: m === null ? 'node (PATH)' : `Node ${m}`,
      run: (cmd: string[]) => onNode(m, ['node', ...cmd], consumer),
    })),
    {
      name: 'Bun',
      run: (cmd: string[]) => spawnSync('bun', cmd, { cwd: consumer, encoding: 'utf8' }),
    },
  ];
  for (const rt of runtimes) {
    const imp = rt.run([join(consumer, 'imports.mjs')]);
    const line = imp.stdout?.split('\n').find((l) => l.startsWith('IMPORTS ')) ?? '';
    const counts = line === ''
      ? {}
      : JSON.parse(line.slice('IMPORTS '.length)) as Record<string, number>;
    const extra = (imp.stdout ?? '').split('\n').filter((l) =>
      l.trim() !== '' && !l.startsWith('IMPORTS ')
    );
    const empty = Object.entries(counts).filter(([s, n]) => n === 0 && s !== NPM_NAME).map(([s]) =>
      s
    );
    if (imp.status !== 0 || Object.keys(counts).length !== subs.length) {
      fail(`${rt.name}: importing every export: ${out(imp).split('\n').slice(-3).join(' | ')}`);
    } else if (extra.length > 0) {
      fail(`${rt.name}: importing printed output (the CLI ran on import?): ${extra[0]}`);
    } else if (empty.length > 0) {
      fail(`${rt.name}: exports with nothing in them: ${empty.join(', ')}`);
    } else ok(`${rt.name}: all ${subs.length} exports import, and importing runs nothing`);
    const name = rt.name.startsWith('Bun') ? 'bun' : 'node';
    const s = rt.run([smoke, name, join(pkg, 'main.js')]);
    const hash = (s.stdout ?? '').trim();
    if (s.status !== 0 || hash !== sourceHash) {
      fail(
        `${rt.name}: cli-smoke on the installed main.js: ${hash || out(s)} (source ${sourceHash})`,
      );
    } else ok(`${rt.name}: the CLI from the package, every command, the source's hash`);
  }

  // 4. The bin, as npx runs it.
  const bin = npm(24, ['exec', '--no', '--', 'binaryang', '--version'], consumer);
  if (bin.status !== 0 || bin.stdout.trim() !== `binaryang ${version}`) {
    fail(`npm exec binaryang --version: ${out(bin)}`);
  } else ok(`npm exec binaryang --version: ${bin.stdout.trim()}`);

  // 5. The types, as a consumer with no @types/node sees them.
  writeFileSync(
    join(consumer, 'types.ts'),
    subs.map((s, i) => `import * as m${i} from '${spec(s)}';\n`).join('') +
      `export const all = [${subs.map((_, i) => `m${i}`).join(', ')}];\n`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    `${
      JSON.stringify(
        {
          compilerOptions: {
            target: 'esnext',
            module: 'nodenext',
            moduleResolution: 'nodenext',
            lib: ['esnext', 'dom'],
            types: [],
            strict: true,
            noEmit: true,
            skipLibCheck: false,
          },
          files: ['types.ts'],
        },
        null,
        2,
      )
    }\n`,
  );
  const tsc = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.exe' : 'tsc');
  const types = spawnSync(tsc, ['-p', join(consumer, 'tsconfig.json')], {
    cwd: consumer,
    encoding: 'utf8',
  });
  if (types.status !== 0) {
    fail(
      `the shipped .d.ts do not type-check for a consumer: ${
        out(types).split('\n').slice(0, 8).join(' | ')
      }`,
    );
  } else {ok(
      `a consumer importing all ${subs.length} exports type-checks against the shipped .d.ts`,
    );}

  // 6. The browser, from the INSTALLED package.
  const js: Record<string, string> = {};
  for (const [sub, e] of Object.entries(exportsMap)) js[sub] = e.default;
  const browser = bundleExports(pkg, join(work, 'browser'), js);
  if (browser.problems.length > 0) fail(`browser: ${browser.problems.join('; ')}`);
  else {ok(
      `browser: all ${subs.length} exports of the installed package bundle with no top-level node: import`,
    );}

  // 7. JSR's own npm build of the same version: the same export list. The registry's metadata
  // leaves `exports` out, so it is read from the tarball's own package.json.
  try {
    const r = await fetch(`https://npm.jsr.io/@jsr/jrmarcum__binaryang`);
    const meta = (await r.json()) as { versions?: Record<string, { dist?: { tarball?: string } }> };
    const url = meta.versions?.[version]?.dist?.tarball;
    if (url === undefined) console.log(`note JSR's npm build has no ${version} to compare (yet)`);
    else {
      const tgz = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const theirs = (JSON.parse(tarFile(gunzipSync(tgz), 'package/package.json')) as {
        exports?: Record<string, unknown>;
      }).exports ?? {};
      const a = Object.keys(theirs).sort().join(' '), b = subs.slice().sort().join(' ');
      if (a !== b) fail(`export list differs from JSR's npm build: theirs ${a} / ours ${b}`);
      else ok(`the export list equals JSR's own npm build of ${version}`);
    }
  } catch (e) {
    console.log(`note JSR's npm build not reached: ${(e as Error).message}`);
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(problems.length === 0 ? '\nthe npm package holds' : `\n${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
