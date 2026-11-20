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
 * are pruned to the last {@link KEEP_RUNS} at the next gate start (security + privacy review).
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

/** Folders of earlier gate runs kept; older ones are removed at the next gate start. */
export const KEEP_RUNS = 5;

/** Makes this run's private failure folder (0700 by construction) and returns its path. */
export function makeFailureDir(tmp: string = tmpdir()): string {
  return mkdtempSync(join(tmp, FAILURE_PREFIX));
}

/**
 * Removes this user's failure folders of earlier runs, keeping the newest {@link KEEP_RUNS}. Only
 * a real directory (`lstat`, so a link is never followed or removed through) owned by this uid
 * (where the OS has uids) is touched; anything else with the prefix is left alone. Returns the
 * removed paths. A folder that cannot be removed is skipped, never fatal to the gate.
 */
export function pruneFailureDirs(tmp: string = tmpdir(), keep: number = KEEP_RUNS): string[] {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const mine: { path: string; mtime: number }[] = [];
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith(FAILURE_PREFIX)) continue;
    const path = join(tmp, name);
    try {
      const st = lstatSync(path);
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue;
      mine.push({ path, mtime: st.mtimeMs });
    } catch { /* gone, or not ours to read */ }
  }
  mine.sort((a, b) => b.mtime - a.mtime);
  const removed: string[] = [];
  for (const { path } of mine.slice(keep)) {
    try {
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    } catch { /* not removable: leave it */ }
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
