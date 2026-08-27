// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';

// T13.44. `release_guard.test.ts` proves `releaseBlockers` returns the right
// answer. It does NOT prove `scripts/publish.ts` asks the question -- delete
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

const PUBLISH = await Deno.readTextFile('scripts/publish.ts');
const GUARD = await Deno.readTextFile('scripts/release-guard.ts');
const DENO_JSON = await Deno.readTextFile('deno.json');

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
    expect(PUBLISH.slice(call)).toContain('Deno.exit(1)');
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

  it('checks the remote tag before mutating anything', () => {
    const calls = gitCalls(PUBLISH);
    const lsRemote = calls.find((c) => c.sub === 'ls-remote');
    const firstMutation = calls.find((c) => !READ_ONLY.has(c.sub));
    expect(lsRemote).toBeDefined();
    expect(firstMutation).toBeDefined();
    expect(lsRemote!.at).toBeLessThan(firstMutation!.at);
  });

  // The property that made `publish.ts` untestable in the first place. If the
  // guard module ever gains a side effect, importing it from a test starts
  // doing something, and the next person moves the logic back inline.
  it('keeps release-guard.ts free of side effects', () => {
    expect(GUARD).not.toContain('Deno.Command');
    expect(GUARD).not.toContain('Deno.exit');
    // No top-level await: every export must be a plain function.
    expect(/^await /m.test(GUARD)).toBe(false);
    expect(/^const \w+ = await/m.test(GUARD)).toBe(false);
  });

  it('keeps scripts/ inside the gate', () => {
    // T13.43 found `scripts/` type-checked, linted and formatted by nothing --
    // including the file that publishes immutable artifacts.
    const cfg = JSON.parse(DENO_JSON) as {
      tasks: Record<string, string>;
      lint: { include: string[] };
      fmt: { include: string[] };
    };
    expect(cfg.tasks.check).toContain('scripts/');
    expect(cfg.lint.include).toContain('scripts/');
    expect(cfg.fmt.include).toContain('scripts/');
  });

  it('documents where the guards live, so the docs cannot drift silently', () => {
    // The T13.43 root cause was prose describing a guard that did not exist.
    // Naming the module in the release docs means a rewrite has to look at it.
    return Deno.readTextFile('cmem/publishing.md').then((doc) => {
      expect(doc).toContain('release-guard.ts');
    });
  });
});
