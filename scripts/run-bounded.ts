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
 * `detached`, elsewhere), then reports `{ status, timedOut }` as one line of JSON.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** How a bounded run ended: its exit code (null when killed or not started), and whether by the limit. */
export interface Bounded {
  status: number | null;
  timedOut: boolean;
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
  return { status: null, timedOut: r.error !== undefined };
}

/** Kills a process and every descendant it still has. */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
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
  child.on('error', () => {
    clearTimeout(timer);
    report({ status: null, timedOut: false });
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    report({ status: timedOut ? null : code, timedOut });
  });
}
