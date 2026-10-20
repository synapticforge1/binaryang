// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The npm package, built into `dist/` (open-work 29; owner, 2026-10-20: publish to npm as
 * `@synapticforge1/binaryang`, JSR staying the source). Nothing here publishes.
 *
 * JSR compiles the TypeScript for its own npm clients; npmjs.org does not, and Node refuses to
 * strip types inside `node_modules`, so the package ships JavaScript and `.d.ts`:
 *
 * 1. `tsc -p tsconfig.npm.json`: `main.ts` and `src/` into `dist/`, `./x.ts` imports rewritten to
 *    `./x.js`.
 * 2. `dist/main.js` gets `#!/usr/bin/env node`: it is the package's `bin`, so `npx` runs the CLI.
 * 3. What JSR's `publish.include` also ships: the definitions JSON, README, the licence files.
 * 4. `dist/package.json`, GENERATED from `jsr.json` ({@link npmManifest}): the version has ONE
 *    source, and the repo's own `package.json` stays `private` (`version_sync.test.ts` refuses a
 *    name or version there).
 *
 * ```sh
 * bun run npm:build      # then: bun run npm:prove
 * ```
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * The package's name on npmjs.org (owner, 2026-10-20). An npm scope is the npm org's name, which is
 * `synapticforge1`: the GitHub org is `synapticforge`, and the two need not match (the manifest's
 * `repository` names GitHub). JSR's name is `@jrmarcum/binaryang`.
 */
export const NPM_NAME = '@synapticforge1/binaryang';

/** The Node floor: `import.meta.main`, which `main.ts` runs on, arrived in 22.18. */
export const NODE_FLOOR = '>=22.18';

/** What `jsr.json` holds that the npm manifest is generated from. */
export interface JsrManifest {
  version: string;
  exports: Record<string, string>;
}

/** `./src/tools/wasm-opt.ts` → `./src/tools/wasm-opt` (the emitted file, before `.js` / `.d.ts`). */
const stem = (file: string): string => file.replace(/\.ts$/, '');

/** The npm `package.json` for `dist/`, from `jsr.json`: the same version and the same exports. */
export function npmManifest(jsr: JsrManifest): Record<string, unknown> {
  const exports: Record<string, { types: string; default: string }> = {};
  for (const [sub, file] of Object.entries(jsr.exports)) {
    if (!file.endsWith('.ts')) throw new Error(`jsr.json export ${sub} is not a .ts file: ${file}`);
    exports[sub] = { types: `${stem(file)}.d.ts`, default: `${stem(file)}.js` };
  }
  const main = exports['.'];
  if (main === undefined) throw new Error('jsr.json has no "." export');
  return {
    name: NPM_NAME,
    version: jsr.version,
    description:
      'WebAssembly toolchain in TypeScript: Binaryen and WABT ported (wasm-opt, wat2wasm, ' +
      'wasm2wat, wasm-validate, wasm-interp, …), as a library and a CLI. Also on JSR as ' +
      '@jrmarcum/binaryang.',
    // npm takes an SPDX expression, which JSR cannot (cmem/licensing.md): the dual licence as it is.
    license: 'MIT OR Apache-2.0',
    type: 'module',
    exports,
    types: main.types,
    bin: { binaryang: main.default },
    engines: { node: NODE_FLOOR },
    repository: { type: 'git', url: 'git+https://github.com/synapticforge/binaryang.git' },
    homepage: 'https://github.com/synapticforge/binaryang#readme',
    bugs: { url: 'https://github.com/synapticforge/binaryang/issues' },
    keywords: ['webassembly', 'wasm', 'binaryen', 'wabt', 'wasm-opt', 'wat2wasm', 'wasm2wat'],
    sideEffects: false,
    publishConfig: { access: 'public', provenance: true },
  };
}

/** The files beside the code, as `jsr.json`'s `publish.include` ships them. */
const EXTRA = ['README.md', 'LICENSE', 'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE.md'];

/** Builds the package into `<root>/dist`; the manifest it wrote. Throws on a failed step. */
export function build(root: string): Record<string, unknown> {
  const dist = join(root, 'dist');
  rmSync(dist, { recursive: true, force: true });
  const tsc = spawnSync('bun', ['x', 'tsc', '-p', join(root, 'tsconfig.npm.json')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (tsc.status !== 0) throw new Error(`tsc -p tsconfig.npm.json exited ${tsc.status}`);

  const entry = join(dist, 'main.js');
  writeFileSync(entry, `#!/usr/bin/env node\n${readFileSync(entry, 'utf8')}`);

  const defs = join(root, 'src', 'definitions');
  mkdirSync(join(dist, 'src', 'definitions'), { recursive: true });
  for (const f of readdirSync(defs).filter((f) => f.endsWith('.json'))) {
    copyFileSync(join(defs, f), join(dist, 'src', 'definitions', f));
  }
  for (const f of EXTRA) copyFileSync(join(root, f), join(dist, f));

  const jsr = JSON.parse(readFileSync(join(root, 'jsr.json'), 'utf8')) as JsrManifest;
  const manifest = npmManifest(jsr);
  writeFileSync(join(dist, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  try {
    const m = build(root);
    console.log(`built ${m['name']}@${m['version']} into dist/`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
