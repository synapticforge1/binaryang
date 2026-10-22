/**
 * @module scripts/release/bump_version
 *
 * Bumps `jsr.json` `version` (and `main.ts`'s `VERSION` literal) to the next SemVer version at
 * the chosen level (see `./version.ts` for the rule). Prints the old → new transition. Does not
 * commit or tag — the release-flow caller handles that.
 *
 * Run:
 *   bun run bump [patch|minor|major] [--dry-run|-n]     (patch when no level is given)
 *
 * @license MIT
 */

import {
  BUMP_LEVELS,
  type BumpLevel,
  MAIN_TS_URL,
  MANIFEST_URL,
  nextVersion,
  readCurrentVersion,
  replaceOnce,
  writeAtomic,
} from './version.ts';

import { readFile } from 'node:fs/promises';
import process from 'node:process';

// GUARD: this script MUTATES jsr.json, and it read no arguments at all -- so
// `bun run bump --dry-run` silently performed a real bump and reported it in
// the same "1.4.1 -> 1.4.2" form a dry run would have used. That happened while
// checking what the next version WOULD be, and only a failing assertion
// downstream revealed the file had already moved.
//
// `--dry-run` now works, and anything unrecognised is refused rather than
// ignored. A flag a mutating script does not understand must never be treated
// as consent to mutate. The same holds for the level: one of the three, at most once.
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const levels = args.filter((a): a is BumpLevel => (BUMP_LEVELS as readonly string[]).includes(a));
const unknown = args.filter(
  (a) => a !== '--dry-run' && a !== '-n' && !(BUMP_LEVELS as readonly string[]).includes(a),
);
if (unknown.length > 0 || levels.length > 1) {
  console.error(
    unknown.length > 0
      ? `bump: unrecognised argument(s): ${unknown.join(' ')}`
      : `bump: one level at most, got ${levels.join(' ')}`,
  );
  console.error('Usage: bun run bump [patch|minor|major] [--dry-run|-n]');
  process.exit(2);
}
const level: BumpLevel = levels[0] ?? 'patch';

const current = await readCurrentVersion();
const next = nextVersion(current, level);

if (dryRun) {
  console.log(`${current} -> ${next}   (${level}; dry run: jsr.json and main.ts NOT modified)`);
  process.exit(0);
}

// Both new texts are made BEFORE either file is written, so a version line missing from either
// (or there twice) stops the bump with both files untouched.
//
// `main.ts` carries the version as a LITERAL, because it is the CLI entry point and
// cannot import JSON. Rewrite it here so the two cannot drift -- binaryen-ts reported
// `--version` 1.3.4 through two minor releases while this was a "keep in sync by hand"
// comment. `version_sync.test.ts` is the backstop, and it fails the publish.
//
// This half lived only in binaryen-ts's copy of the script and the wabt-ts copy is the
// one binaryang inherited its task wiring from, so the merged script had a --dry-run
// guard and no main.ts rewrite: the safer script, doing less of the job.
let manifest: string;
let main: string;
try {
  manifest = replaceOnce(
    await readFile(MANIFEST_URL, 'utf8'),
    /("version"\s*:\s*)"[^"]*"/,
    (prefix) => `${prefix}"${next}"`,
    'the `version` field in jsr.json',
  );
  main = replaceOnce(
    await readFile(MAIN_TS_URL, 'utf8'),
    /(const VERSION = ')[^']*(')/,
    (prefix, suffix) => `${prefix}${next}${suffix}`,
    'the `VERSION` constant in main.ts',
  );
} catch (e) {
  console.error(`bump: ${(e as Error).message}; nothing was written.`);
  process.exit(1);
}
await writeAtomic(MANIFEST_URL, manifest);
await writeAtomic(MAIN_TS_URL, main);

console.log(`${current} -> ${next}   (${level})`);
console.log(`main.ts VERSION -> ${next}`);
console.log('');
console.log('Next step:');
console.log('  bun run release');
console.log('');
console.log(
  `That commits the bump, tags v${next}, and pushes both. The tag push triggers`,
);
console.log('publish.yml on GitHub, which runs deno publish with OIDC provenance.');
