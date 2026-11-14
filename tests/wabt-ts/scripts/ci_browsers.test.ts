// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';
import {
  APT,
  APT_FAIL_FAST,
  dearmor,
  keyProblem,
  keyring,
  primaryFingerprints,
  UNDECLARED,
} from '../../../scripts/ci/install-browsers.ts';
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
    // Bun is npm's tarball of it, sha256-checked, no install script (security round 1, B8): the
    // installer's `bun-npm`, which needs npm — so after Node.
    expect(ENGINES).not.toContain('npm install -g');
    const bun = ENGINES.indexOf('tools: bun-npm');
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
    // Opera's undeclared dependency (it aborts without the schema), and nothing else from Ubuntu.
    expect(UNDECLARED).toEqual(['gsettings-desktop-schemas']);
  });

  // Each was measured on GitHub on 2026-11-11, and each could be removed with every test green
  // (review round 1, 2026-11-13).
  it("keeps the fixes measured on GitHub: Firefox's HOME, Chromium's IPC, the git exception", () => {
    expect(ENGINES).toMatch(/\n {4}env:\n {6}HOME: \/root\n/);
    expect(ENGINES).toMatch(/\n {6}options: --ipc=host\n/);
    expect(ENGINES).toContain('run: git config --global --add safe.directory "$GITHUB_WORKSPACE"');
  });

  it('both jobs: a time limit, Node for the driver, the lockfile exactly; installs before the check', () => {
    for (const [name, job] of [['engines', ENGINES], ['installed', INSTALLED]] as const) {
      expect(job, name).toMatch(/\n {4}timeout-minutes: 20\n/);
      expect(job, name).toMatch(
        /uses: actions\/setup-node@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+node-version: '24'/,
      );
      expect(job, name).toContain('run: bun install --frozen-lockfile');
      expect(job, name).not.toMatch(/run: bun install(?! --frozen-lockfile)/);
    }
    expect(INSTALLED.indexOf('run: bun scripts/ci/install-browsers.ts')).toBeLessThan(
      INSTALLED.indexOf('run: bun run browsers'),
    );
    expect(INSTALLED.indexOf('bun install --frozen-lockfile')).toBeLessThan(
      INSTALLED.indexOf('run: bun scripts/ci/install-browsers.ts'),
    );
  });

  it('tells apt to fail fast, before any apt run', () => {
    expect(APT_FAIL_FAST).toContain('Acquire::Retries "1";');
    expect(APT_FAIL_FAST).toContain('Acquire::https::Timeout "15";');
    const conf = SCRIPT.indexOf("'/etc/apt/apt.conf.d/99-binaryang-fail-fast'");
    expect(conf).toBeGreaterThan(-1);
    expect(conf).toBeLessThan(SCRIPT.indexOf("'apt-get'"));
  });

  // Security review round 1 (2026-11-13), C12: each vendor's signing key was trusted on first
  // use. Its primary keys are now pinned; the fixtures are the two public key files as served on
  // 2026-11-13, whose fingerprints `gpg --show-keys` gave the same that day — reduced to their key
  // and subkey packets (security round 2: no user IDs, so no addresses; the fingerprints, which
  // cover the key packet alone, unchanged), Opera's re-armored.
  const FIX = 'tests/wabt-ts/scripts/fixtures/apt-keys';
  const braveKey = new Uint8Array(readFileSync(`${FIX}/brave-browser-archive-keyring.gpg`));
  const operaKey = new Uint8Array(readFileSync(`${FIX}/opera-archive.key`));
  const brave = APT.find((b) => b.name === 'brave')!;
  const opera = APT.find((b) => b.name === 'opera')!;

  it("reads a key file's primary fingerprints, binary and armored, as gpg does", () => {
    expect(primaryFingerprints(braveKey)).toEqual([
      'DBF1A116C220B8C7164F98230686B78420038257',
      '47D32A74E9A9E013A4B4926C68D513D36A73CD96',
      'B2A3DCA350E67256740DF904DE4EC67BE4B0DCA0',
    ]);
    expect(primaryFingerprints(operaKey)).toEqual(['6C86BE214648376680CA957B11EE8C00B693A745']);
    expect(dearmor(braveKey)).toBe(braveKey); // binary: as given
    expect(dearmor(operaKey)[0]! & 0x80).toBe(0x80); // armored: a packet header once decoded
  });

  it('accepts each vendor key only with exactly its pinned primary keys', () => {
    expect(keyProblem(brave, braveKey)).toBe(null);
    expect(keyProblem(opera, operaKey)).toBe(null);
    // another vendor's key, a key added, a key removed
    expect(keyProblem(brave, operaKey)).toContain('not the pinned');
    expect(
      keyProblem({ ...opera, fingerprints: [...opera.fingerprints, 'AB'.repeat(20)] }, operaKey),
    )
      .toContain('not the pinned');
    expect(keyProblem({ ...brave, fingerprints: brave.fingerprints.slice(1) }, braveKey))
      .toContain('not the pinned');
    // what is not a key at all
    expect(keyProblem(brave, new TextEncoder().encode('<html>Not Found</html>'))).toContain(
      'does not read as OpenPGP keys',
    );
    expect(keyProblem(brave, braveKey.subarray(0, 100))).toContain('does not read as OpenPGP keys');
  });

  it('checks the key before writing the keyring', () => {
    expect(SCRIPT.indexOf('keyProblem(b, key)')).toBeGreaterThan(-1);
    expect(SCRIPT.indexOf('keyProblem(b, key)')).toBeLessThan(
      SCRIPT.indexOf('keyring(b.keyring, key)'),
    );
    // …and apt is pointed at the keyring written from the checked bytes, not the download.
    // (the script's template text, written in parts: here it is no template)
    expect(SCRIPT).toContain('ring.path, ring.bytes);');
    expect(SCRIPT).toContain('signed-by=$' + '{ring.path}]');
    expect(SCRIPT).not.toMatch(/writeRoot\([^\n]*, key\);/);
  });

  // Security review round 2 (2026-11-13): only the FIRST armored block was fingerprinted, and apt
  // trusted the whole file — a second block's key passed unchecked (re-run that day).
  it('refuses a key file with a second armored block, and gives apt only the checked bytes', () => {
    const braveArmored = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${
      Buffer.from(braveKey).toString('base64').match(/.{1,64}/g)!.join('\n')
    }\n-----END PGP PUBLIC KEY BLOCK-----\n`;
    const both = new TextEncoder().encode(
      `${new TextDecoder('latin1').decode(operaKey)}\n${braveArmored}`,
    );
    expect(keyProblem(opera, both)).toContain('more than one armored block');
    // The keyring: binary, the de-armored key, as .gpg, for either form of download.
    const o = keyring('/k/opera', operaKey);
    expect(o.path).toBe('/k/opera.gpg');
    expect(o.bytes[0]! & 0x80).toBe(0x80);
    expect(primaryFingerprints(o.bytes)).toEqual(opera.fingerprints);
    expect(keyring('/k/brave', braveKey)).toEqual({ path: '/k/brave.gpg', bytes: braveKey });
  });
});
