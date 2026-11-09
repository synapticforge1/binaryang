// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The workflows' two GitHub writes, through GitHub's REST API with the job's own `GITHUB_TOKEN`
 * (owner, 2026-11-08, workspace letter H30: no `gh`, in CI too). It replaces `gh workflow run`
 * (auto-tag.yml) and `gh release create` (publish.yml).
 *
 * ```sh
 * bun scripts/release/github.ts dispatch <workflow-file> <ref>   # auto-tag.yml's fallback
 * bun scripts/release/github.ts release <tag>                    # publish.yml's `release` job
 * ```
 *
 * `release` follows the workspace's order (letter H32, owner 2026-11-09), and keeps it:
 *   1. the tag EXISTS on GitHub and peels (annotated tags followed) to `GITHUB_SHA` — because
 *      `POST /releases` CREATES a tag that is missing;
 *   2. a Release already there for the tag is done: no write, so a re-run is safe;
 *   3. `POST` with GitHub's generated notes and the JSR link on top, then read the page back
 *      and check the tag again.
 * Every request has its own time limit.
 *
 * Standalone on purpose: `node:` builtins and `fetch`, no import from this repository, and only
 * `jsr.json` read. The `release` job checks out THIS file and `jsr.json` alone and installs
 * nothing, so no package code runs beside the write token (workspace correspondence C30).
 * Reads `GITHUB_API_URL`, `GITHUB_REPOSITORY`, `GITHUB_SHA` and `GITHUB_TOKEN`.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

/** What a GitHub call needs; `fetch` is injectable so the tests run against a mock API. */
export interface GitHub {
  /** e.g. `https://api.github.com` */
  api: string;
  /** `owner/name` */
  repo: string;
  token: string;
  fetch?: typeof fetch;
  /** Per request; 30 s by default. */
  timeoutMs?: number;
}

/** A response's status and parsed JSON body (`null` when there is none, or it is not JSON). */
interface Reply {
  status: number;
  body: Record<string, unknown> | null;
}

async function call(gh: GitHub, method: string, path: string, payload?: unknown): Promise<Reply> {
  const f = gh.fetch ?? fetch;
  const r = await f(`${gh.api}/repos/${gh.repo}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${gh.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'binaryang-release',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload === undefined ? null : JSON.stringify(payload),
    signal: AbortSignal.timeout(gh.timeoutMs ?? 30_000),
  });
  const text = await r.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text === '' ? null : (JSON.parse(text) as Record<string, unknown>);
  } catch { /* not JSON: the status says enough */ }
  return { status: r.status, body };
}

/** A git object reference as the API returns it: `{ type, sha }`. */
function objectOf(body: Record<string, unknown> | null): { type: string; sha: string } | null {
  const o = body?.['object'] as { type?: unknown; sha?: unknown } | undefined;
  return typeof o?.type === 'string' && typeof o.sha === 'string'
    ? { type: o.type, sha: o.sha }
    : null;
}

/**
 * The commit a tag names on GitHub, annotated tags followed; `null` when the tag is not there.
 * Throws on anything else, so a broken read is never taken for "absent".
 */
export async function peelTag(gh: GitHub, tag: string): Promise<string | null> {
  const ref = await call(gh, 'GET', `/git/ref/tags/${encodeURIComponent(tag)}`);
  if (ref.status === 404) return null;
  if (ref.status !== 200) throw new Error(`reading tag ${tag}: HTTP ${ref.status}`);
  let obj = objectOf(ref.body);
  for (let depth = 0; obj !== null && obj.type === 'tag' && depth < 8; depth++) {
    const t = await call(gh, 'GET', `/git/tags/${obj.sha}`);
    if (t.status !== 200) throw new Error(`peeling tag ${tag}: HTTP ${t.status}`);
    obj = objectOf(t.body);
  }
  if (obj === null || obj.type !== 'commit') {
    throw new Error(`tag ${tag} does not peel to a commit (${obj?.type ?? 'no object'})`);
  }
  return obj.sha;
}

/** The outcome of {@link release}: the exit code and what to print. */
export interface Outcome {
  code: number;
  lines: string[];
}

/** H32's three steps, in their order. Never creates a tag. */
export async function release(
  gh: GitHub,
  o: { tag: string; sha: string; jsrName: string; version: string },
): Promise<Outcome> {
  const lines: string[] = [];
  const fail = (m: string): Outcome => ({ code: 1, lines: [...lines, `::error::${m}`] });

  // 1. The tag is on GitHub and names the commit this run built.
  const peeled = await peelTag(gh, o.tag);
  if (peeled === null) {
    return fail(`tag ${o.tag} is not on GitHub; no Release made (POST /releases would CREATE it)`);
  }
  if (peeled !== o.sha) {
    return fail(`tag ${o.tag} names ${peeled}, but this run built ${o.sha}; no Release made`);
  }
  lines.push(`Tag ${o.tag} peels to ${o.sha}`);

  // 2. A page already there is done.
  const path = `/releases/tags/${encodeURIComponent(o.tag)}`;
  const before = await call(gh, 'GET', path);
  if (before.status === 200) {
    lines.push(
      `Release ${o.tag} already exists: ${String(before.body?.['html_url'])} — nothing to do`,
    );
    return { code: 0, lines };
  }
  if (before.status !== 404) return fail(`reading release ${o.tag}: HTTP ${before.status}`);

  // 3. Create, read back, check the tag again.
  const made = await call(gh, 'POST', '/releases', {
    tag_name: o.tag,
    name: `binaryang ${o.tag}`,
    body: `JSR: https://jsr.io/${o.jsrName}@${o.version}`,
    generate_release_notes: true,
  });
  if (made.status !== 201) return fail(`creating release ${o.tag}: HTTP ${made.status}`);
  const after = await call(gh, 'GET', path);
  if (after.status !== 200 || after.body?.['tag_name'] !== o.tag) {
    return fail(`release ${o.tag} was created but does not read back (HTTP ${after.status})`);
  }
  const again = await peelTag(gh, o.tag);
  if (again !== o.sha) return fail(`after the release, tag ${o.tag} names ${again}, not ${o.sha}`);
  const author = (after.body?.['author'] as { login?: unknown } | undefined)?.login;
  lines.push(
    `Release ${o.tag} created: ${String(after.body['html_url'])} (author ${String(author)})`,
  );
  return { code: 0, lines };
}

/** `POST …/actions/workflows/<file>/dispatches`; GitHub answers 204 when it is accepted. */
export async function dispatch(gh: GitHub, workflow: string, ref: string): Promise<Outcome> {
  const r = await call(
    gh,
    'POST',
    `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      ref,
    },
  );
  return r.status === 204
    ? { code: 0, lines: [`Dispatched ${workflow} on ref ${ref}`] }
    : { code: 1, lines: [`::error::dispatching ${workflow} on ${ref}: HTTP ${r.status}`] };
}

/** The runner's GitHub settings, or the name of the first one missing. */
function fromEnv(): GitHub | string {
  const env = process.env;
  const repo = env['GITHUB_REPOSITORY'] ?? '';
  const token = env['GITHUB_TOKEN'] ?? '';
  if (repo === '') return 'GITHUB_REPOSITORY';
  if (token === '') return 'GITHUB_TOKEN';
  return { api: env['GITHUB_API_URL'] || 'https://api.github.com', repo, token };
}

/** The subcommand's exit code. */
export async function main(argv: string[]): Promise<number> {
  const [cmd, a, b] = argv;
  if (!((cmd === 'release' && a) || (cmd === 'dispatch' && a && b))) {
    console.error('usage: github.ts release <tag> | dispatch <workflow-file> <ref>');
    return 2;
  }
  const gh = fromEnv();
  if (typeof gh === 'string') {
    console.log(`::error::${gh} is not set`);
    return 1;
  }
  let out: Outcome;
  if (cmd === 'dispatch') {
    out = await dispatch(gh, a, b as string);
  } else {
    const sha = process.env['GITHUB_SHA'] ?? '';
    if (sha === '') {
      console.log('::error::GITHUB_SHA is not set');
      return 1;
    }
    const m = JSON.parse(readFileSync('jsr.json', 'utf8')) as { name: string; version: string };
    if (`v${m.version}` !== a) {
      console.log(`::error::tag ${a} is not jsr.json's version (${m.version})`);
      return 1;
    }
    out = await release(gh, { tag: a, sha, jsrName: m.name, version: m.version });
  }
  for (const l of out.lines) console.log(l);
  return out.code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
