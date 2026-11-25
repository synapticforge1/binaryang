// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module scripts/gate-failure
 *
 * What the gate keeps of a FAILED step (review Q-H6, 2026-11-20). The gate prints one line per
 * step, and printed a failure's last three output lines only: on `test:bun` those are the totals,
 * so a failing test was never named (v4.1.1's release, 2 of 4 runs). Now the step's whole output
 * is written to a log that outlives the gate, the row names the log, and the row carries the
 * failing lines the test runners mark (Bun's `(fail)`, Node's `✖` / `not ok`) before the tail.
 *
 * The logs hold full output (absolute paths, the user name), so they live in a folder made for ONE
 * run by `mkdtempSync` (mode 0700, a name nobody can plant), each log is created with flag `wx`
 * (mode 0600: a planted link or file is an error, never followed), and the folders of earlier runs
 * are pruned at the next gate start: a failing run's folder is kept at most 7 days AND only the
 * {@link KEEP_RUNS} newest are kept, the run in progress included (security + privacy review).
 */

import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/** A line a test runner prints for one failing test (Bun, Node's spec and TAP reporters). */
const FAILING = /^(\(fail\)|✖|not ok\b)/;

/** At most this many failing lines go in the row; the log has the rest. */
export const MAX_NAMED = 5;

/** The prefix of a run's failure folder inside the shared temp dir. */
export const FAILURE_PREFIX = 'binaryang-gate-failures-';

/** At most this many failing-run folders exist after a gate starts, the current run's included. */
export const KEEP_RUNS = 5;

/** A failing-run folder older than this is removed at the next gate start, however few there are. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The folder the first version of this module used: fixed name, no suffix, world-readable on POSIX. */
export const OLD_FIXED_NAME = 'binaryang-gate-failures';

/** Makes this run's private failure folder (0700 by construction) and returns its path. */
export function makeFailureDir(tmp: string = tmpdir()): string {
  return mkdtempSync(join(tmp, FAILURE_PREFIX));
}

/**
 * Removes this user's failure folders that are older than {@link MAX_AGE_MS}, then all but the
 * newest `keep` (default {@link KEEP_RUNS} - 1: this run's folder is the last of the
 * {@link KEEP_RUNS}), and the OLD fixed-name folder ({@link OLD_FIXED_NAME}) wherever it is. Only a
 * real directory (`lstat`, so a link is never followed or removed through) owned by this uid (where
 * the OS has uids) is touched; anything else is left alone. Returns the removed paths. NEVER
 * fatal to the gate: a folder that cannot be removed is skipped, and a failure to read the temp
 * dir at all prints one line and returns what was removed so far.
 */
export function pruneFailureDirs(
  tmp: string = tmpdir(),
  keep: number = KEEP_RUNS - 1,
  now: number = Date.now(),
): string[] {
  const removed: string[] = [];
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    const mine: { path: string; mtime: number }[] = [];
    for (const name of readdirSync(tmp)) {
      const old = name === OLD_FIXED_NAME;
      if (!old && !name.startsWith(FAILURE_PREFIX)) continue;
      const path = join(tmp, name);
      try {
        const st = lstatSync(path);
        if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue;
        if (old) {
          rmSync(path, { recursive: true, force: true });
          removed.push(path);
        } else mine.push({ path, mtime: st.mtimeMs });
      } catch { /* gone, not ours to read, or not removable: leave it */ }
    }
    mine.sort((a, b) => b.mtime - a.mtime);
    mine.forEach(({ path, mtime }, n) => {
      if (n < keep && now - mtime <= MAX_AGE_MS) return;
      try {
        rmSync(path, { recursive: true, force: true });
        removed.push(path);
      } catch { /* not removable: leave it */ }
    });
  } catch (e) {
    console.log(`gate: could not prune old failure logs in ${tmp}: ${(e as Error).message}`);
  }
  return removed;
}

/**
 * Writes a failed step's full output to a NEW `<dir>/<step>.log` (`dir` made if missing; an
 * existing file or link at the name is left alone, never followed: the log takes a
 * numeric suffix). Returns the row's text — the failing lines the runners marked (up to
 * {@link MAX_NAMED}, ` | `-joined), else the last three lines — and the log's path, printed on a
 * line of its own (rows are cut at 200 chars).
 */
export function keepFailure(
  dir: string,
  step: string,
  stdout: string,
  stderr: string,
): { tail: string; log: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = step.replace(/[^A-Za-z0-9._-]+/g, '-');
  const text = `$ ${step}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`;
  let log = join(dir, `${base}.log`);
  // 'wx' never overwrites and never follows a planted link; a name clash gets a suffix.
  for (let n = 2;; n++) {
    try {
      writeFileSync(log, text, { flag: 'wx', mode: 0o600 });
      break;
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST' || n > 99) throw e;
      log = join(dir, `${base}-${n}.log`);
    }
  }
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const failing = [...new Set(lines.filter((l) => FAILING.test(l)))];
  const shown = failing.length > 0
    ? [
      ...failing.slice(0, MAX_NAMED),
      ...(failing.length > MAX_NAMED ? [`… ${failing.length - MAX_NAMED} more`] : []),
    ]
    : lines.slice(-3);
  return { tail: shown.join(' | '), log };
}
