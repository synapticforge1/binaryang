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

const current = await readCurrentVersion();
const next = nextVersion(current);

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

// `main.ts` carries the version as a literal, because it is the CLI entry for Node 18
// as well as Deno and cannot import JSON. Rewrite it here so the two cannot drift —
// `binaryen-ts --version` reported 1.3.4 through two minor releases when this was a
// "keep in sync by hand" comment. `tests/version_sync_test.ts` is the backstop.
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

console.log(`${current} -> ${next}`);
console.log('');
console.log('Next step:');
console.log('  deno task publish');
console.log('');
console.log(
  `That commits the bump, tags v${next}, and pushes both. The tag push triggers`,
);
console.log('publish.yml on GitHub, which runs deno publish with OIDC provenance.');
