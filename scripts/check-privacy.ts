// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * 🔒 The privacy rule, CHECKED (security review round 1, A3, 2026-11-13): "No secrets or personal
 * information are ever made public" (workspace working-rules § Records) — no token, key,
 * password, personal address or personal drive path in any committed file, commit message or
 * package. It was a rule people followed; nothing in CI or the release checked it.
 *
 * What it reads:
 *   - every tracked file (`git ls-files`), text only;
 *   - each directory named with `--dir` (the npm package's `dist/`, before it is packed);
 *   - with `--commits <range>`, the message of every commit in the range (`git log`).
 *
 * What it refuses:
 *   - a drive path that records one machine's layout: a drive letter then `Users` or `Programs`
 *     (either slash), the same under WSL's `/mnt/<letter>`, a macOS home (`/Users/<name>/`), a
 *     Linux home (`/home/<name>/`) — except `/home/runner/`, the CI runner's, which names nothing
 *     about a person (the test is "is it machine-specific?", owner 2026-10-23);
 *   - a private key block, and the token shapes of GitHub, npm, AWS and Slack (JSR and npm
 *     publish by OIDC here: no token of theirs exists to leak);
 *   - an email address, except a service's (`…@users.noreply.github.com`, `noreply@…`,
 *     `git@github.com`) and the ONE maintainer contact the rule allows — read from the manifests'
 *     own fields at run time, so this file never holds it — and only in a manifest.
 *
 * A hit is printed with its file and line and the match MASKED (its first three characters), and
 * exits 1. Never print a secret whole, even to say it was found.
 *
 * ```sh
 * bun scripts/check-privacy.ts [--dir dist] [--commits <range>]
 * ```
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** One finding: where, what kind, and the match masked. */
export interface Leak {
  where: string;
  kind: string;
  masked: string;
}

const RULES: { kind: string; re: RegExp }[] = [
  { kind: 'drive path', re: /\b[A-Za-z]:(?:\\\\?|\/)+(?:Users|Programs)(?:\\\\?|\/)[^\s'"`]*/g },
  { kind: 'drive path', re: /\/mnt\/[a-z]\/(?:Users|Programs)\/[^\s'"`]*/g },
  { kind: 'home path', re: /\/Users\/[A-Za-z][\w.-]*\/[^\s'"`]*/g },
  { kind: 'home path', re: /\/home\/(?!runner\/)[a-z][\w.-]*\/[^\s'"`]*/g },
  { kind: 'private key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { kind: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'AWS key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** A service's address, which names no person. */
const SERVICE = /^(?:[^@\s]+@users\.noreply\.github\.com|no-?reply@[^@\s]+|git@github\.com)$/i;
/** Files the maintainer contact may appear in: the manifests' own fields. */
const MANIFESTS = new Set(['package.json', 'jsr.json', 'dist/package.json']);

/**
 * Findings checked by hand and found to name nothing private, each by place and kind, with why.
 * Commit messages cannot be changed once pushed, so a false positive in one is listed here
 * rather than rewritten; a FILE's false positive is fixed in the file instead.
 */
export const KNOWN: readonly { where: string; kind: string; why: string }[] = [
  {
    where: 'commit 05389dc7454e:6',
    kind: 'home path',
    why: "review round 2's message quotes the test's fictional home path for a user 'brave' " +
      '(2026-11-13); the fixture now uses a path under /srv',
  },
];

/** The first three characters, then stars: enough to find it, never enough to use it. */
export function mask(s: string): string {
  return `${s.slice(0, 3)}${'*'.repeat(Math.max(3, Math.min(12, s.length - 3)))}`;
}

/**
 * Every leak in `text`, named `name` (a path, or `commit <sha>`). `maintainer` is the one address
 * allowed, in a manifest only.
 */
export function findLeaks(name: string, text: string, maintainer: string | undefined): Leak[] {
  const out: Leak[] = [];
  const lines = text.split('\n');
  const isManifest = MANIFESTS.has(name.replace(/\\/g, '/'));
  lines.forEach((line, i) => {
    const where = `${name}:${i + 1}`;
    for (const { kind, re } of RULES) {
      for (const m of line.matchAll(re)) out.push({ where, kind, masked: mask(m[0]) });
    }
    for (const m of line.matchAll(EMAIL)) {
      const addr = m[0];
      if (SERVICE.test(addr)) continue;
      if (
        maintainer !== undefined && addr.toLowerCase() === maintainer.toLowerCase() && isManifest
      ) {
        continue;
      }
      out.push({ where, kind: 'email address', masked: mask(addr) });
    }
  });
  return out;
}

/** The leaks not in {@link KNOWN}. */
export function unknown(leaks: readonly Leak[]): Leak[] {
  return leaks.filter((l) => !KNOWN.some((k) => k.where === l.where && k.kind === l.kind));
}

/** The maintainer contact, from the manifests' own fields, if one is there. */
function maintainerAddress(root: string): string | undefined {
  for (const f of ['package.json', 'jsr.json']) {
    try {
      const j = JSON.parse(readFileSync(join(root, f), 'utf8')) as Record<string, unknown>;
      const people = [j['author'], ...((j['maintainers'] as unknown[]) ?? [])];
      for (const p of people) {
        const s = typeof p === 'string' ? p : (p as { email?: string } | undefined)?.email;
        const m = s?.match(EMAIL);
        if (m) return m[0];
      }
    } catch {
      // no such manifest, or no address in it
    }
  }
  return undefined;
}

/** Text files only: a NUL in the first 8 KiB means binary (as git decides). */
function textOf(path: string): string | undefined {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8192).includes(0)) return undefined;
  return bytes.toString('utf8');
}

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

/** Parses `--dir D` (repeatable) and `--commits R`; anything else is refused. */
export function parseArgs(argv: string[]): { dirs: string[]; commits: string | undefined } {
  const dirs: string[] = [];
  let commits: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = argv[i + 1];
    if ((a === '--dir' || a === '--commits') && (v === undefined || v.startsWith('--'))) {
      throw new Error(`${a} needs a value`);
    }
    if (a === '--dir') dirs.push(argv[++i]!);
    else if (a === '--commits') commits = argv[++i]!;
    else throw new Error(`unknown argument ${a}`);
  }
  return { dirs, commits };
}

if (import.meta.main) {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`check-privacy: ${(e as Error).message}`);
    process.exit(2);
  }
  const root = process.cwd();
  const maintainer = maintainerAddress(root);
  const leaks: Leak[] = [];
  let files = 0;
  for (const f of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
    let text: string | undefined;
    try {
      text = textOf(join(root, f));
    } catch {
      continue; // listed but deleted in the working tree
    }
    if (text === undefined) continue;
    files++;
    leaks.push(...findLeaks(f, text, maintainer));
  }
  for (const d of args.dirs) {
    const all: string[] = [];
    walk(join(root, d), all);
    for (const p of all) {
      const text = textOf(p);
      if (text === undefined) continue;
      files++;
      leaks.push(...findLeaks(p.slice(root.length + 1).replace(/\\/g, '/'), text, maintainer));
    }
  }
  let commits = 0;
  if (args.commits !== undefined) {
    for (const entry of git(['log', '--format=%H%n%B%x00', args.commits]).split('\0')) {
      const body = entry.trim();
      if (body === '') continue;
      commits++;
      const sha = body.slice(0, 12);
      leaks.push(...findLeaks(`commit ${sha}`, body.slice(body.indexOf('\n') + 1), undefined));
    }
  }
  if (files < 50) {
    console.error(
      `check-privacy: only ${files} files read — the listing is broken, not the tree clean`,
    );
    process.exit(1);
  }
  const found = unknown(leaks);
  if (found.length > 0) {
    console.error(`check-privacy: ${found.length} finding(s) (masked):`);
    for (const l of found) console.error(`  ${l.where}: ${l.kind} ${l.masked}`);
    process.exit(1);
  }
  console.log(
    `check-privacy: clean — ${files} files${commits ? `, ${commits} commit messages` : ''}`,
  );
}
