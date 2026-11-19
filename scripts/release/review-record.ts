// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The record of the latest COMPLETED review: one file, `cmem/local/review-complete` (gitignored,
 * private), holding exactly one commit hash. Written only by this script; read strictly by the
 * release (`bun run release` refuses without it, or when anything but the release files and
 * `cmem/` changed since that commit — workspace review standard, letter H37 § 9).
 *
 * 🔒 Owner, 2026-11-19 (option C of the review-line finding): the record moved out of the
 * hand-written review notes. Reading it from free text failed open three times — each fix met a
 * new look-alike spelling of the line that made the release use an OLDER review — so the record is
 * now a value no one writes by hand and nothing reads loosely. The notes may keep a
 * human-readable copy; nothing reads it.
 *
 * ```sh
 * bun run review:record <commit>   # when a review's last re-review comes back empty
 * ```
 *
 * @license MIT
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import process from 'node:process';

/** Where the record lives (gitignored: `/cmem/local/`). */
export const REVIEW_RECORD = 'cmem/local/review-complete';

/** The one valid content: 40 lowercase hex digits and an optional single LF, nothing else. */
const RECORD = /^([0-9a-f]{40})\n?$/;

/**
 * The commit a record's BYTES name. Throws, naming the problem, for anything but the one valid
 * content — a byte-order mark, UTF-16, CRLF, spaces, a second line, an uppercase or short hash —
 * because only this script writes the file: anything else was written some other way.
 */
export function parseReviewRecord(bytes: Uint8Array): string {
  for (const b of bytes) {
    if (b > 0x7f) {
      throw new Error(
        `${REVIEW_RECORD} holds a non-ASCII byte: rewrite it with \`bun run review:record\``,
      );
    }
  }
  const m = RECORD.exec(new TextDecoder().decode(bytes));
  if (m === null) {
    throw new Error(
      `${REVIEW_RECORD} is not one 40-hex commit hash: rewrite it with \`bun run review:record\``,
    );
  }
  return m[1]!;
}

/** The recorded commit, or `null` when no review is recorded. Throws on a malformed record. */
export function readReviewRecord(path: string = REVIEW_RECORD): string | null {
  if (!existsSync(path)) return null;
  return parseReviewRecord(readFileSync(path));
}

/**
 * Writes `sha` (40 lowercase hex) as the record, whole: into a temp file beside it, then renamed
 * over it, so a failure leaves the old record or none — never half of one.
 */
export function writeReviewRecord(sha: string, path: string = REVIEW_RECORD): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`not a 40-hex commit hash: ${JSON.stringify(sha)}`);
  }
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${sha}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch { /* not made */ }
    throw e;
  }
}

/** The full hash of `rev`, which must name a commit in this repository; `null` when it does not. */
export function resolveCommit(rev: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const sha = r.status === 0 ? r.stdout.trim() : '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

if (import.meta.main) {
  const rev = process.argv[2];
  if (rev === undefined || process.argv.length > 3) {
    console.error(
      'usage: bun run review:record <commit>   (the commit the completed review covers)',
    );
    process.exit(2);
  }
  const sha = resolveCommit(rev);
  if (sha === null) {
    console.error(`review:record: '${rev}' names no commit in this repository`);
    process.exit(1);
  }
  writeReviewRecord(sha);
  console.log(`review:record: ${REVIEW_RECORD} = ${sha}`);
}
