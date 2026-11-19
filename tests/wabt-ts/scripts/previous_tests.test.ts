/**
 * The compatibility gate's behaviour check (workspace letter H6, rule 3;
 * `scripts/release/previous-tests.ts`): reading node:test's JUnit report, and judging its failures
 * against `tests/accepted-changes.json`. Pure: a hand-written report, no test run.
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';
import { failuresIn, gateHolds, judge } from '../../../scripts/release/previous-tests.ts';

const report = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="the IR">
    <testcase name="keeps a name" time="0.1" classname="test" file="C:\\tmp\\x\\tests\\ir\\a.test.ts">
    </testcase>
    <testcase name="folds &quot;i32.add&quot; &amp; drops" time="0.2" classname="test" file="/tmp/x/tests/ir/a.test.ts">
      <failure type="testCodeFailure" message="expected 1">boom</failure>
    </testcase>
    <testcase name="emits -Oz bytes" time="0.3" classname="test" file="/tmp/x/tests/binaryen-ts/passes/b.test.ts">
      <failure type="testCodeFailure" message="moved">moved</failure>
    </testcase>
  </testsuite>
</testsuites>`;

describe('failuresIn: the failing testcases of a node:test JUnit report', () => {
  it('finds only the failures, tree-relative, with entities decoded', () => {
    expect(failuresIn(report)).toEqual([
      { file: 'tests/ir/a.test.ts', name: 'folds "i32.add" & drops' },
      { file: 'tests/binaryen-ts/passes/b.test.ts', name: 'emits -Oz bytes' },
    ]);
  });
  it('a report with no failure has none', () => {
    expect(
      failuresIn('<testsuites><testcase name="a" file="tests/x.test.ts"></testcase></testsuites>'),
    ).toEqual([]);
  });
});

describe('judge: failures against the accepted list', () => {
  const failures = failuresIn(report);
  const moved = {
    file: 'tests/binaryen-ts/passes/b.test.ts',
    name: 'emits -Oz bytes',
    since: '1.16.0',
    reason: 'a new pass',
  };
  it('an unlisted failure is unexpected — the gate fails on it', () => {
    const j = judge(failures, [moved]);
    expect(j.unexpected).toEqual([{ file: 'tests/ir/a.test.ts', name: 'folds "i32.add" & drops' }]);
    expect(j.accepted).toEqual([{ file: moved.file, name: moved.name }]);
  });
  it('with every failure listed, nothing is unexpected', () => {
    const both = [moved, {
      file: 'tests/ir/a.test.ts',
      name: 'folds "i32.add" & drops',
      since: '1.16.0',
      reason: 'x',
    }];
    expect(judge(failures, both).unexpected).toEqual([]);
  });
  it('a listed entry that no longer fails is reported stale', () => {
    const gone = {
      file: 'tests/ir/z.test.ts',
      name: 'fixed since',
      since: '1.15.0',
      reason: 'old',
    };
    expect(judge(failures, [moved, gone]).stale).toEqual([gone]);
  });
  // Review round 1 (2026-11-13): a stale entry was printed and KEPT, ready to accept a real
  // regression of a same-named test at a later release.
  it('the gate holds only with nothing unexpected AND nothing stale', () => {
    const both = [moved, {
      file: 'tests/ir/a.test.ts',
      name: 'folds "i32.add" & drops',
      since: '1.16.0',
      reason: 'x',
    }];
    expect(gateHolds(judge(failures, both))).toBe(true);
    expect(gateHolds(judge(failures, [moved]))).toBe(false); // one unexpected
    const gone = {
      file: 'tests/ir/z.test.ts',
      name: 'fixed since',
      since: '1.15.0',
      reason: 'old',
    };
    expect(gateHolds(judge(failures, [...both, gone]))).toBe(false); // one stale
  });
  it('the file must match as well as the name', () => {
    const elsewhere = { ...moved, file: 'tests/ir/a.test.ts' };
    expect(judge(failures, [elsewhere]).unexpected.length).toBe(2);
  });
});

// The harness's work tree (4.1.1's bump, 2026-11-19): v4.1.0's tests failed two that were the
// harness's doing — `resolveCommit('HEAD')` in a repository with nothing committed, and
// corpus_roundtrip without the gitignored binaryen corpus. Read from the source: the run itself
// takes minutes and is what the bump executes.
describe('previousTests: the work tree the old tests run in', () => {
  const src = fsx.readTextFileSync('scripts/release/previous-tests.ts');
  const body = src.slice(src.indexOf('export function previousTests('));

  it('commits what it stages, under an identity of its own', () => {
    expect(body).toMatch(/\['add', '-A'\], \['commit', '-q', '-m', 'previous tests'\]/);
    expect(body).toContain('GIT_AUTHOR_NAME: who');
    expect(body).toContain('GIT_COMMITTER_EMAIL: at');
    expect(body).not.toContain('--no-verify');
    expect(body).not.toContain('gpgsign');
  });

  // A caller's GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE outranks `cwd`: with GIT_DIR exported,
  // v4.1.0's tests committed into the real repository (2026-11-19). Every process gets `clean`.
  it('starts every process without the caller GIT_* variables', () => {
    expect(body).toContain(
      'const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));',
    );
    const spawns = body.split('spawnSync(').slice(1).map((s) => s.slice(0, s.indexOf(')')));
    expect(spawns.length).toBe(4);
    for (const s of spawns) expect(s).toMatch(/\benv(: clean)?\b/);
    expect(body).toMatch(/const env = \{\s*\.\.\.clean,/);
    expect(body).not.toContain('...process.env');
  });

  it('links the binaryen corpus in when the checkout has it', () => {
    expect(body).toContain("join(REPO, 'upstream', 'binaryen', 'test')");
    expect(body).toMatch(/if \(existsSync\(corpus\)\)/);
  });

  it('removes its links before it removes the folder', () => {
    const fin = body.slice(body.lastIndexOf('} finally {'));
    const unlink = fin.indexOf('unlinkSync(l)');
    const rm = fin.indexOf('rmSync(dir');
    expect(unlink).toBeGreaterThan(0);
    expect(rm).toBeGreaterThan(unlink);
    // Every link goes through `link`, which records it for that removal.
    expect(body.split('symlinkSync(').length - 1).toBe(1);
    expect(body).toMatch(/symlinkSync\(target, at, 'junction'\);\s*links\.push\(at\);/);
  });
});
