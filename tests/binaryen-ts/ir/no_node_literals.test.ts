// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Every expression node outside `ir/expressions.ts` is built by its FACTORY
// (open-work 7, closed 2026-10-06). A literal `{ kind: ExpressionKind.X, type: … }`
// computes its own `type`, and that is where one goes wrong unseen: the `br_if`
// literal of the 26 this began with was mistyped. The factories hold the rule
// once — `makeBreak`'s unreachable-condition case, `makeReturn`'s `unreachable`.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';

const SRC = new URL('../../../src/', import.meta.url);

function* tsFiles(dir: URL): Generator<URL> {
  for (const e of Deno.readDirSync(dir)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
    if (e.isDirectory) yield* tsFiles(u);
    else if (e.name.endsWith('.ts')) yield u;
  }
}

describe('no expression node is built as a literal outside its factories', () => {
  it('src/ has none', () => {
    const found: string[] = [];
    for (const f of tsFiles(SRC)) {
      if (f.pathname.endsWith('/ir/expressions.ts')) continue;
      const lines = Deno.readTextFileSync(f).split('\n');
      lines.forEach((l, i) => {
        if (/kind: ExpressionKind\.\w+,/.test(l)) {
          found.push(`${f.pathname.split('/src/')[1]}:${i + 1}: ${l.trim()}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});
