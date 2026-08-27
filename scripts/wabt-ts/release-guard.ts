/**
 * @module scripts/release-guard
 *
 * Pure helpers for the release preflight in `scripts/publish.ts`, kept in
 * their own module so they can be TESTED. `publish.ts` is a top-level script
 * with side effects on import (it stages, tags and pushes), so nothing can
 * import it to check its logic — which is how it went four releases claiming
 * in two documents to refuse a dirty tree while having no such check at all
 * (T13.43).
 *
 * @license MIT
 */

/**
 * The path named by one `git status --porcelain` line.
 *
 * The format is two status characters, a space, then the path; a rename is
 * `old -> new` and the NEW path is the one that matters.
 */
export function statusPath(line: string): string {
  const p = line.slice(3);
  const arrow = p.indexOf(' -> ');
  return arrow === -1 ? p : p.slice(arrow + 4);
}

/**
 * The `git status --porcelain` lines that would be left out of a release.
 *
 * `deno.json` is excluded because `publish.ts` stages exactly that file and
 * commits it as the version bump. Everything else — modified, staged, or
 * UNTRACKED — is absent from the tag, and the tag is what JSR publishes.
 *
 * Untracked files count: a new source file that was never committed is
 * missing from the release while every local check still passes, because the
 * file is sitting on disk.
 */
export function releaseBlockers(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .filter((l) => statusPath(l) !== 'deno.json');
}
