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
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
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

/** The failing testcases in a node:test JUnit report, files made tree-relative. */
export function failuresIn(xml: string): Failure[] {
  const out: Failure[] = [];
  const rel = (p: string) => p.replaceAll('\\', '/').replace(/^.*?(?=tests\/)/, '');
  for (const m of xml.matchAll(/<testcase((?:\s+[\w:-]+="[^"]*")*)\s*>([\s\S]*?)<\/testcase>/g)) {
    if (!/<failure\b/.test(m[2]!)) continue;
    const file = /\bfile="([^"]+)"/.exec(m[1]!)?.[1] ?? '?';
    const name = (/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? '?').replace(/&quot;/g, '"').replace(
      /&amp;/g,
      '&',
    )
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
    out.push({ file: rel(file), name });
  }
  return out;
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

/** Runs the previous release's tests against this tree's committed source; 0 when the gate holds. */
export function previousTests(ref = lastReleaseTag()): number {
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-prevtests-'));
  try {
    const extract = (tree: string, ...paths: string[]) => {
      const tar = spawnSync('git', ['archive', '--format=tar', tree, ...paths], {
        cwd: REPO,
        maxBuffer: 1 << 30,
      });
      if (tar.status !== 0) {
        throw new Error(`git archive ${tree}: ${tar.stderr.toString().slice(0, 300)}`);
      }
      // `tar -x` with cwd, never `-C <drive path>` (a Windows tar reads `C:` as a remote host).
      const x = spawnSync('tar', ['-x'], { cwd: dir, input: tar.stdout, maxBuffer: 1 << 30 });
      if (x.status !== 0) throw new Error(`tar -x: ${x.stderr.toString().slice(0, 300)}`);
    };
    extract('HEAD');
    rmSync(join(dir, 'tests'), { recursive: true, force: true });
    extract(ref, 'tests');
    symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'junction');
    const report = join(dir, 'junit.xml');
    const flags = ['--test', '--test-reporter=junit', `--test-reporter-destination=${report}`];
    const globs = TEST_DIRS.map((d) => `${d}/**/*.test.ts`);
    const [bin, args] = nodeCommand(REFEREE, flags, globs[0]!, globs.slice(1));
    const status = spawnSync(bin, args, { cwd: dir, stdio: 'ignore' }).status;
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
    const j = judge(failuresIn(xml), accepted);
    console.log(
      `previous tests (${ref}'s tests/ on this tree's src/): ${total} tests, ${
        j.accepted.length + j.unexpected.length
      } failed, ${j.accepted.length} accepted`,
    );
    for (const f of j.unexpected) console.error(`  ✗ NOT accepted: ${f.file} — ${f.name}`);
    for (const s of j.stale) {
      console.log(`  · stale entry (no longer fails): ${s.file} — ${s.name} (since ${s.since})`);
    }
    if (j.unexpected.length > 0) {
      console.error(
        'A previous-release test fails that tests/accepted-changes.json does not list: a behaviour',
      );
      console.error(
        'change. Fix it, or list it there with the version and the reason, in its own commit.',
      );
      return 1;
    }
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(previousTests(process.argv[2]));
