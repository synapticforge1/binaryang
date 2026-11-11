// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The GitHub workflows' LOGIC, in TypeScript (owner rule: "any logic with a loop, a condition,
 * polling or result collection goes in a `.ts` file", and the shell only launches it — which
 * reaches the workflows' `run:` blocks too; 2026-10-21). Each workflow step that decides is one
 * subcommand here. `node:` builtins only, so it runs on Bun and Node alike.
 *
 * ```sh
 * bun scripts/release/workflow.ts release-state   # publish.yml `checks`: is this push a release?
 * ```
 *
 * 🔒 The owner's order (2026-11-10, workspace letter H33, `release-process.md` § 5 / § 8 D1): "the
 * CI to check first, then push the tag, and then create the release page from the tag, then
 * publish the package to the registry". `bun run release` pushes `main` only; publish.yml runs on
 * every push to `main` and asks THIS question first. Until 2026-11-10 a tag pushed from the
 * owner's machine started publish.yml, and auto-tag.yml (retired) tagged a bump `bun run release`
 * had not.
 *
 * What publish.yml asks the registries (the OIDC check, the provenance poll, JSR's and npm's
 * version state) is `registry.ts`, standalone, for the jobs that hold the publishing credential
 * (open-work 54).
 *
 * Outputs go to `$GITHUB_OUTPUT`; unset (a local run), they are printed instead.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

/** The package manifest, read from the repository root (where the workflows run). */
function jsrManifest(): { name: string; version: string } {
  return JSON.parse(readFileSync('jsr.json', 'utf8')) as { name: string; version: string };
}

/** `key=value` into the step's outputs; printed when not on a runner. */
function output(key: string, value: string): void {
  const f = process.env['GITHUB_OUTPUT'];
  if (f) appendFileSync(f, `${key}=${value}\n`);
  else console.log(`(output) ${key}=${value}`);
}

/**
 * What a push of `main` is, from the manifest's version and where its tag stands on GitHub:
 * - `new` — no `v<version>` tag yet: a release, CI tags this commit;
 * - `rerun` — the tag is on THIS commit: a re-run of a release (each job skips what is done);
 * - `released` — the tag is on another commit: an ordinary push, nothing to release.
 */
export type ReleaseState = 'new' | 'rerun' | 'released';

/** {@link ReleaseState} from the commit the tag peels to on GitHub (`null`: no tag). */
export function releaseState(tagCommit: string | null, sha: string): ReleaseState {
  if (tagCommit === null) return 'new';
  return tagCommit === sha ? 'rerun' : 'released';
}

/** A release version is a plain `major.minor.patch` (SemVer 2.0.0, no suffix). */
export function isReleaseVersion(v: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);
}

/**
 * The commit `tag` peels to on `origin` (annotated tags followed: `^{}` wins), `null` when the
 * tag is not there. Read with `git ls-remote`, never the local tags: GitHub is what CI tags. A
 * failed read throws — it is never taken for "no tag".
 */
export function lsRemoteTagCommit(lsRemoteOutput: string, tag: string): string | null {
  let direct: string | null = null;
  let peeled: string | null = null;
  for (const line of lsRemoteOutput.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha === undefined || ref === undefined) continue;
    if (ref === `refs/tags/${tag}^{}`) peeled = sha;
    else if (ref === `refs/tags/${tag}`) direct = sha;
  }
  return peeled ?? direct;
}

/** The subcommand's exit code (a Promise, as every release script's `main`, for the tests). */
export function main(argv: string[]): Promise<number> {
  return Promise.resolve(decide(argv));
}

function decide(argv: string[]): number {
  const [cmd] = argv;
  if (cmd === 'release-state' && argv.length === 1) {
    const sha = process.env['GITHUB_SHA'] ?? '';
    if (sha === '') {
      console.log('::error::GITHUB_SHA is not set');
      return 1;
    }
    const version = jsrManifest().version;
    const tag = `v${version}`;
    const r = spawnSync(
      'git',
      ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      console.log(`::error::git ls-remote origin failed (exit ${r.status}): ${r.stderr.trim()}`);
      return 1;
    }
    const at = lsRemoteTagCommit(r.stdout, tag);
    const state = releaseState(at, sha);
    console.log(`jsr.json ${version}; tag ${tag} on GitHub: ${at ?? '(absent)'} -> ${state}`);
    if (state === 'released') {
      output('release', 'false');
      return 0;
    }
    if (!isReleaseVersion(version)) {
      console.log(`::error::jsr.json's version ${version} is not a release version`);
      return 1;
    }
    output('release', 'true');
    output('state', state);
    output('version', version);
    output('tag', tag);
    return 0;
  }
  console.error('usage: workflow.ts release-state');
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
