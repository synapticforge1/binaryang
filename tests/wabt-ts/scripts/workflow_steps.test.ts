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
