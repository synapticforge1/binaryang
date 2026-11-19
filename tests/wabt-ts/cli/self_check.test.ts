// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// `binaryang --self-check` (workspace letter H39 (3)): tries every `host` operation on the machine
// it runs on, reports each, exits 1 if one failed, and cleans up after itself. Run here on the
// test runner's runtime; a new OS is checked by running the command there.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { selfCheck } from '../../../src/host.ts';

const MAIN = resolve('main.ts');
const leftovers = () => readdirSync(tmpdir()).filter((n) => n.startsWith('binaryang-self-check-'));

describe('H39: --self-check', () => {
  it('every operation is tried, none fails, and the temp folder is gone', async () => {
    const before = leftovers();
    const results = await selfCheck();
    assertEquals(results.length, 10, results.map((r) => r.operation).join(', '));
    const failed = results.filter((r) => r.status === 'FAIL');
    assertEquals(failed, []);
    assertEquals(results.at(-1)?.operation, 'remove the temp folder');
    assertEquals(leftovers(), before);
  });

  it('the command prints one line per operation and exits 0', () => {
    const r = spawnSync('bun', [MAIN, '--self-check'], { encoding: 'utf8', timeout: 60_000 });
    assertEquals(r.status, 0, r.stdout + r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert(/^binaryang \d+\.\d+\.\d+ self-check: \w+-\w+, Bun /.test(lines[0]!), lines[0]);
    assertEquals(lines.filter((l) => /^ {2}(ok {2}|FAIL) \S/.test(l)).length, 10);
    assertEquals(lines.at(-1), 'every host operation works here');
  });

  // Owner, 2026-11-19: "no skips to track". A link the machine refuses was `skipped`, and the
  // run exited 0 without having tried it.
  it('a symbolic link the machine refuses is a FAIL, with the reason', async () => {
    const refuse = () =>
      Promise.reject(Object.assign(new Error('operation not permitted'), {
        code: 'EPERM',
      }));
    const results = await selfCheck({ symlink: refuse });
    const link = results.find((r) => r.operation === 'write through a symbolic link');
    assertEquals(link?.status, 'FAIL');
    assert(link?.detail?.includes('Developer Mode'), link?.detail);
    assertEquals(results.filter((r) => r.status !== 'ok').length, 1);
  });
});
