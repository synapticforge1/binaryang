// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The real-browser job (open-work 28.3, 2026-10-13) runs the browsers the owner named: "chromium
// based, firefox, opera, vivaldi, brave, edge", and Safari (owner: "add safari instead of
// duckduckgo"), as WebKit, its engine. Pinned: that list and each browser's engine, and that CI
// installs them and runs the job with `--require-all`, so a browser that cannot launch FAILS there
// rather than being skipped as it is on a machine that lacks it.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readFileSync } from 'node:fs';
import { browserSpecs } from '../../../scripts/check-browsers.ts';

describe('the real-browser job', () => {
  it("runs the owner's browsers, each on its engine", () => {
    const byName = new Map(browserSpecs().map((s) => [s.name, s.engine]));
    expect([...byName.keys()].sort()).toEqual(
      ['brave', 'chrome', 'chromium', 'edge', 'firefox', 'opera', 'safari', 'vivaldi'],
    );
    expect(byName.get('safari')).toBe('webkit');
    expect(byName.get('firefox')).toBe('firefox');
    for (const n of ['chromium', 'chrome', 'edge', 'brave', 'opera', 'vivaldi']) {
      expect([n, byName.get(n)]).toEqual([n, 'chromium']);
    }
  });

  it('is a CI job that installs the browsers and requires all of them', () => {
    const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const runs = [...ci.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1]!.trim());
    expect(runs).toContain('bun scripts/ci/install-browsers.ts');
    expect(runs).toContain('bun run browsers --require-all');
  });
});
