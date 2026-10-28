// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Deno, from npm, run by Bun — the ONE place its version is written (open-work 51, 2026-10-28).
 *
 * Deno stays the authority where JSR is the question — `deno publish`'s type check, `deno doc`'s
 * view of the exports, the Deno consumer's run — but it is not a tool anyone installs (owner,
 * 2026-10-28: "migrating everything to bun"). Deno's own npm package (`deno`, published by the
 * Deno team) is fetched and run by `bun x`. Code builds the command with {@link denoCommand};
 * a command line (package.json, CI, cli-smoke) runs this file:
 *
 * ```sh
 * bun scripts/deno.ts publish --dry-run --allow-dirty
 * bun scripts/deno.ts run -A main.ts --help
 * ```
 *
 * `tests/wabt-ts/scripts/deno_pin.test.ts` refuses a `deno@<version>` written anywhere else.
 * Bumping it: one edit here, then `bun run surface:check` (`deno doc`'s output feeds the surface
 * hashes) and the publish dry run.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** The pinned Deno, as `bun x` names it. */
export const DENO = 'deno@2.9.6';

/** `bun` and its arguments to run Deno with `args`: spawn as `spawnSync(cmd, argv, …)`. */
export function denoCommand(args: readonly string[]): [string, string[]] {
  return ['bun', ['x', DENO, ...args]];
}

if (import.meta.main) {
  const [cmd, argv] = denoCommand(process.argv.slice(2));
  const r = spawnSync(cmd, argv, { stdio: 'inherit' });
  if (r.error) {
    console.error(`scripts/deno.ts: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}
