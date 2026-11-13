// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * CI only: installs Brave and Opera for ci.yml's "Browsers (Chrome, Edge, Brave, Opera)" job, on GitHub's hosted
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
import { createHash } from 'node:crypto';
import process from 'node:process';

/** An apt repository: its signing key, its source line, and the package to install from it. */
export interface AptBrowser {
  name: string;
  key: string;
  /**
   * The key file's primary-key fingerprints, exactly (security review round 1, C12, 2026-11-13).
   * The key was trusted on first use: whatever the URL served signed the packages installed. Read
   * from each vendor's URL on 2026-11-13 and equal to `gpg --show-keys` on the same file; a
   * vendor's rotation fails CI with the new list, to be checked and pinned by hand.
   */
  fingerprints: readonly string[];
  /** Without extension: `.gpg` (binary) or `.asc` (armored) is added by what the key is. */
  keyring: string;
  source: string;
  list: string;
  pkg: string;
}

export const APT: readonly AptBrowser[] = [
  {
    name: 'brave',
    key: 'https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg',
    fingerprints: [
      'DBF1A116C220B8C7164F98230686B78420038257',
      '47D32A74E9A9E013A4B4926C68D513D36A73CD96',
      'B2A3DCA350E67256740DF904DE4EC67BE4B0DCA0',
    ],
    keyring: '/usr/share/keyrings/brave-browser-archive-keyring',
    source: 'https://brave-browser-apt-release.s3.brave.com/ stable main',
    list: '/etc/apt/sources.list.d/brave-browser-release.list',
    pkg: 'brave-browser',
  },
  {
    name: 'opera',
    key: 'https://deb.opera.com/archive.key',
    fingerprints: ['6C86BE214648376680CA957B11EE8C00B693A745'],
    keyring: '/usr/share/keyrings/opera-browser',
    source: 'https://deb.opera.com/opera-stable/ stable non-free',
    list: '/etc/apt/sources.list.d/opera-stable.list',
    pkg: 'opera-stable',
  },
];

/**
 * Ubuntu packages a browser needs but does not declare. Opera aborts at start without
 * `gsettings-desktop-schemas` ("GLib-GIO-ERROR: Settings schema 'org.gnome.desktop.background' is
 * not installed", SIGABRT — measured on GitHub, 2026-11-11); `playwright install --with-deps`
 * used to install it, among its 181. The one thing here that still asks Ubuntu's mirrors.
 */
export const UNDECLARED: readonly string[] = ['gsettings-desktop-schemas'];

/** apt's network settings for every apt run here: one retry, 15 s per request. */
export const APT_FAIL_FAST = [
  'Acquire::Retries "1";',
  'Acquire::http::Timeout "15";',
  'Acquire::https::Timeout "15";',
  '',
].join('\n');

/** An armored key's bytes (the base64 between the header's blank line and the checksum), or the key as given. */
export function dearmor(key: Uint8Array): Uint8Array {
  const text = new TextDecoder('latin1').decode(key);
  if (!text.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----')) return key;
  const body = text.split('-----BEGIN PGP PUBLIC KEY BLOCK-----')[1]!
    .split('-----END PGP PUBLIC KEY BLOCK-----')[0]!;
  const lines = body.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.trim() === '') + 1;
  const b64 = lines.slice(start).filter((l) => !l.startsWith('=')).join('').trim();
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * The fingerprints of every PRIMARY key in an OpenPGP key file (packet tag 6, version 4: SHA-1 of
 * 0x99, the body's 2-byte length, and the body — RFC 4880 § 12.2), uppercase hex, in file order.
 * A key of another version, or a packet that does not parse, throws: the check below must not
 * pass on what it could not read.
 */
export function primaryFingerprints(file: Uint8Array): string[] {
  const b = dearmor(file);
  const out: string[] = [];
  for (let p = 0; p < b.length;) {
    const h = b[p++]!;
    if ((h & 0x80) === 0) throw new Error(`not an OpenPGP packet at byte ${p - 1}`);
    let tag: number;
    let len: number;
    if (h & 0x40) {
      tag = h & 0x3f;
      const l0 = b[p++]!;
      if (l0 < 192) len = l0;
      else if (l0 < 224) len = ((l0 - 192) << 8) + b[p++]! + 192;
      else if (l0 === 255) {
        len = ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0;
        p += 4;
      } else throw new Error('a partial-length packet in a key file');
    } else {
      tag = (h >> 2) & 0x0f;
      const kind = h & 3;
      if (kind === 3) throw new Error('an indeterminate-length packet in a key file');
      const n = [1, 2, 4][kind]!;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + b[p++]!;
    }
    if (p + len > b.length) throw new Error('a packet runs past the end of the key file');
    const body = b.subarray(p, p + len);
    if (tag === 6) {
      if (body[0] !== 4) {
        throw new Error(`a version ${body[0]} primary key (only version 4 is read)`);
      }
      const hash = createHash('sha1');
      hash.update(new Uint8Array([0x99, (len >> 8) & 0xff, len & 0xff]));
      hash.update(body);
      out.push(hash.digest('hex').toUpperCase());
    }
    p += len;
  }
  return out;
}

/** Why a fetched key is not the pinned one, or `null` when its primary keys are exactly the pins. */
export function keyProblem(
  b: Pick<AptBrowser, 'key' | 'fingerprints'>,
  key: Uint8Array,
): string | null {
  let got: string[];
  try {
    got = primaryFingerprints(key);
  } catch (e) {
    return `its signing key does not read as OpenPGP keys: ${(e as Error).message}`;
  }
  const want = [...b.fingerprints].sort();
  const have = [...got].sort();
  if (have.length === want.length && have.every((f, i) => f === want[i])) return null;
  return `its signing key (${b.key}) holds primary keys [${got.join(', ')}], not the pinned ` +
    `[${b.fingerprints.join(', ')}]: a vendor's rotation is checked and pinned by hand`;
}

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
    const problem = keyProblem(b, key);
    if (problem !== null) {
      console.error(`✗ ${b.name}: ${problem}`);
      process.exit(1);
    }
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
  const pkgs = [...APT.map((b) => b.pkg), ...UNDECLARED];
  step(`apt-get install ${pkgs.join(' ')}`, 'sudo', ['apt-get', 'install', '-y', '-q', ...pkgs]);
  // 4. Each starts at all, here, where its error names what is missing (2026-11-11: Opera closed
  // at launch inside the check with no reason, once `--with-deps` no longer installed 181 system
  // packages before it).
  step('brave-browser --version', 'brave-browser', ['--version']);
  step('opera --version', 'opera', ['--version']);
  console.log('Brave and Opera installed');
}

if (import.meta.main) await main();
