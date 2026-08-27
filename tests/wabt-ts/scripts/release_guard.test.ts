// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { releaseBlockers, statusPath } from '../../scripts/release-guard.ts';

// T13.43. `scripts/publish.ts` stages `deno.json` and NOTHING else, then tags
// and pushes -- and the tag is exactly what JSR publishes. So on a dirty tree
// it released a bare version bump containing none of the work, and a JSR
// version is immutable.
//
// Two documents claimed the script "refuses if the working tree is dirty". It
// had no such check. It was never tested either, because `publish.ts` stages,
// tags and pushes at import time, so nothing could import it to find out --
// which is why the guard lives in its own module now.

describe('T13.43 — release preflight', () => {
  // The over-correction guard, and the most important test here: a release
  // that SHOULD go ahead must not be blocked. A guard that always refuses
  // fails safe exactly once, then gets deleted by whoever needs to ship.
  it('does not block a clean tree', () => {
    expect(releaseBlockers('')).toEqual([]);
    expect(releaseBlockers('\n')).toEqual([]);
    expect(releaseBlockers('\n\n')).toEqual([]);
  });

  it('does not block the normal bump path (deno.json only)', () => {
    expect(releaseBlockers(' M deno.json')).toEqual([]);
    expect(releaseBlockers('M  deno.json\n')).toEqual([]);
  });

  const BLOCKING: [name: string, porcelain: string][] = [
    ['a modified source file', ' M src/writer/binary-writer.ts'],
    ['a staged source file', 'M  src/core/leb128.ts'],
    ['an untracked file', '?? tests/parser/new_thing.test.ts'],
    ['a deleted file', ' D src/gone.ts'],
    ['deno.json AND something else', ' M deno.json\n M src/core/leb128.ts'],
  ];
  for (const [name, porcelain] of BLOCKING) {
    it(`blocks on ${name}`, () => {
      const b = releaseBlockers(porcelain);
      expect(b.length).toBeGreaterThan(0);
      // deno.json is never itself a blocker, even when listed alongside one.
      expect(b.some((l) => statusPath(l) === 'deno.json')).toBe(false);
    });
  }

  // An untracked NEW source file is the nastiest case: it is absent from the
  // tag, so the release is missing it, while every local check passes because
  // the file is on disk.
  it('treats an untracked source file as a blocker', () => {
    expect(releaseBlockers('?? src/tools/wasm2ts-impl.ts')).toHaveLength(1);
  });

  it('reads the NEW path of a rename', () => {
    expect(statusPath('R  old/path.ts -> new/path.ts')).toEqual('new/path.ts');
    expect(statusPath(' M src/core/leb128.ts')).toEqual('src/core/leb128.ts');
  });

  // Precision: the exclusion is an exact path match, not a substring. A file
  // merely NAMED like deno.json must still block.
  it('is not fooled by a path containing "deno.json"', () => {
    expect(releaseBlockers(' M deno.json.bak')).toHaveLength(1);
    expect(releaseBlockers(' M scripts/deno.json')).toHaveLength(1);
    expect(releaseBlockers('?? deno.jsonc')).toHaveLength(1);
  });

  it('survives trailing whitespace and CRLF', () => {
    expect(releaseBlockers(' M deno.json\r\n')).toEqual([]);
    expect(releaseBlockers(' M src/a.ts\r\n M src/b.ts\r\n')).toHaveLength(2);
  });

  it('reports every blocker, not just the first', () => {
    const many = Array.from({ length: 30 }, (_, i) => ` M src/f${i}.ts`).join('\n');
    expect(releaseBlockers(many)).toHaveLength(30);
  });
});
