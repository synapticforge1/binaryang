// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The test runner must name every tree under `tests/` EXPLICITLY.
//
// History: `deno test tests/` collected only 513 of 907 tests and exited 0. The
// workspace member at `tests/binaryen-ts/` shadowed its sibling directories
// during discovery, so `tests/wabt-ts/` was never walked: a green run that
// covered half the suite, which nothing reports, because 513 passing tests look
// exactly like 513 passing tests. So the `deno test` task named each tree, and
// this test held it to that.
//
// The suite left Deno (Bun migration B5, 2026-10-13) and deno.json with its
// members went (B7): the trees are `TEST_DIRS` in scripts/test.ts, which
// `bun run test` (Node, the referee) and `bun run test:bun` both take them from.
// The rule is the same: a tree left out would go quietly unrun on both.
//
// It deliberately derives the expected trees from the FILESYSTEM rather than
// hard-coding them, so adding `tests/<new-tree>/` fails here until the runner
// names it -- rather than silently going uncollected.

import { assert } from '@std/assert';
import { test } from 'node:test';
import * as fsx from '../test_fs.ts';
import { TEST_DIRS } from '../../scripts/test.ts';

test('scripts/test.ts names every tree under tests/', async () => {
  const trees: string[] = [];
  for await (const e of fsx.readDir(new URL('../../tests/', import.meta.url))) {
    if (e.isDirectory) trees.push(e.name);
  }
  assert(trees.length > 0, 'no test trees found');
  const missing = trees.filter((t) => !TEST_DIRS.includes(`tests/${t}`));
  assert(missing.length === 0, `TEST_DIRS in scripts/test.ts does not name: ${missing.join(', ')}`);
});
