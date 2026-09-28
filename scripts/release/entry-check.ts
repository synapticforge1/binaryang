/**
 * @module scripts/release/entry-check
 *
 * Release preflight: the package's `.` export — what `deno run -A
 * jsr:@jrmarcum/binaryang <command>` runs — must BE the CLI. Run exactly as a
 * user runs it, by the path `deno.json` exports, and judged by its output and
 * exit code:
 *
 * - `--help` prints the usage, exit 0;
 * - `--version` prints the version `deno.json` is about to publish;
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
export async function checkEntry(root: string): Promise<string[]> {
  const cfg = JSON.parse(await Deno.readTextFile(`${root}/deno.json`)) as {
    version: string;
    exports: Record<string, string>;
  };
  const rel = cfg.exports['.'];
  if (rel === undefined) return ['deno.json exports no `.`'];
  const entry = `${root}/${rel.replace(/^\.\//, '')}`;
  const problems: string[] = [];

  const run = async (args: string[]) => {
    const r = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', '--quiet', entry, ...args],
      cwd: root,
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    return {
      code: r.code,
      out: new TextDecoder().decode(r.stdout),
      err: new TextDecoder().decode(r.stderr),
    };
  };

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

  const dir = await Deno.makeTempDir({ prefix: 'binaryang-entry-check-' });
  try {
    // (module) — the smallest valid module.
    await Deno.writeFile(`${dir}/ok.wasm`, Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
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
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }

  const imported = await new Deno.Command(Deno.execPath(), {
    args: [
      'eval',
      `await import(${JSON.stringify(new URL(`file:///${entry.replace(/^\//, '')}`).href)})`,
    ],
    cwd: root,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const said = new TextDecoder().decode(imported.stdout) +
    new TextDecoder().decode(imported.stderr);
  if (imported.code !== 0 || said.trim() !== '') {
    problems.push(
      `importing ${rel} ran something (exit ${imported.code}): ${said.trim().slice(0, 80)}`,
    );
  }
  return problems;
}
