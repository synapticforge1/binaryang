// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The README's privacy statement (the review of 2026-11-18, privacy class: "a stated policy")
// holds only while the shipped code makes no request and reads no environment. This pins both.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []
  );

describe('the README says binaryang collects nothing, and the code agrees', () => {
  it('the README states it', () => {
    const readme = readFileSync('README.md', 'utf8');
    assert(readme.includes('## Privacy'));
    assert(readme.includes('binaryang collects nothing'));
  });
  it('the shipped code makes no network request and reads no environment', () => {
    const shipped = [...files('src'), 'main.ts'];
    const banned =
      /\bfetch\(|XMLHttpRequest|WebSocket|process\.env\b|Deno\.env\b|Bun\.env\b|\bhomedir\(|\buserInfo\(/;
    const hits = shipped.filter((f) => banned.test(readFileSync(f, 'utf8')));
    assertEquals(hits, []);
  });
});
