// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The GitHub workflows' LOGIC, in TypeScript (owner rule: "any logic with a loop, a condition,
 * polling or result collection goes in a `.ts` file", and the shell only launches it — which
 * reaches the workflows' `run:` blocks too; 2026-10-21). Each workflow step that decided or polled
 * in bash is one subcommand here; the step is now a single `bun scripts/release/workflow.ts …`.
 * `node:` builtins and `fetch` only, so it runs on Bun and Node alike.
 *
 * ```sh
 * bun scripts/release/workflow.ts tag-matches <ref-name>        # publish.yml: jsr.json version = tag
 * bun scripts/release/workflow.ts tag-check                     # auto-tag.yml: version, tag exists?
 * bun scripts/release/workflow.ts release-cred                  # auto-tag.yml: RELEASE_PAT present?
 * ```
 *
 * What publish.yml asks the registries (the OIDC check, the provenance poll, JSR's and npm's
 * version state) moved to `registry.ts` on 2026-11-09, standalone, for the jobs that hold the
 * publishing credential (open-work 54).
 *
 * Outputs go to `$GITHUB_OUTPUT`, as the bash did; unset (a local run), they are printed instead.
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

/** The version a `vX.Y.Z` ref names, or null when it is not a version tag. */
export function tagVersion(refName: string): string | null {
  return /^v\d+\.\d+\.\d+$/.test(refName) ? refName.slice(1) : null;
}

/** The subcommand's exit code (a Promise, as every release script's `main`, for the tests). */
export function main(argv: string[]): Promise<number> {
  return Promise.resolve(decide(argv));
}

function decide(argv: string[]): number {
  const [cmd, a] = argv;
  switch (cmd) {
    case 'tag-matches': {
      // publish.yml: a tag publishes from any branch, so the manifest must name the tag's version.
      const tag = tagVersion(a ?? '');
      const v = jsrManifest().version;
      if (tag !== v) {
        console.log(`::error::Tag version (${tag ?? a}) does not match jsr.json version (${v})`);
        return 1;
      }
      console.log(`Versions match: ${v}`);
      return 0;
    }
    case 'tag-check': {
      // auto-tag.yml: the version, and whether `v<version>` already exists (needs fetch-depth: 0).
      const v = jsrManifest().version;
      const tag = `v${v}`;
      output('version', v);
      console.log(`jsr.json version: ${v}`);
      const r = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
        stdio: 'ignore',
      });
      const exists = r.status === 0;
      output('exists', String(exists));
      console.log(
        exists
          ? `Tag ${tag} already exists — nothing to do.`
          : `Tag ${tag} does not exist — will create + push + dispatch publish.`,
      );
      return 0;
    }
    case 'release-cred': {
      // auto-tag.yml: `secrets` is not dependably readable in a step-level `if:`, so the presence
      // of RELEASE_PAT becomes a yes/no output. The secret itself is never printed.
      const pat = (process.env['RELEASE_PAT'] ?? '') !== '';
      output('pat', pat ? 'yes' : 'no');
      console.log(
        pat
          ? 'RELEASE_PAT is configured — tag push will trigger publish.yml directly.'
          : 'RELEASE_PAT is not configured — will fall back to workflow_dispatch.',
      );
      return 0;
    }
  }
  console.error('usage: workflow.ts tag-matches <ref> | tag-check | release-cred');
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
