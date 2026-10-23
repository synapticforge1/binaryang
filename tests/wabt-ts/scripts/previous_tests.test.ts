/**
 * The compatibility gate's behaviour check (workspace letter H6, rule 3;
 * `scripts/release/previous-tests.ts`): reading node:test's JUnit report, and judging its failures
 * against `tests/accepted-changes.json`. Pure: a hand-written report, no test run.
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { failuresIn, judge } from '../../../scripts/release/previous-tests.ts';

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
  it('the file must match as well as the name', () => {
    const elsewhere = { ...moved, file: 'tests/ir/a.test.ts' };
    expect(judge(failures, [elsewhere]).unexpected.length).toBe(2);
  });
});
