// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Counts the exported type names that collide between the two `src/` trees.
 *
 * This is binaryang's stated measure of convergence: two IRs are retained by
 * decision, and the number only falls when they genuinely converge.
 *
 * ## The counting rule is the point
 *
 * `type` + `interface` + `enum`, exported, one name counted once per tree. The
 * same tree yields **55** without `enum`, **56** with it, and **58** if classes
 * are counted — so a number reported without its rule cannot be compared
 * against an earlier one. The rule lived only in a person's head until this
 * script; that is the defect being fixed, more than the manual counting.
 *
 * `class` is excluded deliberately. A class is a runtime value as well as a
 * type, so two same-named exported classes would collide at runtime too — a
 * different and louder problem than a compile-time type ambiguity. Zero
 * runtime values collide today, and folding classes into this number would
 * hide the day one does.
 *
 * ## Reported, never gated
 *
 * CI prints this and does not fail on it. Gating it would create pressure to
 * make it fall by RENAMING, which is the one way of moving it that means
 * nothing — the whole value of the indicator is that it moves only when the
 * trees actually converge.
 *
 * ```sh
 * deno task collisions          # count and names
 * deno task collisions --quiet  # just the count
 * ```
 */

import { walk } from '@std/fs/walk';
import { relative, SEPARATOR } from '@std/path';

/** The two namespaced trees. A third tree would be added here, not inferred. */
const TREES = ['src/binaryen-ts', 'src/wabt-ts'] as const;

/**
 * Exported `type` / `interface` / `enum` declarations.
 *
 * `const enum` and `declare` are matched too; `export type { X }` re-export
 * lists are NOT, because a re-export is the same declaration seen twice and
 * counting it would inflate a tree's own name set.
 */
const DECL =
  /^\s*export\s+(?:declare\s+)?(?:const\s+)?(type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;

async function exportedTypeNames(root: string): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for await (const entry of walk(root, { exts: ['.ts'], includeDirs: false })) {
    if (entry.path.endsWith('.d.ts')) continue;
    const text = await Deno.readTextFile(entry.path);
    for (const m of text.matchAll(DECL)) {
      const name = m[2]!;
      const where = relative('.', entry.path).split(SEPARATOR).join('/');
      const seen = found.get(name);
      if (seen) {
        if (!seen.includes(where)) seen.push(where);
      } else {
        found.set(name, [where]);
      }
    }
  }
  return found;
}

const quiet = Deno.args.includes('--quiet');
const unknown = Deno.args.filter((a) => a !== '--quiet');
if (unknown.length > 0) {
  console.error(`collisions: unrecognised argument(s): ${unknown.join(' ')}`);
  console.error('Usage: deno task collisions [--quiet]');
  Deno.exit(2);
}

const [a, b] = await Promise.all(TREES.map(exportedTypeNames));
const collisions = [...a!.keys()].filter((n) => b!.has(n)).sort();

if (!quiet) {
  console.log(`Exported type names, rule = type|interface|enum, exported, per tree:\n`);
  for (const [i, t] of TREES.entries()) {
    console.log(`  ${t.padEnd(18)} ${(i === 0 ? a! : b!).size}`);
  }
  console.log(`\n${collisions.length} name(s) declared in BOTH trees:\n`);
  const w = Math.max(...collisions.map((n) => n.length));
  for (const n of collisions) {
    console.log(`  ${n.padEnd(w)}  ${a!.get(n)!.join(' ')}  |  ${b!.get(n)!.join(' ')}`);
  }
  console.log('');
  console.log('Reported, not gated. This falls only when the two IRs converge; gating it');
  console.log('would reward renaming, which moves the number without converging anything.');
}
console.log(`collisions=${collisions.length}`);
