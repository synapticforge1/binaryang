// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The lint is not vacuous: Biome, through THIS project's biome.jsonc, must report every rule below
 * on a snippet built to break each one. Run after every lint (`bun run lint`).
 *
 * 🔧 Why (2026-10-13): `biome migrate` (2.5.14) rewrote `"recommended": true` as
 * `"preset": "none"`, which turns every rule OFF, so the lint step passes on anything. A green
 * lint cannot tell "clean" from "checking nothing". This canary can. It runs on every lint, so an
 * upgrade, a migrate, or a config edit that silences the linter fails at once, with no reminder
 * to remember.
 *
 * The snippet is written to a TEMPORARY file under `src/`, so the project's include rules and
 * config apply to it as to real source, and is always deleted afterwards. (stdin with
 * `--stdin-file-path` does not work: Biome 2.5.14's `lint` echoes stdin back and reports no
 * diagnostics, measured 2026-10-13.) Not gitignored on purpose: Biome honours `.gitignore`
 * (`useIgnoreFile`) and would then skip the file.
 *
 * This canary is the ONLY guard. Until 2026-10-13 `"preset": "none"` also failed the lint by
 * accident (the `biome-ignore` comments became "suppression comment has no effect" warnings);
 * the last suppression went that day, and with `"none"` `biome lint --error-on-warnings` now
 * passes on all 521 files while this canary fails naming 3 rules (measured 2026-10-13).
 *
 * ```sh
 * bun scripts/check-lint-canary.ts
 * ```
 */

import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import process from 'node:process';

/** Each rule, and a line that breaks it: recommended-set rules AND the explicitly enabled ones. */
export const CANARIES: readonly [rule: string, code: string][] = [
  ['lint/suspicious/noExplicitAny', 'export const a = (x: any): number => x;'], // recommended
  ['lint/suspicious/noDebugger', 'export function d(): void { debugger; }'], // recommended
  ['lint/suspicious/noDoubleEquals', 'export const e = (x: number): boolean => x == 1;'], // recommended
  ['lint/suspicious/useAwait', 'export async function w(): Promise<number> { return 1; }'], // deno's require-await
  ['lint/suspicious/noVar', 'export function v(): number { var x = 1; return x; }'], // deno's no-var
  ['lint/style/useConst', 'export function c(): number { let y = 2; return y; }'], // deno's prefer-const
];

if (import.meta.main) {
  const code = CANARIES.map(([, c]) => c).join('\n') + '\n';
  const file = 'src/__lint_canary__.ts';
  let out: string;
  try {
    writeFileSync(file, code);
    const r = spawnSync(
      'node_modules/.bin/biome' + (process.platform === 'win32' ? '.exe' : ''),
      ['lint', file, '--colors=off', '--max-diagnostics=none'],
      { encoding: 'utf8' },
    );
    out = `${r.stdout}${r.stderr}`;
  } finally {
    rmSync(file, { force: true });
  }
  const missing = CANARIES.filter(([rule]) => !out.includes(rule)).map(([rule]) => rule);
  if (missing.length > 0) {
    console.log(
      [
        'The lint is checking LESS than biome.jsonc claims. These rules did not fire on a snippet',
        'built to break them:',
        ...missing.map((m) => `  ${m}`),
        'Check biome.jsonc first: `biome migrate` (2.5.14) rewrites "recommended": true as',
        '"preset": "none", which switches every rule off.',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(`lint canary: all ${CANARIES.length} rules fire through biome.jsonc`);
}
