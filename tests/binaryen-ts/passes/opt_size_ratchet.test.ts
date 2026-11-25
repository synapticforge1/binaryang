// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
/**
 * `scripts/opt-size.ts` `judge`: the wasm-opt size ratchet (review C-R2-2). Growth past the
 * baseline fails; a gain fails too until it is recorded, so it cannot be given back unseen.
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  binaryenSize,
  judge,
  judgeRun,
  refusedChanges,
  requireSix,
  type SizeEntry,
  WASM_OPT_MAX_BUFFER,
  WASM_OPT_TIMEOUT_MS,
  type WasmOptRun,
} from '../../../scripts/opt-size.ts';

const base: SizeEntry = { ours: 1010, binaryen: 1000, modules: 3, refused: ['x'] };
const run = (now: SizeEntry) => {
  const fails: string[] = [];
  const notes: string[] = [];
  judge('set', now, base, fails, notes);
  return { fails, notes };
};

describe('size ratchet judge', () => {
  it('passes at the baseline ratio', () => {
    expect(run({ ...base, ours: 2020, binaryen: 2000 }).fails).toEqual([]);
  });
  it('fails when binaryang grows past the ratio', () => {
    const { fails } = run({ ...base, ours: 1011 });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('GREW');
  });
  it('fails on a gain until it is recorded, naming the command', () => {
    const { fails } = run({ ...base, ours: 1009 });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('SMALLER');
    expect(fails[0]).toContain('--update-baseline');
  });
  it('fails when binaryen refuses a different set of modules', () => {
    expect(run({ ...base, refused: [] }).fails).toHaveLength(1);
  });
  it('fails with no baseline entry', () => {
    const fails: string[] = [];
    judge('set', base, undefined, fails, []);
    expect(fails[0]).toContain('no baseline entry');
  });
});

const ran = (over: Partial<WasmOptRun>): WasmOptRun => ({
  status: 0,
  signal: null,
  stdout: '',
  stderr: '',
  ...over,
});

describe('judgeRun: a refusal is exit 1 with a message, nothing else', () => {
  it('exit 0 is taken', () => expect(judgeRun(ran({}), 'm')).toBe('ok'));
  it('exit 1 with a message is a refusal', () => {
    expect(judgeRun(ran({ status: 1, stderr: 'Fatal: error parsing wasm' }), 'm')).toBe('refused');
  });
  it('a signal (kill, OOM) throws, naming the module, never "refused"', () => {
    expect(() => judgeRun(ran({ status: null, signal: 'SIGKILL' }), 'big.wasm (-Oz)')).toThrow(
      'big.wasm (-Oz) was ended by SIGKILL',
    );
  });
  it('ENOBUFS and the time limit throw, naming the module', () => {
    const err = (code: string) => Object.assign(new Error(code), { code });
    expect(() => judgeRun(ran({ status: null, error: err('ENOBUFS') }), 'a.wasm')).toThrow(
      'wasm-opt on a.wasm did not finish (ENOBUFS',
    );
    expect(() => judgeRun(ran({ status: null, error: err('ETIMEDOUT') }), 'a.wasm')).toThrow(
      'wasm-opt on a.wasm did not finish (ETIMEDOUT',
    );
  });
  it('exit 1 with nothing said, or another exit code, throws', () => {
    expect(() => judgeRun(ran({ status: 1 }), 'm')).toThrow(/no message/);
    expect(() => judgeRun(ran({ status: 137, stderr: 'x' }), 'm')).toThrow(/exited 137/);
  });
});

describe('binaryenSize runs wasm-opt bounded and does not turn a failed run into a refusal', () => {
  const inTmp = <T>(body: (dir: string) => T): T => {
    const dir = mkdtempSync(join(tmpdir(), 'opt-size-test-'));
    try {
      return body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const fake = (r: Partial<WasmOptRun>, seen: Record<string, unknown>[] = []) =>
    ((_cmd: string, _args: readonly string[], opts: Record<string, unknown>) => {
      seen.push(opts);
      return ran(r);
    }) as unknown as typeof import('node:child_process').spawnSync;

  it('a timeout names the limit that was USED, not the default', () => {
    const timedOut = { status: null, error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) };
    expect(() => judgeRun(ran(timedOut), 'a.wasm', 1500)).toThrow('it ran past 1.5 s');
    expect(() => judgeRun(ran(timedOut), 'a.wasm')).toThrow(
      `it ran past ${WASM_OPT_TIMEOUT_MS / 1000} s`,
    );
    const seen: Record<string, unknown>[] = [];
    inTmp((dir) => {
      expect(() => binaryenSize(dir, new Uint8Array(8), '-Oz', 'm', fake(timedOut, seen), 2000))
        .toThrow('it ran past 2 s');
    });
    expect(seen[0]!['timeout']).toBe(2000);
  });
  it('sets a timeout and a maxBuffer', () => {
    const seen: Record<string, unknown>[] = [];
    inTmp((dir) => {
      expect(
        binaryenSize(dir, new Uint8Array(8), '-Oz', 'm', fake({ status: 1, stderr: 'no' }, seen)),
      ).toBeUndefined();
    });
    expect(seen[0]!['timeout']).toBe(WASM_OPT_TIMEOUT_MS);
    expect(seen[0]!['maxBuffer']).toBe(WASM_OPT_MAX_BUFFER);
  });
  it('each run writes its own input file, never reusing one (EBUSY on Windows, the gate)', () => {
    const inputs: string[] = [];
    const record = ((_cmd: string, args: readonly string[]) => {
      inputs.push(args[0]!);
      return ran({ status: 1, stderr: 'no' });
    }) as unknown as typeof import('node:child_process').spawnSync;
    inTmp((dir) => {
      binaryenSize(dir, new Uint8Array(8), '-Oz', 'a', record);
      binaryenSize(dir, new Uint8Array(8), '-Oz', 'b', record);
    });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).not.toBe(inputs[1]);
  });
  it('a write that throws is reported as is, its cleanup hiding nothing (round 8)', () => {
    // The input write is inside the try (round 7): when it throws, the finally's removals run
    // and must not hide the write's own error. `dir` here is a FILE, so the write is ENOTDIR.
    inTmp((dir) => {
      const notADir = join(dir, 'file');
      writeFileSync(notADir, 'x');
      expect(() => binaryenSize(notADir, new Uint8Array(8), '-Oz', 'a', fake({ status: 0 })))
        .toThrow(/ENOTDIR|ENOENT|EEXIST/);
      expect(readdirSync(dir)).toEqual(['file']);
    });
  });
  it("each run's files are removed when it is done, not left for the end (round 6)", () => {
    inTmp((dir) => {
      binaryenSize(dir, new Uint8Array(8), '-Oz', 'a', fake({ status: 1, stderr: 'no' }));
      expect(readdirSync(dir)).toEqual([]);
    });
  });
  it('a killed run throws, naming the module', () => {
    inTmp((dir) => {
      expect(() =>
        binaryenSize(
          dir,
          new Uint8Array(8),
          '-O2',
          'rustc.wasm',
          fake({ status: null, signal: 'SIGKILL' }),
        )
      ).toThrow(/rustc.wasm/);
    });
  });
});

describe('the module set and the refused set are not recorded blindly', () => {
  it('requireSix throws unless there are six', () => {
    expect(() => requireSix(['a', 'b'])).toThrow(/found 2/);
    expect(() => requireSix(['a', 'b', 'c', 'd', 'e', 'f'])).not.toThrow();
  });
  it('the corpus script calls requireSix and exits, before any recording', () => {
    const src = readFileSync('scripts/check-optimize-corpus.ts', 'utf8');
    expect(src).toContain('requireSix(sixInputs.map((i) => i.name));');
    expect(src.indexOf('requireSix(')).toBeLessThan(src.indexOf('if (update)'));
  });
  it('no process.exit sits between the scratch folder and its removal (the `finally` would be skipped)', () => {
    const src = readFileSync('scripts/check-optimize-corpus.ts', 'utf8');
    const from = src.indexOf('const tmp = scratch();');
    const to = src.indexOf('tmp.done();', from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    expect(src.slice(from, to)).not.toContain('process.exit');
    // ...and the six-module problem is still reported, after the folder is gone.
    expect(src.indexOf('sixProblem !== undefined', to)).toBeGreaterThan(to);
  });
  it('refusedChanges names a refusal that appeared or went; none for an equal set or no baseline', () => {
    const b = {
      binaryen: 'v',
      entries: { s: { ours: 1, binaryen: 1, modules: 1, refused: ['x'] } },
    };
    const e = (refused: string[]) => ({ s: { ours: 1, binaryen: 1, modules: 1, refused } });
    expect(refusedChanges(e(['x']), b)).toEqual([]);
    expect(refusedChanges(e(['x', 'y']), b)).toHaveLength(1);
    expect(refusedChanges(e([]), b)[0]).toContain('s: refused []');
    expect(refusedChanges(e(['y']), undefined)).toEqual([]);
  });
  it('the corpus script gates --update-baseline on the refused set and the explicit flag', () => {
    const src = readFileSync('scripts/check-optimize-corpus.ts', 'utf8');
    expect(src).toContain("process.argv.includes('--accept-refused-change')");
    expect(src.indexOf('refusedChanges(')).toBeLessThan(src.indexOf('writeFileSync(BASELINE'));
  });
});
