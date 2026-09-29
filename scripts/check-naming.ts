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
 * deno run --allow-run scripts/check-naming.ts
 * ```
 */

/** A component that makes upstream the subject: every name under it is allowed. */
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

async function trackedPaths(): Promise<string[]> {
  const out = await new Deno.Command('git', { args: ['ls-files', '-z'], stderr: 'inherit' })
    .output();
  if (!out.success) throw new Error(`git ls-files exited ${out.code}`);
  return new TextDecoder().decode(out.stdout).split('\0').filter((p) => p !== '');
}

if (import.meta.main) {
  const offenders = (await trackedPaths()).filter(violates);
  for (const p of offenders) console.log(p);
  Deno.exit(offenders.length === 0 ? 0 : 1);
}
