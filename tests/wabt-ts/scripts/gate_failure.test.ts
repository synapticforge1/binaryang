// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
/**
 * `scripts/gate-failure.ts`: a failed gate step names its failing tests and keeps its whole output
 * (review Q-H6, 2026-11-20). The gate printed a failure's last three lines only — on `test:bun` the
 * totals — so a test that failed in 2 of 4 runs of v4.1.1's release gate was never named.
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  FAILURE_PREFIX,
  KEEP_RUNS,
  keepFailure,
  makeFailureDir,
  MAX_NAMED,
  pruneFailureDirs,
} from '../../../scripts/gate-failure.ts';

/** Runs `body` with a fresh folder, removed after. */
function inDir(body: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-failure-'));
  try {
    body(join(dir, 'failures'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('keepFailure', () => {
  it("names Bun's failing test, not the totals that end the output", () => {
    inDir((dir) => {
      const stderr = [
        'tests/a.test.ts:',
        '(pass) a > one [2.00ms]',
        '(fail) a > coalesce at the budget [20700.00ms]',
        '(pass) a > two',
        ' 4101 pass',
        ' 1 fail',
        'Ran 4102 tests across 400 files. [120.00s]',
      ].join('\n');
      const { tail, log } = keepFailure(dir, 'test:bun', '', stderr);
      expect(tail).toBe('(fail) a > coalesce at the budget [20700.00ms]');
      expect(log).toBe(join(dir, 'test-bun.log'));
      const kept = readFileSync(log, 'utf8');
      expect(kept).toContain(stderr);
      expect(kept).toContain('$ test:bun');
    });
  });

  it("names Node's failing tests (spec reporter ✖, TAP not ok), each once", () => {
    inDir((dir) => {
      const stdout = '✔ fine\n✖ breaks (3ms)\nnot ok 7 - also breaks\n✖ breaks (3ms)\nℹ fail 2';
      const { tail } = keepFailure(dir, 'test', stdout, '');
      expect(tail).toBe('✖ breaks (3ms) | not ok 7 - also breaks');
    });
  });

  it('shows at most MAX_NAMED failing lines and counts the rest', () => {
    inDir((dir) => {
      const out = Array.from({ length: MAX_NAMED + 3 }, (_, i) => `(fail) t${i}`).join('\n');
      const { tail } = keepFailure(dir, 'test:bun', out, '');
      expect(tail.split(' | ')).toHaveLength(MAX_NAMED + 1);
      expect(tail.endsWith('… 3 more')).toBe(true);
    });
  });

  it('with no marked line, falls back to the last three lines', () => {
    inDir((dir) => {
      const { tail } = keepFailure(dir, 'lint', 'a\nb\n\nc\nd\n', 'e');
      expect(tail).toBe('c | d | e');
    });
  });

  it('never overwrites what is at the log name (flag wx): the log takes a suffix', () => {
    inDir((dir) => {
      mkdirSync(dir);
      const victim = join(dir, 'lint.log');
      writeFileSync(victim, 'precious');
      const { log } = keepFailure(dir, 'lint', 'out', '');
      expect(readFileSync(victim, 'utf8')).toBe('precious');
      expect(log).toBe(join(dir, 'lint-2.log'));
      expect(readFileSync(log, 'utf8')).toContain('out');
    });
  });

  it('writes the log private (0600) and the folder private (0700) where the OS has modes', () => {
    inDir((dir) => {
      const { log } = keepFailure(dir, 'lint', 'out', '');
      if (process.platform === 'win32') return; // no POSIX modes to read
      expect(statSync(log).mode & 0o077).toBe(0);
      expect(statSync(dir).mode & 0o077).toBe(0);
    });
  });

  it('makeFailureDir makes a fresh, unguessable folder per run, private where modes exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gate-failure-tmp-'));
    try {
      const a = makeFailureDir(tmp);
      const b = makeFailureDir(tmp);
      expect(a).not.toBe(b);
      expect(a.startsWith(join(tmp, FAILURE_PREFIX))).toBe(true);
      expect(a).not.toBe(join(tmp, FAILURE_PREFIX.slice(0, -1))); // not the old fixed name
      if (process.platform !== 'win32') expect(statSync(a).mode & 0o077).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('pruneFailureDirs keeps the newest KEEP_RUNS folders and touches nothing else', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gate-failure-tmp-'));
    try {
      const total = KEEP_RUNS + 2;
      for (let i = 0; i < total; i++) {
        const d = join(tmp, `${FAILURE_PREFIX}${i}`);
        mkdirSync(d);
        writeFileSync(join(d, 'x.log'), 'x');
        utimesSync(d, 1_000_000 + i, 1_000_000 + i); // i = 0 is the oldest
      }
      const plainFile = join(tmp, `${FAILURE_PREFIX}file`); // not a directory: left alone
      writeFileSync(plainFile, 'keep me');
      utimesSync(plainFile, 1, 1);
      mkdirSync(join(tmp, 'other-folder')); // another name: left alone
      const removed = pruneFailureDirs(tmp);
      expect(removed.map((r) => r.slice(tmp.length + 1)).sort()).toEqual([
        `${FAILURE_PREFIX}0`,
        `${FAILURE_PREFIX}1`,
      ]);
      const left = readdirSync(tmp);
      expect(left).toContain(`${FAILURE_PREFIX}file`);
      expect(left).toContain('other-folder');
      expect(left.filter((n) => /\d$/.test(n) && n.startsWith(FAILURE_PREFIX))).toHaveLength(
        KEEP_RUNS,
      );
      expect(existsSync(plainFile)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the gate uses a per-run folder, prunes at start, and prints the log path on its own line', () => {
    const gate = readFileSync('scripts/gate.ts', 'utf8');
    expect(gate).toContain('failures ??= makeFailureDir(),');
    expect(gate).toContain('pruneFailureDirs();');
    expect(gate).not.toContain("'binaryang-gate-failures'"); // the old fixed, shared name
    expect(gate).toMatch(/if \(log !== ''\) console\.log\(` {5}full output: \$\{log\}`\);/);
  });
});
