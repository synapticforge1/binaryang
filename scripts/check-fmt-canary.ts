// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The format check is not vacuous: dprint, through THIS project's dprint.json, must cover the tree
 * and apply the settings `deno fmt` used. Run after every `dprint check` (`bun run fmt:check`).
 *
 * 🔧 Why (2026-10-13, Bun migration B3): a green `dprint check` cannot tell "formatted" from
 * "checked nothing" (an `includes` typo) or "checked with the wrong settings" (a lost `lineWidth`
 * or `quoteStyle` reformats nothing that is already formatted). Three TEMPORARY files under `src/`
 * (so the real includes apply), checked by the full config, always deleted afterwards:
 * - A, double-quoted: MUST be reported (in scope, and `quoteStyle: preferSingle` is live);
 * - B, a correct line of 92–98 columns: must NOT be reported (the width is at least ~100);
 * - C, the same shape at 103–108 columns: MUST be reported (the width is at most ~100).
 * And dprint must list at least {@link MIN_FILES} files (532 on 2026-10-13).
 *
 * ```sh
 * bun scripts/check-fmt-canary.ts
 * ```
 */

import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import process from 'node:process';

export const MIN_FILES = 500;

/** `export const <name> = ['w0', 'w1', …];` grown until its length falls in [lo, hi]. */
function arrayLine(name: string, lo: number, hi: number): string {
  for (let n = 1; n < 40; n++) {
    for (let pad = 0; pad < 8; pad++) {
      const items = Array.from({ length: n }, (_, i) => `'w${i}${'x'.repeat(i === 0 ? pad : 0)}'`);
      const line = `export const ${name} = [${items.join(', ')}];`;
      if (line.length >= lo && line.length <= hi) return line;
    }
  }
  throw new Error(`no line of ${lo}–${hi} columns`);
}

export const FILES: readonly { path: string; code: string; reported: boolean; why: string }[] = [
  {
    path: 'src/__fmt_canary_a__.ts',
    code: 'export const a = "x";\n',
    reported: true,
    why: 'singleQuote / scope',
  },
  {
    path: 'src/__fmt_canary_b__.ts',
    code: `${arrayLine('b', 92, 98)}\n`,
    reported: false,
    why: 'lineWidth >= ~100',
  },
  {
    path: 'src/__fmt_canary_c__.ts',
    code: `${arrayLine('c', 103, 108)}\n`,
    reported: true,
    why: 'lineWidth <= ~100',
  },
];

if (import.meta.main) {
  const bin = 'node_modules/.bin/dprint' + (process.platform === 'win32' ? '.exe' : '');
  const listed = spawnSync(bin, ['output-file-paths'], { encoding: 'utf8', maxBuffer: 16 << 20 });
  const count = listed.stdout.split('\n').filter((l) =>
    l.trim() && !l.startsWith('Compiling')
  ).length;
  let out = '';
  try {
    for (const f of FILES) writeFileSync(f.path, f.code);
    const r = spawnSync(bin, ['check'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    // Colour codes and CRLF off, so the `from <path>:` headers match line-anchored.
    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
    out = `${r.stdout}${r.stderr}`.replace(ansi, '').replaceAll('\r', '').replaceAll('\\', '/');
  } finally {
    for (const f of FILES) rmSync(f.path, { force: true });
  }
  // Only dprint's per-file headers count (`from <path>:`): a diff of another file can CONTAIN a
  // canary's path (this script's own did, before it was formatted).
  const reportedPaths = [...out.matchAll(/^from (.+):$/gm)].map((m) => m[1]!.trim());
  const wrong = FILES.filter((f) => reportedPaths.some((p) => p.endsWith(f.path)) !== f.reported);
  if (count < MIN_FILES || wrong.length > 0) {
    console.log(
      [
        'The format check is checking LESS than dprint.json claims.',
        ...(count < MIN_FILES
          ? [`  dprint lists ${count} files, fewer than ${MIN_FILES}: check "includes".`]
          : []),
        ...wrong.map((f) => `  ${f.path} was ${f.reported ? 'NOT ' : ''}reported (${f.why})`),
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(
    `fmt canary: ${count} files in scope; quote style and line width hold through dprint.json`,
  );
}
