/**
 * `scripts/run-bounded.ts`: a time limit that ends the whole process tree. `spawnSync`'s own
 * `timeout` kills the direct child alone; the previous-tests harness runs `fnm exec … node --test`,
 * whose node and per-file test processes outlived it (review, 2026-11-20, measured on win-x64).
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { runBounded } from '../../../scripts/run-bounded.ts';

/** Whether a process is still alive (signal 0 tests, sends nothing). */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('runBounded', () => {
  it('reports an ordinary exit code, not a timeout', () => {
    const r = runBounded(process.execPath, ['-e', 'process.exit(3)'], { limitMs: 60_000 });
    expect(r).toEqual({ status: 3, timedOut: false });
  });

  it('at the limit, the WHOLE tree ends: the child and the grandchild it started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-bounded-'));
    try {
      const pids = join(dir, 'pids.json');
      // The grandchild is one the plain timeout cannot reach: on win32 detached (out of the
      // runtime's own job), elsewhere an ordinary child (a kill of its parent leaves it running).
      const parent = join(dir, 'parent.js');
      writeFileSync(
        parent,
        `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
  detached: process.platform === 'win32',
});
writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ parent: process.pid, grandchild: g.pid }));
setInterval(() => {}, 1000);
`,
      );
      const r = runBounded(process.execPath, [parent], { limitMs: 3_000 });
      expect(r).toEqual({ status: null, timedOut: true });
      const { parent: p, grandchild: g } = JSON.parse(readFileSync(pids, 'utf8')) as {
        parent: number;
        grandchild: number;
      };
      // A moment for the OS to finish the kill.
      for (let i = 0; i < 20 && (alive(p) || alive(g)); i++) {
        await new Promise((res) => setTimeout(res, 100));
      }
      const left = [p, g].filter(alive);
      for (const pid of left) process.kill(pid); // never leave one behind, even when this fails
      expect(left).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a command that cannot start is no timeout and no exit code', () => {
    expect(runBounded('no-such-command-binaryang', [], { limitMs: 10_000 })).toEqual({
      status: null,
      timedOut: false,
    });
  });
});
