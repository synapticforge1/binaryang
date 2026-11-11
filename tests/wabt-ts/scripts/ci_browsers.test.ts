// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';
import { APT_FAIL_FAST, keyringPath } from '../../../scripts/ci/install-browsers.ts';
import { browserSpecs } from '../../../scripts/check-browsers.ts';

// ci.yml's browser check is two jobs (owner, 2026-11-11). On that day GitHub's runners could not
// resolve Ubuntu's mirrors: on the hosted runner `playwright install --with-deps` waited out the
// job's limit asking them for 181 packages, and in Playwright's container Chrome's package could
// not get `xdg-utils`. So Playwright's engines run in Playwright's image, installing nothing, and
// the installed browsers run on the hosted runner, which already has Chrome and Edge.

/** The text without whole-line comments (`#` in YAML, `//` and ` * ` in TypeScript). */
const code = (text: string) =>
  text.split('\n').filter((l) => !/^\s*(#|\/\/|\*|\/\*\*)/.test(l)).join('\n');
const CI = code(fsx.readTextFileSync('.github/workflows/ci.yml'));
const SCRIPT = code(fsx.readTextFileSync('scripts/ci/install-browsers.ts'));
const PKG = JSON.parse(fsx.readTextFileSync('package.json')) as {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};

/** A job's text, from its key to the next top-level job. */
function job(key: string): string {
  const start = CI.indexOf(`\n  ${key}:\n`);
  expect(start, `job ${key}`).toBeGreaterThan(-1);
  const rest = CI.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
const ENGINES = job('browsers-engines');
const INSTALLED = job('browsers');
/** The `--only=` list a job's check runs. */
const only = (text: string) =>
  /bun run browsers --require-all --only=(\S+)/.exec(text)?.[1]?.split(',') ?? [];

describe("ci.yml's browser check: Playwright's engines in its image, the rest on the runner", () => {
  it('the two jobs check every browser check-browsers.ts knows, each once', () => {
    const both = [...only(ENGINES), ...only(INSTALLED)].sort();
    expect(both).toEqual(browserSpecs().map((s) => s.name).sort());
    expect(only(ENGINES).sort()).toEqual(['chromium', 'firefox', 'safari']);
  });

  it("runs Playwright's engines in the image of package.json's Playwright version, by digest", () => {
    const version = PKG.devDependencies?.['playwright'] ?? PKG.dependencies?.['playwright'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const image = /\n {6}image: (\S+)/.exec(ENGINES)?.[1];
    expect(image).toMatch(
      new RegExp(
        `^mcr\\.microsoft\\.com/playwright:v${
          version!.replace(/\./g, '\\.')
        }-noble@sha256:[0-9a-f]{64}$`,
      ),
    );
  });

  it('installs nothing in the container: no browser, no apt', () => {
    expect(ENGINES).not.toContain('install-browsers');
    expect(ENGINES).not.toMatch(/apt-get|playwright install|--with-deps/);
    // The image has no `unzip`, which setup-bun needs (measured on GitHub, 2026-11-11).
    expect(ENGINES).not.toContain('uses: oven-sh/setup-bun');
    const bun = ENGINES.indexOf('npm install -g bun@1.4.4');
    expect(bun).toBeGreaterThan(ENGINES.indexOf('actions/setup-node'));
    expect(bun).toBeLessThan(ENGINES.indexOf('bun install --frozen-lockfile'));
    // Root in the container, the workspace the runner's: git must be told it is safe.
    expect(ENGINES.indexOf('safe.directory')).toBeLessThan(ENGINES.indexOf('bun run browsers'));
  });

  it('on the runner, downloads no Playwright browser: only Brave and Opera, from their vendors', () => {
    expect(INSTALLED).not.toContain('container:');
    expect(INSTALLED).not.toMatch(/playwright install|--with-deps|ms-playwright/);
    expect(SCRIPT).not.toMatch(/cli\.js|'--with-deps'|playwright install/);
    expect(SCRIPT).toContain("pkg: 'brave-browser'");
    expect(SCRIPT).toContain("pkg: 'opera-stable'");
  });

  it('tells apt to fail fast, before any apt run', () => {
    expect(APT_FAIL_FAST).toContain('Acquire::Retries "1";');
    expect(APT_FAIL_FAST).toContain('Acquire::https::Timeout "15";');
    const conf = SCRIPT.indexOf("'/etc/apt/apt.conf.d/99-binaryang-fail-fast'");
    expect(conf).toBeGreaterThan(-1);
    expect(conf).toBeLessThan(SCRIPT.indexOf("'apt-get'"));
  });

  it('writes a binary key as .gpg and an armored one as .asc (no gpg needed)', () => {
    const armored = new TextEncoder().encode('-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQINB');
    expect(keyringPath('/k/opera', armored)).toBe('/k/opera.asc');
    expect(keyringPath('/k/brave', new Uint8Array([0x99, 0x02, 0x0d, 0x04]))).toBe('/k/brave.gpg');
  });
});
