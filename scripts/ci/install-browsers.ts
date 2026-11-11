// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * CI only: installs what `bun run browsers --require-all` runs (open-work 28.3), INSIDE
 * Playwright's own container (`mcr.microsoft.com/playwright:v<our version>-noble`, ci.yml's
 * Browsers job; owner, 2026-11-11). The image already holds Playwright's Chromium, Firefox and
 * WebKit and every system package they need, so nothing of theirs is downloaded here and no
 * Ubuntu mirror is asked for them. What the image lacks:
 *
 *   - Chrome and Edge (the stable channels): Playwright's own installers (`playwright install
 *     chrome msedge`), which fetch Google's and Microsoft's packages;
 *   - Brave and Opera: each vendor's apt repository.
 *
 * Why (2026-11-11): all day GitHub's runners could not resolve the Ubuntu mirrors, and on the
 * hosted image `playwright install --with-deps` asked them for 181 packages (114 MB), waiting
 * out the job's 20-minute limit. So apt is also told to FAIL FAST (one retry, 15 s per request):
 * an outage now fails this step in about a minute instead of hanging.
 *
 * Logic in TypeScript, not in the workflow's shell (the working rules): each step is one command,
 * run in order, and the first failure stops the script with its exit code. The container runs as
 * root, and the image need not have `sudo`, `curl` or `gpg`: keys are fetched here, and an
 * ASCII-armored key is written as `.asc`, which apt reads as it is.
 *
 *   bun scripts/ci/install-browsers.ts
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

/** An apt repository: its signing key, its source line, and the package to install from it. */
interface AptBrowser {
  name: string;
  key: string;
  /** Without extension: `.gpg` (binary) or `.asc` (armored) is added by what the key is. */
  keyring: string;
  source: string;
  list: string;
  pkg: string;
}

const APT: AptBrowser[] = [
  {
    name: 'brave',
    key: 'https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg',
    keyring: '/usr/share/keyrings/brave-browser-archive-keyring',
    source: 'https://brave-browser-apt-release.s3.brave.com/ stable main',
    list: '/etc/apt/sources.list.d/brave-browser-release.list',
    pkg: 'brave-browser',
  },
  {
    name: 'opera',
    key: 'https://deb.opera.com/archive.key',
    keyring: '/usr/share/keyrings/opera-browser',
    source: 'https://deb.opera.com/opera-stable/ stable non-free',
    list: '/etc/apt/sources.list.d/opera-stable.list',
    pkg: 'opera-stable',
  },
];

/** apt's network settings for every apt run here, Playwright's installers' included. */
export const APT_FAIL_FAST = [
  'Acquire::Retries "1";',
  'Acquire::http::Timeout "15";',
  'Acquire::https::Timeout "15";',
  '',
].join('\n');

/** The keyring file for a fetched key: binary keys as `.gpg`, armored ones as `.asc`. */
export function keyringPath(base: string, key: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(key.subarray(0, 64));
  return `${base}${head.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----') ? '.asc' : '.gpg'}`;
}

function step(label: string, cmd: string, args: string[]): void {
  console.log(`$ ${label}`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
  });
  if (r.status !== 0) {
    console.error(`✗ ${label}: exit ${r.status ?? r.error?.message}`);
    process.exit(r.status ?? 1);
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) {
    console.error('install-browsers.ts runs in CI, as root in the Playwright container');
    process.exit(2);
  }
  // 1. Fail fast, before ANY apt run (Playwright's installers run apt too).
  writeFileSync('/etc/apt/apt.conf.d/99-binaryang-fail-fast', APT_FAIL_FAST);
  console.log('apt: one retry, 15 s timeouts');

  // 2. The vendors' repositories.
  for (const b of APT) {
    const r = await fetch(b.key, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) {
      console.error(`✗ ${b.name}: its signing key answered HTTP ${r.status}`);
      process.exit(1);
    }
    const key = new Uint8Array(await r.arrayBuffer());
    const keyring = keyringPath(b.keyring, key);
    writeFileSync(keyring, key);
    writeFileSync(b.list, `deb [arch=amd64 signed-by=${keyring}] ${b.source}\n`);
    console.log(`${b.name}: ${keyring}, ${b.list}`);
  }
  step('apt-get update', 'apt-get', ['update', '-q']);

  // 3. Chrome and Edge, by Playwright's installers (they fetch and install the vendor packages).
  step('playwright install chrome msedge', 'node', [
    'node_modules/playwright/cli.js',
    'install',
    'chrome',
    'msedge',
  ]);

  // 4. Brave and Opera.
  step(`apt-get install ${APT.map((b) => b.pkg).join(' ')}`, 'apt-get', [
    'install',
    '-y',
    '-q',
    ...APT.map((b) => b.pkg),
  ]);
  console.log('browsers installed');
}

if (import.meta.main) await main();
