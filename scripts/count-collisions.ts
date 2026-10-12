// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Counts the exported type names declared in more than one file of `src/`.
 *
 * This is binaryang's measure of convergence. It counted the names the two
 * `src/` trees both declared until open-work 21 merged the trees into one; one
 * tree needs one name each, so the number falls as the names converge.
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
 * bun run collisions          # count and names
 * bun run collisions --quiet  # just the count
 * ```
 */

import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

/** The one source tree (open-work 21 merged `src/binaryen-ts/` and `src/wabt-ts/` into it). */
const TREE = 'src';

/**
 * Exported `type` / `interface` / `enum` declarations.
 *
 * `const enum` and `declare` are matched too; `export type { X }` re-export
 * lists are NOT, because a re-export is the same declaration seen twice and
 * counting it would inflate a tree's own name set.
 */
const DECL =
  /^\s*export\s+(?:declare\s+)?(?:const\s+)?(type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;

/** Every file under `dir` ending in `ext`, depth-first in directory order, as `@std/fs/walk` visited them. */
function walkFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

async function exportedTypeNames(root: string): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const path of walkFiles(root, '.ts')) {
    if (path.endsWith('.d.ts')) continue;
    const text = await readFile(path, 'utf8');
    for (const m of text.matchAll(DECL)) {
      const name = m[2]!;
      const where = relative('.', path).split(sep).join('/');
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

const quiet = process.argv.slice(2).includes('--quiet');
const unknown = process.argv.slice(2).filter((a) => a !== '--quiet');
if (unknown.length > 0) {
  console.error(`collisions: unrecognised argument(s): ${unknown.join(' ')}`);
  console.error('Usage: bun run collisions [--quiet]');
  process.exit(2);
}

// Open-work item 21, phase 1 (2026-10-09): the two trees are ONE `src/` now, so the
// indicator counts what one tree must not have — an exported type name DECLARED IN
// MORE THAN ONE FILE. Before the move it counted names declared in both trees: 86.
// The one-tree rule gives 88 on the same code — the 86, plus two names wabt-ts had
// already declared twice INSIDE itself, which the per-tree rule could not see:
// `Features` (core/feature.ts, compat/wabt-compat.ts) and `LiteralType`
// (core/literal.ts, parser/token.ts). After open-work 21's phases 2–4: 2, the
// compat layer's `WasmModule` and `Features`; renamed `WabtWasmModule` /
// `WabtFeatures` the same day (owner), with the old names as deprecated
// re-exports. **0 since 2026-10-09: any duplicate is news.**
const names = await exportedTypeNames(TREE);
const collisions = [...names.entries()].filter(([, files]) => files.length > 1).map(([n]) => n)
  .sort();

if (!quiet) {
  console.log(`Exported type names, rule = type|interface|enum, exported, in ${TREE}/:\n`);
  console.log(`  ${names.size} distinct names`);
  console.log(`\n${collisions.length} name(s) declared in more than one file:\n`);
  const w = Math.max(0, ...collisions.map((n) => n.length));
  for (const n of collisions) console.log(`  ${n.padEnd(w)}  ${names.get(n)!.join('  |  ')}`);
  console.log('');
  console.log('Reported, not gated. This falls only when the names converge; gating it');
  console.log('would reward renaming, which moves the number without converging anything.');
}
console.log(`collisions=${collisions.length}`);
