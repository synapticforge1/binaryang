/**
 * @module binaryen-ts/tests/version_sync
 *
 * `main.ts`'s `VERSION` literal must equal `jsr.json`'s `version`, and
 * `jsr.json` must be the ONLY manifest that names the package.
 *
 * This exists because the two drifted silently: `binaryen-ts --version` printed
 * `1.3.4` through the whole of 1.4.x and into 1.5.0, while the comment above the
 * constant said to keep it in sync with `deno.json` by hand. That is what a
 * by-hand invariant looks like some releases later, and nothing failed — the CLI
 * simply lied about which version it was, to anyone who asked.
 *
 * The literal cannot be replaced by a read of the manifest: `main.ts` is the CLI
 * entry for Node and Bun as well as Deno, and a runtime read needs the manifest
 * present and adjacent in the published package. Cross-runtime support is a
 * published capability, so the constant stays.
 *
 * So the drift is closed from two sides instead. `deno task bump` rewrites both
 * files, and this test fails if they ever disagree — including if someone sets a
 * minor version by hand, which is exactly how 1.5.0 was released.
 *
 * The manifest moved from `deno.json` to `jsr.json` on 2026-10-12 (the Bun
 * migration, cmem/bun-migration.md). A `name` or `version` left in `deno.json`
 * is not harmless: with a `deno.json` present Deno publishes from IT and ignores
 * `jsr.json`, so a second copy is a second source of truth that wins.
 *
 * @license MIT
 */

import { assertEquals } from '@std/assert';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);

test('version: main.ts VERSION matches jsr.json', async () => {
  const manifest = JSON.parse(await Deno.readTextFile(new URL('jsr.json', root))) as {
    version?: string;
  };
  const declared = manifest.version;
  assertEquals(
    typeof declared,
    'string',
    'jsr.json has no `version` field — the manifest is malformed',
  );

  const mainSource = await Deno.readTextFile(new URL('main.ts', root));
  const match = mainSource.match(/const VERSION = '([^']*)'/);
  assertEquals(
    match !== null,
    true,
    "main.ts has no `const VERSION = '...'` literal — if it was renamed or moved, " +
      'update `scripts/release/bump_version.ts` to match, or the bump silently stops syncing it',
  );

  assertEquals(
    match?.[1],
    declared,
    `main.ts reports ${match?.[1]} but jsr.json says ${declared}. ` +
      'Run `deno task bump`, which rewrites both, or set both by hand for a minor.',
  );
});

test('version: deno.json does not name the package (jsr.json is the one manifest)', async () => {
  const deno = JSON.parse(await Deno.readTextFile(new URL('deno.json', root))) as Record<
    string,
    unknown
  >;
  const stray = ['name', 'version', 'exports', 'publish'].filter((k) => k in deno);
  assertEquals(
    stray,
    [],
    `deno.json carries ${stray.join(', ')}. The package lives in jsr.json only: with these in ` +
      'deno.json, `deno publish` would take the package from deno.json instead.',
  );
});

// package.json exists for Bun and Node (dev dependencies and scripts, B2). It is never published,
// so a `version` there is a second copy that drifts. A `name` invites `npx jsr publish`, which
// skips the type check when a package.json is present (cmem/bun-migration.md, finding 2).
test('version: package.json does not name the package either', async () => {
  const pkg = JSON.parse(await Deno.readTextFile(new URL('package.json', root))) as Record<
    string,
    unknown
  >;
  const stray = ['name', 'version', 'exports', 'bin'].filter((k) => k in pkg);
  assertEquals(
    stray,
    [],
    `package.json carries ${stray.join(', ')}. The package lives in jsr.json only.`,
  );
});
