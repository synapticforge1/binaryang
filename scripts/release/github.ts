// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The workflows' two GitHub writes, through GitHub's REST API with the job's own `GITHUB_TOKEN`
 * (owner, 2026-11-08, workspace letter H30: no GitHub CLI, in CI too).
 *
 * ```sh
 * bun scripts/release/github.ts tag <tag>       # publish.yml's `tag` job: CI tags the commit
 * bun scripts/release/github.ts release <tag>   # publish.yml's `release` job: the page
 * ```
 *
 * 🔒 The owner's order (2026-11-10, workspace letter H33, D1): checks, then CI pushes the tag,
 * then the Release page from the tag, then the publish. `tag`:
 *   1. the tag already on GitHub at `GITHUB_SHA` is done (a re-run); on any other commit it is
 *      refused — a published tag never moves;
 *   2. otherwise `POST /git/tags` (an annotated tag object on `GITHUB_SHA`) and `POST /git/refs`,
 *      then read the tag back and require it to peel to `GITHUB_SHA`.
 * A tag made with `GITHUB_TOKEN` starts no workflow run, so publish.yml runs the page and the
 * publish in the SAME run (`needs:`).
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
 * `jsr.json` read. The `tag` and `release` jobs check out THIS file and `jsr.json` alone and
 * install nothing, so no package code runs beside the write token (workspace correspondence C30).
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

async function call(hub: GitHub, method: string, path: string, payload?: unknown): Promise<Reply> {
  const f = hub.fetch ?? fetch;
  const r = await f(`${hub.api}/repos/${hub.repo}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${hub.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'binaryang-release',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload === undefined ? null : JSON.stringify(payload),
    signal: AbortSignal.timeout(hub.timeoutMs ?? 30_000),
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
export async function peelTag(hub: GitHub, tag: string): Promise<string | null> {
  const ref = await call(hub, 'GET', `/git/ref/tags/${encodeURIComponent(tag)}`);
  if (ref.status === 404) return null;
  if (ref.status !== 200) throw new Error(`reading tag ${tag}: HTTP ${ref.status}`);
  let obj = objectOf(ref.body);
  for (let depth = 0; obj !== null && obj.type === 'tag' && depth < 8; depth++) {
    const t = await call(hub, 'GET', `/git/tags/${obj.sha}`);
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
  hub: GitHub,
  o: { tag: string; sha: string; jsrName: string; version: string },
): Promise<Outcome> {
  const lines: string[] = [];
  const fail = (m: string): Outcome => ({ code: 1, lines: [...lines, `::error::${m}`] });

  // 1. The tag is on GitHub and names the commit this run built.
  const peeled = await peelTag(hub, o.tag);
  if (peeled === null) {
    return fail(`tag ${o.tag} is not on GitHub; no Release made (POST /releases would CREATE it)`);
  }
  if (peeled !== o.sha) {
    return fail(`tag ${o.tag} names ${peeled}, but this run built ${o.sha}; no Release made`);
  }
  lines.push(`Tag ${o.tag} peels to ${o.sha}`);

  // 2. A page already there is done.
  const path = `/releases/tags/${encodeURIComponent(o.tag)}`;
  const before = await call(hub, 'GET', path);
  if (before.status === 200) {
    lines.push(
      `Release ${o.tag} already exists: ${String(before.body?.['html_url'])} — nothing to do`,
    );
    return { code: 0, lines };
  }
  if (before.status !== 404) return fail(`reading release ${o.tag}: HTTP ${before.status}`);

  // 3. Create, read back, check the tag again.
  const made = await call(hub, 'POST', '/releases', {
    tag_name: o.tag,
    name: `binaryang ${o.tag}`,
    body: `JSR: https://jsr.io/${o.jsrName}@${o.version}`,
    generate_release_notes: true,
  });
  if (made.status !== 201) return fail(`creating release ${o.tag}: HTTP ${made.status}`);
  const after = await call(hub, 'GET', path);
  if (after.status !== 200 || after.body?.['tag_name'] !== o.tag) {
    return fail(`release ${o.tag} was created but does not read back (HTTP ${after.status})`);
  }
  const again = await peelTag(hub, o.tag);
  if (again !== o.sha) return fail(`after the release, tag ${o.tag} names ${again}, not ${o.sha}`);
  const author = (after.body?.['author'] as { login?: unknown } | undefined)?.login;
  lines.push(
    `Release ${o.tag} created: ${String(after.body['html_url'])} (author ${String(author)})`,
  );
  return { code: 0, lines };
}

/** CI's annotated tag on the commit `checks` passed (D1). Never moves a tag. */
export async function tag(hub: GitHub, o: { tag: string; sha: string }): Promise<Outcome> {
  const fail = (m: string): Outcome => ({ code: 1, lines: [`::error::${m}`] });

  // 1. Already there: done at this commit, refused anywhere else.
  const at = await peelTag(hub, o.tag);
  if (at === o.sha) {
    return { code: 0, lines: [`Tag ${o.tag} is already on ${o.sha} — nothing to do`] };
  }
  if (at !== null) {
    return fail(`tag ${o.tag} is on ${at}, not this run's ${o.sha}; a published tag never moves`);
  }

  // 2. The tag object, then the ref naming it, then read back.
  const obj = await call(hub, 'POST', '/git/tags', {
    tag: o.tag,
    message: `Release ${o.tag}`,
    object: o.sha,
    type: 'commit',
  });
  const objSha = obj.body?.['sha'];
  if (obj.status !== 201 || typeof objSha !== 'string') {
    return fail(`creating the tag object ${o.tag}: HTTP ${obj.status}`);
  }
  const ref = await call(hub, 'POST', '/git/refs', { ref: `refs/tags/${o.tag}`, sha: objSha });
  if (ref.status !== 201) return fail(`creating refs/tags/${o.tag}: HTTP ${ref.status}`);
  const again = await peelTag(hub, o.tag);
  if (again !== o.sha) {
    return fail(`tag ${o.tag} was created but reads back as ${again ?? 'absent'}, not ${o.sha}`);
  }
  return { code: 0, lines: [`Tag ${o.tag} created on ${o.sha} (object ${objSha}), read back`] };
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
  const [cmd, a] = argv;
  if (!((cmd === 'release' || cmd === 'tag') && a && argv.length === 2)) {
    console.error('usage: github.ts tag <tag> | release <tag>');
    return 2;
  }
  const hub = fromEnv();
  if (typeof hub === 'string') {
    console.log(`::error::${hub} is not set`);
    return 1;
  }
  const sha = process.env['GITHUB_SHA'] ?? '';
  if (sha === '') {
    console.log('::error::GITHUB_SHA is not set');
    return 1;
  }
  // Both writes name jsr.json's version and nothing else.
  const m = JSON.parse(readFileSync('jsr.json', 'utf8')) as { name: string; version: string };
  if (`v${m.version}` !== a) {
    console.log(`::error::tag ${a} is not jsr.json's version (${m.version})`);
    return 1;
  }
  const out = cmd === 'tag'
    ? await tag(hub, { tag: a, sha })
    : await release(hub, { tag: a, sha, jsrName: m.name, version: m.version });
  for (const l of out.lines) console.log(l);
  return out.code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
