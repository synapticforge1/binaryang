// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `host` — every call binaryang makes to the system it runs on (workspace letter H39, owner,
 * 2026-11-19: "all of the OS/platform specifics lives in one place").
 *
 * Reading and writing files (never over an input, never half-written), temp files, paths, the
 * process (arguments, exit, stdout): all of it is here, and only here. `bun run portability`
 * fails when any other shipped file imports a runtime's file, path, OS or process API. What
 * binaryang COMPUTES is tested per engine (V8 and JavaScriptCore); OS-specific testing concerns
 * this file alone, and only when it or the pinned runtime changes (cmem/platforms.md). On a
 * machine not yet tested, `binaryang --self-check` ({@link selfCheck}) tries each operation here.
 *
 * ## History
 *
 * `src/cli/io.ts` until 2026-11-19. wabt-ts defined `cliRead`/`cliWrite` privately and identically
 * in five of its six tools, each reaching for the `Deno` global, which runs on one of binaryang's
 * four supported runtimes. This module is the single copy, written against `node:` builtins, which
 * are portable across Deno, Node and Bun.
 *
 * ## Layer
 *
 * The library layer does not reach the system: `node:` is portable across the three runtimes but
 * NOT to the browser, and binaryang's library surface has to run there. See the README's
 * runtime-support table. `Deno.*` is never permitted in shipped source.
 *
 * @license MIT
 */

import type nodeProcess from 'node:process';
import { printable } from './core/printable.ts';

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
 * win-x64 / win-arm64: a reserved device name, in any case, as Win32 reads one — the bare name,
 * with trailing dots or spaces (`NUL.`, `nul `, `NUL. `), or with a colon (`NUL:`, `CON:`);
 * `nul.wasm` is an ordinary file on Windows 11. Measured 2026-11-19 with cmd's `>` (Win32's own
 * rules: none of these made a file) against Node and Bun, whose fs made a FILE for each but the
 * colon form — so binaryang writes a device by its device path, `\\.\NAME`.
 */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?::|[. ]*)$/i;

/**
 * The process's own output stream a path names — `/dev/stdout`, `/dev/fd/1`, `/dev/stderr`,
 * `/dev/fd/2`, on every OS — or `null`. Written through the stream, never opened by path: 🔧 under
 * Bun's test runner a child's stdout is a socket, and Linux refuses to open a socket by its
 * `/proc` path (ENXIO), and the path's link target has none when it is a pipe (ENOENT from
 * realpath) — 4.1.0 notes review. On Windows these paths otherwise name nothing.
 */
function standardStream(path: string): 'stdout' | 'stderr' | null {
  // `/proc/self/fd/N` too: Git Bash on Windows rewrites `/dev/stdout` into it before the tool
  // sees the argument (4.1.0 notes review).
  if (path === '/dev/stdout' || path === '/dev/fd/1' || path === '/proc/self/fd/1') {
    return 'stdout';
  }
  if (path === '/dev/stderr' || path === '/dev/fd/2' || path === '/proc/self/fd/2') {
    return 'stderr';
  }
  return null;
}

/**
 * Whether a tool's output `path` is its own standard output — `-`, or a path naming stdout. Its
 * report lines then go to stderr, so stdout holds the module alone (4.1.0 notes review: through
 * 4.0.0 `wasm-bundle -o -`, and with 4.1.0's streams `-o /dev/stdout` for wasm-bundle, wasm-opt and
 * wasm-ctor-eval, mixed "Wrote WASM: …" lines into the module bytes).
 */
export function writesToStdout(path: string): boolean {
  return path === '-' || standardStream(path) === 'stdout';
}

/**
 * Bun on Linux: whether standard output was CLOSED when the process started (`>&-`). Q-H4, 4.1.0
 * notes review: a runtime reopens a closed fd 1 as `/dev/null` before any script runs, so a write
 * to it succeeds and goes nowhere. Measured 2026-11-20 (WSL Ubuntu, `/proc/self/fdinfo/1`): Bun
 * reopens it with O_CLOEXEC (02000000) and sets that bit on no other stdio fd it inherits, and an
 * fd inherited across exec can never carry it (exec closes those) — so `/dev/null` with O_CLOEXEC
 * is the reopened one, while `>/dev/null`, `<>/dev/null`, Python's DEVNULL, Node's and Bun's
 * `stdio: 'ignore'` all lack the bit. Node sets O_CLOEXEC on fd 0-2 whatever they were, and Deno
 * reopens with the very flags Python's DEVNULL uses (`O_RDWR|O_LARGEFILE`): nothing in-process tells
 * those two from a deliberate discard, so only Bun is checked. Elsewhere: no `/proc` on macOS, and
 * on Windows a closed handle arrives as NUL.
 */
async function bunClosedStdout(): Promise<boolean> {
  const p = cliProcess();
  if (p.platform !== 'linux' || p.versions['bun'] === undefined) return false;
  try {
    const { readFile, readlink } = await import('node:fs/promises');
    if ((await readlink('/proc/self/fd/1')) !== '/dev/null') return false;
    const flags = /^flags:\s*([0-7]+)/m.exec(await readFile('/proc/self/fdinfo/1', 'utf8'));
    return flags !== null && (parseInt(flags[1]!, 8) & 0o2000000) !== 0;
  } catch {
    return false;
  }
}

/**
 * What one stream's writes share (see {@link writeStream}): the writes still waiting, the one
 * 'error' listener that rejects them, and whether that listener is installed or a failure was seen.
 */
interface StreamWatch {
  readonly pending: Set<(err: Error) => void>;
  readonly onError: (err: Error) => void;
  installed: boolean;
  failed: boolean;
}

const watches = new WeakMap<object, StreamWatch>();

/** `data` to the process's stdout or stderr, resolved once it is flushed. */
async function writeStream(stream: 'stdout' | 'stderr', data: Uint8Array | string): Promise<void> {
  if (stream === 'stdout' && (await bunClosedStdout())) {
    throw new Error('standard output is closed (this process was started with `>&-`)');
  }
  const out = cliProcess()[stream];
  // 🔧 Node reports a failed write TWICE: to the callback, and as an 'error' event on the stream,
  // which with no listener is an "Unhandled 'error' event" stack trace of 23-25 lines, not the
  // one line + exit 1 the callers print (4.1.x review, hardening F1: `> /dev/full`, a closed
  // pipe). Bun and Deno call back only. So a listener is held while a write is pending, and the
  // callback and the event settle the one promise, whichever comes first. 🔧 ONE listener per
  // stream, shared by every pending write: a listener each made 50 concurrent writes a
  // MaxListenersExceededWarning on Node 24 (round 2 review). It stays after a failure (the event
  // can follow the callback by a tick, and the process is ending); after success, once the last
  // write is done, it is removed, so a long run does not leave one behind.
  let watch = watches.get(out);
  if (watch === undefined) {
    const pending = new Set<(err: Error) => void>();
    const made: StreamWatch = {
      pending,
      installed: false,
      failed: false,
      onError: (err) => {
        made.failed = true;
        for (const reject of [...pending]) reject(err);
        pending.clear();
      },
    };
    watch = made;
    watches.set(out, watch);
  }
  const w = watch;
  return new Promise((resolve, reject) => {
    w.pending.add(reject);
    if (!w.installed) {
      out.on('error', w.onError);
      w.installed = true;
    }
    out.write(data, (err) => {
      w.pending.delete(reject);
      if (err) {
        w.failed = true;
        return reject(err);
      }
      if (w.pending.size === 0 && !w.failed) {
        out.removeListener('error', w.onError);
        w.installed = false;
      }
      resolve();
    });
  });
}

/**
 * The bare device name (`NUL`, `CON`, `COM1` …) `path` names on Windows, or `null`. A `\\?\` path
 * is never a device: Win32 does no device-name parsing after that prefix, so `\\?\C:\x\nul` names
 * a real file called `nul` (4.1.0 notes review, Q-H3; `\\.\NUL`, with a dot, is the device).
 */
async function windowsDeviceName(path: string): Promise<string | null> {
  if (path.startsWith('\\\\?\\')) return null;
  const { basename } = await import('node:path');
  const m = WINDOWS_DEVICE.exec(path === '/dev/null' ? 'NUL' : basename(path));
  return m === null ? null : m[1]!.toUpperCase();
}

/**
 * Whether `path` names a DEVICE rather than a file or folder: on Windows a reserved name (or
 * `/dev/null`, written as NUL), elsewhere an existing path that is neither a file nor a folder
 * (`/dev/null`, `/dev/stdout`, a pipe). A tool that writes a file BESIDE its output skips it for a
 * device: there is no "beside" a device (`wasm-bundle -o NUL` wrote a file named `NUL.wit` here
 * through 4.0.0; on Linux it tried `/dev/null.wit`).
 */
export async function isDevice(path: string): Promise<boolean> {
  if (standardStream(path) !== null) return true;
  if (cliProcess().platform === 'win32') return (await windowsDeviceName(path)) !== null;
  const { stat } = await import('node:fs/promises');
  try {
    const st = await stat(path);
    return !st.isFile() && !st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Writes `data` into the FIFO at `path`, refusing at once when nothing has it open for reading.
 * 🔧 Opening a FIFO for writing blocks until a reader opens it, so `-o <FIFO>` with no reader hung
 * the tool for ever (4.1.0 notes review, Q-H2). A non-blocking open fails with ENXIO exactly then.
 * That probe handle stays open until the blocking one is, so the reader never sees the FIFO's last
 * writer leave and end its input early. (Only a reader that exits in the instant between the two
 * opens can still leave the write waiting.) Windows has no FIFO: a named pipe that does not exist
 * (`\\.\pipe\x`) is refused at once with ENOENT there (measured 2026-11-20), so nothing hangs.
 */
async function writeFifo(path: string, data: Uint8Array | string): Promise<void> {
  const { constants, open } = await import('node:fs/promises');
  let probe;
  try {
    probe = await open(path, constants.O_WRONLY | constants.O_NONBLOCK);
  } catch (e) {
    if ((e as { code?: string }).code === 'ENXIO') {
      // The example command is given only where it can be exact: a path with a byte that acts
      // when printed (ESC, a line break …) is escaped in the message, and an escaped name is not
      // the file's. Elsewhere it is single-quoted, `'` written `'\''`, which no byte escapes — in
      // POSIX sh. fish reads `\` and `\'` inside single quotes as escapes and csh/tcsh expand `!`
      // (history), so a path with `\` or `!` gets no example either (round 2 review).
      const quoted = `'${path.split("'").join("'\\''")}'`;
      const example = printable(path) === path && !/[\\!]/.test(path)
        ? ` (for example \`cat ${quoted}\`)`
        : '';
      throw new Error(`it is a FIFO with no reader: start the reader first${example}, then write`);
    }
    throw e;
  }
  try {
    const out = await open(path, constants.O_WRONLY);
    try {
      await probe.close();
      probe = undefined;
      await out.writeFile(data);
    } finally {
      await out.close();
    }
  } finally {
    await probe?.close();
  }
}

/**
 * Why a Windows `path` cannot be written as a file by temp and rename, or `null`. Two shapes left
 * debris behind (4.1.x review, security note 3; measured on Windows 11 26300, Bun 1.4.4):
 * - `\\?\C:\x\sub\..\up.txt`: Win32 resolves no `.` or `..` after `\\?\` (a segment named `..` is
 *   no folder), yet Bun's open of the temp name normalised it while its rename and unlink did not,
 *   so `up.txt.<hex>.tmp` stayed beside the target. Node resolves them; both are refused, so one
 *   path means one thing. An empty segment (`\\`) is the same.
 * - `ads.txt:s`, an alternate data stream: opening the temp stream CREATED an empty `ads.txt`, and
 *   renaming a stream is EINVAL. A stream name is refused up front rather than failing after.
 * - Round 2: a `/` anywhere in a `\\?\` path (Bun normalises it on open, Win32 does not), and
 *   EVERY segment after the root is checked, not all but the first (`\\?\..\x`, `\\?\UNC\..\s`).
 */
function windowsPathProblem(path: string): string | null {
  // Round 3: an NT-namespace `\??\` path is no ordinary path either. Bun normalised
  // `\??\UNC\localhost\C$\<dir>\sub\..\u8.txt` on the temp open and not on rename or unlink, and
  // left `u8.txt.<hex>.tmp` (`\??\C:\...` was already refused by the `:` rule below). Refused
  // outright, ahead of every other rule: the same file is written as `C:\...` or `\\?\C:\...`.
  if (path.startsWith('\\??\\')) {
    return 'an NT-namespace \\??\\ path is not supported here: write the path as C:\\... or \\\\?\\C:\\...';
  }
  const verbatim = path.startsWith('\\\\?\\');
  // Win32 reads `\\?\` as "no processing": a `/` is a name character to it, yet Bun normalises it
  // on the temp open and not on the rename (round 2 review: `\\?\W/sub/../fs.txt` left
  // `fs.txt.<hex>.tmp` in W's parent). One refusal covers every such path.
  if (verbatim && path.includes('/')) {
    return 'a `/` in a \\\\?\\ path is not a separator to Windows: write the path with `\\`';
  }
  // Every segment after the root is a name. The root is dropped alone: `X:` (a drive), or `UNC`
  // (its server and share stay and are checked); `C:rel` loses its `C:`.
  const parts = (verbatim ? path.slice(4) : path).split('\\');
  let names = parts;
  if (!verbatim) parts[0] = parts[0]!.replace(/^[A-Za-z]:/, '');
  else if (/^[A-Za-z]:$/.test(parts[0]!) || /^UNC$/i.test(parts[0]!)) {
    names = parts.slice(1);
  }
  if (names.some((x) => x.includes(':'))) {
    return 'an alternate data stream (a `:` in the name) cannot be written here: name a file';
  }
  if (!verbatim) return null;
  const at = names.findIndex(
    (x, i) => x === '.' || x === '..' || (x === '' && i < names.length - 1),
  );
  if (at < 0) return null;
  const what = names[at] === '' ? 'an empty segment' : `a '${names[at]}' segment`;
  return `a \\\\?\\ path with ${what} is not resolved by Windows: write the path without it`;
}

/**
 * Writes `data` to `path`, through `node:fs/promises` loaded on demand, ATOMICALLY: into a fresh
 * file beside the target, then renamed over it. A failure part-way (a full disk, a kill) leaves
 * the old file whole, never half a module (security review round 1, 2026-11-13). A symbolic link
 * is written through, to the file it names, as before. A target that is not a regular file (a
 * device such as `/dev/null`, a pipe, a Windows device name such as `NUL`) is written directly:
 * renaming over it would replace it.
 *
 * What the rename means (review H-3, 2026-11-18): the output is a NEW file, so a hard link to the
 * old one keeps the old contents and its ACL and owner are the directory's defaults (the mode is
 * kept); a kill between the write and the rename leaves `<output>.<8 hex>.tmp` beside it. Where
 * the directory refuses a new file but the existing output is writable, it is overwritten in place
 * (not atomic there), as before atomic writes.
 */
export async function fsWrite(path: string, data: Uint8Array | string): Promise<void> {
  const { lstat, open, readlink, realpath, rename, stat, unlink, writeFile } = await import(
    'node:fs/promises'
  );
  const { dirname, resolve } = await import('node:path');
  const stream = standardStream(path);
  if (stream !== null) return writeStream(stream, data);
  // win-x64 / win-arm64: `\\.\C:\dir\f` is the file `C:\dir\f` (the device namespace resolves `.`,
  // `..` and `/` as a plain path does). Bun 1.4.4 cannot open it (ENOENT) and Node can, so it is
  // written as the plain path on both (round 2 review; measured on Windows 11 26300).
  if (cliProcess().platform === 'win32') {
    // Round 3: the device namespace has no reserved names and trims nothing, so `\\.\D:\dir\nul`
    // is a FILE called `nul` there (Node's raw write makes it), but the plain path `D:\dir\nul` it
    // is rewritten to is the NUL DEVICE (data silently discarded, exit 0; Bun 1.4.4 and Node 24)
    // and `trail. ` loses its dot and space. Such a last name is refused rather than guessed.
    // Round 4: Win32 reads `/` as a separator in a `\\.\` path (only `\\?\` skips that), so
    // `\\.\D:/dir/nul`, `//./D:/dir/nul` and a trailing `\` are the same path and reached the NUL
    // device past the check above. Separators are made one form first, and the last name is
    // taken with any trailing separator removed.
    if (/^[\\/]{2}\.[\\/]/.test(path)) path = `\\\\.\\${path.slice(4).replace(/\//g, '\\')}`;
    const bare = path.replace(/\\+$/, '');
    const last = /^\\\\\.\\[A-Za-z]:\\/.test(path) ? bare.slice(bare.lastIndexOf('\\') + 1) : '';
    if (last !== '' && (WINDOWS_DEVICE.test(last) || /[. ]$/.test(last))) {
      throw new Error(
        'a \\\\.\\ path whose last name is a device name (NUL, CON, COM1 ...) or ends in a dot or ' +
          'space cannot be written here: Windows would take it for the device or trim it, not ' +
          'the file named; write the plain path (a device name) or name the file differently',
      );
    }
    path = path.replace(/^\\\\\.\\([A-Za-z]:)(?=\\)/, '$1');
  }
  // win-x64 / win-arm64: a reserved device name (`NUL`, `CON`, `COM1` …, any case; `/dev/null`
  // as NUL) is a DEVICE, written by its device path. 🔧 `realpath` refused it (EINVAL), so
  // `-o NUL` failed after atomic writes came in (review H-2, 2026-11-18); and written by its plain
  // name, Bun created a FILE named `NUL` (measured on Windows 11 26300), so 3.0.4 never reached
  // the device either. Windows 11 reserves only the bare name: `nul.wasm` is an ordinary file.
  // 🔧 Opened `r+`, not by `writeFile`: Deno 2.9.8 refuses `writeFile` on the device (EISDIR, it
  // opens with create / truncate) and accepts `r+`; Bun 1.4.4 and Node 24 accept both (measured
  // on Windows 11 26300, 2026-11-19, found by `--self-check`, letter H39).
  if (cliProcess().platform === 'win32') {
    const name = await windowsDeviceName(path);
    if (name !== null) {
      let device;
      try {
        device = await open(`\\\\.\\${name}`, 'r+');
      } catch (e) {
        // `CON` with no console attached, a `COM1` that is not there: say which device, and why
        // (4.1.0 notes review: a bare EINVAL).
        const why = e instanceof Error ? e.message : String(e);
        const hint = name === 'CON' ? ' (this process has no console)' : '';
        throw new Error(
          `${path} is the ${name} device, which cannot be opened here${hint}: ${why}`,
        );
      }
      try {
        await device.writeFile(data);
      } finally {
        await device.close();
      }
      return;
    }
  }
  // A device or pipe (`/dev/stdout`, `/dev/null`, a FIFO), links followed: written directly,
  // BEFORE `realpath` — 🔧 `/dev/stdout` is a link to `/proc/self/fd/1`, and when that is a pipe
  // its target has no path, so realpath failed with ENOENT (4.1.0 notes review, linux-x64).
  const direct = await stat(path).catch(() => undefined);
  if (direct !== undefined && !direct.isFile() && !direct.isDirectory()) {
    if (direct.isFIFO()) return writeFifo(path, data);
    await writeFile(path, data);
    return;
  }
  // The path as given is checked BEFORE `realpath`, which fails on some of these (`\\?\UNC\h\.\x`:
  // EUNKNOWN); the target is checked again below, as a link or realpath may have changed it.
  if (cliProcess().platform === 'win32') {
    const problem = windowsPathProblem(path);
    if (problem !== null) throw new Error(problem);
  }
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
  if (cliProcess().platform === 'win32') {
    const problem = windowsPathProblem(target);
    if (problem !== null) throw new Error(problem);
  }
  // Eight hex digits are enough beside one file: a temp name 13 characters longer than the
  // target, not 41 (a long legal name could fail ENAMETOOLONG through the temp name alone).
  const tmp = `${target}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    try {
      await writeFile(tmp, data, mode === undefined ? { flag: 'wx' } : { flag: 'wx', mode });
    } catch (e) {
      // The directory refuses a new file, but the output exists: overwrite it in place, as before
      // atomic writes (review H-3). Its own failure (read-only file) is the error reported.
      const code = (e as { code?: string }).code;
      if (mode !== undefined && (code === 'EACCES' || code === 'EPERM')) {
        await writeFile(target, data);
        return;
      }
      throw e;
    }
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
    // win-x64 / win-arm64 / mac-x64 / mac-arm64: case-insensitive file systems by default (NTFS,
    // exFAT, APFS), so a path differing only in case is the same file there.
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

/**
 * The ONE way a CLI message reaches stderr: every tool, `main.ts` and {@link cliFail} call it, so
 * nothing from the command line or a module acts on the terminal (round 2 review: `unknown option
 * <ESC>[2J`, an option's value, and `wasm-opt`'s error text went out raw). A character that acts
 * when printed is written `\uXXXX` (`core/printable.ts`). With `block`, the text is the tool's
 * own multi-line layout (a diagnostic, a usage, a map): its line breaks and tabs stay.
 */
export function cliError(message: string, block = false): void {
  console.error(printable(message, { keepLines: block }));
}

/**
 * The ONE way a CLI status or progress line reaches stdout (`Wrote WASM: <path>`, a ctor-eval
 * progress line, a bundle report line): the same rules as {@link cliError}, on stdout. A path,
 * a ctor name or an export name inside the line acted on the terminal when printed raw (round 3
 * review). With `block`, the text is the tool's own multi-line layout and keeps its breaks.
 * Not for the module's own output, nor help text: those are not status lines.
 */
export function cliInfo(line: string, block = false): void {
  console.log(printable(line, { keepLines: block }));
}

/**
 * Exit with a one-line `tool: message` on stderr. Never returns. The message is PRINTABLE: a path
 * from the command line, and the system's own error text quoting it (`ENOENT … open '<path>'`),
 * went to the terminal raw, so an ESC in a path acted there (4.1.x review, privacy note; the
 * review process says paths are escaped). Through {@link cliError}.
 */
export function cliFail(tool: string, message: string): never {
  cliError(`${tool}: ${message}`);
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
export function writeStdout(data: Uint8Array | string): Promise<void> {
  return writeStream('stdout', data);
}

/**
 * Output of a CLI tool to stdout, awaited: a write that fails (EPIPE from a reader that left,
 * ENOSPC, EBADF) is a one-line `tool: cannot write standard output: …` and exit 1, as a file write
 * is. 🔧 Through 4.1.2 `-o -` in wasm-bundle, wasm-ctor-eval and wasm-opt called an unawaited
 * `stdout.write` with no handler (4.1.0 notes review, Q-H4). A string gets no newline added.
 */
export async function cliWriteStdout(tool: string, data: Uint8Array | string): Promise<void> {
  try {
    await writeStdout(data);
  } catch (e) {
    cliFail(tool, `cannot write standard output: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** One line of {@link selfCheck}'s report. */
export interface SelfCheckResult {
  /** What was tried, in a few words. */
  readonly operation: string;
  /**
   * `ok` or `FAIL`, nothing else (owner, 2026-11-19: "no skips to track"): an operation the
   * machine will not let it try is a FAIL, with the reason.
   */
  readonly status: 'ok' | 'FAIL';
  /** Why it failed. */
  readonly detail?: string;
}

/**
 * Tries each of this module's operations on the machine it runs on, in a fresh temp folder that it
 * removes afterwards, and returns one result per operation (letter H39 (3): "only when asked, and
 * it cleans up after itself"). Run as `binaryang --self-check`; nothing else calls it.
 */
export async function selfCheck(
  /** For the tests: stands in for `symlink`, to make the machine refuse a link. */
  testing: { symlink?: (target: string, link: string) => Promise<void> } = {},
): Promise<SelfCheckResult[]> {
  const fsp = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const platform = cliProcess().platform;
  const results: SelfCheckResult[] = [];
  const same = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((x, i) => x === b[i]);
  const attempt = async (operation: string, run: () => Promise<string | true>) => {
    try {
      const r = await run();
      results.push(
        r === true ? { operation, status: 'ok' } : { operation, status: 'FAIL', detail: r },
      );
    } catch (e) {
      results.push({
        operation,
        status: 'FAIL',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  };

  let dir: string;
  try {
    dir = await fsp.mkdtemp(join(tmpdir(), 'binaryang-self-check-'));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return [{ operation: 'make a temp folder', status: 'FAIL', detail }];
  }
  results.push({ operation: 'make a temp folder', status: 'ok' });
  try {
    const a = join(dir, 'a.wasm');
    const one = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
    const two = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 1, 0]);

    await attempt('write a new file', async () => {
      await fsWrite(a, one);
      return same(await fsRead(a), one) || 'the bytes read back differ';
    });
    await attempt('replace a file whole, no temp file left', async () => {
      await fsWrite(a, two);
      if (!same(await fsRead(a), two)) return 'the bytes read back differ';
      const left = (await fsp.readdir(dir)).filter((n) => n.endsWith('.tmp'));
      return left.length === 0 || `left behind: ${left.join(', ')}`;
    });
    await attempt('write text', async () => {
      const t = join(dir, 't.wat');
      await fsWrite(t, '(module)\n');
      return (await fsp.readFile(t, 'utf8')) === '(module)\n' || 'the text read back differs';
    });
    await attempt('refuse to read a folder', async () => {
      const refused = await fsRead(dir).then(() => false, () => true);
      return refused || 'a folder was read as a file';
    });
    await attempt('refuse a file over the input limit', async () => {
      const refused = await fsRead(a, 4).then(() => false, () => true);
      return refused || 'an 11-byte file passed a 4-byte limit';
    });
    await attempt('know one file by two names', async () => {
      const b = join(dir, 'b.wasm');
      await fsWrite(b, one);
      if (!(await sameFile(a, a))) return 'a file is not the same as itself';
      if (await sameFile(a, b)) return 'two files read as one';
      if (await sameFile(a, join(dir, 'missing.wasm'))) return 'a missing file read as present';
      // win-x64 / win-arm64 / mac-x64 / mac-arm64: the case variant is the same file there.
      if (platform === 'win32' || platform === 'darwin') {
        if (!(await sameFile(a, join(dir, 'A.WASM')))) return `'A.WASM' is not 'a.wasm' here`;
      }
      return true;
    });
    await attempt('write through a symbolic link', async () => {
      const target = join(dir, 'target.wasm');
      const link = join(dir, 'link.wasm');
      await fsWrite(target, one);
      try {
        await (testing.symlink ?? fsp.symlink)(target, link);
      } catch (e) {
        const code = (e as { code?: string }).code;
        // win-x64 / win-arm64: a symbolic link needs Developer Mode or an administrator.
        if (code !== 'EPERM' && code !== 'EACCES') throw e;
        return `this account may not make a symbolic link (${code}), so writing through one ` +
          'was not tried; on Windows, turn on Developer Mode or run as an administrator';
      }
      await fsWrite(link, two);
      if (!(await fsp.lstat(link)).isSymbolicLink()) return 'the link was replaced by a file';
      return same(await fsRead(target), two) || 'the linked file was not written';
    });
    await attempt('write to the null device', async () => {
      // win-x64 / win-arm64: NUL; elsewhere /dev/null.
      await fsWrite(platform === 'win32' ? 'NUL' : '/dev/null', one);
      return true;
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  await attempt('remove the temp folder', async () => {
    const gone = await fsp.stat(dir).then(() => false, () => true);
    return gone || 'it is still there';
  });
  return results;
}

/** `binaryang --self-check`: prints {@link selfCheck}'s report; exits 1 if anything failed. */
export async function cliSelfCheck(version: string): Promise<void> {
  const p = cliProcess();
  const v = p.versions as { bun?: string; deno?: string; node?: string };
  const runtime = v.bun ? `Bun ${v.bun}` : v.deno ? `Deno ${v.deno}` : `Node ${v.node}`;
  console.log(`binaryang ${version} self-check: ${p.platform}-${p.arch}, ${runtime}`);
  const results = await selfCheck();
  for (const r of results) {
    const why = r.detail === undefined ? '' : ` — ${r.detail}`;
    console.log(`  ${r.status.padEnd(4)} ${r.operation}${why}`);
  }
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(
    failed === 0 ? 'every host operation works here' : `${failed} host operation(s) failed`,
  );
  if (failed > 0) cliExit(1);
}
