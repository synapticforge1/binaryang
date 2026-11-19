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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

/** Where the record lives (gitignored: `/cmem/local/`). */
export const REVIEW_RECORD = 'cmem/local/review-complete';

/** The one valid content: 40 lowercase hex digits and an optional single LF, nothing else. */
const RECORD = /^([0-9a-f]{40})\n?$/;
/** The largest valid record, in bytes: 40 hex digits and a LF. */
const MAX_RECORD_BYTES = 41;

/**
 * The commit a record's BYTES name. Throws, naming the problem and the file (`path`), for anything
 * but the one valid content — a byte-order mark, UTF-16, CRLF, spaces, a second line, an uppercase
 * or short hash — because only this script writes the file: anything else was written some other way.
 */
export function parseReviewRecord(bytes: Uint8Array, path: string = REVIEW_RECORD): string {
  const fix = 'rewrite it with `bun run review:record <commit>`';
  for (const b of bytes) {
    if (b > 0x7f) throw new Error(`${path} holds a non-ASCII byte: ${fix}`);
  }
  const m = RECORD.exec(new TextDecoder().decode(bytes));
  if (m === null) throw new Error(`${path} is not one 40-hex commit hash: ${fix}`);
  return m[1]!;
}

/**
 * The recorded commit, or `null` when no review is recorded. Throws, naming the file, on a
 * malformed record — a folder, or more than {@link MAX_RECORD_BYTES} bytes, refused before it is
 * read (re-review 3: a huge file was read whole first; a folder threw the bare OS error).
 */
export function readReviewRecord(path: string = REVIEW_RECORD): string | null {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (!st.isFile()) throw new Error(`${path} is not a file: remove it, then run review:record`);
  if (st.size > MAX_RECORD_BYTES) {
    throw new Error(`${path} is ${st.size} bytes, not one 40-hex commit hash: rewrite it`);
  }
  return parseReviewRecord(readFileSync(path), path);
}

/**
 * Writes `sha` (40 lowercase hex) as the record, whole: into a temp file beside it, then renamed
 * over it, so a failure leaves the old record or none — never half of one. Makes the record's
 * folder when it is missing: `cmem/local/` is gitignored, so a fresh clone has none (re-review 3,
 * B-3: the first `review:record` there failed with a bare ENOENT).
 */
export function writeReviewRecord(sha: string, path: string = REVIEW_RECORD): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`not a 40-hex commit hash: ${JSON.stringify(sha)}`);
  }
  // Only when missing: Bun 1.4.4 on Windows throws EEXIST for `mkdirSync('.', { recursive })`, which
  // Node does not, so a bare file name failed (re-review 4, 2026-11-19).
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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
  try {
    writeReviewRecord(sha);
  } catch (e) {
    // A named one-line refusal, never a stack trace (re-review 3, B-3).
    console.error(
      `review:record: cannot write ${REVIEW_RECORD}: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
  console.log(`review:record: ${REVIEW_RECORD} = ${sha}`);
}
