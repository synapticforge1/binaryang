/**
 * The compatibility gate's behaviour check (workspace letter H6, rule 3;
 * `scripts/release/previous-tests.ts`): reading node:test's JUnit report, and judging its failures
 * against `tests/accepted-changes.json`. Pure: a hand-written report, no test run.
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';
import {
  confirmAlone,
  failureMessages,
  failuresIn,
  gateHolds,
  judge,
  passesIn,
  PREVIOUS_TESTS_LIMIT_MS,
} from '../../../scripts/release/previous-tests.ts';

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

// 4.1.2's bump (2026-11-20): v4.1.1's coalesce_budget (a 20 s wall-clock bound, ~7 s alone)
// failed twice inside the full parallel suite on a busy machine, against byte-identical src/.
describe('confirmAlone: an unlisted failure is run again, its file alone', () => {
  const lone = (cases: [string, string, 'pass' | 'fail' | 'skip'][]) =>
    `<testsuites>${
      cases.map(([file, name, o]) =>
        `<testcase name="${name}" file="C:\\tmp\\x\\${file.replaceAll('/', '\\')}">${
          o === 'fail' ? '<failure message="x">x</failure>' : o === 'skip' ? '<skipped/>' : ''
        }</testcase>`
      ).join('')
    }</testsuites>`;
  const slow = { file: 'tests/binaryen-ts/passes/b.test.ts', name: 'within budget' };
  const broken = { file: 'tests/ir/a.test.ts', name: 'folds' };

  it('passesIn reads only the passing cases, tree-relative', () => {
    const xml = lone([['tests/ir/a.test.ts', 'p', 'pass'], ['tests/ir/a.test.ts', 'f', 'fail'], [
      'tests/ir/a.test.ts',
      's',
      'skip',
    ]]);
    expect([...passesIn(xml)]).toEqual(['tests/ir/a.test.ts\u0000p']);
  });

  it('passing alone is timing; failing alone stays a failure; each file is run once', () => {
    const asked: string[] = [];
    const r = confirmAlone([slow, broken, { ...broken, name: 'other' }], (file) => {
      asked.push(file);
      return file === slow.file
        ? lone([[slow.file, slow.name, 'pass']])
        : lone([[broken.file, 'folds', 'fail'], [broken.file, 'other', 'pass']]);
    });
    expect(r.timing).toEqual([slow, { ...broken, name: 'other' }]);
    expect(r.still).toEqual([broken]);
    expect(asked).toEqual([slow.file, broken.file]);
  });

  it('no lone report, a skip, or a case the lone run never reached is NOT a pass', () => {
    expect(confirmAlone([slow], () => null).still).toEqual([slow]);
    expect(confirmAlone([slow], () => lone([[slow.file, slow.name, 'skip']])).still).toEqual([
      slow,
    ]);
    expect(confirmAlone([slow], () => lone([[slow.file, 'another', 'pass']])).still).toEqual([
      slow,
    ]);
  });

  // Review (2026-11-20): two cases of one name in one file (different `describe`s) — one passing
  // alone must not vouch for the other failing.
  it('a name that also failed or was skipped alone is not a pass', () => {
    const twins = lone([[slow.file, slow.name, 'pass'], [slow.file, slow.name, 'fail']]);
    expect(passesIn(twins).size).toBe(0);
    expect(confirmAlone([slow], () => twins).still).toEqual([slow]);
    const skipped = lone([[slow.file, slow.name, 'pass'], [slow.file, slow.name, 'skip']]);
    expect(confirmAlone([slow], () => skipped).still).toEqual([slow]);
  });

  it("the full run's failure message, one line, entities decoded, for the report", () => {
    const xml = '<testsuites><testcase name="t" file="C:\\x\\tests\\ir\\a.test.ts">' +
      '<failure message="Expected 20507 &lt; 20000&#10;at &quot;x&quot;">x</failure></testcase></testsuites>';
    expect(failureMessages(xml).get('tests/ir/a.test.ts\u0000t')).toBe(
      'Expected 20507 < 20000&#10;at "x"',
    );
  });

  it('the run uses it: only what still fails alone reaches the verdict, bounded, and says so', () => {
    const src = fsx.readTextFileSync('scripts/release/previous-tests.ts');
    expect(src).toContain('const { still, timing } = confirmAlone(first.unexpected,');
    expect(src).toContain('const j = { ...first, unexpected: still };');
    expect(src).toContain('return gateHolds(j) ? 0 : 1;');
    // Both runs are bounded over their WHOLE tree (run-bounded.ts); a lone run that does not finish
    // gives no verdict (the failure stands), a full run that does not finish is a failure.
    expect(src).toContain('limitMs: PREVIOUS_TESTS_LIMIT_MS.full');
    expect(src).toContain('limitMs: PREVIOUS_TESTS_LIMIT_MS.alone');
    expect(src).toContain('if (r.timedOut || r.failed !== undefined) return null;');
    expect(src).toContain('if (full.timedOut) {');
    // A run that could not start says so — never "did not finish".
    expect(src).toContain('if (full.failed !== undefined) {');
    expect(src).toContain('the run could not start');
    expect(src).not.toMatch(/spawnSync\([^)]*timeout:/);
    expect(PREVIOUS_TESTS_LIMIT_MS.alone).toBeLessThanOrEqual(PREVIOUS_TESTS_LIMIT_MS.full);
    // The report claims no cause it did not show.
    expect(src).toContain('load assumed, shared state or a race not ruled out');
    expect(src).toContain(['full-run failure: $', '{why}'].join(''));
    expect(src).not.toContain('not on behaviour):');
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
    // git archive, tar and the work tree's git (spawnSync); the full run and each lone re-run
    // (runBounded, 4.1.2). Each gets `env: clean`, or the work tree's `env` built on `...clean`.
    const calls = (fn: string) =>
      body.split(`${fn}(`).slice(1).map((s) => s.slice(0, s.indexOf(')')));
    expect(calls('spawnSync').length).toBe(3);
    expect(calls('runBounded').length).toBe(2);
    for (const s of [...calls('spawnSync'), ...calls('runBounded')]) {
      expect(s).toMatch(/[{,]\s*env(?:: clean)?\s*[,}]/);
    }
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
