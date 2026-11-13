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
 * WHAT it does is `./release-run.ts` (`runRelease`), every guard and every git command, tested
 * with git, the registries and the checks handed in (review round 1, 2026-11-13). This file wires
 * in the real ones: git, JSR and npm, the cold `deno publish --dry-run` in an empty `DENO_DIR`,
 * `bun run check`, and the entry check.
 *
 * Typical flow:
 *   1. bun run bump <level>   # writes the next version into jsr.json and main.ts
 *   2. bun run release        # guards, commits the bump, pushes main (this script)
 *   3. Watch the Actions tab — publish.yml's six jobs; a failure is "Re-run failed jobs" on that
 *      run, never a new tag and never a second `bun run release` (it refuses: nothing to push).
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
 * @license MIT
 */

import { readCurrentVersion } from './version.ts';
import { checkEntry } from './entry-check.ts';
import { DENO, denoCommand } from '../deno.ts';
import { jsrHas, npmState } from './registry.ts';
import { runRelease } from './release-run.ts';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = await readCurrentVersion();
const jsrName = (JSON.parse(readFileSync('jsr.json', 'utf8')) as { name: string }).name;

const code = await runRelease({
  version,
  git(args) {
    console.log(`$ git ${args.join(' ')}`);
    // stdin and stderr pass through, LIVE: git's progress, hook output, a refusal's reason and a
    // credential prompt reach the maintainer as before the refactor (review round 2,
    // 2026-11-13); stdout is captured for the answers the guards read.
    const r = spawnSync('git', args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
    return {
      status: r.status,
      stdout: r.stdout ?? '',
      // Why it failed: git did not start; git was killed (it printed nothing); or nothing here —
      // git's own words were printed live, and release-run says "git's reason above" (rounds 3–5).
      stderr: r.error ? String(r.error) : r.signal ? `git was killed by ${r.signal}` : '',
    };
  },
  jsrHas: (v) => jsrHas({}, jsrName, v),
  npmState: (v) => npmState({}, v),
  // The cold check (binaryen-ts v1.2.4): publish.yml checks with no cache, so a stale local cache
  // passed what CI then failed, after the tag was public. Since Bun migration B7 the Deno type
  // check is the one inside `deno publish`, so THAT runs, as a dry run, in an EMPTY `DENO_DIR`.
  // Deno comes from npm (scripts/deno.ts); never `bunx jsr publish`, which adds `--no-check`.
  coldDryRun() {
    const coldDir = mkdtempSync(join(tmpdir(), 'binaryang-release-check-'));
    try {
      console.log(`$ DENO_DIR=${coldDir} bun x ${DENO} publish --dry-run --allow-dirty   (cold)`);
      // `env` REPLACES the environment in node:child_process, so the parent's is spread in.
      const [denoBin, denoArgv] = denoCommand(['publish', '--dry-run', '--allow-dirty']);
      return spawnSync(denoBin, denoArgv, {
        env: { ...process.env, DENO_DIR: coldDir },
        stdio: 'inherit',
      }).status === 0;
    } finally {
      rmSync(coldDir, { recursive: true, force: true });
    }
  },
  typeCheck() {
    console.log('$ bun run check   (bun check, as publish.yml runs it)');
    return spawnSync('bun', ['run', 'check'], { stdio: 'inherit' }).status === 0;
  },
  entryProblems: () => checkEntry(process.cwd()),
  log: (l) => console.log(l),
  error: (l) => console.error(l),
});
if (code === 0) {
  console.log('  https://github.com/synapticforge1/binaryang/actions');
  console.log(
    "Its jobs, in the owner's order: checks -> tag (CI tags this commit) -> release (the",
  );
  console.log(
    'GitHub Release page) -> jsr -> npm. Read every job; a failure is "Re-run failed jobs",',
  );
  console.log('never a new tag.');
}
process.exit(code);
