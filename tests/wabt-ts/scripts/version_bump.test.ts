// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The version rule and the bump (2026-10-22; workspace letter H6, SemVer 2.0.0, and tooling rule
// 4). `nextVersion` is SemVer with no cap: the old rule capped each sub-version at 9, which minors
// 10–14 had already passed by hand, so a patch bump of 1.14.9 would have produced 2.0.0.
// `replaceOnce` refuses zero matches AND two; `writeAtomic` leaves no temporary file behind. The
// script itself runs here only with `--dry-run` and with arguments it must refuse: neither may
// touch jsr.json or main.ts.

import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { expect } from '@std/expect';
import { nextVersion, replaceOnce, writeAtomic } from '../../../scripts/release/version.ts';

describe('nextVersion: SemVer 2.0.0, nothing capped, nothing carried', () => {
  it('raises the component asked for and resets the lower ones', () => {
    expect(nextVersion('1.14.0')).toBe('1.14.1');
    expect(nextVersion('1.14.0', 'patch')).toBe('1.14.1');
    expect(nextVersion('1.14.3', 'minor')).toBe('1.15.0');
    expect(nextVersion('1.14.3', 'major')).toBe('2.0.0');
  });

  it('past 9 is just a larger number', () => {
    expect(nextVersion('1.9.9')).toBe('1.9.10');
    expect(nextVersion('1.14.9')).toBe('1.14.10'); // the old rule: 2.0.0
    expect(nextVersion('1.9.9', 'minor')).toBe('1.10.0');
  });

  it('refuses what is not a plain major.minor.patch', () => {
    for (const v of ['1.14', '1.14.0-rc.1', 'v1.14.0', '01.2.3', '']) {
      expect(() => nextVersion(v)).toThrow('Cannot parse version');
    }
    expect(() => nextVersion('1.0.0', 'micro' as 'patch')).toThrow('Unknown bump level');
  });
});

describe('replaceOnce: exactly one match, or nothing', () => {
  const re = /("version"\s*:\s*)"[^"]*"/;
  const set = (prefix: string) => `${prefix}"2.0.0"`;
  it('replaces the one match', () => {
    expect(replaceOnce('{ "version": "1.0.0" }', re, set, 'v')).toBe('{ "version": "2.0.0" }');
  });
  it('refuses none and refuses two', () => {
    expect(() => replaceOnce('{ "name": "x" }', re, set, 'v')).toThrow('found 0');
    expect(() => replaceOnce('{ "version": "1", "version": "2" }', re, set, 'v')).toThrow(
      'found 2',
    );
  });
});

describe('writeAtomic', () => {
  it('replaces the file and leaves no temporary file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'binaryang-atomic-'));
    try {
      const f = join(dir, 'jsr.json');
      writeFileSync(f, 'old');
      await writeAtomic(pathToFileURL(f), 'new');
      expect(readFileSync(f, 'utf8')).toBe('new');
      expect(readdirSync(dir)).toEqual(['jsr.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the bump script, without writing', () => {
  const root = new URL('../../../', import.meta.url);
  const script = new URL('scripts/release/bump_version.ts', root);
  const files = ['jsr.json', 'main.ts'].map((f) => new URL(f, root));
  const snapshot = () => files.map((f) => readFileSync(f, 'utf8'));
  const bump = (...args: string[]) =>
    spawnSync(process.execPath, [script.pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  const current = JSON.parse(readFileSync(files[0]!, 'utf8')).version as string;

  it('--dry-run prints the next version at each level and writes nothing', () => {
    const before = snapshot();
    for (const level of ['patch', 'minor', 'major'] as const) {
      const r = bump(level, '--dry-run');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`${current} -> ${nextVersion(current, level)}`);
    }
    expect(bump('-n').stdout).toContain(`${current} -> ${nextVersion(current)}`);
    expect(snapshot()).toEqual(before);
  });

  it('refuses an unknown argument and two levels, writing nothing', () => {
    const before = snapshot();
    for (
      const args of [['--dryrun'], ['micro', '-n'], ['minor', 'major', '-n'], ['minor', 'major']]
    ) {
      expect(bump(...args).status).toBe(2);
    }
    expect(snapshot()).toEqual(before);
  });
});
