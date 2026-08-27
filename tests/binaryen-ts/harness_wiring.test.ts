// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The `test` task must name every tree under `tests/` EXPLICITLY.
//
// `deno test tests/` collects only 513 of 907 tests here and exits 0. The cause
// is the workspace member at `tests/binaryen-ts/`: a directory containing a
// member shadows its sibling directories during discovery, so `tests/wabt-ts/`
// is never walked. Measured, and re-measured after the `_test.ts` -> `.test.ts`
// rename to rule the naming convention out -- the count did not move, so the
// member is the mechanism and the naming split was not.
//
// The failure mode is the dangerous kind: a green run that covered half the
// suite. Nothing reports it, because 513 passing tests look exactly like 513
// passing tests. This test is the thing that reports it.
//
// It deliberately derives the expected trees from the FILESYSTEM rather than
// hard-coding them, so adding `tests/<new-tree>/` fails here until the task is
// updated -- rather than silently going uncollected.
//
// This file lives in `tests/binaryen-ts/` on purpose: that is the tree that IS
// always collected, so the guard itself cannot be skipped by the bug it guards.

import { assert } from '@std/assert';

Deno.test('the test task names every tree under tests/', async () => {
  const root = new URL('../../', import.meta.url);
  const cfg = JSON.parse(await Deno.readTextFile(new URL('deno.json', root))) as {
    tasks: Record<string, string>;
  };
  const task = cfg.tasks.test;
  assert(task, 'no `test` task in deno.json');

  const trees: string[] = [];
  for await (const e of Deno.readDir(new URL('tests/', root))) {
    if (e.isDirectory) trees.push(e.name);
  }
  assert(trees.length > 0, 'no test trees found');

  const missing = trees.filter((t) => !task.includes(`tests/${t}/`));
  assert(
    missing.length === 0,
    `the \`test\` task does not name: ${missing.join(', ')}.\n` +
      `A bare \`deno test tests/\` silently collects only the workspace member ` +
      `and exits 0 — half the suite, reported green.\nTask is: ${task}`,
  );
});
