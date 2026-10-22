/**
 * @module scripts/release/version
 *
 * Shared version helpers for the release scripts. binaryang's versioning rule is Semantic
 * Versioning 2.0.0 (owner, 2026-09-20, workspace-wide): a patch is fixes only, a minor a
 * backward-compatible addition (patch resets), a major anything breaking (minor and patch
 * reset). Components are unbounded and nothing carries:
 *
 *   1.14.0 patch → 1.14.1
 *   1.14.0 minor → 1.15.0
 *   1.14.0 major → 2.0.0
 *   1.9.9  patch → 1.9.10
 *
 * 🔧 Until 2026-10-22 this file kept both predecessors' rule, each sub-version capped at 9
 * (`1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`), with no minor mode: every minor from 1.6.0 on was typed
 * by hand, and minors 10–14 were already past the cap, so a patch bump of 1.14.9 would have
 * produced 2.0.0.
 *
 * @license MIT
 */

/**
 * Resolves the repository's package manifest, `jsr.json`, regardless of CWD.
 *
 * The package's name, version and exports live in `jsr.json` and nowhere else
 * (since the Bun migration's first step, 2026-10-12, cmem/bun-migration.md);
 * `deno.json` is gone since B7 (2026-10-13), so `deno publish` reads it by itself.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MANIFEST_URL: URL = new URL('../../jsr.json', import.meta.url);

/** Absolute URL of `main.ts`, which carries the version as a literal (see `bump_version.ts`). */
export const MAIN_TS_URL: URL = new URL('../../main.ts', import.meta.url);

/** Reads the current `version` field from `jsr.json`. */
export async function readCurrentVersion(): Promise<string> {
  const text = await readFile(MANIFEST_URL, 'utf8');
  const data = JSON.parse(text);
  const v = data.version;
  if (typeof v !== 'string') {
    throw new Error(`jsr.json has no string \`version\` field (got ${JSON.stringify(v)})`);
  }
  return v;
}

/** Which component a bump raises. */
export type BumpLevel = 'patch' | 'minor' | 'major';
export const BUMP_LEVELS: readonly BumpLevel[] = ['patch', 'minor', 'major'];

/**
 * The next version under SemVer 2.0.0 at `level`. Throws if `version` is not a plain
 * `major.minor.patch` triple (a pre-release or build suffix is not a version this repo uses).
 */
export function nextVersion(version: string, level: BumpLevel = 'patch'): string {
  const m = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!m) {
    throw new Error(
      `Cannot parse version ${JSON.stringify(version)} — expected "major.minor.patch"`,
    );
  }
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  switch (level) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      throw new Error(`Unknown bump level ${JSON.stringify(level)}`);
  }
}

/**
 * `text` with the ONE match of `pattern` replaced (workspace tooling rule 4: an edit script
 * asserts each match exactly once). Zero matches and two or more both throw, naming `what`:
 * a second `"version"` key, or a second `const VERSION`, must stop the bump, not be skipped.
 */
export function replaceOnce(
  text: string,
  pattern: RegExp,
  replacement: (...groups: string[]) => string,
  what: string,
): string {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  const count = [...text.matchAll(global)].length;
  if (count !== 1) throw new Error(`${what}: expected exactly one match, found ${count}`);
  return text.replace(pattern, (_m, ...groups: string[]) => replacement(...groups));
}

/**
 * Writes `text` to `url` through a temporary file beside it and a rename (workspace tooling rule
 * 4: a write that truncates before it can fail eats the file). The rename replaces the target.
 */
export async function writeAtomic(url: URL, text: string): Promise<void> {
  const path = fileURLToPath(url);
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}
