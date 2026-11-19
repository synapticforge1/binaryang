// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Security review round 1 (2026-11-13), the CI and release class:
//
//   A3  the privacy rule ("no secrets or personal information are ever made public") and the
//       dependencies' known vulnerabilities were checked by no step of CI or the release. Now
//       `scripts/check-privacy.ts` and `bun audit` run in the LOCAL gate (`scripts/gate.ts`: the
//       tree, and the commits not yet on GitHub; with `--release`, every commit since the
//       previous release), and the built npm package is scanned before it is packed.
//   B8  ci.yml's credentials — ci.yml is gone since 2026-11-18: the workspace review standard
//       (letter H37) runs every gate locally and CI only publishes.
//
// The samples below are ASSEMBLED from pieces, so this file holds no string the scanner refuses.

import { existsSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';
import {
  findLeaks,
  KNOWN,
  mask,
  parseArgs,
  privateFilesTracked,
  textOf,
  unknown,
} from '../../../scripts/check-privacy.ts';

const PUBLISH = fsx.readTextFileSync('.github/workflows/publish.yml');
const GATE = fsx.readTextFileSync('scripts/gate.ts');
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

describe('B8 — the workflows hold no credential they do not need', () => {
  it('ci.yml is gone: CI runs no tests (letter H37); publish.yml holds write only to publish', () => {
    expect(existsSync('.github/workflows/ci.yml')).toBe(false);
    expect(readdirSync('.github/workflows').sort()).toEqual(['publish.yml']);
    expect(PUBLISH).toMatch(/\npermissions: \{\}\n/);
    expect(live(job(PUBLISH, 'checks'))).not.toMatch(/:\s*write\b/);
    expect(live(PUBLISH)).not.toMatch(/npm (?:install|i) -g/);
  });
});

describe('A3 — the privacy rule and the audit, checked by the local gate and the release', () => {
  it('the gate: the tree and the commits not yet on GitHub, and the audit', () => {
    expect(GATE).toContain(
      "['privacy', bun('scripts/check-privacy.ts', '--commits', 'origin/main..HEAD')]",
    );
    expect(GATE).toContain("['audit', bun('audit')]");
  });

  it("the release's gate: every commit since the previous release, before the tag", () => {
    expect(GATE).toContain("['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD']");
    // (`$` + `{prev}` written in two parts: it is the gate's template, not this file's.)
    expect(GATE).toContain("bun('scripts/check-privacy.ts', '--commits', `$" + '{prev}..HEAD`)');
    // the release runs the gate with --release, and the tag job still waits for checks
    expect(fsx.readTextFileSync('scripts/release/publish.ts')).toContain(
      "spawnSync('bun', ['run', 'gate', '--release']",
    );
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
  const dependabot = ['support', '@', 'github.com'].join('');

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
    // Dependabot's sign-off: GitHub's own support address, exactly — a person at github.com is not.
    expect(kinds(`Signed-off-by: dependabot[bot] <${dependabot}>`)).toEqual([]);
    expect(kinds(['some.one', '@', 'github.com'].join(''))).toEqual(['email address']);
    expect(kinds(['support', '@', 'github.com.evil.example'].join(''))).toEqual(['email address']);
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

// Security review round 2 (2026-11-13): the scanner skipped any file with a NUL, so a UTF-16
// file — or a text file with one early NUL — was never read; it missed common secret shapes and
// Git Bash's drive paths; CI's commit range fell back to the tip alone after a force-push.
describe('round 2 — the scanner reads every file, in every encoding', () => {
  const gh = ['gh', 'p_', 'a1B2'.repeat(9)].join('');
  const line = `const t = '${gh}';`;
  const kinds = (bytes: Uint8Array) => findLeaks('f', textOf(bytes), undefined).map((l) => l.kind);
  const utf16le = (s: string) => new Uint8Array(Buffer.from(s, 'utf16le'));

  it('UTF-8, UTF-16 with either byte-order mark, UTF-16 without one, and text with a NUL', () => {
    expect(kinds(new TextEncoder().encode(line))).toEqual(['GitHub token']);
    expect(kinds(new Uint8Array([0xff, 0xfe, ...utf16le(line)]))).toEqual(['GitHub token']);
    const be = Buffer.from(utf16le(line));
    be.swap16();
    expect(kinds(new Uint8Array([0xfe, 0xff, ...be]))).toEqual(['GitHub token']);
    expect(kinds(utf16le(line))).toContain('GitHub token');
    expect(kinds(new TextEncoder().encode(`\0\n${line}`))).toContain('GitHub token');
  });

  it('a binary file is read too (its bytes as text)', () => {
    const bin = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...new TextEncoder().encode(gh)]);
    expect(kinds(bin)).toContain('GitHub token');
  });
});

describe('round 2 — the shapes the first list missed', () => {
  const kinds = (s: string) => findLeaks('f.ts', s, undefined).map((l) => l.kind);
  it('Google and Stripe keys, a JWT, a secret assigned, a Git Bash drive path', () => {
    expect(kinds(['AI', 'za', 'B'.repeat(35)].join(''))).toEqual(['Google API key']);
    expect(kinds(['sk', '_live_', 'C'.repeat(24)].join(''))).toEqual(['Stripe key']);
    expect(
      kinds(['ey', 'J', 'a'.repeat(12), '.ey', 'J', 'b'.repeat(12), '.', 'c'.repeat(12)].join('')),
    )
      .toEqual(['JSON Web Token']);
    expect(kinds(['pass', 'word = "', 'hunter22x', '"'].join(''))).toEqual(['secret assignment']);
    // (it is a home path too, which the macOS rule also says)
    expect(kinds(['/', 'c/', 'Users', '/someone/x'].join(''))).toContain('drive path');
    expect(kinds(['/', 'd/', 'Programs', '/proj/a.ts'].join(''))).toEqual(['drive path']);
  });

  it('and not what names no one: a placeholder path, a variable, an empty or templated value', () => {
    expect(kinds('C:/x/Programs/Opera/opera.exe')).toEqual([]);
    expect(kinds('const password = process.env.PASSWORD;')).toEqual([]);
    expect(kinds(['pass', "word: '$", "{x}'"].join(''))).toEqual([]);
    expect(kinds('/usr/lib/x86_64-linux-gnu/opera-stable/opera')).toEqual([]);
  });
});

describe('the private files stay untracked (letter H37 § 10)', () => {
  it('the review issues file, cmem/local/ and .claude/ are each refused when tracked', () => {
    expect(privateFilesTracked(['src/a.ts', 'cmem/INDEX.md', 'README.md'])).toEqual([]);
    expect(privateFilesTracked(['cmem/review-issues.md', 'cmem/local/env.md', '.claude/s.json']))
      .toEqual(['cmem/review-issues.md', 'cmem/local/env.md', '.claude/s.json']);
    // a look-alike name is not one of them
    expect(privateFilesTracked(['cmem/review-issues-template.md', 'docs/cmem/local.md'])).toEqual(
      [],
    );
  });
});

describe('round 2 — the installer', () => {
  it('curl follows no redirect off https', () => {
    expect(fsx.readTextFileSync('.github/actions/install-pinned/action.yml')).toContain(
      "curl -fsSL --retry 3 --proto '=https' --proto-redir '=https'",
    );
  });
});
