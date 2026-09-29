// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The runtime-portability rule (BINDING; README "Runtime support",
 * cmem/project.md). Two checks over the tracked shipped source; both must find
 * nothing.
 *
 *   library layer (the exported surface) : web standards only; no Deno.*, no node:*
 *   CLI layer                            : node:* builtins fine; Deno.* never
 *
 * `node:` builtins are portable across Deno, Node and Bun but NOT to the
 * browser, which is why they are confined to the CLI layer (`/tools/`, `/cli/`).
 * `Deno.*` is never permitted in shipped source: it works on one of the four
 * supported targets. (`interop/` was the other `node:`-permitted layer until
 * 1.7.0, when the bridge to upstream binaryen left `src/` for the comparison
 * suite. Its exemption went with it: left in, it would let a new `interop/`
 * directory under `src/` import `node:` unseen.)
 *
 * ⚠️ The `Deno.*` check skips JSDoc lines (a line whose first non-blank is
 * `*`): doc comments legitimately show consumers writing
 * `import { writeFile } from "node:fs/promises"` or `Deno.readFile`, and a
 * check that cries wolf gets disabled. The `node:` check needs no such skip —
 * it matches only a line that STARTS with `import` / `const` / `let`.
 *
 * Prints every hit, grouped by check, and exits 1 if there is one.
 *
 * ```sh
 * deno run --allow-run --allow-read scripts/check-portability.ts
 * ```
 */

const DENO_GLOBAL = /\bDeno\.[a-zA-Z]/;
const JSDOC_LINE = /^\s*\*/;
const NODE_IMPORT = /^\s*(import|const|let)\b.*['"]node:/;
const CLI_LAYER = /\/(tools|cli)\//;

/** `file:line:text` for every line of `text` that `hit` accepts. */
export function scan(file: string, text: string, hit: (line: string) => boolean): string[] {
  const hits: string[] = [];
  text.split('\n').forEach((line, i) => {
    const l = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (hit(l)) hits.push(`${file}:${i + 1}:${l}`);
  });
  return hits;
}

export const isDenoGlobal = (line: string): boolean =>
  DENO_GLOBAL.test(line) && !JSDOC_LINE.test(line);
export const isNodeImport = (line: string): boolean => NODE_IMPORT.test(line);

/** Shipped source as the rule reads it: every tracked `.ts` under `src/`, plus `main.ts`. */
async function shippedSource(): Promise<string[]> {
  const out = await new Deno.Command('git', {
    args: ['ls-files', '-z', '--', 'src/*.ts', 'main.ts'],
    stderr: 'inherit',
  }).output();
  if (!out.success) throw new Error(`git ls-files exited ${out.code}`);
  return new TextDecoder().decode(out.stdout).split('\0').filter((p) => p !== '');
}

if (import.meta.main) {
  const denoHits: string[] = [];
  const nodeHits: string[] = [];
  for (const file of await shippedSource()) {
    const text = await Deno.readTextFile(file);
    denoHits.push(...scan(file, text, isDenoGlobal));
    if (file.startsWith('src/') && !CLI_LAYER.test(file)) {
      nodeHits.push(...scan(file, text, isNodeImport));
    }
  }
  if (denoHits.length > 0) console.log(['Deno globals in shipped source:', ...denoHits].join('\n'));
  if (nodeHits.length > 0) {
    console.log(['node: imports outside the CLI layer:', ...nodeHits].join('\n'));
  }
  Deno.exit(denoHits.length + nodeHits.length === 0 ? 0 : 1);
}
