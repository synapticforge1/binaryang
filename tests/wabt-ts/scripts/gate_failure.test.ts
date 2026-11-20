/**
 * `scripts/gate-failure.ts`: a failed gate step names its failing tests and keeps its whole output
 * (review Q-H6, 2026-11-20). The gate printed a failure's last three lines only — on `test:bun` the
 * totals — so a test that failed in 2 of 4 runs of v4.1.1's release gate was never named.
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepFailure, MAX_NAMED } from '../../../scripts/gate-failure.ts';

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

  it('the gate prints the log path on its own line, never cut with the row', () => {
    const gate = readFileSync('scripts/gate.ts', 'utf8');
    expect(gate).toContain('keepFailure(failures, name,');
    expect(gate).toMatch(/if \(log !== ''\) console\.log\(` {5}full output: \$\{log\}`\);/);
  });
});
