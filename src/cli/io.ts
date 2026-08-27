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

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

/** Exit with a one-line `tool: message` on stderr. Never returns. */
export function cliFail(tool: string, message: string): never {
  console.error(`${tool}: ${message}`);
  process.exit(1);
}

/** Read a file for the CLI, or exit 1 with a one-line message. */
export async function cliRead(tool: string, path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
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
    await writeFile(path, data);
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
    process.stdout.write(data, (err) => (err ? reject(err) : resolve()));
  });
}
