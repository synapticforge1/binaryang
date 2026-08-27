/**
 * @module scripts/bump_version
 *
 * Bumps `deno.json` `version` to the next value under the sub-version-
 * capped-at-9 rule (see `./version.ts` for the rule). Prints the old → new
 * transition. Does not commit or tag — the release-flow caller handles that.
 *
 * Run:
 *   deno task bump
 *
 * @license MIT
 */

import { DENO_JSON_URL, MAIN_TS_URL, nextVersion, readCurrentVersion } from './version.ts';

// GUARD: this script MUTATES deno.json, and it read no arguments at all -- so
// `deno task bump --dry-run` silently performed a real bump and reported it in
// the same "1.4.1 -> 1.4.2" form a dry run would have used. That happened while
// checking what the next version WOULD be, and only a failing assertion
// downstream revealed the file had already moved.
//
// `--dry-run` now works, and anything unrecognised is refused rather than
// ignored. A flag a mutating script does not understand must never be treated
// as consent to mutate.
const args = Deno.args;
const dryRun = args.includes('--dry-run') || args.includes('-n');
const unknown = args.filter((a) => a !== '--dry-run' && a !== '-n');
if (unknown.length > 0) {
  console.error(`bump: unrecognised argument(s): ${unknown.join(' ')}`);
  console.error('Usage: deno task bump [--dry-run|-n]');
  Deno.exit(2);
}

const current = await readCurrentVersion();
const next = nextVersion(current);

if (dryRun) {
  console.log(`${current} -> ${next}   (dry run: deno.json NOT modified)`);
  Deno.exit(0);
}

const text = await Deno.readTextFile(DENO_JSON_URL);
const updated = text.replace(
  /("version"\s*:\s*)"[^"]*"/,
  (_match, prefix) => `${prefix}"${next}"`,
);
if (updated === text) {
  console.error('Could not locate the `version` field in deno.json to rewrite.');
  Deno.exit(1);
}
await Deno.writeTextFile(DENO_JSON_URL, updated);

console.log(`${current} -> ${next}`);
console.log('');
console.log('Next step:');
console.log('  deno task release');
console.log('');
console.log(
  `That commits the bump, tags v${next}, and pushes both. The tag push triggers`,
);
console.log('publish.yml on GitHub, which runs deno publish with OIDC provenance.');

// `main.ts` carries the version as a LITERAL, because it is the CLI entry point and
// cannot import JSON. Rewrite it here so the two cannot drift -- binaryen-ts reported
// `--version` 1.3.4 through two minor releases while this was a "keep in sync by hand"
// comment. `version_sync.test.ts` is the backstop, and it fails the publish.
//
// This half lived only in binaryen-ts's copy of the script and the wabt-ts copy is the
// one binaryang inherited its task wiring from, so the merged script had a --dry-run
// guard and no main.ts rewrite: the safer script, doing less of the job.
const mainText = await Deno.readTextFile(MAIN_TS_URL);
const mainUpdated = mainText.replace(
  /(const VERSION = ')[^']*(')/,
  (_match, prefix, suffix) => `${prefix}${next}${suffix}`,
);
if (mainUpdated === mainText) {
  console.error('Could not locate the `VERSION` constant in main.ts to rewrite.');
  Deno.exit(1);
}
await Deno.writeTextFile(MAIN_TS_URL, mainUpdated);
console.log(`main.ts VERSION -> ${next}`);
