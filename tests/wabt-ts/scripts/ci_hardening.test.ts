// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 1 (2026-11-13), the CI and release class:
//
//   A3  the privacy rule ("no secrets or personal information are ever made public") and the
//       dependencies' known vulnerabilities were checked by no step of CI or the release. Now
//       `scripts/check-privacy.ts` and `bun audit` run in CI's gates (the tree, and the commits a
//       push adds) and in the release's checks (every commit since the previous release), and the
//       built npm package is scanned before it is packed.
//   B8  ci.yml had no `permissions:` (the repository default, possibly write), actions pinned by
//       tag, checkouts that kept the token, and `npm install -g bun` running the package's install
//       script. Now: read-only, pinned to commits, no kept credential, nothing's install script.
//
// The samples below are ASSEMBLED from pieces, so this file holds no string the scanner refuses.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';
import { findLeaks, KNOWN, mask, parseArgs, unknown } from '../../../scripts/check-privacy.ts';

const CI = fsx.readTextFileSync('.github/workflows/ci.yml');
const PUBLISH = fsx.readTextFileSync('.github/workflows/publish.yml');
/** The lines that are not YAML comments. */
const live = (yml: string) => yml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
/** One job's text in a workflow, by its key under `jobs:`. */
function job(yml: string, key: string): string {
  const body = yml.slice(yml.indexOf('\njobs:\n') + 7);
  const at = body.search(new RegExp(`^ {2}${key}:\\s*$`, 'm'));
  const rest = body.slice(at + 3);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next < 0 ? body.slice(at) : body.slice(at, at + 3 + next);
}

describe('B8 — ci.yml holds no credential it does not need', () => {
  it('reads with a read-only token, and no job asks for more', () => {
    expect(CI).toMatch(/\npermissions:\n {2}contents: read\n\njobs:\n/);
    expect(live(CI)).not.toMatch(/:\s*write\b/);
  });

  it('pins every action to a commit, or to this repo', () => {
    const uses = [...CI.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(8);
    expect(uses.filter((u) => !/@[0-9a-f]{40}$/.test(u) && !u.startsWith('./.github/actions/')))
      .toEqual([]);
  });

  it('keeps no credential in any checkout', () => {
    const checkouts = CI.split('uses: actions/checkout@').slice(1);
    expect(checkouts.length).toBe(4);
    for (const c of checkouts) {
      expect(c.split(/\n\s+- name: /)[0]).toContain('persist-credentials: false');
    }
  });

  it('runs no install script: nothing is `npm install -g`-ed', () => {
    expect(live(CI)).not.toMatch(/npm (?:install|i) -g/);
  });
});

describe('A3 — the privacy rule and the audit, checked by CI and the release', () => {
  it("CI's gates: the tree and the commits the push adds, with the history to read them", () => {
    const gates = live(job(CI, 'gates'));
    expect(gates).toMatch(/uses: actions\/checkout@\S+[^\n]*\n\s+with:\n\s+fetch-depth: 0\n/);
    expect(gates).toContain('bun run privacy --commits "$range"');
    expect(gates).toContain('if git cat-file -e "$BASE^{commit}" 2>/dev/null; then');
    expect(gates).toContain('run: bun run audit');
    // the base: the pull request's, or the commit before the push
    expect(gates).toContain('github.event.pull_request.base.sha || github.event.before');
  });

  it("the release's checks: every commit since the previous release, before the tag", () => {
    const checks = live(job(PUBLISH, 'checks'));
    expect(checks).toContain("prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD^)");
    expect(checks).toContain('bun run privacy --commits "$prev..HEAD"');
    expect(checks).toContain('run: bun run audit');
    // checks has the tags (fetch-depth 0), and the tag job waits for checks
    expect(checks).toMatch(/fetch-depth: 0/);
    expect(job(PUBLISH, 'tag')).toMatch(/needs: \[checks, npm-build\]/);
  });

  it('npm-build scans what npm will publish before packing it', () => {
    const build = live(job(PUBLISH, 'npm-build'));
    const scan = build.indexOf('bun run privacy --dir dist');
    expect(scan).toBeGreaterThan(build.indexOf('bun run npm:prove'));
    // (the command, not "npm package" in a step's name)
    expect(scan).toBeLessThan(build.indexOf('npm pack --pack-destination'));
  });

  it('package.json runs the scanner and the audit by name', () => {
    const scripts = (JSON.parse(fsx.readTextFileSync('package.json')) as {
      scripts: Record<string, string>;
    }).scripts;
    expect(scripts['privacy']).toBe('bun scripts/check-privacy.ts');
    expect(scripts['audit']).toBe('bun audit');
  });
});

describe('A3 — scripts/check-privacy.ts', () => {
  // Assembled, so this file holds none of them whole.
  const drive = ['C', ':\\', 'Users', '\\someone\\x'].join('');
  const driveFwd = ['D', ':/', 'Programs', '/proj/a.ts'].join('');
  const wsl = ['/mnt/', 'c/', 'Users', '/someone/x'].join('');
  const mac = ['/', 'Users', '/someone/x'].join('');
  const home = ['/', 'home', '/someone/x'].join('');
  const runner = ['/', 'home', '/runner/work/x'].join('');
  const key = ['-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY-----'].join('');
  const gh = ['gh', 'p_', 'a1B2'.repeat(9)].join('');
  const pat = ['github', '_pat_', 'A'.repeat(30)].join('');
  const npm = ['np', 'm_', 'Z9'.repeat(18)].join('');
  const aws = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
  const person = ['some.one', '@', 'example', '.org'].join('');
  const bot = ['41898282+github-actions[bot]', '@', 'users.noreply.github.com'].join('');
  const trailer = ['noreply', '@', 'anthropic.com'].join('');

  const kinds = (text: string, name = 'f.ts', maintainer?: string) =>
    findLeaks(name, text, maintainer).map((l) => l.kind);

  it('finds each kind it is meant to', () => {
    expect(kinds(drive)).toEqual(['drive path']);
    expect(kinds(driveFwd)).toEqual(['drive path']);
    expect(kinds(wsl)).toContain('drive path');
    expect(kinds(mac)).toEqual(['home path']);
    expect(kinds(home)).toEqual(['home path']);
    expect(kinds(key)).toEqual(['private key']);
    expect(kinds(gh)).toEqual(['GitHub token']);
    expect(kinds(pat)).toEqual(['GitHub token']);
    expect(kinds(npm)).toEqual(['npm token']);
    expect(kinds(aws)).toEqual(['AWS key']);
    expect(kinds(person)).toEqual(['email address']);
  });

  it("passes what names no one: the runner's home, service addresses, a convention path", () => {
    expect(kinds(runner)).toEqual([]);
    expect(kinds(bot)).toEqual([]);
    expect(kinds(trailer)).toEqual([]);
    expect(kinds('C:\\zig-cache\\wazmrt and /usr/lib/x86_64-linux-gnu/opera-stable/opera')).toEqual(
      [],
    );
    expect(kinds('import { x } from "@std/assert"; scope @jrmarcum/binaryang')).toEqual([]);
  });

  it('allows the maintainer contact in a manifest, and nowhere else', () => {
    expect(kinds(`"author": "${person}"`, 'package.json', person)).toEqual([]);
    expect(kinds(`"author": "${person}"`, 'jsr.json', person)).toEqual([]);
    expect(kinds(person, 'README.md', person)).toEqual(['email address']);
    expect(kinds(person, 'package.json', undefined)).toEqual(['email address']);
  });

  it('names the line, and never prints a finding whole', () => {
    const [l] = findLeaks('a/b.ts', `one\ntwo ${gh}`, undefined);
    expect(l!.where).toBe('a/b.ts:2');
    expect(l!.masked.slice(0, 3)).toBe(gh.slice(0, 3));
    expect(l!.masked).not.toContain(gh.slice(3, 6));
    expect(mask('abcdefghij')).toBe('abc*******');
    expect(mask('ab')).toBe('ab***');
  });

  it('KNOWN: each entry is one place and kind, with its reason; nothing else passes', () => {
    expect(KNOWN.length).toBeGreaterThan(0);
    for (const k of KNOWN) {
      expect(k.where).toMatch(/^commit [0-9a-f]{12}:\d+$/);
      expect(k.why.length).toBeGreaterThan(20);
    }
    const k = KNOWN[0]!;
    const same = { where: k.where, kind: k.kind, masked: 'x' };
    expect(unknown([same])).toEqual([]);
    expect(unknown([{ ...same, kind: 'email address' }]).length).toBe(1);
    expect(unknown([{ ...same, where: `${k.where}0` }]).length).toBe(1);
  });

  it('takes --dir and --commits, and refuses anything else', () => {
    expect(parseArgs([])).toEqual({ dirs: [], commits: undefined });
    expect(parseArgs(['--dir', 'dist', '--dir', 'x', '--commits', 'a..b'])).toEqual({
      dirs: ['dist', 'x'],
      commits: 'a..b',
    });
    expect(() => parseArgs(['--dir'])).toThrow('--dir needs a value');
    expect(() => parseArgs(['--commits', '--dir', 'x'])).toThrow('--commits needs a value');
    expect(() => parseArgs(['--all'])).toThrow('unknown argument --all');
  });
});
