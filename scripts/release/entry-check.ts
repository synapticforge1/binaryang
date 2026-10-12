/**
 * @module scripts/release/entry-check
 *
 * Release preflight: the package's `.` export — what `deno run -A
 * jsr:@jrmarcum/binaryang <command>` runs — must BE the CLI. Run exactly as a
 * user runs it, by the path `jsr.json` exports, and judged by its output and
 * exit code:
 *
 * - `--help` prints the usage, exit 0;
 * - `--version` prints the version `jsr.json` is about to publish;
 * - a real command runs: `wasm-validate` on a valid module exits 0, and on a
 *   missing file exits 1 — a no-op entry would exit 0 both times;
 * - IMPORTING the entry runs nothing: a library `import` of the root must not
 *   read the importer's argv or exit.
 *
 * 🔧 Why this exists (2026-09-28): from 2026-08-27 (`4651be129`) through 1.6.0
 * the root was `src/index.ts`, which has no dispatcher. The README's command
 * printed nothing and exited 0 on every published version, and nothing ran the
 * entry a user runs. Fixed in 1.6.1.
 *
 * Side-effect free: `publish.ts` calls {@link checkEntry}, and a test calls it
 * on the real tree.
 *
 * @license MIT
 */

/** What went wrong, one line each; empty when the entry is the CLI. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export async function checkEntry(root: string): Promise<string[]> {
  const cfg = JSON.parse(await readFile(`${root}/jsr.json`, 'utf8')) as {
    version: string;
    exports: Record<string, string>;
  };
  const rel = cfg.exports['.'];
  if (rel === undefined) return ['jsr.json exports no `.`'];
  const entry = `${root}/${rel.replace(/^\.\//, '')}`;
  const problems: string[] = [];

  // The RUNNING runtime, with its own flags (Node needs --experimental-transform-types for
  // the TypeScript source): the entry is checked under whatever runs the release.
  const runtime = (args: string[]) => {
    const r = spawnSync(process.execPath, [...process.execArgv, ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { code: r.status, out: r.stdout.toString('utf8'), err: r.stderr.toString('utf8') };
  };
  const run = (args: string[]) => Promise.resolve(runtime([entry, ...args]));

  const help = await run(['--help']);
  if (help.code !== 0 || !help.out.includes('USAGE') || !help.out.includes('wat2wasm')) {
    problems.push(`\`${rel} --help\` exit ${help.code}, no usage printed`);
  }
  const version = await run(['--version']);
  if (version.code !== 0 || !version.out.includes(cfg.version)) {
    problems.push(
      `\`${rel} --version\` exit ${version.code}, printed "${version.out.trim()}", not ${cfg.version}`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'binaryang-entry-check-'));
  try {
    // (module) — the smallest valid module.
    await writeFile(`${dir}/ok.wasm`, Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    const ok = await run(['wasm-validate', `${dir}/ok.wasm`]);
    if (ok.code !== 0) {
      problems.push(`\`${rel} wasm-validate <valid>\` exit ${ok.code}: ${ok.err.trim()}`);
    }
    const missing = await run(['wasm-validate', `${dir}/missing.wasm`]);
    if (missing.code !== 1) {
      problems.push(
        `\`${rel} wasm-validate <missing file>\` exit ${missing.code}, not 1 — did a command run at all?`,
      );
    }
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }

  // A one-line importer module, run by the same runtime: `-e` with top-level await is not
  // portable (Node's `-e` is CommonJS unless told otherwise).
  const importer = await mkdtemp(join(tmpdir(), 'binaryang-entry-import-'));
  let imported: { code: number | null; out: string; err: string };
  try {
    await writeFile(
      join(importer, 'import.mjs'),
      `await import(${JSON.stringify(pathToFileURL(entry).href)});\n`,
    );
    imported = runtime([join(importer, 'import.mjs')]);
  } finally {
    await rm(importer, { recursive: true }).catch(() => {});
  }
  const said = imported.out + imported.err;
  if (imported.code !== 0 || said.trim() !== '') {
    problems.push(
      `importing ${rel} ran something (exit ${imported.code}): ${said.trim().slice(0, 80)}`,
    );
  }
  return problems;
}
