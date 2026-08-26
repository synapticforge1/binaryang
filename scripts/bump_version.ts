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

import { DENO_JSON_URL, nextVersion, readCurrentVersion } from './version.ts';

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
console.log('  deno task publish');
console.log('');
console.log(
  `That commits the bump, tags v${next}, and pushes both. The tag push triggers`,
);
console.log('publish.yml on GitHub, which runs deno publish with OIDC provenance.');
