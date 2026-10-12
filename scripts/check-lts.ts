// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The CLI on EVERY current Node LTS line (owner, 2026-10-12: "We should support and test all
 * currently available lts versions"), the same output on each.
 *
 * Which lines: Node's own release schedule (`nodejs/Release`'s `schedule.json`), every line whose
 * LTS has started and whose end of life has not come. That is decided by the date, never by a
 * list here, so a line ENTERS this check the day it becomes LTS. Node 26 does on 2026-10-28. It
 * removed `--experimental-transform-types`, so the source had to become erasable TypeScript
 * first (open-work 28 part 4, done 2026-10-12): Node runs it with NO flag, 22.18 through 26.
 *
 * How: each line runs through fnm (`fnm exec --using=<major>`), so no Node switches globally and
 * no path is machine-specific. `scripts/cli-smoke.ts` runs every dispatcher command and prints the
 * sha256 of the `wat2wasm` output; every line must print the same one. A line fnm does not have
 * installed FAILS the check, naming the command that installs it, and is never silently skipped.
 *
 * CI does not run this: its `runtimes` matrix covers the same lines with `actions/setup-node`.
 *
 * ```sh
 * bun run lts
 * ```
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const SCHEDULE = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';

/** One line of Node's release schedule. */
export interface ReleaseLine {
  start: string;
  lts?: string;
  maintenance?: string;
  end: string;
  codename?: string;
}

/** The majors whose LTS has started on `today` (YYYY-MM-DD) and whose end of life has not come. */
export function currentLtsMajors(schedule: Record<string, ReleaseLine>, today: string): number[] {
  return Object.entries(schedule)
    .filter(([, l]) => l.lts !== undefined && l.lts <= today && today <= l.end)
    .map(([k]) => Number(k.replace(/^v/, '')))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

/** The majors fnm has installed, from `fnm list` (`* v24.21.0 default`, `v22.23.3`, `system`). */
export function installedMajors(fnmList: string): Set<number> {
  return new Set([...fnmList.matchAll(/\bv(\d+)\.\d+\.\d+/g)].map((m) => Number(m[1])));
}

function fnm(args: string[]) {
  return spawnSync('fnm', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
}

if (import.meta.main) {
  if (fnm(['--version']).status !== 0) {
    console.error('bun run lts needs fnm (https://fnm.vercel.app): `scoop install fnm`, then');
    console.error('`fnm install <major>` for each current LTS line.');
    process.exit(2);
  }
  let schedule: Record<string, ReleaseLine>;
  try {
    const res = await fetch(SCHEDULE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    schedule = await res.json() as Record<string, ReleaseLine>;
  } catch (e) {
    console.error(`cannot read Node's release schedule (${SCHEDULE}): ${(e as Error).message}`);
    process.exit(2);
  }
  const today = new Date().toISOString().slice(0, 10);
  const majors = currentLtsMajors(schedule, today);
  const have = installedMajors(fnm(['list']).stdout ?? '');
  console.log(`current Node LTS lines on ${today}: ${majors.map((m) => `v${m}`).join(', ')}`);

  const hashes = new Map<number, string>();
  const problems: string[] = [];
  for (const m of majors) {
    if (!have.has(m)) {
      problems.push(`v${m}: not installed in fnm -- run \`fnm install ${m}\``);
      continue;
    }
    const r = fnm([
      'exec',
      `--using=${m}`,
      'node',
      '--no-warnings',
      'scripts/cli-smoke.ts',
      'node --no-warnings',
    ]);
    const out = `${r.stdout ?? ''}`.trim();
    const hash = out.split('\n').at(-1) ?? '';
    if (r.status !== 0 || !/^[0-9a-f]{64}$/.test(hash)) {
      const why = `${r.stderr ?? ''}${out}`.trim().split('\n').find((l) =>
        /error|Error|bad option/.test(l)
      );
      problems.push(
        `v${m}: the CLI did not run (exit ${r.status}): ${(why ?? '').trim().slice(0, 160)}`,
      );
      continue;
    }
    hashes.set(m, hash);
    console.log(`  v${m}  ${hash}`);
  }
  const distinct = new Set(hashes.values());
  if (distinct.size > 1) {
    problems.push(`the lines disagree: ${distinct.size} different wat2wasm hashes`);
  }
  if (problems.length > 0) {
    console.log(['', 'FAILED:', ...problems.map((p) => `  ${p}`)].join('\n'));
    process.exit(1);
  }
  console.log(`every current LTS line runs the CLI with the same output (${majors.length} lines)`);
}
