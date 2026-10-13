// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The test suite, off Deno (Bun migration B5, 2026-10-13; owner: "Node 24 authoritative, Bun too").
 *
 * `bun run test` runs `node --test` on the V8 REFEREE ({@link REFEREE} in `scripts/v8.ts`): 220 test
 * files use the host WebAssembly engine, so the engine that runs them decides what they find, and
 * the referee is the one measured equal to Deno's V8. Through fnm when it is installed (this
 * machine); otherwise `node` from PATH, and only if it IS the referee's major (CI pins it).
 *
 * `bun run test:bun` runs the same files on Bun (JavaScriptCore), the portability leg. Its failures
 * must be EXACTLY the measured engine differences in `tests/bun-known-differences.json`: a failure
 * not listed fails, and so does a listed test that now passes (JavaScriptCore caught up: delete the
 * entry), so the list cannot rot in either direction.
 *
 * ```sh
 * bun run test           # node --test on the referee: the verdict
 * bun run test:bun       # bun test, against the known JavaScriptCore differences
 * ```
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { nodeCommand, REFEREE } from './v8.ts';

/** Every tree under `tests/` that holds tests (`harness_wiring.test.ts` checks this is all of them). */
export const TEST_DIRS = ['tests/binaryen-ts', 'tests/wabt-ts', 'tests/ir', 'tests/definitions'];
const GLOBS = TEST_DIRS.map((d) => `${d}/**/*.test.ts`);

/** A test Bun is known to fail for an engine reason, with that reason. */
export interface KnownDifference {
  readonly file: string;
  readonly test: string;
  readonly reason: string;
}

const xmlUnescape = (s: string) =>
  s.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<').replaceAll('&#10;', '\n').replaceAll('&amp;', '&');

/** The failing tests in a JUnit report, as `file :: test` keys (repeats kept). */
export function junitFailures(xml: string): string[] {
  const out: string[] = [];
  // Attributes as name="…" pairs: a raw `>` may sit inside a value.
  for (
    const m of xml.matchAll(/<testcase((?:\s+[\w:-]+="[^"]*")*)\s*(\/>|>([\s\S]*?)<\/testcase>)/g)
  ) {
    if (!/<(failure|error)\b/.test(m[3] ?? '')) continue;
    const file = (/\bfile="([^"]+)"/.exec(m[1]!)?.[1] ?? '?').replaceAll('\\', '/');
    const name = xmlUnescape(/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? '?');
    out.push(`${file} :: ${name}`);
  }
  return out;
}

/**
 * "A step that ran nothing passes" (cmem/best-practices.md): every tracked test file must appear in
 * the report, so a glob that matches nothing, or a file that registers no test, fails the run.
 */
function checkCoverage(xml: string, runner: string): boolean {
  const tracked = spawnSync('git', ['ls-files', ...TEST_DIRS], { encoding: 'utf8' }).stdout
    .split('\n').filter((f) => f.endsWith('.test.ts'));
  // A file that registers NO test still appears: node reports it as one testcase named by its own
  // path (shown 2026-10-13 by emptying a test file). Only a testcase with a test's name counts.
  const rel = (p: string) => p.replaceAll('\\', '/').replace(/^.*?(?=tests\/)/, '');
  const ran = new Set<string>();
  for (const m of xml.matchAll(/<testcase((?:\s+[\w:-]+="[^"]*")*)/g)) {
    const file = /\bfile="([^"]+)"/.exec(m[1]!)?.[1];
    const name = /\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? '';
    if (file !== undefined && rel(name) !== rel(file)) ran.add(rel(file));
  }
  const missing = tracked.filter((f) => !ran.has(f));
  for (const f of missing) console.error(`✗ ${runner} ran no test from ${f}`);
  if (tracked.length === 0) console.error(`✗ no tracked test files under ${TEST_DIRS.join(', ')}`);
  return missing.length === 0 && tracked.length > 0;
}

function onNode(): number {
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-node-test-'));
  try {
    const report = join(dir, 'junit.xml');
    const flags = [
      '--test',
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      '--test-reporter=junit',
      `--test-reporter-destination=${report}`,
      ...process.argv.slice(2),
    ];
    const haveFnm = spawnSync('fnm', ['--version'], { stdio: 'ignore' }).status === 0;
    let status: number;
    if (haveFnm) {
      const [bin, args] = nodeCommand(REFEREE, flags, GLOBS[0]!, GLOBS.slice(1));
      status = spawnSync(bin, args, { stdio: 'inherit' }).status ?? 1;
    } else {
      const v = spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? '';
      if (!v.startsWith(`v${REFEREE}.`)) {
        console.error(
          `the suite runs on Node ${REFEREE} (the V8 referee): found ${v || 'no node'}, and no fnm`,
        );
        return 2;
      }
      status =
        spawnSync('node', ['--no-warnings', ...flags, ...GLOBS], { stdio: 'inherit' }).status ?? 1;
    }
    let xml = '';
    try {
      xml = readFileSync(report, 'utf8');
    } catch {
      console.error(`node --test wrote no report (exit ${status})`);
      return 1;
    }
    return checkCoverage(xml, 'node') ? status : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function onBun(): number {
  const known: KnownDifference[] = JSON.parse(
    readFileSync('tests/bun-known-differences.json', 'utf8'),
  );
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-bun-test-'));
  try {
    const report = join(dir, 'junit.xml');
    const r = spawnSync('bun', [
      'test',
      '--reporter=junit',
      `--reporter-outfile=${report}`,
      ...TEST_DIRS,
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    let xml: string;
    try {
      xml = readFileSync(report, 'utf8');
    } catch {
      console.error(`bun test wrote no report (exit ${r.status})`);
      return 1;
    }
    const failed = junitFailures(xml);
    const expected = known.map((k) => `${k.file} :: ${k.test}`);
    const unexpected = failed.filter((f) => !expected.includes(f));
    const stale = expected.filter((e) => !failed.includes(e));
    for (const f of unexpected) console.error(`✗ fails on Bun, not a known difference: ${f}`);
    for (const s of stale) {
      console.error(`✗ listed as a Bun difference, but passes now (delete it): ${s}`);
    }
    const tests = (/<testsuites\b[^>]*\btests="(\d+)"/.exec(xml) ?? [])[1] ?? '?';
    console.log(
      `bun: ${tests} tests; ${failed.length} failed, all ${
        unexpected.length === 0 ? '' : 'NOT '
      }known ` +
        `JavaScriptCore differences (${known.length} listed)`,
    );
    const covered = checkCoverage(xml, 'bun');
    return unexpected.length === 0 && stale.length === 0 && covered ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(process.argv[2] === '--bun' ? onBun() : onNode());
