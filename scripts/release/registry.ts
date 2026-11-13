// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * What publish.yml asks the two registries, in TypeScript (owner rule, 2026-10-21: a condition,
 * loop or poll goes in a `.ts` file; the workflow only launches it).
 *
 * ```sh
 * bun scripts/release/registry.ts oidc-check                     # OIDC env present? (diagnostic)
 * bun scripts/release/registry.ts free <version>                 # neither registry has it, or exit 1
 * bun scripts/release/registry.ts jsr-has <version>              # output present=true|false
 * bun scripts/release/registry.ts jsr-wait <version>             # until JSR answers 200
 * bun scripts/release/registry.ts npm-state <version>            # state=free|published; burned → exit 1
 * bun scripts/release/registry.ts npm-digest <dir>              # the one .tgz's sha256; output sha256=
 * bun scripts/release/registry.ts npm-tarball <dir> <v> <sha256> # that .tgz, checked; output tarball=
 * bun scripts/release/registry.ts provenance jsr|npm <version>   # the read-back poll
 * ```
 *
 * **Standalone on purpose** (open-work 54; workspace correspondence C30 / C34): `node:` builtins
 * and `fetch` only, no import from this repository, `jsr.json` the one file read. The two jobs
 * that hold the publishing credential (`id-token: write`) check out this file and the files they
 * publish, and install nothing, so no third-party code runs beside that credential.
 * Every request has its own time limit.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { gunzipSync } from 'node:zlib';

/** The npm package's name. `scripts/npm/build.ts` owns it; a test holds the two equal. */
export const NPM_NAME = '@synapticforge1/binaryang';

/** Injectable for the tests: the network and the clock. */
export interface Net {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Per request; 30 s by default. */
  timeoutMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

async function get(net: Net, url: string): Promise<{ status: number; text: string }> {
  const f = net.fetch ?? fetch;
  const r = await f(url, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(net.timeoutMs ?? 30_000),
  });
  return { status: r.status, text: await r.text() };
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

function jsrManifest(): { name: string; version: string } {
  return JSON.parse(readFileSync('jsr.json', 'utf8')) as { name: string; version: string };
}

/** JSR's version record for `@scope/name@version`. */
export function jsrVersionUrl(jsrName: string, version: string): string {
  const [scope, name] = jsrName.replace(/^@/, '').split('/') as [string, string];
  return `https://api.jsr.io/scopes/${scope}/packages/${name}/versions/${version}`;
}

/** Where each registry's version record is, for {@link provenance}. */
export function provenanceUrl(registry: 'jsr' | 'npm', jsrName: string, version: string): string {
  return registry === 'npm'
    ? `https://registry.npmjs.org/${NPM_NAME.replace('/', '%2F')}/${version}`
    : jsrVersionUrl(jsrName, version);
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

/** Whether JSR has the version: 200 → true, 404 → false, anything else throws (never "absent"). */
export async function jsrHas(net: Net, jsrName: string, version: string): Promise<boolean> {
  const r = await get(net, `${jsrVersionUrl(jsrName, version)}?cb=${Date.now()}`);
  if (r.status === 200) return true;
  if (r.status === 404) return false;
  throw new Error(`JSR answered HTTP ${r.status} for ${jsrName}@${version}`);
}

/**
 * Waits until JSR answers 200 for the version: the jobs after the upload run on `uploaded`, not
 * on `deno publish`'s exit (C34 — it uploads, THEN signs, so a failure after the upload must not
 * strand the version), and each first proves the upload happened. 12 tries, 15 s apart.
 */
export async function jsrWait(net: Net, jsrName: string, version: string): Promise<boolean> {
  const sleep = net.sleep ?? realSleep;
  for (let i = 1; i <= 12; i++) {
    try {
      if (await jsrHas(net, jsrName, version)) return true;
    } catch { /* a transient answer: the next try */ }
    if (i < 12) await sleep(15_000);
  }
  return false;
}

/**
 * The version's state on npm, read from the package document: `published` when npm serves it,
 * `burned` when npm has used the number before (its `time` keeps every number, an unpublished one
 * included, and npm never reuses one — C34), `free` otherwise. A package npm has never seen (404)
 * is `free`; any other answer throws.
 */
export async function npmState(
  net: Net,
  version: string,
): Promise<'free' | 'published' | 'burned'> {
  const r = await get(net, `https://registry.npmjs.org/${NPM_NAME.replace('/', '%2F')}`);
  if (r.status === 404) return 'free';
  if (r.status !== 200) throw new Error(`npm answered HTTP ${r.status} for ${NPM_NAME}`);
  const doc = JSON.parse(r.text) as {
    versions?: Record<string, unknown>;
    time?: Record<string, unknown>;
  };
  if (doc.versions?.[version] !== undefined) return 'published';
  if (doc.time?.[version] !== undefined) return 'burned';
  return 'free';
}

/** One file's text from an uncompressed tar: 512-byte headers, name at 0, octal size at 124. */
function tarFile(tar: Uint8Array, name: string): string {
  const text = new TextDecoder();
  for (let p = 0; p + 512 <= tar.length;) {
    const header = tar.subarray(p, p + 512);
    const n = text.decode(header.subarray(0, 100)).replace(/\0.*$/s, '');
    if (n === '') break;
    const size = parseInt(text.decode(header.subarray(124, 136)).replace(/\0.*$/s, '').trim(), 8);
    if (n === name) return text.decode(tar.subarray(p + 512, p + 512 + size));
    p += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${name} is not in the tarball`);
}

/**
 * What is wrong with the tarball the `npm` job is about to publish, or [] (C30: the credential's
 * job publishes a BUILT artifact, and refuses one whose manifest could run code — `npm publish
 * --ignore-scripts` skips lifecycle scripts too, this makes a scripted manifest a stop, not a skip).
 */
export function tarballProblems(tgz: Uint8Array, version: string): string[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(tarFile(gunzipSync(tgz), 'package/package.json')) as Record<string, unknown>;
  } catch (e) {
    return [`no readable package/package.json: ${(e as Error).message}`];
  }
  const p: string[] = [];
  if (m['name'] !== NPM_NAME) p.push(`name is ${String(m['name'])}, not ${NPM_NAME}`);
  if (m['version'] !== version) p.push(`version is ${String(m['version'])}, not ${version}`);
  const scripts = m['scripts'] as Record<string, unknown> | undefined;
  if (scripts !== undefined && Object.keys(scripts).length > 0) {
    p.push(`the manifest has scripts (${Object.keys(scripts).join(', ')})`);
  }
  const pc = m['publishConfig'] as { provenance?: unknown } | undefined;
  if (pc?.provenance !== true) p.push('publishConfig.provenance is not true');
  return p;
}

/**
 * The tarball as `npm publish` must be given it: an ABSOLUTE path. npm reads `dir/name.tgz` as a
 * GitHub shorthand (`dir/<repo>`) and runs `git ls-remote` against github.com — what failed
 * 3.0.1's npm job (reproduced with npm 11: "git … ls-remote ssh://git@github.com/npm-pack/…").
 */
export function tarballSpec(file: string): string {
  return resolve(file);
}

/**
 * Polls a registry until the version records provenance: 12 tries, 15 s apart, each read
 * cache-busted. JSR ingests attestation asynchronously AND caches the endpoint, so a plain re-read
 * can keep returning the pre-attestation record for minutes (measured 2026-08-27: wabt-ts@1.5.1
 * read as null repeatedly while the cache-busted read showed rekorLogId 2618866200). Exit 1 when
 * it never appears: the version exists either way, and is immutable.
 */
async function provenance(net: Net, registry: 'jsr' | 'npm', version: string): Promise<number> {
  const sleep = net.sleep ?? realSleep;
  const name = registry === 'npm' ? NPM_NAME : jsrManifest().name;
  const url = provenanceUrl(registry, jsrManifest().name, version);
  const read = registry === 'npm' ? npmProvenance : jsrRekor;
  console.log(`Checking ${url}`);
  for (let i = 1; i <= 12; i++) {
    let found = '';
    try {
      const r = await get(net, `${url}?cb=${process.env['GITHUB_RUN_ID'] ?? Date.now()}-${i}`);
      if (r.status === 200) found = read(r.text);
    } catch { /* a transient network error: the next try */ }
    if (found !== '') {
      const what = registry === 'npm' ? `provenance ${found}` : `Rekor log ID ${found}`;
      console.log(`Provenance recorded on ${registry} — ${what}`);
      summary(`- ${registry}: ${name}@${version}, provenance recorded (${what})`);
      return 0;
    }
    if (i < 12) {
      console.log(`  attempt ${i}: not recorded yet, retrying in 15s`);
      await sleep(15_000);
    }
  }
  console.log(
    registry === 'npm'
      ? `::error::${name}@${version} has no provenance attestation on npm. The version exists and is immutable.`
      : `::error::${name}@${version} published WITHOUT provenance (no Sigstore/Rekor entry). The publish itself SUCCEEDED — this version exists and is immutable. Do NOT 'fix' this by editing permissions or the publish YAML: binaryen-ts's workflow is byte-identical between an unattested (v1.4.3) and an attested (v1.5.0) release, so the YAML is not the variable. Check the OIDC step above, then org/enterprise Settings → Actions → General → OIDC policy, then that the JSR↔GitHub repo link is intact. See cmem/publishing.md.`,
  );
  return 1;
}

const USAGE =
  'usage: registry.ts oidc-check | free <v> | jsr-has <v> | jsr-wait <v> | npm-state <v> | npm-digest <dir> | npm-tarball <dir> <v> <sha256> | provenance jsr|npm <v>';

/** The sha256 of `bytes`, hex. */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The one `.tgz` in `dir`, as an absolute path, or `undefined` having said why. */
function oneTarball(dir: string): string | undefined {
  const tgzs = readdirSync(dir).filter((f) => f.endsWith('.tgz'));
  if (tgzs.length !== 1) {
    console.log(`::error::expected one .tgz in ${dir}, found ${tgzs.length}`);
    return undefined;
  }
  return tarballSpec(join(dir, tgzs[0] as string));
}

/** The subcommand's exit code. */
export async function main(argv: string[], net: Net = {}): Promise<number> {
  const [cmd, a, b, c] = argv;
  const isVersion = (v: string | undefined): v is string => /^\d+\.\d+\.\d+$/.test(v ?? '');
  switch (cmd) {
    case 'oidc-check': {
      // The PREREQUISITE only (are the OIDC env vars on the runner?); a diagnostic, not evidence,
      // which is why it warns and never fails.
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
    case 'jsr-has': {
      if (!isVersion(a)) break;
      const has = await jsrHas(net, jsrManifest().name, a);
      output('present', String(has));
      console.log(
        has ? `JSR already has ${a}: the upload is skipped (a re-run)` : `JSR has no ${a} yet`,
      );
      return 0;
    }
    case 'jsr-wait': {
      if (!isVersion(a)) break;
      if (await jsrWait(net, jsrManifest().name, a)) {
        console.log(`JSR serves ${a}`);
        return 0;
      }
      console.log(`::error::JSR never answered 200 for ${a}: the upload did not happen`);
      return 1;
    }
    case 'free': {
      // publish.yml `checks`, for a NEW release, before CI tags anything (D1): neither registry
      // may know the number. JSR versions are immutable; npm never reuses one (C34 (2)).
      if (!isVersion(a)) break;
      const onJsr = await jsrHas(net, jsrManifest().name, a);
      const s = await npmState(net, a);
      console.log(`${a}: JSR ${onJsr ? 'HAS it' : 'free'}; npm ${s}`);
      if (onJsr || s !== 'free') {
        console.log(
          `::error::${a} is not free on both registries (JSR ${
            onJsr ? 'has it' : 'free'
          }, npm ${s}): refused before the tag. Bump the version.`,
        );
        return 1;
      }
      return 0;
    }
    case 'npm-state': {
      if (!isVersion(a)) break;
      const s = await npmState(net, a);
      output('state', s);
      console.log(`npm: ${NPM_NAME}@${a} is ${s}`);
      if (s === 'burned') {
        console.log(
          `::error::npm has used ${a} before (unpublished numbers are never reused). Bump the version before JSR publishes a number npm refuses.`,
        );
        return 1;
      }
      return 0;
    }
    case 'npm-digest': {
      // npm-build, after packing: the tarball's sha256, handed to the npm job as a job output.
      if (a === undefined) break;
      const file = oneTarball(a);
      if (file === undefined) return 1;
      const digest = sha256(new Uint8Array(readFileSync(file)));
      output('sha256', digest);
      console.log(`${file}: sha256 ${digest}`);
      return 0;
    }
    case 'npm-tarball': {
      if (a === undefined || !isVersion(b) || !/^[0-9a-f]{64}$/.test(c ?? '')) break;
      const file = oneTarball(a);
      if (file === undefined) return 1;
      const bytes = new Uint8Array(readFileSync(file));
      const problems = tarballProblems(bytes, b);
      // The tarball npm-build PROVED, byte for byte (security review round 1, C12, 2026-11-13):
      // the artifact is looked up by name, and a manifest check alone passes any other tarball
      // with the same name, version and fields.
      const digest = sha256(bytes);
      if (digest !== c) problems.push(`sha256 is ${digest}, not ${c}, the one npm-build packed`);
      for (const p of problems) console.log(`::error::${file}: ${p}`);
      if (problems.length > 0) return 1;
      output('tarball', file);
      console.log(`${file}: ${NPM_NAME}@${b}, the packed bytes, no scripts, provenance on`);
      return 0;
    }
    case 'provenance': {
      if ((a !== 'jsr' && a !== 'npm') || !isVersion(b)) break;
      return await provenance(net, a, b);
    }
  }
  console.error(USAGE);
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
