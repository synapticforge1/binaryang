// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

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

/**
 * The largest input a tool reads: 1 GiB. With no cap, a mistaken path to a disk image or an
 * endless device took the process's memory before anything said why (security review round 1,
 * 2026-11-13).
 */
export const MAX_INPUT_BYTES = 1024 * 1024 * 1024;

/**
 * A file's bytes, through `node:fs/promises` loaded on demand. A fresh `Uint8Array`, not a pooled
 * `Buffer`. Refuses a directory and anything over `limit` ({@link MAX_INPUT_BYTES}). A pipe or a
 * device (`/dev/stdin`) is read up to the limit, as it has no size to check first.
 */
export async function fsRead(path: string, limit: number = MAX_INPUT_BYTES): Promise<Uint8Array> {
  const tooLarge = (size: number) =>
    new Error(`${size} bytes or more is over the ${limit}-byte input limit`);
  const { open } = await import('node:fs/promises');
  const fh = await open(path, 'r');
  try {
    const st = await fh.stat();
    if (st.isDirectory()) throw new Error('is a directory');
    if (st.isFile()) {
      if (st.size > limit) throw tooLarge(st.size);
      return new Uint8Array(await fh.readFile());
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const buf = new Uint8Array(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit) throw tooLarge(total);
      chunks.push(buf.subarray(0, bytesRead));
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  } finally {
    await fh.close();
  }
}

/**
 * Writes `data` to `path`, through `node:fs/promises` loaded on demand, ATOMICALLY: into a fresh
 * file beside the target, then renamed over it. A failure part-way (a full disk, a kill) leaves
 * the old file whole, never half a module (security review round 1, 2026-11-13). A symbolic link
 * is written through, to the file it names, as before. A target that is not a regular file (a
 * device such as `/dev/null`, a pipe) is written directly: renaming over it would replace it.
 */
export async function fsWrite(path: string, data: Uint8Array | string): Promise<void> {
  const { lstat, readlink, realpath, rename, stat, unlink, writeFile } = await import(
    'node:fs/promises'
  );
  const { dirname, resolve } = await import('node:path');
  let target = path;
  let mode: number | undefined;
  try {
    target = await realpath(path);
    const st = await stat(target);
    if (!st.isFile()) {
      await writeFile(target, data);
      return;
    }
    mode = st.mode & 0o777;
  } catch (e) {
    if ((e as { code?: string }).code !== 'ENOENT') throw e;
    // A DANGLING symbolic link: written through, to the file it names, as a link to an existing
    // file is. 🔧 The rename replaced the link itself with a file (security review round 2).
    const link = await lstat(path).catch(() => undefined);
    if (link?.isSymbolicLink()) target = resolve(dirname(path), await readlink(path));
  }
  // Eight hex digits are enough beside one file: a temp name 13 characters longer than the
  // target, not 41 (a long legal name could fail ENAMETOOLONG through the temp name alone).
  const tmp = `${target}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, data, mode === undefined ? { flag: 'wx' } : { flag: 'wx', mode });
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    // The error names the file the user asked for, never the temp name they did not.
    const err = e as Error & { code?: string };
    const named = new Error(err.message.split(tmp).join(target));
    throw err.code === undefined ? named : Object.assign(named, { code: err.code });
  }
}

/**
 * Whether `a` and `b` are the same file: one device and inode, so a case variant on Windows or
 * macOS, a hard link, a symbolic link or a junction all count (measured on Windows with Bun 1.4.4
 * and Node 24, 2026-11-13). `false` when either does not exist. A file system without inode
 * numbers (inode 0) is compared by its real path instead, without case on Windows and macOS.
 */
export async function sameFile(a: string, b: string): Promise<boolean> {
  const { realpath, stat } = await import('node:fs/promises');
  try {
    const [x, y] = await Promise.all([stat(a, { bigint: true }), stat(b, { bigint: true })]);
    if (x.ino !== 0n && y.ino !== 0n) return x.dev === y.dev && x.ino === y.ino;
    const [ra, rb] = await Promise.all([realpath(a), realpath(b)]);
    const platform = cliProcess().platform;
    const fold = platform === 'win32' || platform === 'darwin';
    return fold ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
  } catch {
    return false;
  }
}

/**
 * Exit 1, by name, when `output` is one of `inputs`: a tool whose output is not its input's
 * format (`wat2wasm a.wat -o a.wat`) would destroy the input and exit 0 (security review round 1,
 * 2026-11-13). A tool that rewrites a module in place in its own format (`wasm-strip`, or
 * `wasm-opt a.wasm -o a.wasm` as upstream) does not call this.
 */
export async function cliRefuseOverwritingInput(
  tool: string,
  inputs: readonly string[],
  output: string,
): Promise<void> {
  for (const input of inputs) {
    if (await sameFile(input, output)) {
      cliFail(
        tool,
        `the output '${output}' is the input '${input}'; writing it would destroy the input ` +
          '(name another output file)',
      );
    }
  }
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
  // 🔧 `wat2wasm in.wat -o ""` wrote the binary to the terminal (an empty string read as "no
  // output") while other tools said "cannot write ''" (security review round 2, 2026-11-13):
  // an empty path is the same refusal everywhere.
  if (path === '') cliFail(tool, 'the output path is empty (-o ""): name a file');
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
