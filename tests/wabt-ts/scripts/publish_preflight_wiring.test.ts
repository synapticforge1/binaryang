// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';

// T13.44. `release_guard.test.ts` proves `releaseBlockers` returns the right
// answer. It does NOT prove `scripts/release/publish.ts` asks the question -- delete
// the whole guard block and every one of those tests still passes.
//
// That gap is exactly how T13.43 happened: two documents described a
// dirty-tree refusal, the pure logic for it was obvious, and the script simply
// did not do it. So this file gates the WIRING, structurally, by reading the
// source:
//
//   1. the guard is imported and called;
//   2. NOTHING that mutates git state runs before it;
//   3. the guard actually exits rather than warning;
//   4. `release-guard.ts` stays side-effect free, so it stays importable by a
//      test -- the property whose absence made `publish.ts` untestable;
//   5. `scripts/` stays inside the gate.
//
// A source-text gate is blunt, and it is the right tool here: the alternative
// is executing a release. Same shape as `token_type_reachability.test.ts` and
// `const_expr_head_coupling.test.ts`.

const PUBLISH = await fsx.readTextFile('scripts/release/publish.ts');
const GUARD = await fsx.readTextFile('scripts/release/release-guard.ts');

/** Every `git` subcommand invoked in `publish.ts`, in source order. */
function gitCalls(src: string): { sub: string; at: number }[] {
  const out: { sub: string; at: number }[] = [];
  for (const m of src.matchAll(/\[\s*'git'\s*,\s*'([a-z-]+)'/g)) {
    out.push({ sub: m[1]!, at: m.index! });
  }
  return out;
}

// Anything not on this list is assumed to CHANGE something. New git
// subcommands are opted in deliberately: if you add one and it is read-only,
// add it here and say so; if it mutates, it belongs after the guard.
const READ_ONLY = new Set(['status', 'ls-remote', 'rev-parse', 'diff', 'config', 'log']);

describe('T13.44 — the release preflight stays wired in', () => {
  it('imports and calls the guard', () => {
    expect(PUBLISH).toContain('release-guard.ts');
    expect(/releaseBlockers\s*\(/.test(PUBLISH)).toBe(true);
  });

  it('refuses rather than warns', () => {
    const call = PUBLISH.indexOf('releaseBlockers(');
    expect(call).toBeGreaterThan(-1);
    // An exit must follow the call, or the script prints a complaint and
    // releases anyway -- which is worse than no guard, because the output
    // looks like it was checked.
    expect(PUBLISH.slice(call)).toContain('process.exit(1)');
  });

  it('runs no state-changing git command before the guard', () => {
    const call = PUBLISH.indexOf('releaseBlockers(');
    const calls = gitCalls(PUBLISH);
    expect(calls.length).toBeGreaterThan(0);

    const before = calls.filter((c) => c.at < call).map((c) => c.sub);
    const mutatingBefore = before.filter((s) => !READ_ONLY.has(s));
    expect(mutatingBefore).toEqual([]);

    // And the mutations really do exist afterwards -- otherwise this test
    // passes vacuously on a script that no longer releases anything.
    const after = calls.filter((c) => c.at > call).map((c) => c.sub);
    for (const sub of ['add', 'commit', 'tag', 'push']) {
      expect(after).toContain(sub);
    }
  });

  // The guard exempts RELEASE_FILES because this script stages them. If the
  // stage names its own list, the two drift apart again: staging deno.json
  // alone after a bump that also rewrote main.ts is the 2026-09-14 refusal,
  // and exempting main.ts without staging it would tag the old CLI version.
  it('stages exactly the list the guard exempts', () => {
    const adds = [...PUBLISH.matchAll(/\[\s*'git'\s*,\s*'add'\s*,([^\]]*)\]/g)].map((m) =>
      m[1]!.trim()
    );
    expect(adds).toEqual(['...RELEASE_FILES']);
  });

  it('checks the remote tag before mutating anything', () => {
    const calls = gitCalls(PUBLISH);
    const lsRemote = calls.find((c) => c.sub === 'ls-remote');
    const firstMutation = calls.find((c) => !READ_ONLY.has(c.sub));
    expect(lsRemote).toBeDefined();
    expect(firstMutation).toBeDefined();
    expect(lsRemote!.at).toBeLessThan(firstMutation!.at);
  });

  // The cold type check (2026-09-28): publish.yml checks with no cache, so a
  // stale local cache used to pass what CI then failed — after the tag was
  // public (binaryen-ts v1.2.4). It must run in a FRESH `DENO_DIR` (`--reload`
  // does not re-resolve a pinned version), before any git mutation, and refuse.
  it('runs a cold type check, in a fresh DENO_DIR, before mutating anything', () => {
    // Since Bun migration B7 the Deno type check is the one inside `deno publish` (no deno.json,
    // no `deno check`), so the cold run is the publish DRY RUN; `bun run check` (tsc) follows it.
    const at = PUBLISH.indexOf("spawnSync('deno', ['publish', '--dry-run', '--allow-dirty']");
    expect(at).toBeGreaterThan(-1);
    const tsc = PUBLISH.indexOf("spawnSync('bun', ['run', 'check']");
    expect(tsc).toBeGreaterThan(at);
    // The parent environment spread in: node:child_process REPLACES `env` (Deno.Command merged
    // it), and a cold check without PATH cannot even find `deno` (Bun migration B4).
    expect(PUBLISH).toContain('env: { ...process.env, DENO_DIR: coldDir }');
    expect(PUBLISH).toContain('mkdtemp(');
    const firstMutation = gitCalls(PUBLISH).find((c) => !READ_ONLY.has(c.sub));
    expect(firstMutation).toBeDefined();
    expect(at).toBeLessThan(firstMutation!.at);
    expect(PUBLISH.slice(at, firstMutation!.at)).toContain('process.exit(1)');
  });

  // The entry check (1.6.1): through 1.6.0 the package root was not the CLI,
  // and nothing ran the entry a user runs. Before any git mutation, and refuse.
  it('checks the package root is the CLI, before mutating anything', () => {
    expect(PUBLISH).toContain("from './entry-check.ts'");
    const at = PUBLISH.indexOf('await checkEntry(');
    expect(at).toBeGreaterThan(-1);
    const firstMutation = gitCalls(PUBLISH).find((c) => !READ_ONLY.has(c.sub));
    expect(firstMutation).toBeDefined();
    expect(at).toBeLessThan(firstMutation!.at);
    expect(PUBLISH.slice(at, firstMutation!.at)).toContain('process.exit(1)');
  });

  // The property that made `publish.ts` untestable in the first place. If the
  // guard module ever gains a side effect, importing it from a test starts
  // doing something, and the next person moves the logic back inline.
  it('keeps release-guard.ts free of side effects', () => {
    expect(GUARD).not.toContain('Deno.Command');
    expect(GUARD).not.toContain('Deno.exit');
    expect(GUARD).not.toContain('child_process');
    expect(GUARD).not.toContain('process.exit');
    // No top-level await: every export must be a plain function.
    expect(/^await /m.test(GUARD)).toBe(false);
    expect(/^const \w+ = await/m.test(GUARD)).toBe(false);
  });

  it('keeps scripts/ inside the gate', () => {
    // T13.43 found `scripts/` type-checked, linted and formatted by nothing --
    // including the file that publishes immutable artifacts.
    // Since Bun migration B3 / B7 the three are Biome, dprint and tsc (deno.json is gone): each
    // config's scope must name scripts/. Line comments stripped: none of their strings holds `//`.
    const jsonc = (path: string) =>
      JSON.parse(
        fsx.readTextFileSync(path).replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'),
      );
    const biome = jsonc('biome.jsonc') as { files: { includes: string[] } };
    expect(biome.files.includes).toContain('scripts/**');
    const dprint = jsonc('dprint.json') as { includes: string[] };
    expect(dprint.includes).toContain('scripts/**');
    const ts = jsonc('tsconfig.json') as { include: string[] };
    expect(ts.include).toContain('scripts/**/*.ts');
  });

  it('documents where the guards live, so the docs cannot drift silently', () => {
    // The T13.43 root cause was prose describing a guard that did not exist.
    // Naming the module in the release docs means a rewrite has to look at it.
    // The release docs are the merged cmem/publishing.md since the wabt-ts wing
    // was summarized (2026-09-14).
    return fsx.readTextFile('cmem/publishing.md').then((doc) => {
      expect(doc).toContain('release-guard.ts');
    });
  });
});

// The release path off Deno (Bun migration B6, 2026-10-13). Provenance is the reason for the shape:
// `deno publish` must be called DIRECTLY by publish.yml (an indirection such as `bunx jsr publish`,
// which downloads Deno and runs it as a subprocess, is the kind this repo has lost provenance
// through), and everything before it is the CI gate's tooling, so a release is judged as CI is.
describe('the release workflows, off Deno except for the publish itself', () => {
  const PUBLISH_YML = fsx.readTextFileSync('.github/workflows/publish.yml');
  const AUTO_TAG_YML = fsx.readTextFileSync('.github/workflows/auto-tag.yml');
  /** `run:` commands, in order. */
  const runs = (yml: string) => [...yml.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1]!.trim());
  /** The lines that are not YAML comments. */
  const code = (yml: string) => yml.split('\n').filter((l) => !/^\s*#/.test(l));

  it('publishes with deno publish, directly, from jsr.json', () => {
    // Bare since B7: with no deno.json, Deno finds jsr.json itself, and a `--config` naming any
    // other file would publish from it.
    expect(runs(PUBLISH_YML)).toContain('deno publish');
    expect(runs(PUBLISH_YML).filter((r) => /^deno publish\b/.test(r) && r !== 'deno publish'))
      .toEqual(
        [],
      );
    expect(code(PUBLISH_YML).filter((l) => /\b(bunx|npx) jsr\b/.test(l))).toEqual([]);
    expect(code(PUBLISH_YML).filter((l) => /\b(deno task|bun run) release\b/.test(l))).toEqual([]);
  });

  it('runs both type checks and both test legs BEFORE publishing', () => {
    const r = runs(PUBLISH_YML);
    const publish = r.indexOf('deno publish');
    for (const cmd of ['bun run check', 'bun run test', 'bun run test:bun']) {
      const at = r.indexOf(cmd);
      expect(at >= 0 && at < publish, `${cmd} runs before the publish`).toBe(true);
    }
    expect(r).not.toContain('bun run test');
  });

  it('auto-tag needs no Deno', () => {
    expect(code(AUTO_TAG_YML).filter((l) => /\bdeno\b/i.test(l))).toEqual([]);
  });
});
