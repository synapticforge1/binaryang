// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The real-browser job (open-work 28.3, 2026-10-13) runs the browsers the owner named: "chromium
// based, firefox, opera, vivaldi, brave, edge", and Safari (owner: "add safari instead of
// duckduckgo"), as WebKit, its engine; Vivaldi removed again (owner, 2026-10-13: "lets remove
// vivaldi from the checks"; it never ran headless on CI). Pinned: that list and each browser's
// engine, and that CI
// installs them and runs the job with `--require-all`, so a browser that cannot launch FAILS there
// rather than being skipped as it is on a machine that lacks it.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  browserSpecs,
  isVendorBinary,
  parseOnly,
  selectSpecs,
} from '../../../scripts/check-browsers.ts';

describe('the real-browser job', () => {
  it("runs the owner's browsers, each on its engine", () => {
    const byName = new Map(browserSpecs().map((s) => [s.name, s.engine]));
    expect([...byName.keys()].sort()).toEqual(
      ['brave', 'chrome', 'chromium', 'edge', 'firefox', 'opera', 'safari'],
    );
    expect(byName.get('safari')).toBe('webkit');
    expect(byName.get('firefox')).toBe('firefox');
    for (const n of ['chromium', 'chrome', 'edge', 'brave', 'opera']) {
      expect([n, byName.get(n)]).toEqual([n, 'chromium']);
    }
  });

  // Review round 1 (2026-11-13): `--only=chrom,edgee --require-all` checked NO browser, exit 0.
  it('--only refuses an unknown, an empty or a repeated name; it never selects nothing', () => {
    const specs = browserSpecs();
    expect(selectSpecs(specs).length).toBe(specs.length);
    expect(selectSpecs(specs, ['chrome', 'edge']).map((s) => s.name)).toEqual(['chrome', 'edge']);
    expect(() => selectSpecs(specs, ['chrom', 'edgee'])).toThrow('"chrom", "edgee"');
    expect(() => selectSpecs(specs, ['chrome', 'operaa'])).toThrow('"operaa"');
    expect(() => selectSpecs(specs, [])).toThrow('(empty)');
    expect(() => selectSpecs(specs, ['chrome', 'chrome'])).toThrow('twice');
  });

  // Review round 1 (2026-11-13): Brave and Opera are found by PATH or an environment variable, and
  // nothing checked that the binary launched was the browser named.
  it('a Brave or Opera binary must be that vendor\'s: another binary is "missing", with why', () => {
    // The real installs, Linux and Windows.
    for (const p of ['/opt/brave.com/brave/brave', '/usr/bin/brave-browser']) {
      expect(isVendorBinary(p, 'brave'), p).toBe(true);
    }
    expect(isVendorBinary('C:\\Program Files\\BraveSoftware\\Brave-Browser\\brave.exe', 'brave'))
      .toBe(true);
    for (const p of ['/usr/lib/x86_64-linux-gnu/opera/opera', '/usr/bin/opera']) {
      expect(isVendorBinary(p, 'opera'), p).toBe(true);
    }
    // Round 2 (2026-11-13): the vendor's name elsewhere in the path is not the vendor's binary.
    expect(isVendorBinary('/home/brave/google-chrome', 'brave')).toBe(false);
    expect(isVendorBinary('/usr/bin/cooperative', 'opera')).toBe(false);
    expect(isVendorBinary('/opt/opera/chrome', 'opera')).toBe(false);
    expect(isVendorBinary(resolve('package.json'), 'brave')).toBe(false);
  });

  /** browserSpecs() with one environment variable set, restored afterwards. */
  const withEnv = (name: string, value: string, spec: string) => {
    const saved = process.env[name];
    process.env[name] = value;
    try {
      return browserSpecs().find((s) => s.name === spec)!;
    } finally {
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    }
  };

  it('a wrong binary named by BINARYANG_BRAVE or BINARYANG_OPERA is refused, not launched', () => {
    for (const [name, spec] of [['BINARYANG_BRAVE', 'brave'], ['BINARYANG_OPERA', 'opera']]) {
      const s = withEnv(name!, resolve('package.json'), spec!);
      expect(s.executablePath, name).toBeUndefined();
      expect(s.missing, name).toContain(`is not a ${spec} executable`);
    }
  });

  it('a BINARYANG_* path that does not exist is passed over, never launched', () => {
    const s = withEnv('BINARYANG_OPERA', resolve('no-such-dir/opera'), 'opera');
    expect(s.executablePath ?? '').not.toContain('no-such-dir');
    expect(s.missing ?? '').not.toContain('is not a');
  });

  // Round 2 (2026-11-13): a second `--only=` was ignored, so `--only=chrome --only=edge` tested
  // Chrome alone; a bare or space-separated `--only` ran everything.
  it('one --only=<names> flag, in its = form', () => {
    expect(parseOnly(['--require-all'])).toBeUndefined();
    expect(parseOnly(['--only=chrome,edge,'])).toEqual(['chrome', 'edge']);
    expect(() => parseOnly(['--only=chrome', '--only=edge'])).toThrow('2 times');
    expect(() => parseOnly(['--only', 'chrome'])).toThrow('--only=<names>');
  });

  // Two CI jobs since 2026-11-11 (owner): Playwright's engines in its image, the installed
  // browsers on the hosted runner. ci_browsers.test.ts holds that their two lists are all of them.
  it('is CI work that installs the browsers and requires all of them', () => {
    const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const runs = [...ci.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1]!.trim());
    expect(runs).toContain('bun scripts/ci/install-browsers.ts');
    const checks = runs.filter((r) => r.startsWith('bun run browsers '));
    expect(checks).toEqual([
      'bun run browsers --require-all --only=chromium,firefox,safari',
      'bun run browsers --require-all --only=chrome,edge,brave,opera',
    ]);
  });
});
