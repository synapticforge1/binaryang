/**
 * @module scripts/release/publish
 *
 * Local release driver (U4 of the workspace's `release-process.md` § 5). Commits the bump that
 * `jsr.json` and `main.ts` carry as `bump to vX.Y.Z`, then pushes `main` ONLY and reads it back
 * with `git ls-remote`. It makes and pushes NO tag: 🔒 the owner's order (2026-11-10, workspace
 * letter H33, D1) is "the CI to check first, then push the tag, and then create the release page
 * from the tag, then publish the package to the registry". `.github/workflows/publish.yml` runs
 * on the push: `checks` → CI's `tag` → the `release` page → `jsr` / `npm`. Until 2026-11-10 this
 * script force-wrote the tag locally and pushed `main` and the tag together.
 *
 * Typical flow:
 *   1. bun run bump <level>   # writes the next version into jsr.json and main.ts
 *   2. bun run release        # guards, commits the bump, pushes main (this script)
 *   3. Watch the Actions tab — publish.yml's six jobs; a failure past the tag is
 *      "Re-run failed jobs", never a new tag.
 *
 * Named `release`, not `publish`, deliberately: `bun run publish:dry` runs
 * `deno publish --dry-run`, which checks the JSR manifest and is NOT a dry run
 * of this script. Two names one keystroke apart, doing unrelated things, with
 * only one of them irreversible.
 *
 * Why this script does NOT call `deno publish` itself: JSR provenance
 * requires the GitHub-issued OIDC token, which is only available inside the
 * GitHub Actions workflow. A local `deno publish` succeeds but the resulting
 * version is permanently flagged "No provenance" on JSR. So `deno publish`
 * runs only inside `publish.yml`, and only there.
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
import { DENO, denoCommand } from '../deno.ts';
import { jsrHas, npmState } from './registry.ts';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

// 0a. GUARD: on `main`, and `main` holds everything GitHub's `main` has.
//
// publish.yml releases from `main` only; a push from another branch would push nothing CI tags.
// `fetch` only moves the remote-tracking ref, never a branch or the tree.
const branch = (await capture(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
if (branch !== 'main') {
  console.error(`Refusing to release ${tag}: on '${branch}', not 'main'. Merge first (U2).`);
  process.exit(1);
}
await capture(['git', 'fetch', '-q', 'origin', 'main']);
const behind = spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], {
  stdio: 'ignore',
}).status;
if (behind !== 0) {
  console.error(`Refusing to release ${tag}: local main does not contain origin/main.`);
  console.error('  Bring main up to date with GitHub first; a push here would be refused.');
  process.exit(1);
}

// 0b. GUARD: the tag exists NOWHERE — not here, not on origin.
//
// CI makes the tag (D1). A local tag would be one this script never pushes, and one on origin
// means the version was released already (its JSR version is immutable): bump instead. Never
// `git tag -f`, never a forced tag push — a published tag never moves.
const localTag = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
  stdio: 'ignore',
}).status;
if (localTag === 0) {
  console.error(`Refusing to release ${tag}: a LOCAL tag ${tag} exists. CI makes the tag;`);
  console.error(`  delete the local one (git tag -d ${tag}) if it was never pushed.`);
  process.exit(1);
}
const remoteTag = await capture(['git', 'ls-remote', '--tags', 'origin', tag]);
if (remoteTag.trim() !== '') {
  console.error(`Refusing to release ${tag}: that tag already exists on origin.`);
  console.error('');
  console.error('  The version was released (JSR versions are immutable) or its run failed for a');
  console.error('  reason a new push will not change ("Re-run failed jobs" on that run).');
  console.error('  Run `bun run bump <level>` for the next version.');
  process.exit(1);
}

// 0b2. GUARD: neither registry knows the number (publish.yml's `checks` asks again).
// npm never reuses a number, an unpublished one included (C34 (2)).
const manifestName = (JSON.parse(await readFile('jsr.json', 'utf8')) as { name: string }).name;
const onJsr = await jsrHas({}, manifestName, version);
const onNpm = await npmState({}, version);
if (onJsr || onNpm !== 'free') {
  console.error(
    `Refusing to release ${tag}: JSR ${onJsr ? 'has it' : 'free'}, npm ${onNpm}. Bump again.`,
  );
  process.exit(1);
}

// 0c. GUARD: COLD checks, before anything is committed or tagged.
//
// `publish.yml` checks with no cache; a local check does not. Editing file A
// does not re-check file B when B's types depend on A, so a stale local cache
// passes what CI fails — and CI fails AFTER the tag is public. That shipped
// binaryen-ts v1.2.4 broken: an orphaned tag, no JSR publish, a burned version.
// `--reload` is not enough: it does not invalidate a resolved dependency
// VERSION, and only a fresh `DENO_DIR` proves the whole chain (cmem
// best-practices.md).
//
// Since Bun migration B7 there is no deno.json and no `deno check`: the Deno
// type check publish.yml still runs is the one inside `deno publish` itself, so
// THAT is what runs here, as a dry run, in an empty `DENO_DIR`. (It caught, the
// day it was written, `import.meta.main` untyped once deno.json was gone.)
//
// Deno comes from npm (`deno`, Deno's own package, pinned in scripts/deno.ts), so no installed
// Deno is needed (owner, 2026-10-28: migrating to Bun). NOT `bunx jsr publish`: with a
// package.json it adds `--no-check`, and Deno refuses `--check` beside it — the dry run would
// check no types (measured on jsr 0.14.3).
const coldDir = await mkdtemp(join(tmpdir(), 'binaryang-release-check-'));
try {
  console.log(`$ DENO_DIR=${coldDir} bun x ${DENO} publish --dry-run --allow-dirty   (cold)`);
  // `env` REPLACES the environment in node:child_process (Deno.Command merged it), so the
  // parent's is spread in: without PATH, `bun` itself would not be found.
  const [denoBin, denoArgv] = denoCommand(['publish', '--dry-run', '--allow-dirty']);
  const cold = spawnSync(denoBin, denoArgv, {
    env: { ...process.env, DENO_DIR: coldDir },
    stdio: 'inherit',
  });
  if (cold.status !== 0) {
    console.error(`\nRefusing to release ${tag}: the cold publish dry run failed.`);
    console.error('  publish.yml would fail the same way, after the tag was public.');
    process.exit(1);
  }
} finally {
  await rm(coldDir, { recursive: true }).catch(() => {});
}
// …and publish.yml's type check (Bun migration B6 / B7): `bun check` over src/, scripts/ and
// tests/ (`tsc` until 2026-10-15). No cache to go stale: `bun check` writes none and checks every
// file every time.
console.log('$ bun run check   (bun check, as publish.yml runs it)');
if (spawnSync('bun', ['run', 'check'], { stdio: 'inherit' }).status !== 0) {
  console.error(`\nRefusing to release ${tag}: the type check failed.`);
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

// 3. Push `main` ONLY, as a user (the run's actor is who JSR authorises), and read it back.
await run(['git', 'push', 'origin', 'main']);
const head = (await capture(['git', 'rev-parse', 'HEAD'])).trim();
const remoteMain =
  (await capture(['git', 'ls-remote', 'origin', 'refs/heads/main'])).split(/\s/)[0];
if (remoteMain !== head) {
  console.error(`\nThe push did not read back: origin main is ${remoteMain}, HEAD is ${head}.`);
  process.exit(1);
}

console.log(`\nPushed main = ${head} (read back). publish.yml releases ${tag} from it:`);
console.log(`  https://github.com/synapticforge1/binaryang/actions`);
console.log('');
console.log("Its jobs, in the owner's order: checks (is it a release, both registries free,");
console.log('compatibility gate, check, both test legs, JSR dry run) -> tag (CI tags this');
console.log('commit) -> release (the GitHub Release page) -> jsr (deno publish, provenance read');
console.log('back) -> npm (the proven tarball, provenance read back). Read every job; a failure');
console.log('is "Re-run failed jobs", never a new tag.');
