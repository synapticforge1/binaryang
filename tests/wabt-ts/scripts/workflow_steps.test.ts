// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { expect } from '@std/expect';
import {
  jsrRekor,
  main,
  npmProvenance,
  provenanceUrl,
  tagVersion,
} from '../../../scripts/release/workflow.ts';
import { dispatch, main as githubMain, peelTag, release } from '../../../scripts/release/github.ts';

// The workflows' decisions moved out of bash into scripts/release/workflow.ts (owner rule,
// 2026-10-21: a condition or a loop goes in a .ts file, the shell only launches it). These pin
// what the bash did: the outputs auto-tag.yml's `if:`s read, the exit codes publish.yml stops on,
// and the two registries' provenance fields. The poll's network loop is not run here.

const jsr = JSON.parse(readFileSync('jsr.json', 'utf8')) as { name: string; version: string };

/** Runs a subcommand with GITHUB_OUTPUT pointed at a scratch file; its exit code and outputs. */
async function run(args: string[], env: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-steps-'));
  const out = join(dir, 'out');
  const saved: Record<string, string | undefined> = {};
  const set = { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(dir, 'summary'), ...env };
  for (const [k, v] of Object.entries(set)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const log = console.log;
  console.log = () => {};
  try {
    const code = await main(args);
    let text = '';
    try {
      text = readFileSync(out, 'utf8');
    } catch { /* no outputs written */ }
    return {
      code,
      outputs: Object.fromEntries(text.trim().split('\n').filter(Boolean).map((l) => l.split('='))),
    };
  } finally {
    console.log = log;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the workflows' decisions, in TypeScript", () => {
  it('tag-matches: the tag must name jsr.json version, or publish.yml stops', async () => {
    expect((await run(['tag-matches', `v${jsr.version}`])).code).toBe(0);
    expect((await run(['tag-matches', 'v0.0.1'])).code).toBe(1);
    expect((await run(['tag-matches', jsr.version])).code).toBe(1); // no `v`: not a version tag
    expect(tagVersion('v1.13.2')).toBe('1.13.2');
    expect(tagVersion('main')).toBe(null);
  });

  it("tag-check: outputs the version, and whether its tag exists (auto-tag.yml's if:)", async () => {
    const r = await run(['tag-check']);
    expect(r.code).toBe(0);
    expect(r.outputs['version']).toBe(jsr.version);
    expect(['true', 'false']).toContain(r.outputs['exists']);
  });

  it('release-cred: yes / no from RELEASE_PAT, never the secret itself', async () => {
    expect((await run(['release-cred'], { RELEASE_PAT: undefined })).outputs).toEqual({
      pat: 'no',
    });
    expect((await run(['release-cred'], { RELEASE_PAT: '' })).outputs).toEqual({ pat: 'no' });
    const yes = await run(['release-cred'], { RELEASE_PAT: 's3cret' });
    expect(yes.outputs).toEqual({ pat: 'yes' });
    expect(JSON.stringify(yes.outputs)).not.toContain('s3cret');
  });

  it('oidc-check: a diagnostic that never fails the job', async () => {
    const none = {
      ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
    };
    expect((await run(['oidc-check'], none)).code).toBe(0);
    expect(
      (await run(['oidc-check'], {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'u',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't',
      })).code,
    )
      .toBe(0);
  });

  it("provenance: each registry's field, and nothing when it is absent or the body is not JSON", () => {
    expect(jsrRekor('{"rekorLogId":"3346116525"}')).toBe('3346116525');
    expect(jsrRekor('{"rekorLogId":null}')).toBe(''); // 1.13.2 on JSR read like this
    expect(jsrRekor('not json')).toBe('');
    const att =
      '{"dist":{"attestations":{"provenance":{"predicateType":"https://slsa.dev/provenance/v1"}}}}';
    expect(npmProvenance(att)).toBe('https://slsa.dev/provenance/v1');
    expect(npmProvenance('{"dist":{}}')).toBe(''); // 1.13.1 on npm: published by hand
    expect(npmProvenance('')).toBe('');
  });

  it('provenance: the version records it reads', () => {
    expect(provenanceUrl('jsr', '@jrmarcum/binaryang', '1.13.2')).toBe(
      'https://api.jsr.io/scopes/jrmarcum/packages/binaryang/versions/1.13.2',
    );
    expect(provenanceUrl('npm', '@jrmarcum/binaryang', '1.13.2')).toBe(
      'https://registry.npmjs.org/@synapticforge1%2Fbinaryang/1.13.2',
    );
  });

  it('an unknown subcommand, or provenance without a registry and version, is a usage error', async () => {
    expect((await run(['nope'])).code).toBe(2);
    expect((await run(['provenance', 'pypi', '1.0.0'])).code).toBe(2);
    expect((await run(['provenance', 'jsr'])).code).toBe(2);
  });
});

// scripts/release/github.ts against a mock GitHub API (workspace letters H30 and H32): the two
// writes that replaced `gh`. Each case counts the POSTs, because the hazard is a write — a Release
// POSTed for a missing tag CREATES that tag.

const SHA = 'c0ffee0000000000000000000000000000000001';
const OTHER = 'c0ffee0000000000000000000000000000000002';

interface MockState {
  /** tag → its ref object; an annotated tag points at an entry of `tagObjects`. */
  refs: Record<string, { type: string; sha: string }>;
  tagObjects: Record<string, { type: string; sha: string }>;
  releases: Record<string, { tag_name: string; html_url: string; author: { login: string } }>;
  /** Status to answer a POST /releases or a dispatch with; 201 / 204 when unset. */
  postStatus?: number;
  /** A created release is not stored (it "does not read back"). */
  dropCreated?: boolean;
  /** Status for GET /git/ref, when not the state's own answer. */
  refStatus?: number;
}

function mockGitHub(state: MockState) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const reply = (status: number, body?: unknown) =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace('https://api.test/repos/o/r', '');
    const method = init?.method ?? 'GET';
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      posts.push({ path, body });
      if (path.endsWith('/dispatches')) return reply(state.postStatus ?? 204);
      if (state.postStatus !== undefined) return reply(state.postStatus);
      const tag = String(body['tag_name']);
      const rel = { tag_name: tag, html_url: `https://gh/r/${tag}`, author: { login: 'bot' } };
      if (!state.dropCreated) state.releases[tag] = rel;
      return reply(201, rel);
    }
    let m = /^\/git\/ref\/tags\/(.+)$/.exec(path);
    if (m) {
      if (state.refStatus !== undefined) return reply(state.refStatus);
      const o = state.refs[decodeURIComponent(m[1] as string)];
      return o ? reply(200, { object: o }) : reply(404);
    }
    m = /^\/git\/tags\/(.+)$/.exec(path);
    if (m) {
      const o = state.tagObjects[m[1] as string];
      return o ? reply(200, { object: o }) : reply(404);
    }
    m = /^\/releases\/tags\/(.+)$/.exec(path);
    if (m) {
      const r = state.releases[decodeURIComponent(m[1] as string)];
      return r ? reply(200, r) : reply(404);
    }
    return reply(500);
  }) as typeof fetch;
  return { gh: { api: 'https://api.test', repo: 'o/r', token: 'tok', fetch: f }, posts };
}

const rel = { tag: 'v9.9.9', sha: SHA, jsrName: '@jrmarcum/binaryang', version: '9.9.9' };

describe('github.ts: the GitHub writes, through the REST API (no gh)', () => {
  it('release: an annotated tag on the built commit, no page yet → one POST, read back', async () => {
    const { gh, posts } = mockGitHub({
      refs: { 'v9.9.9': { type: 'tag', sha: 'aaa' } },
      tagObjects: { aaa: { type: 'commit', sha: SHA } },
      releases: {},
    });
    const out = await release(gh, rel);
    expect(out.code).toBe(0);
    expect(posts.length).toBe(1);
    expect(posts[0]?.path).toBe('/releases');
    expect(posts[0]?.body).toEqual({
      tag_name: 'v9.9.9',
      name: 'binaryang v9.9.9',
      body: 'JSR: https://jsr.io/@jrmarcum/binaryang@9.9.9',
      generate_release_notes: true,
    });
    expect(out.lines.join('\n')).toContain('author bot');
  });

  it('release: a lightweight tag peels to itself', async () => {
    const { gh, posts } = mockGitHub({
      refs: { 'v9.9.9': { type: 'commit', sha: SHA } },
      tagObjects: {},
      releases: {},
    });
    expect((await release(gh, rel)).code).toBe(0);
    expect(posts.length).toBe(1);
  });

  it('release: a tag missing on GitHub is refused with NO write (POST would create the tag)', async () => {
    const { gh, posts } = mockGitHub({ refs: {}, tagObjects: {}, releases: {} });
    const out = await release(gh, rel);
    expect(out.code).toBe(1);
    expect(posts.length).toBe(0);
  });

  it('release: a tag naming another commit is refused with no write', async () => {
    const { gh, posts } = mockGitHub({
      refs: { 'v9.9.9': { type: 'tag', sha: 'aaa' } },
      tagObjects: { aaa: { type: 'commit', sha: OTHER } },
      releases: {},
    });
    expect((await release(gh, rel)).code).toBe(1);
    expect(posts.length).toBe(0);
  });

  it('release: a page already there is done — exit 0, no write (re-runs are safe)', async () => {
    const { gh, posts } = mockGitHub({
      refs: { 'v9.9.9': { type: 'commit', sha: SHA } },
      tagObjects: {},
      releases: {
        'v9.9.9': { tag_name: 'v9.9.9', html_url: 'https://gh/r/v9.9.9', author: { login: 'x' } },
      },
    });
    expect((await release(gh, rel)).code).toBe(0);
    expect(posts.length).toBe(0);
  });

  it('release: a refused POST, or a page that does not read back, fails the job', async () => {
    const base = () => ({
      refs: { 'v9.9.9': { type: 'commit', sha: SHA } },
      tagObjects: {},
      releases: {},
    });
    expect((await release(mockGitHub({ ...base(), postStatus: 422 }).gh, rel)).code).toBe(1);
    expect((await release(mockGitHub({ ...base(), dropCreated: true }).gh, rel)).code).toBe(1);
  });

  it('release: a broken tag read throws — it is never taken for "absent"', async () => {
    const { gh, posts } = mockGitHub({ refs: {}, tagObjects: {}, releases: {}, refStatus: 502 });
    await expect(peelTag(gh, 'v9.9.9')).rejects.toThrow('HTTP 502');
    expect(posts.length).toBe(0);
  });

  it("dispatch: POSTs the workflow's dispatch with the ref; anything but 204 fails", async () => {
    const ok = mockGitHub({ refs: {}, tagObjects: {}, releases: {} });
    expect((await dispatch(ok.gh, 'publish.yml', 'v9.9.9')).code).toBe(0);
    expect(ok.posts).toEqual([
      { path: '/actions/workflows/publish.yml/dispatches', body: { ref: 'v9.9.9' } },
    ]);
    const no = mockGitHub({ refs: {}, tagObjects: {}, releases: {}, postStatus: 403 });
    expect((await dispatch(no.gh, 'publish.yml', 'v9.9.9')).code).toBe(1);
  });

  it('main: usage errors exit 2; a missing token exits 1 before any request', async () => {
    const saved = process.env['GITHUB_TOKEN'];
    const err = console.error;
    const log = console.log;
    console.error = () => {};
    console.log = () => {};
    try {
      expect(await githubMain([])).toBe(2);
      expect(await githubMain(['release'])).toBe(2);
      expect(await githubMain(['dispatch', 'publish.yml'])).toBe(2);
      delete process.env['GITHUB_TOKEN'];
      expect(await githubMain(['dispatch', 'publish.yml', 'v1.0.0'])).toBe(1);
    } finally {
      console.error = err;
      console.log = log;
      if (saved === undefined) delete process.env['GITHUB_TOKEN'];
      else process.env['GITHUB_TOKEN'] = saved;
    }
  });
});
