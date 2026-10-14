/**
 * @module scripts/release/publish
 *
 * Local release driver. Commits and tags whatever `jsr.json` currently says,
 * then pushes commit + tag in a single atomic `git push origin main vX.Y.Z`.
 * The tag push triggers `.github/workflows/publish.yml` on GitHub: developer
 * pushes are authenticated with a PAT (not GITHUB_TOKEN), so the tag push
 * fires the workflow directly without going through the auto-tag detour.
 *
 * Typical flow:
 *   1. bun run bump        # writes the next version into jsr.json
 *   2. bun run release     # commits + tags + pushes (this script)
 *
 * Named `release`, not `publish`, deliberately: `deno task publish:dry` runs
 * `deno publish --dry-run`, which checks the JSR manifest and is NOT a dry run
 * of this script. Two names one keystroke apart, doing unrelated things, with
 * only one of them irreversible.
 *   3. Watch the Actions tab — JSR publish + GitHub Release are both
 *      produced by publish.yml.
 *
 * Why this script does NOT call `deno publish` itself: JSR provenance
 * requires the GitHub-issued OIDC token, which is only available inside the
 * GitHub Actions workflow. A local `deno publish` succeeds but the resulting
 * version is permanently flagged "No provenance" on JSR. So the local script
 * stops at "push the tag" — `deno publish` runs only inside `publish.yml`,
 * and only there.
 *
 * The single release path for binaryang. binaryen-ts and wabt-ts each shipped
 * their own near-identical copy; this is the union of the two, keeping every
 * guard either side had.
 *
 * @license MIT
 */

import { readCurrentVersion } from './version.ts';
import { RELEASE_FILES, releaseBlockers } from './release-guard.ts';
import { checkEntry } from './entry-check.ts';

import { mkdtemp, rm } from 'node:fs/promises';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(cmd: string[]): void {
  console.log(`$ ${cmd.join(' ')}`);
  const code = spawnSync(cmd[0]!, cmd.slice(1), { stdio: 'inherit' }).status ?? 1;
  if (code !== 0) {
    console.error(`\nCommand failed with exit code ${code}: ${cmd.join(' ')}`);
    process.exit(code);
  }
}

/** Run a command and return its stdout; exits on failure. */
function capture(cmd: string[]): string {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
  const code = r.status ?? 1;
  if (code !== 0) {
    console.error(r.stderr.toString('utf8'));
    console.error(`Command failed with exit code ${code}: ${cmd.join(' ')}`);
    process.exit(code);
  }
  return r.stdout.toString('utf8');
}

const version = await readCurrentVersion();
const tag = `v${version}`;

console.log(`Releasing ${tag}\n`);

// 0. GUARD: refuse on a dirty tree.
//
// The tag this script pushes is exactly what JSR publishes, and this script
// stages RELEASE_FILES (what the bump wrote) and NOTHING ELSE. So on a dirty
// tree it commits a bare version bump, tags that, and publishes a release
// containing none of the work -- and a JSR version is immutable, so the only
// remedy is to burn
// another version number.
//
// Not hypothetical: this guard was written after finding the tree carrying 15
// unreleased user-visible fixes across 55 paths while the docs claimed this
// script already refused (T13.43). It did not -- it force-tagged and pushed
// regardless.
//
// Untracked files count as dirty too. A new source file that was never
// committed is absent from the tag, so the release is missing it while every
// local check still passes, because the file is sitting on disk.
const status = await capture(['git', 'status', '--porcelain']);
const dirty = releaseBlockers(status);
if (dirty.length > 0) {
  console.error(`Refusing to release ${tag}: the working tree is not clean.`);
  console.error('');
  console.error(`  ${dirty.length} path(s) would be LEFT OUT of the release:`);
  for (const l of dirty.slice(0, 10)) console.error(`    ${l}`);
  if (dirty.length > 10) console.error(`    ... and ${dirty.length - 10} more`);
  console.error('');
  console.error(
    `  This script commits ${RELEASE_FILES.join(' and ')} only. Commit or stash the rest first --`,
  );
  console.error('  a published JSR version cannot be replaced.');
  process.exit(1);
}

// 0b. GUARD: refuse if the tag is already on the remote.
//
// A local tag is re-creatable, and step 3 deliberately force-writes it for
// retry safety. A REMOTE tag is not: it has already triggered publish.yml, so
// that version is either live on JSR (immutable) or failed for a reason a
// re-push will not change. Bump instead.
const remoteTag = await capture(['git', 'ls-remote', '--tags', 'origin', tag]);
if (remoteTag.trim() !== '') {
  console.error(`Refusing to release ${tag}: that tag already exists on origin.`);
  console.error('');
  console.error('  It has already triggered publish.yml, so the version is either live on');
  console.error('  JSR (immutable) or failed for a reason a re-push will not change.');
  console.error('  Run `bun run bump` for the next version.');
  process.exit(1);
}

// 0c. GUARD: a COLD type check, before anything is committed or tagged.
//
// `publish.yml` type-checks with no cache; a local check does not. Editing file
// A does not re-check file B when B's types depend on A, so a stale local cache
// passes what CI fails — and CI fails AFTER the tag is public. That shipped
// binaryen-ts v1.2.4 broken: an orphaned tag, no JSR publish, a burned version.
// `--reload` is not enough: it does not invalidate a resolved dependency
// VERSION, and only a fresh `DENO_DIR` proves the whole chain (cmem
// best-practices.md). So the same `deno task check` publish.yml runs, in an
// empty `DENO_DIR`.
const coldDir = await mkdtemp(join(tmpdir(), 'binaryang-release-check-'));
try {
  console.log(`$ DENO_DIR=${coldDir} deno task check   (cold, as publish.yml runs it)`);
  // `env` REPLACES the environment in node:child_process (Deno.Command merged it), so the
  // parent's is spread in: without PATH, `deno` itself would not be found.
  const cold = spawnSync('deno', ['task', 'check'], {
    env: { ...process.env, DENO_DIR: coldDir },
    stdio: 'inherit',
  });
  if (cold.status !== 0) {
    console.error(`\nRefusing to release ${tag}: the cold type check failed.`);
    console.error('  publish.yml would fail the same way, after the tag was public.');
    process.exit(1);
  }
} finally {
  await rm(coldDir, { recursive: true }).catch(() => {});
}
// …and publish.yml's second type check (Bun migration B6): `tsc` over src/, scripts/ and tests/.
// No cache to go stale: `tsc -p` without `incremental` checks every file every time.
console.log('$ bun run check   (tsc, as publish.yml runs it)');
if (spawnSync('bun', ['run', 'check'], { stdio: 'inherit' }).status !== 0) {
  console.error(`\nRefusing to release ${tag}: the tsc type check failed.`);
  console.error('  publish.yml would fail the same way, after the tag was public.');
  process.exit(1);
}

// 0d. GUARD: the published ROOT is the CLI, run as a user runs it.
//
// Through 1.6.0 the root was a module with no dispatcher: the README's
// `deno run -A jsr:@jrmarcum/binaryang <command>` printed nothing and exited 0
// on every published version, and no check ran the entry a user runs
// (`entry-check.ts` has the record).
console.log('$ checkEntry — the `.` export: --help, --version, a command, an import');
const entryProblems = await checkEntry(process.cwd());
if (entryProblems.length > 0) {
  console.error(`\nRefusing to release ${tag}: the package root is not a working CLI.`);
  for (const p of entryProblems) console.error(`  ${p}`);
  process.exit(1);
}

// 1. Stage the bump -- RELEASE_FILES, the only files a release touches. Not
//    `jsr.json` alone: the bump also rewrites main.ts's VERSION literal, and
//    staging one of the two would tag a CLI reporting the old version.
await run(['git', 'add', ...RELEASE_FILES]);

// 2. Commit only if there's actually something staged. `bun run bump` +
//    `bun run release` is the common path (both files dirty), but if the
//    user already committed the bump manually, skip the no-op commit.
const diffCode = spawnSync('git', ['diff', '--cached', '--quiet'], { stdio: 'ignore' }).status;
if (diffCode !== 0) {
  await run(['git', 'commit', '-m', `bump to ${tag}`]);
} else {
  console.log('(the bump is already committed — skipping commit)\n');
}

// 3. Force-tag locally for re-run safety: if a previous publish attempt got
//    as far as creating the tag but failed before pushing, this overwrites
//    the stale local tag instead of erroring.
await run(['git', 'tag', '-f', tag]);

// 4. Push commit + tag in a single operation. Atomic from git's perspective,
//    which avoids racing `auto-tag.yml` (it sees the tag already exists when
//    it fires on the main push and no-ops).
await run(['git', 'push', 'origin', 'main', tag]);

console.log(`\nPushed ${tag}. publish.yml will run:`);
console.log(`  https://github.com/jrmarcum/binaryang/actions`);
console.log('');
console.log('It performs: version verify -> deno task check + bun run check -> bun run test');
console.log('(Node 24) + bun run test:bun -> deno publish (with OIDC provenance) -> create');
console.log('GitHub Release -> verify provenance on JSR.');
