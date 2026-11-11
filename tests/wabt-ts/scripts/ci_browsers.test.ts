// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';
import { APT_FAIL_FAST, keyringPath } from '../../../scripts/ci/install-browsers.ts';

// ci.yml's Browsers job runs in Playwright's own container (owner, 2026-11-11): on that day
// GitHub's runners could not resolve Ubuntu's mirrors, and `playwright install --with-deps` waited
// out the job's limit asking them for 181 packages. The image carries Playwright's browsers and
// their system packages, so it must be the image of the Playwright version the tests run.

const CI = fsx.readTextFileSync('.github/workflows/ci.yml');
const PKG = JSON.parse(fsx.readTextFileSync('package.json')) as {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};
/** The Browsers job's text. */
const job = CI.slice(CI.indexOf('\n  browsers:\n'), CI.indexOf('\n  runtimes:\n'));

describe("ci.yml's Browsers job: Playwright's container", () => {
  it("runs in the image of package.json's Playwright version, pinned by digest", () => {
    const version = PKG.devDependencies?.['playwright'] ?? PKG.dependencies?.['playwright'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const image = /\n {6}image: (\S+)/.exec(job)?.[1];
    expect(image).toMatch(
      new RegExp(
        `^mcr\\.microsoft\\.com/playwright:v${
          version!.replace(/\./g, '\\.')
        }-noble@sha256:[0-9a-f]{64}$`,
      ),
    );
  });

  it("downloads none of Playwright's browsers and asks for no system packages", () => {
    expect(job).not.toContain('--with-deps');
    expect(job).not.toContain('ms-playwright');
    const script = fsx.readTextFileSync('scripts/ci/install-browsers.ts');
    expect(script).not.toContain("'--with-deps'");
    expect(script).not.toMatch(/'install',\s*'(chromium|firefox|webkit)'/);
  });

  // The image has no `unzip`, which setup-bun needs (measured on GitHub, 2026-11-11).
  it('installs Bun from npm, at the pinned version, after Node', () => {
    expect(job).not.toContain('uses: oven-sh/setup-bun');
    const bun = job.indexOf('npm install -g bun@1.4.4');
    expect(bun).toBeGreaterThan(job.indexOf('actions/setup-node'));
    expect(bun).toBeLessThan(job.indexOf('bun install --frozen-lockfile'));
  });

  it('tells apt to fail fast, before any apt run', () => {
    expect(APT_FAIL_FAST).toContain('Acquire::Retries "1";');
    expect(APT_FAIL_FAST).toContain('Acquire::https::Timeout "15";');
    const script = fsx.readTextFileSync('scripts/ci/install-browsers.ts');
    const conf = script.indexOf('99-binaryang-fail-fast');
    const firstApt = script.indexOf("'apt-get'");
    expect(conf).toBeGreaterThan(-1);
    expect(conf).toBeLessThan(firstApt);
    expect(conf).toBeLessThan(script.indexOf("'install',\n    'chrome'"));
  });

  it('writes a binary key as .gpg and an armored one as .asc (no gpg in the image)', () => {
    const armored = new TextEncoder().encode('-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQINB');
    expect(keyringPath('/k/opera', armored)).toBe('/k/opera.asc');
    expect(keyringPath('/k/brave', new Uint8Array([0x99, 0x02, 0x0d, 0x04]))).toBe('/k/brave.gpg');
  });
});
