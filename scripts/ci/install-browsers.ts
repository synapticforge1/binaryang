// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * CI only (Ubuntu): installs the browsers `bun run browsers --require-all` runs (open-work 28.3).
 * Playwright's own Chromium, Firefox and WebKit (with their system libraries); Brave and Opera
 * from each vendor's apt repository. Chrome and Edge come with GitHub's Ubuntu image, and
 * the job fails loudly (`--require-all`) if either is ever missing.
 *
 * Logic in TypeScript, not in the workflow's shell (the working rules): each step is one command,
 * run in order, and the first failure stops the script with its exit code.
 *
 *   bun scripts/ci/install-browsers.ts
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** An apt repository: its signing key, its source line, and the package to install from it. */
interface AptBrowser {
  name: string;
  key: string;
  keyring: string;
  source: string;
  list: string;
  pkg: string;
}

const APT: AptBrowser[] = [
  {
    name: 'brave',
    key: 'https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg',
    keyring: '/usr/share/keyrings/brave-browser-archive-keyring.gpg',
    source: 'https://brave-browser-apt-release.s3.brave.com/ stable main',
    list: '/etc/apt/sources.list.d/brave-browser-release.list',
    pkg: 'brave-browser',
  },
  {
    name: 'opera',
    key: 'https://deb.opera.com/archive.key',
    keyring: '/usr/share/keyrings/opera-browser.gpg',
    source: 'https://deb.opera.com/opera-stable/ stable non-free',
    list: '/etc/apt/sources.list.d/opera-stable.list',
    pkg: 'opera-stable',
  },
];

function step(label: string, cmd: string, args: string[], input?: string | Buffer): void {
  console.log(`$ ${label}`);
  const r = spawnSync(cmd, args, {
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    input,
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });
  if (r.status !== 0) {
    console.error(`✗ ${label}: exit ${r.status ?? r.error?.message}`);
    process.exit(r.status ?? 1);
  }
}

if (process.platform !== 'linux') {
  console.error('install-browsers.ts is for CI (Linux); locally, install browsers yourself');
  process.exit(2);
}
step('playwright install --with-deps chromium firefox webkit', 'node', [
  'node_modules/playwright/cli.js',
  'install',
  '--with-deps',
  'chromium',
  'firefox',
  'webkit',
]);
for (const b of APT) {
  // The key, dearmored where it is ASCII-armored (gpg reads either and writes binary).
  const key = spawnSync('curl', ['-fsSL', b.key], { maxBuffer: 1 << 20 });
  if (key.status !== 0) {
    console.error(`✗ ${b.name}: could not fetch its signing key`);
    process.exit(1);
  }
  // Brave publishes a binary keyring, Opera an ASCII-armored key: only an armored one
  // go through `gpg --dearmor`; a binary one is written as it is.
  const armored = key.stdout.subarray(0, 32).toString('latin1').includes('-----BEGIN');
  step(
    `${b.name}: keyring`,
    'sudo',
    armored ? ['gpg', '--batch', '--yes', '--dearmor', '-o', b.keyring] : ['tee', b.keyring],
    key.stdout,
  );
  step(
    `${b.name}: source`,
    'sudo',
    ['tee', b.list],
    `deb [arch=amd64 signed-by=${b.keyring}] ${b.source}\n`,
  );
}
step('apt-get update', 'sudo', ['apt-get', 'update', '-q']);
step(`apt-get install ${APT.map((b) => b.pkg).join(' ')}`, 'sudo', [
  'apt-get',
  'install',
  '-y',
  '-q',
  ...APT.map((b) => b.pkg),
]);
console.log('browsers installed');
