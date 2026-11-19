// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The runtime-portability rule (BINDING; README "Runtime support",
 * cmem/project.md). Three checks over the tracked shipped source; all must find
 * nothing.
 *
 *   all shipped source : no Deno.*, and no TOP-LEVEL runtime import of a node: builtin
 *   all but src/host.ts : no file, path, OS or process API at all (letter H39)
 *
 * The third is the `host` boundary (workspace letter H39, owner, 2026-11-19: "all of the
 * OS/platform specifics lives in one place"): outside `src/host.ts`, no import of `node:fs`,
 * `node:fs/promises`, `node:path`, `node:os`, `node:process` or `node:child_process` — static,
 * deferred or `import type` — and no `Bun.` / `globalThis.process` reach for the runtime. A tool
 * that needs the system calls `host`. Comment lines are skipped, as for `Deno.*`.
 *
 * `node:` builtins are portable across Deno, Node and Bun but NOT to the
 * browser. 🔧 Until 2026-10-12 they were allowed in the CLI layer (`/tools/`,
 * `/cli/`), and that exemption is how 15 of 22 exports became unloadable in a
 * browser: every tool imported `node:process` at the top for its `main()`, and
 * library modules reached the tools (open-work 28). The CLI layer now reaches
 * `process` through `globalThis` when a CLI function runs, and loads
 * `node:fs/promises` with a deferred `import()` (`src/host.ts`). So the rule
 * is tree-wide: `import type … from 'node:…'` (erased at compile time) and a
 * deferred `await import('node:…')` are fine; a static import is not, even an
 * unused one. A bundler drops an unused import, but JSR's compiled JavaScript
 * keeps it, and a page loading the package without a bundler would fail on it.
 * `scripts/check-browser.ts` is the other half: it bundles every export for
 * the browser.
 *
 * `Deno.*` is never permitted in shipped source: it works on one of the four
 * supported targets.
 *
 * ⚠️ The `Deno.*` check skips JSDoc lines (a line whose first non-blank is
 * `*`): doc comments legitimately show consumers writing
 * `import { writeFile } from "node:fs/promises"` or `Deno.readFile`, and a
 * check that cries wolf gets disabled. The `node:` check needs no such skip:
 * it matches only a line that STARTS with a static `import` (not `import type`)
 * or a `require(`.
 *
 * Prints every hit, grouped by check, and exits 1 if there is one.
 *
 * ```sh
 * bun scripts/check-portability.ts
 * ```
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { spawnSync } from 'node:child_process';

const DENO_GLOBAL = /\bDeno\.[a-zA-Z]/;
const JSDOC_LINE = /^\s*\*/;
/**
 * A static runtime import of a `node:` builtin: `import … from 'node:x'`, `import 'node:x'`, or
 * `… require('node:x')`. NOT `import type …` (erased) and NOT a deferred `import('node:x')`.
 */
const NODE_IMPORT =
  /^\s*import\s+(?!type\b)(?:[^'"(]*\bfrom\s*)?['"]node:|^\s*(?:const|let|var)\b.*\brequire\(\s*['"]node:/;

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

/** The one shipped file allowed to reach the system (letter H39). */
export const HOST = 'src/host.ts';
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
/** A `node:` file / path / OS / process module named in quotes: any import form, or `require`. */
const SYSTEM_MODULE =
  /['"]node:(fs|fs\/promises|path|path\/posix|path\/win32|os|process|child_process)['"]/;
/** A runtime's own global reaching for the system: `Bun.file`, `globalThis.process`, … */
const RUNTIME_GLOBAL = /(?<![\w.$])Bun\.[a-zA-Z]|\bglobalThis\s*\.\s*(process|Bun)\b/;
export const isSystemCall = (line: string): boolean =>
  !COMMENT_LINE.test(line) && (SYSTEM_MODULE.test(line) || RUNTIME_GLOBAL.test(line));

/** Shipped source as the rule reads it: every tracked `.ts` under `src/`, plus `main.ts`. */
function shippedSource(): string[] {
  const out = spawnSync('git', ['ls-files', '-z', '--', 'src/*.ts', 'main.ts'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 1 << 28,
  });
  if (out.status !== 0) throw new Error(`git ls-files exited ${out.status}`);
  return out.stdout.toString('utf8').split('\0').filter((p) => p !== '');
}

if (import.meta.main) {
  const denoHits: string[] = [];
  const nodeHits: string[] = [];
  const hostHits: string[] = [];
  const files = await shippedSource();
  // A gate that cannot fail is decoration: the host file must exist and must itself be hit.
  if (!files.includes(HOST)) {
    console.log(`${HOST} is not tracked: the host boundary has nothing to hold`);
    process.exit(1);
  }
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    denoHits.push(...scan(file, text, isDenoGlobal));
    nodeHits.push(...scan(file, text, isNodeImport));
    const system = scan(file, text, isSystemCall);
    if (file !== HOST) hostHits.push(...system);
    else if (system.length === 0) {
      console.log(`${HOST} reaches no system API: the host check matches nothing (regex broken?)`);
      process.exit(1);
    }
  }
  if (denoHits.length > 0) console.log(['Deno globals in shipped source:', ...denoHits].join('\n'));
  if (nodeHits.length > 0) {
    console.log(['Top-level node: imports in shipped source:', ...nodeHits].join('\n'));
  }
  if (hostHits.length > 0) {
    console.log([`System APIs outside ${HOST} (letter H39):`, ...hostHits].join('\n'));
  }
  const hits = denoHits.length + nodeHits.length + hostHits.length;
  if (hits === 0) console.log(`portability: ${files.length} files; system calls only in ${HOST}`);
  process.exit(hits === 0 ? 0 : 1);
}
