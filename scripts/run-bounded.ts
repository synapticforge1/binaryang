/**
 * @module scripts/run-bounded
 *
 * Runs a command under a time limit that ends its WHOLE process tree, not only its first process.
 *
 * `spawnSync`'s own `timeout` kills the direct child alone. Through `fnm exec … node --test`, that
 * is fnm: node and node's per-file test processes kept running, holding the work tree a hung old
 * test was in (review of the previous-tests harness, 2026-11-20, measured on win-x64). A tree is
 * ended while its root is still alive — after, Windows finds no children to follow.
 *
 * Synchronous for its callers: `runBounded()` runs THIS file as a child, which spawns the command
 * and, at the limit, kills the tree (`taskkill /T /F` on win32; the process group, made with
 * `detached`, elsewhere), then reports `{ status, timedOut, failed? }` as one line of JSON.
 * Interrupted or terminated itself, it kills the tree first; a run that could not start says why
 * in `failed`, never as a timeout.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * How a bounded run ended: its exit code (null when killed or not started), whether by the limit,
 * and — when the command or this helper could not run at all — why (`failed`), so a start
 * failure is never reported as a run that "did not finish".
 */
export interface Bounded {
  status: number | null;
  timedOut: boolean;
  failed?: string;
}

/** Runs `cmd args` in `cwd` with `env`; past `limitMs` its whole tree is killed. Blocks until done. */
export function runBounded(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; limitMs: number },
): Bounded {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: opts.cwd,
    env: opts.env,
    input: JSON.stringify({ cmd, args, limitMs: opts.limitMs }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    // The helper itself is bounded too: it ends a minute after the limit at the latest.
    timeout: opts.limitMs + 60_000,
  });
  const last = (r.stdout ?? '').trim().split('\n').pop() ?? '';
  try {
    const b = JSON.parse(last) as Bounded;
    if (typeof b.timedOut === 'boolean') return b;
  } catch { /* no report: the helper itself failed or was killed */ }
  // The helper's own limit is ETIMEDOUT; anything else is a helper that could not run.
  const code = (r.error as { code?: string } | undefined)?.code;
  if (code === 'ETIMEDOUT') return { status: null, timedOut: true };
  return {
    status: null,
    timedOut: false,
    failed: r.error?.message ?? `the bounded-run helper exited ${r.status} with no report`,
  };
}

/** Kills a process and every descendant it still has. */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // By its full path: found through PATH, a `taskkill.exe` in the working folder would run.
    const taskkill = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    spawnSync(taskkill, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 30_000 });
  } else {
    try {
      process.kill(-pid, 'SIGKILL'); // the group `detached` made
    } catch { /* already gone */ }
  }
}

if (import.meta.main) {
  const { cmd, args, limitMs } = JSON.parse(readFileSync(0, 'utf8')) as {
    cmd: string;
    args: string[];
    limitMs: number;
  };
  const report = (b: Bounded) => {
    process.stdout.write(`${JSON.stringify(b)}\n`);
    process.exit(0);
  };
  const child = spawn(cmd, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) killTree(child.pid);
  }, limitMs);
  // Interrupted or terminated itself (a Ctrl-C, the caller's own end): the tree goes first. On
  // POSIX it is in its own group, so a terminal's Ctrl-C would not reach it otherwise (review,
  // 2026-11-20, measured on linux-x64).
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (child.pid !== undefined) killTree(child.pid);
      process.exit(130);
    });
  }
  child.on('error', (e) => {
    clearTimeout(timer);
    report({ status: null, timedOut: false, failed: e.message });
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    report({ status: timedOut ? null : code, timedOut });
  });
}
