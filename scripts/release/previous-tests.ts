/**
 * @module scripts/release/previous-tests
 *
 * The compatibility gate's BEHAVIOUR check (workspace letter H6, rule 3: "names are not behaviour").
 * The PREVIOUS release's `tests/` must pass against the NEW `src/` for a patch or minor bump: the
 * current committed tree, its `tests/` replaced by the previous tag's, run on Node 24 (the suite's
 * referee). A surface diff once showed 0 of 72 symbols missing while 12 of 28 tests failed.
 *
 * A test that must fail because behaviour changed ON PURPOSE (optimizer output moving, say) is
 * listed in `tests/accepted-changes.json` — its file and name, the version it changed in, and why.
 * Anything failing that is not listed fails the gate; a listed entry that no longer fails is
 * reported, so the list stays true.
 *
 * ```sh
 * bun scripts/release/previous-tests.ts            # against the last release tag
 * bun scripts/release/previous-tests.ts v1.14.0    # against a named one
 * ```
 *
 * @license MIT
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runBounded } from '../run-bounded.ts';
import { TEST_DIRS } from '../test.ts';
import { nodeCommand, REFEREE } from '../v8.ts';
import { lastReleaseTag } from './api-surface.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const ACCEPTED = join(REPO, 'tests', 'accepted-changes.json');

/** One accepted behaviour change: a previous-release test allowed to fail, and why. */
export interface AcceptedChange {
  file: string;
  name: string;
  since: string;
  reason: string;
}

/** A failing testcase from a JUnit report. */
export interface Failure {
  file: string;
  name: string;
}

/** Every testcase in a node:test JUnit report: its file (tree-relative), name, and verdict. */
function testcasesIn(
  xml: string,
): { file: string; name: string; outcome: 'pass' | 'fail' | 'skip'; message: string }[] {
  const out: { file: string; name: string; outcome: 'pass' | 'fail' | 'skip'; message: string }[] =
    [];
  const rel = (p: string) => p.replaceAll('\\', '/').replace(/^.*?(?=tests\/)/, '');
  const re = /<testcase((?:\s+[\w:-]+="[^"]*")*)\s*(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(re)) {
    const body = m[2] ?? '';
    const file = /\bfile="([^"]+)"/.exec(m[1]!)?.[1] ?? '?';
    const name = (/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? '?').replace(/&quot;/g, '"').replace(
      /&amp;/g,
      '&',
    )
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
    const outcome = /<failure\b/.test(body) ? 'fail' : /<skipped\b/.test(body) ? 'skip' : 'pass';
    const message = (/<failure\b[^>]*\bmessage="([^"]*)"/.exec(body)?.[1] ?? '').replace(
      /&quot;/g,
      '"',
    ).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ').slice(0, 160);
    out.push({ file: rel(file), name, outcome, message });
  }
  return out;
}

/**
 * How long the previous release's tests may run: the whole suite (~1 min on win-x64), and one
 * file run alone. Past it the run is a failure that says it did not finish — never a hang.
 */
export const PREVIOUS_TESTS_LIMIT_MS = { full: 30 * 60_000, alone: 10 * 60_000 } as const;

/** The failing testcases in a node:test JUnit report, files made tree-relative. */
export function failuresIn(xml: string): Failure[] {
  return testcasesIn(xml).filter((c) => c.outcome === 'fail').map(({ file, name }) => ({
    file,
    name,
  }));
}

/** Splits failures into those the accepted list explains and those it does not; and stale entries. */
export function judge(failures: Failure[], accepted: AcceptedChange[]) {
  const key = (x: { file: string; name: string }) => `${x.file}\u0000${x.name}`;
  const listed = new Set(accepted.map(key));
  const failing = new Set(failures.map(key));
  return {
    unexpected: failures.filter((f) => !listed.has(key(f))),
    accepted: failures.filter((f) => listed.has(key(f))),
    stale: accepted.filter((a) => !failing.has(key(a))),
  };
}

/**
 * The PASSING testcases in a node:test JUnit report, as `file\0name` keys (files tree-relative).
 * A key that ALSO names a failed or skipped case is not a pass: two tests of one name in one file
 * (in different `describe`s) must not let one's pass vouch for the other's failure (review, 2026-11-20).
 */
export function passesIn(xml: string): Set<string> {
  const cases = testcasesIn(xml);
  const key = (c: { file: string; name: string }) => `${c.file}\u0000${c.name}`;
  const notPass = new Set(cases.filter((c) => c.outcome !== 'pass').map(key));
  return new Set(cases.filter((c) => c.outcome === 'pass' && !notPass.has(key(c))).map(key));
}

/** Each failing testcase's `message`, one line, by `file\0name` (what the full run reported). */
export function failureMessages(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of testcasesIn(xml)) {
    if (c.outcome === 'fail') out.set(`${c.file}\u0000${c.name}`, c.message);
  }
  return out;
}

/**
 * Splits the unexpected failures by a second run of each one's FILE alone (4.1.2's bump,
 * 2026-11-20: v4.1.1's coalesce_budget — a 20 s wall-clock bound, ~7 s alone — failed twice inside
 * the full parallel suite on a machine busy with other work, against byte-identical `src/`). A
 * test that PASSES alone is `timing`: printed with its full-run message, not counted. That is load
 * ASSUMED, not shown — a race or state shared between files would pass alone too — so the line
 * says so and the owner reads it. One that fails or is skipped alone, or that the lone run never
 * reported, stays `still` and fails the gate; a real slowdown fails alone too. `rerun(file)` gives
 * that file's lone JUnit report, or null.
 */
export function confirmAlone(
  unexpected: Failure[],
  rerun: (file: string) => string | null,
): { still: Failure[]; timing: Failure[] } {
  const reports = new Map<string, Set<string> | null>();
  const still: Failure[] = [];
  const timing: Failure[] = [];
  for (const f of unexpected) {
    if (!reports.has(f.file)) {
      const xml = rerun(f.file);
      reports.set(f.file, xml === null ? null : passesIn(xml));
    }
    const passed = reports.get(f.file);
    if (passed?.has(`${f.file}\u0000${f.name}`)) timing.push(f);
    else still.push(f);
  }
  return { still, timing };
}

/**
 * The gate's verdict: no unexpected failure AND no stale entry. A stale entry — an accepted
 * change that no longer fails — accepts NOTHING today but would silently accept a real regression
 * of a same-named test later, so it stops the gate until it is dropped (review round 1,
 * 2026-11-13; it used to be printed and kept).
 */
export function gateHolds(j: ReturnType<typeof judge>): boolean {
  return j.unexpected.length === 0 && j.stale.length === 0;
}

/** Runs the previous release's tests against this tree's committed source; 0 when the gate holds. */
export function previousTests(ref = lastReleaseTag()): number {
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-prevtests-'));
  // The links this run makes into the repository: removed before the folder is (Tooling rule 15).
  const links: string[] = [];
  const link = (target: string, at: string) => {
    symlinkSync(target, at, 'junction');
    links.push(at);
  };
  // EVERY process this run starts gets the caller's environment without GIT_*: a `GIT_DIR`,
  // `GIT_WORK_TREE` or `GIT_INDEX_FILE` (a git hook exports them) outranks `cwd`, so the work
  // tree's `add` and `commit` — and the OLD TESTS, which make commits of their own in what they
  // take for a scratch repository — would land in the REAL one (measured 2026-11-19: with
  // GIT_DIR exported, v4.1.0's tests committed "reviewed" onto the branch being released).
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  try {
    const extract = (tree: string, ...paths: string[]) => {
      const tar = spawnSync('git', ['archive', '--format=tar', tree, ...paths], {
        cwd: REPO,
        maxBuffer: 1 << 30,
        env: clean,
      });
      if (tar.status !== 0) {
        throw new Error(`git archive ${tree}: ${tar.stderr.toString().slice(0, 300)}`);
      }
      // `tar -x` with cwd, never `-C <drive path>` (a Windows tar reads `C:` as a remote host).
      const x = spawnSync('tar', ['-x'], {
        cwd: dir,
        input: tar.stdout,
        maxBuffer: 1 << 30,
        env: clean,
      });
      if (x.status !== 0) throw new Error(`tar -x: ${x.stderr.toString().slice(0, 300)}`);
    };
    extract('HEAD');
    rmSync(join(dir, 'tests'), { recursive: true, force: true });
    extract(ref, 'tests');
    // A git work tree with the extracted files staged: some tests read the TRACKED files
    // (`deno_pin.test.ts` runs `git ls-files`), and outside a repository git lists nothing —
    // 3.0.1's bump failed v3.0.0's copy that way, a harness defect, not a behaviour change.
    // COMMITTED, too: a test that resolves `HEAD` (4.1.0's `resolveCommit`) finds no commit in a
    // repository with only staged files — 4.1.1's bump failed it that way, a harness defect.
    const who = 'previous-tests';
    const at = 'no-reply@previous-tests.invalid';
    const env = {
      ...clean,
      GIT_AUTHOR_NAME: who,
      GIT_AUTHOR_EMAIL: at,
      GIT_COMMITTER_NAME: who,
      GIT_COMMITTER_EMAIL: at,
    };
    for (const g of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'previous tests']]) {
      const r = spawnSync('git', g, { cwd: dir, encoding: 'utf8', env });
      if (r.status !== 0) throw new Error(`git ${g.join(' ')}: ${r.stderr.slice(0, 300)}`);
    }
    link(join(REPO, 'node_modules'), join(dir, 'node_modules'));
    // The gitignored binaryen corpus, where this checkout has it: since 4.1.0 corpus_roundtrip
    // FAILS without it (no skips), and an archive of tracked files never carries it.
    const corpus = join(REPO, 'upstream', 'binaryen', 'test');
    if (existsSync(corpus)) {
      mkdirSync(join(dir, 'upstream', 'binaryen'), { recursive: true });
      link(corpus, join(dir, 'upstream', 'binaryen', 'test'));
    }
    const report = join(dir, 'junit.xml');
    const flags = ['--test', '--test-reporter=junit', `--test-reporter-destination=${report}`];
    const globs = TEST_DIRS.map((d) => `${d}/**/*.test.ts`);
    const [bin, args] = nodeCommand(REFEREE, flags, globs[0]!, globs.slice(1));
    // Bounded, the WHOLE tree: a hung old test ends the run — fnm, node and its per-file test
    // processes — as a failure that says so (review, 2026-11-20; `spawnSync`'s own timeout killed
    // fnm alone and left node running in this tree).
    const full = runBounded(bin, args, {
      cwd: dir,
      env: clean,
      limitMs: PREVIOUS_TESTS_LIMIT_MS.full,
    });
    if (full.timedOut) {
      console.error(
        `previous tests: the run did not finish in ${PREVIOUS_TESTS_LIMIT_MS.full / 60_000} min`,
      );
      return 1;
    }
    const status = full.status;
    let xml = '';
    try {
      xml = readFileSync(report, 'utf8');
    } catch {
      console.error(`previous tests: node wrote no report (exit ${status})`);
      return 1;
    }
    // Count the testcases themselves: a run that executed nothing must not read as a pass.
    const total = [...xml.matchAll(/<testcase\b/g)].length;
    if (total === 0) {
      console.error(
        `previous tests: the report holds no testcase (node exit ${status}) — nothing ran`,
      );
      return 1;
    }
    const accepted =
      (JSON.parse(readFileSync(ACCEPTED, 'utf8')) as { entries: AcceptedChange[] }).entries;
    const first = judge(failuresIn(xml), accepted);
    // Each unlisted failure's file once more, ALONE, in the same tree and environment.
    let reruns = 0;
    const { still, timing } = confirmAlone(first.unexpected, (file) => {
      const lone = join(dir, `alone-${reruns++}.xml`);
      const f = ['--test', '--test-reporter=junit', `--test-reporter-destination=${lone}`];
      const [b, a] = nodeCommand(REFEREE, f, file, []);
      const r = runBounded(b, a, { cwd: dir, env: clean, limitMs: PREVIOUS_TESTS_LIMIT_MS.alone });
      if (r.timedOut) return null; // did not finish: no verdict, so the failure stands
      try {
        return readFileSync(lone, 'utf8');
      } catch {
        return null;
      }
    });
    const j = { ...first, unexpected: still };
    const messages = failureMessages(xml);
    console.log(
      `previous tests (${ref}'s tests/ on this tree's src/): ${total} tests, ${
        first.accepted.length + first.unexpected.length
      } failed, ${j.accepted.length} accepted${
        timing.length > 0 ? `, ${timing.length} passed when run alone` : ''
      }`,
    );
    for (const f of timing) {
      const why = messages.get(`${f.file}\u0000${f.name}`) || '(no message)';
      console.log(
        `  ~ failed in the full run, PASSED when run alone — load assumed, shared state or a race not ruled out: ${f.file} — ${f.name}\n      full-run failure: ${why}`,
      );
    }
    for (const f of j.unexpected) console.error(`  ✗ NOT accepted: ${f.file} — ${f.name}`);
    for (const s of j.stale) {
      console.error(`  ✗ STALE entry (no longer fails): ${s.file} — ${s.name} (since ${s.since})`);
    }
    if (j.unexpected.length > 0) {
      console.error(
        'A previous-release test fails that tests/accepted-changes.json does not list: a behaviour',
      );
      console.error(
        'change. Fix it, or list it there with the version and the reason, in its own commit.',
      );
    }
    if (j.stale.length > 0) {
      console.error(
        'tests/accepted-changes.json lists a change that no longer fails: drop it, in its own commit',
      );
      console.error(
        '(only the release just before is run, so its entries go at the next release).',
      );
    }
    return gateHolds(j) ? 0 : 1;
  } finally {
    // Links first, so the recursive delete can never reach through one into the repository.
    for (const l of links.reverse()) {
      try {
        unlinkSync(l);
      } catch { /* already gone */ }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(previousTests(process.argv[2]));
