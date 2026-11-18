// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The CLI looks its command up by the user's first argument. 🔧 It used a plain object, so
// `constructor` / `toString` / `__proto__` found an Object.prototype member: `constructor x y`
// exited 0 and printed nothing, others threw a bare TypeError (security review round 4, A2).

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { spawnSync } from 'node:child_process';

describe('a command named after an Object.prototype key', () => {
  for (const command of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    it(`"${command}" is an unknown command, exit 1`, () => {
      const r = spawnSync('bun', ['main.ts', command, 'x', 'y'], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      assertEquals(r.status, 1, r.stderr);
      assert(r.stderr.includes(`Unknown command: ${command}`), r.stderr);
    });
  }
});
