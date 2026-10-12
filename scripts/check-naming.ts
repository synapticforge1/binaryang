// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The naming rule (BINDING; cmem/project.md § "Upstream names are reserved").
 *
 * A bare upstream project name (`binaryen`, `wabt`) may appear in a tracked
 * path ONLY where upstream compatibility or comparison is the subject: under a
 * `compat`, `interop` or `comparison` component (the last since 1.7.0, which
 * holds `interop/`). The qualified forms `binaryen-ts` / `wabt-ts` are
 * permitted — the `-ts` suffix is what distinguishes our port from the project
 * it ports.
 *
 * Prints each offending path and exits 1 if there is one; silent with exit 0
 * when the rule holds. (Its shell predecessor always exited 0 and made the
 * OUTPUT the verdict, which a reader once took the wrong way round.)
 *
 * ⚠️ It must STRIP the permitted components and test what remains. The
 * original one-liner (`grep -v '(binaryen|wabt)-ts'`) was correct only before
 * the merge: once `src/binaryen-ts/` and `src/wabt-ts/` existed, that exclusion
 * matched the DIRECTORY component and discarded every file in both trees, so
 * the check silently passed on everything.
 *
 * ```sh
 * bun scripts/check-naming.ts
 * ```
 */

/** A component that makes upstream the subject: every name under it is allowed. */

import process from 'node:process';
import { spawnSync } from 'node:child_process';

const EXEMPT = /compat|interop|comparison/;

/** A bare upstream name as a whole word of a component, after the `-ts` forms are removed. */
const BARE = /(^|[-_.])(binaryen|wabt)([-_.]|$)/;

/** Whether `path` (slash-separated, as git prints it) breaks the rule. */
export function violates(path: string): boolean {
  const components = path.split('/').map((c) => c.toLowerCase());
  if (components.some((c) => EXEMPT.test(c))) return false;
  return components.some((c) =>
    BARE.test(c.replaceAll('binaryen-ts', '').replaceAll('wabt-ts', ''))
  );
}

function trackedPaths(): string[] {
  const out = spawnSync('git', ['ls-files', '-z'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 1 << 28,
  });
  if (out.status !== 0) throw new Error(`git ls-files exited ${out.status}`);
  return out.stdout.toString('utf8').split('\0').filter((p) => p !== '');
}

if (import.meta.main) {
  const offenders = (await trackedPaths()).filter(violates);
  for (const p of offenders) console.log(p);
  process.exit(offenders.length === 0 ? 0 : 1);
}
