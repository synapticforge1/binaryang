/**
 * @module binaryen-ts/tests/version_sync
 *
 * `main.ts`'s `VERSION` literal must equal `deno.json`'s `version`.
 *
 * This exists because the two drifted silently: `binaryen-ts --version` printed
 * `1.3.4` through the whole of 1.4.x and into 1.5.0, while the comment above the
 * constant said to keep it in sync with `deno.json` by hand. That is what a
 * by-hand invariant looks like some releases later, and nothing failed — the CLI
 * simply lied about which version it was, to anyone who asked.
 *
 * The literal cannot be replaced by a read of `deno.json`: `main.ts` is the CLI
 * entry for Node 18 as well as Deno, and importing JSON requires
 * `with { type: 'json' }`, which Node 18 does not support. Cross-runtime support
 * is a published capability, so the constant stays.
 *
 * So the drift is closed from two sides instead. `deno task bump` rewrites both
 * files, and this test fails if they ever disagree — including if someone sets a
 * minor version by hand, which is exactly how 1.5.0 was released.
 *
 * @license MIT
 */

import { assertEquals } from '@std/assert';

Deno.test('version: main.ts VERSION matches deno.json', async () => {
  const denoJsonUrl = new URL('../deno.json', import.meta.url);
  const mainTsUrl = new URL('../main.ts', import.meta.url);

  const manifest = JSON.parse(await Deno.readTextFile(denoJsonUrl)) as { version?: string };
  const declared = manifest.version;
  assertEquals(
    typeof declared,
    'string',
    'deno.json has no `version` field — the manifest is malformed',
  );

  const mainSource = await Deno.readTextFile(mainTsUrl);
  const match = mainSource.match(/const VERSION = '([^']*)'/);
  assertEquals(
    match !== null,
    true,
    "main.ts has no `const VERSION = '...'` literal — if it was renamed or moved, " +
      'update `scripts/bump_version.ts` to match, or the bump silently stops syncing it',
  );

  assertEquals(
    match?.[1],
    declared,
    `main.ts reports ${match?.[1]} but deno.json says ${declared}. ` +
      'Run `deno task bump`, which rewrites both, or set both by hand for a minor.',
  );
});
