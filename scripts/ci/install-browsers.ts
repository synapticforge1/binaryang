// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * CI only: installs Brave and Opera for ci.yml's "Browsers (installed)" job, on GitHub's hosted
 * Ubuntu runner, from each vendor's apt repository. That runner already has Chrome and Edge, so
 * nothing else is installed: Playwright's own Chromium, Firefox and WebKit are checked by the
 * other Browsers job, inside Playwright's container, where they are part of the image.
 *
 * Why the split (owner, 2026-11-11): all day GitHub's runners could not resolve the Ubuntu
 * mirrors. On the hosted runner `playwright install --with-deps` asked them for 181 packages
 * (114 MB) and waited out the job's 20-minute limit; inside the container, Chrome's package could
 * not get its one missing dependency (`xdg-utils`). Each job now asks the mirrors for nothing it
 * can avoid, and apt FAILS FAST (one retry, 15 s per request) for what is left.
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

/** apt's network settings for every apt run here: one retry, 15 s per request. */
export const APT_FAIL_FAST = [
  'Acquire::Retries "1";',
  'Acquire::http::Timeout "15";',
  'Acquire::https::Timeout "15";',
  '',
].join('\n');

/** The keyring file for a fetched key: binary keys as `.gpg`, armored ones as `.asc` (apt reads both). */
export function keyringPath(base: string, key: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(key.subarray(0, 64));
  return `${base}${head.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----') ? '.asc' : '.gpg'}`;
}

function step(label: string, cmd: string, args: string[], input?: string | Uint8Array): void {
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

/** Writes a root-owned file through `sudo tee` (output discarded). */
function writeRoot(label: string, path: string, content: string | Uint8Array): void {
  step(label, 'sh', ['-c', `sudo tee "$0" > /dev/null`, path], content);
}

async function main(): Promise<void> {
  if (process.platform !== 'linux') {
    console.error('install-browsers.ts is for CI (Linux); locally, install browsers yourself');
    process.exit(2);
  }
  // 1. Fail fast, before ANY apt run.
  writeRoot(
    'apt: one retry, 15 s timeouts',
    '/etc/apt/apt.conf.d/99-binaryang-fail-fast',
    APT_FAIL_FAST,
  );

  // 2. The vendors' repositories (keys fetched here: no curl or gpg needed).
  for (const b of APT) {
    const r = await fetch(b.key, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) {
      console.error(`✗ ${b.name}: its signing key answered HTTP ${r.status}`);
      process.exit(1);
    }
    const key = new Uint8Array(await r.arrayBuffer());
    const keyring = keyringPath(b.keyring, key);
    writeRoot(`${b.name}: keyring ${keyring}`, keyring, key);
    writeRoot(
      `${b.name}: source`,
      b.list,
      `deb [arch=amd64 signed-by=${keyring}] ${b.source}\n`,
    );
  }

  // 3. Brave and Opera.
  step('apt-get update', 'sudo', ['apt-get', 'update', '-q']);
  step(`apt-get install ${APT.map((b) => b.pkg).join(' ')}`, 'sudo', [
    'apt-get',
    'install',
    '-y',
    '-q',
    ...APT.map((b) => b.pkg),
  ]);
  console.log('Brave and Opera installed');
}

if (import.meta.main) await main();
