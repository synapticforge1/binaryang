/**
 * @module
 * Cross-runtime CLI I/O helpers.
 *
 * ## Why this exists
 *
 * wabt-ts defined `cliRead`/`cliWrite` privately and identically in five of its
 * six tools (byte-identical, verified), each reaching for the `Deno` global.
 * That global does not exist on Node or Bun at any version, so those blocks ran
 * on exactly one of binaryang's four supported runtimes.
 *
 * This module is the single copy, written against `node:` builtins, which are
 * portable across Deno, Node and Bun.
 *
 * ## Layer
 *
 * This is **CLI-layer** code and may use `node:` builtins. The library layer may
 * not: `node:` is portable across the three runtimes but NOT to the browser, and
 * binaryang's library surface has to run there. See the README's runtime-support
 * table. `Deno.*` is never permitted in shipped source -- it works on one target
 * out of four.
 *
 * @license MIT
 */

import type nodeProcess from 'node:process';

// ⚠️ NO RUNTIME `node:` IMPORT IN THIS FILE, and none in the tools that use it (open-work 28,
// 2026-10-12). A top-level `import … from 'node:process'` made every module that reached this
// one unloadable in a browser, including pure library functions such as `wat2wasm()`, and with it
// 15 of the package's 22 exports. So `process` is reached through `globalThis` when a CLI function
// RUNS, and `node:fs/promises` is loaded on demand. The `import type` above is erased at compile
// time. The checks: `bun run browser` bundles every export for the browser and fails on a `node:`
// left in any of them.

/**
 * The runtime's `process`, when a CLI function runs. Deno, Node and Bun all provide the global
 * (checked 2026-10-12); a browser does not, and gets a message saying what to call instead.
 */
export function cliProcess(): typeof nodeProcess {
  const p = (globalThis as { process?: typeof nodeProcess }).process;
  if (p === undefined) {
    throw new Error(
      'binaryang: the command line needs Deno, Node or Bun (there is no `process` here); ' +
        'in a browser, call the library functions instead',
    );
  }
  return p;
}

/**
 * `process.exit(code)`, as a NAMED call declared `never`. TypeScript treats a call as ending the
 * code path only when it names a function with an explicit `never` type, and
 * `cliProcess().exit(…)` calls through a function result, so code after it would not be seen as
 * unreachable. Every CLI exit goes through here.
 */
export function cliExit(code: number): never {
  cliProcess().exit(code);
  throw new Error(`process.exit(${code}) returned`);
}

/** A file's bytes, through `node:fs/promises` loaded on demand. A fresh `Uint8Array`, not a pooled `Buffer`. */
export async function fsRead(path: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises');
  return new Uint8Array(await readFile(path));
}

/** Writes `data` to `path`, through `node:fs/promises` loaded on demand. */
export async function fsWrite(path: string, data: Uint8Array | string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, data);
}

/**
 * The last segment of a path, `/` or `\` separated, trailing separators ignored: `node:path`'s
 * `basename` without the import. Library functions such as `moduleNameOf` name things from a
 * path, so this must work in a browser too.
 */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return trimmed.slice(at + 1);
}

/** Exit with a one-line `tool: message` on stderr. Never returns. */
export function cliFail(tool: string, message: string): never {
  console.error(`${tool}: ${message}`);
  cliExit(1);
}

/** Read a file for the CLI, or exit 1 with a one-line message. */
export async function cliRead(tool: string, path: string): Promise<Uint8Array> {
  try {
    return await fsRead(path);
  } catch (e) {
    return cliFail(tool, `cannot read '${path}': ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Write a file for the CLI, or exit 1 with a one-line message. See {@link cliRead}. */
export async function cliWrite(
  tool: string,
  path: string,
  data: Uint8Array | string,
): Promise<void> {
  try {
    await fsWrite(path, data);
  } catch (e) {
    cliFail(tool, `cannot write '${path}': ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Write raw bytes to stdout — the `wat2wasm foo.wat` with no `-o` case.
 *
 * Awaits the drain callback rather than ignoring the return value: a large
 * module can exceed the pipe buffer, and a process that exits before the flush
 * completes truncates its own output.
 */
export function writeStdout(data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    cliProcess().stdout.write(data, (err) => (err ? reject(err) : resolve()));
  });
}
