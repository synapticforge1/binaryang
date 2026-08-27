/**
 * @module scripts/publish
 *
 * Local release driver. Commits and tags whatever `deno.json` currently says,
 * then pushes commit + tag in a single atomic `git push origin main vX.Y.Z`.
 * The tag push triggers `.github/workflows/publish.yml` on GitHub: developer
 * pushes are authenticated with a PAT (not GITHUB_TOKEN), so the tag push
 * fires the workflow directly without going through the auto-tag detour.
 *
 * Typical flow:
 *   1. deno task bump        # writes the next version into deno.json
 *   2. deno task release     # commits + tags + pushes (this script)
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
import { releaseBlockers } from './release-guard.ts';

async function run(cmd: string[]): Promise<void> {
  console.log(`$ ${cmd.join(' ')}`);
  const p = new Deno.Command(cmd[0]!, {
    args: cmd.slice(1),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await p.output();
  if (code !== 0) {
    console.error(`\nCommand failed with exit code ${code}: ${cmd.join(' ')}`);
    Deno.exit(code);
  }
}

/** Run a command and return its stdout; exits on failure. */
async function capture(cmd: string[]): Promise<string> {
  const p = new Deno.Command(cmd[0]!, { args: cmd.slice(1), stdout: 'piped', stderr: 'piped' });
  const { code, stdout, stderr } = await p.output();
  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
    console.error(`Command failed with exit code ${code}: ${cmd.join(' ')}`);
    Deno.exit(code);
  }
  return new TextDecoder().decode(stdout);
}

const version = await readCurrentVersion();
const tag = `v${version}`;

console.log(`Releasing ${tag}\n`);

// 0. GUARD: refuse on a dirty tree.
//
// The tag this script pushes is exactly what JSR publishes, and this script
// stages `deno.json` and NOTHING ELSE. So on a dirty tree it commits a bare
// version bump, tags that, and publishes a release containing none of the
// work -- and a JSR version is immutable, so the only remedy is to burn
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
  console.error('  This script commits deno.json only. Commit or stash the rest first --');
  console.error('  a published JSR version cannot be replaced.');
  Deno.exit(1);
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
  console.error('  Run `deno task bump` for the next version.');
  Deno.exit(1);
}

// 1. Stage deno.json (only file we touch on a release)
await run(['git', 'add', 'deno.json']);

// 2. Commit only if there's actually something staged. `deno task bump` +
//    `deno task release` is the common path (deno.json is dirty), but if the
//    user already committed the bump manually, skip the no-op commit.
const diffCheck = new Deno.Command('git', {
  args: ['diff', '--cached', '--quiet'],
});
const { code: diffCode } = await diffCheck.output();
if (diffCode !== 0) {
  await run(['git', 'commit', '-m', `bump to ${tag}`]);
} else {
  console.log('(deno.json already committed — skipping commit)\n');
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
console.log('It performs: version verify -> check -> test -> deno publish (with OIDC');
console.log('provenance) -> create GitHub Release.');
