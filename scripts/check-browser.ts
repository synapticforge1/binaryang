// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Every export loads in a BROWSER (open-work 28 part 2, 2026-10-12). For each export in
 * `jsr.json`, bundle it for the browser target and fail when:
 *
 * - the bundle does not build, or
 * - it still IMPORTS a `node:` builtin at the top level (`from "node:…"` or `require("node:…")`).
 *
 * A deferred `import("node:…")` inside a function is allowed: a browser evaluates it only if that
 * function runs, and the CLI paths that do this are never called in a page.
 *
 * 🔧 Why this exists: `check-portability.ts` checks DIRECT `node:` imports outside the CLI
 * layer, not what a module REACHES. A library module importing a tool, which imported
 * `node:process` at the top for its `main()`, passed it, and 15 of 22 exports, `./wat2wasm` among
 * them, could not be loaded in a browser while the README claimed "modern browsers". This check
 * follows every import, because a bundler does.
 *
 * 🔧 **Blind spot, closed 2026-10-12:** bundled the default way, Bun's browser target replaces
 * `node:fs` / `node:fs/promises` with an empty stub (exit 0, no warning, no `node:` left in the
 * output), so a used, top-level `import { readFileSync } from 'node:fs'` in a library file PASSED
 * this check while it would throw in a browser. Shown with that mutant in `src/core/leb128.ts`.
 * The earlier proof had used `node:process`, whose stub has no default export, so that build
 * failed loudly. The bundle now marks `node:*` external, and the same mutant fails it.
 * `check-portability.ts` (source level) caught the mutant all along.
 *
 * Bundling is not running: a headless-browser job (open-work 28 part 3) is the stronger check.
 * This one is cheap and catches the regression that already happened once.
 *
 * ```sh
 * bun run browser
 * ```
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** A top-level import of a `node:` builtin in bundled output. `import("node:…")` is not one. */
export const STATIC_NODE = /(?:\bfrom\s*|\brequire\(\s*)["']node:[\w/]+["']/g;

/** `file: problem` for one bundle's text, or nothing when it is browser-clean. */
export function staticNodeImports(js: string): string[] {
  return [...new Set(js.match(STATIC_NODE) ?? [])];
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const cfg = JSON.parse(readFileSync(join(root, 'jsr.json'), 'utf8')) as {
    exports: Record<string, string>;
  };
  const out = mkdtempSync(join(tmpdir(), 'binaryang-browser-'));
  const problems: string[] = [];
  try {
    for (const [sub, file] of Object.entries(cfg.exports)) {
      const target = join(out, `${sub === '.' ? 'root' : sub.slice(2).replace(/\//g, '_')}.js`);
      const r = spawnSync(
        'bun',
        // `--external node:*` KEEPS every node: import in the output, where STATIC_NODE can see it.
        // Without it Bun's browser target silently STUBS some builtins: `node:fs` and
        // `node:fs/promises` become `(() => ({}))` (every function undefined), exit 0, no warning,
        // and the import disappears from the bundle (measured, Bun 1.4.3, 2026-10-12). `node:path`
        // is polyfilled outright. A deferred `import("node:…")` stays visible too, and stays allowed.
        [
          'build',
          join(root, file),
          '--target=browser',
          '--format=esm',
          '--external',
          'node:*',
          `--outfile=${target}`,
        ],
        { encoding: 'utf8' },
      );
      if (r.status !== 0) {
        const why = `${r.stderr}${r.stdout}`.split('\n').find((l) => /error/i.test(l)) ?? '';
        problems.push(`${sub}: does not bundle for the browser: ${why.trim()}`);
        continue;
      }
      const found = staticNodeImports(readFileSync(target, 'utf8'));
      if (found.length > 0) problems.push(`${sub}: imports ${found.join(', ')} at the top level`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  const total = Object.keys(cfg.exports).length;
  if (problems.length > 0) {
    console.log(['Exports that do not load in a browser:', ...problems].join('\n'));
    console.log(`${problems.length} of ${total} exports fail`);
    process.exit(1);
  }
  console.log(`all ${total} exports bundle for the browser with no top-level node: import`);
}
