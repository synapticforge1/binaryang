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
 * bun scripts/release/workflow.ts oidc-check                    # publish.yml: OIDC env present?
 * bun scripts/release/workflow.ts provenance jsr|npm <version>  # publish.yml: the read-back poll
 * ```
 *
 * Outputs go to `$GITHUB_OUTPUT` and the summary to `$GITHUB_STEP_SUMMARY`, as the bash did; with
 * neither set (a local run) they are printed instead.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { NPM_NAME } from '../npm/build.ts';

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

/** A line into the run's summary page; printed when not on a runner. */
function summary(line: string): void {
  const f = process.env['GITHUB_STEP_SUMMARY'];
  if (f) appendFileSync(f, `${line}\n`);
  else console.log(`(summary) ${line}`);
}

/** The version a `vX.Y.Z` ref names, or null when it is not a version tag. */
export function tagVersion(refName: string): string | null {
  return /^v\d+\.\d+\.\d+$/.test(refName) ? refName.slice(1) : null;
}

/** JSR's version record → its Rekor log id, or '' while (or when) there is none. */
export function jsrRekor(body: string): string {
  try {
    const id = (JSON.parse(body) as { rekorLogId?: string | null }).rekorLogId;
    return id === null || id === undefined ? '' : String(id);
  } catch {
    return '';
  }
}

/** npm's version record → its provenance predicate type, or '' while (or when) there is none. */
export function npmProvenance(body: string): string {
  try {
    const d = (JSON.parse(body) as {
      dist?: { attestations?: { provenance?: { predicateType?: string } } };
    }).dist;
    return d?.attestations?.provenance?.predicateType ?? '';
  } catch {
    return '';
  }
}

/** Where each registry's version record is, for {@link provenance}. */
export function provenanceUrl(registry: 'jsr' | 'npm', jsrName: string, version: string): string {
  if (registry === 'npm') {
    return `https://registry.npmjs.org/${NPM_NAME.replace('/', '%2F')}/${version}`;
  }
  const [scope, name] = jsrName.replace(/^@/, '').split('/') as [string, string];
  return `https://api.jsr.io/scopes/${scope}/packages/${name}/versions/${version}`;
}

/**
 * Polls a registry until the version records provenance: 12 tries, 15 s apart, each read
 * cache-busted. JSR ingests attestation asynchronously AND caches the endpoint, so a plain re-read
 * can keep returning the pre-attestation record for minutes (measured 2026-08-27: wabt-ts@1.5.1
 * read as null repeatedly while the cache-busted read showed rekorLogId 2618866200). Exit 1 when
 * it never appears: the version exists either way, and is immutable.
 */
async function provenance(registry: 'jsr' | 'npm', version: string): Promise<number> {
  const name = registry === 'npm' ? NPM_NAME : jsrManifest().name;
  const url = provenanceUrl(registry, jsrManifest().name, version);
  const read = registry === 'npm' ? npmProvenance : jsrRekor;
  console.log(`Checking ${url}`);
  for (let i = 1; i <= 12; i++) {
    let found = '';
    try {
      const r = await fetch(`${url}?cb=${process.env['GITHUB_RUN_ID'] ?? Date.now()}-${i}`, {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      });
      if (r.ok) found = read(await r.text());
    } catch { /* a transient network error: the next try */ }
    if (found !== '') {
      const what = registry === 'npm' ? `provenance ${found}` : `Rekor log ID ${found}`;
      console.log(`Provenance recorded on ${registry} — ${what}`);
      summary(`- ${registry}: ${name}@${version}, provenance recorded (${what})`);
      return 0;
    }
    if (i < 12) {
      console.log(`  attempt ${i}: not recorded yet, retrying in 15s`);
      await new Promise((res) => setTimeout(res, 15_000));
    }
  }
  console.log(
    registry === 'npm'
      ? `::error::${name}@${version} has no provenance attestation on npm. The version exists and is immutable.`
      : `::error::${name}@${version} published WITHOUT provenance (no Sigstore/Rekor entry). The publish itself SUCCEEDED — this version exists and is immutable. Do NOT 'fix' this by editing permissions or the publish YAML: binaryen-ts's workflow is byte-identical between an unattested (v1.4.3) and an attested (v1.5.0) release, so the YAML is not the variable. Check the OIDC step above, then org/enterprise Settings → Actions → General → OIDC policy, then that the JSR↔GitHub repo link is intact. See cmem/publishing.md.`,
  );
  return 1;
}

/** The subcommand's exit code. */
export async function main(argv: string[]): Promise<number> {
  const [cmd, a, b] = argv;
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
    case 'oidc-check': {
      // publish.yml: the PREREQUISITE only (are the OIDC env vars on the runner?); a diagnostic,
      // not evidence, which is why it warns and never fails.
      const url = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] ?? '';
      const token = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] ?? '';
      if (url !== '' && token !== '') {
        console.log('OIDC token endpoint reachable — provenance can be attempted.');
      } else {
        console.log(
          `::warning::OIDC token NOT available (URL present: ${
            url ? 'yes' : 'no'
          }, TOKEN present: ${
            token ? 'yes' : 'no'
          }). deno publish will skip provenance silently. Check org/enterprise Settings → Actions → General → OIDC policy.`,
        );
      }
      return 0;
    }
    case 'provenance': {
      if ((a !== 'jsr' && a !== 'npm') || b === undefined) break;
      return await provenance(a, b);
    }
  }
  console.error(
    'usage: workflow.ts tag-matches <ref> | tag-check | release-cred | oidc-check | provenance jsr|npm <version>',
  );
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
