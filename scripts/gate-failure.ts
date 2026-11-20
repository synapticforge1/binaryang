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
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A line a test runner prints for one failing test (Bun, Node's spec and TAP reporters). */
const FAILING = /^(\(fail\)|✖|not ok\b)/;

/** At most this many failing lines go in the row; the log has the rest. */
export const MAX_NAMED = 5;

/**
 * Writes a failed step's full output to `<dir>/<step>.log` (made if missing). Returns the row's
 * text — the failing lines the runners marked (up to {@link MAX_NAMED}, ` | `-joined), else the
 * last three lines — and the log's path, printed on a line of its own (rows are cut at 200 chars).
 */
export function keepFailure(
  dir: string,
  step: string,
  stdout: string,
  stderr: string,
): { tail: string; log: string } {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `${step.replace(/[^A-Za-z0-9._-]+/g, '-')}.log`);
  writeFileSync(log, `$ ${step}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
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
