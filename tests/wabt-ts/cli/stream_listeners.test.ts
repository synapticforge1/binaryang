// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// 4.1.x round 2 review, hardening note: every write to stdout held its own 'error' listener until
// it finished, so 50 concurrent writes made Node 24 print a MaxListenersExceededWarning. One
// listener per stream now, shared by the writes pending, removed when the last one is done.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { denoCommand } from '../../../scripts/deno.ts';
import { nodeCommand, REFEREE } from '../../../scripts/v8.ts';

const PROBE = resolve('tests/wabt-ts/cli/stream_probe.ts');
const runtimes: [string, (mode: string) => [string, string[]]][] = [
  ['bun', (mode) => ['bun', [PROBE, mode]]],
  ['node', (mode) => nodeCommand(REFEREE, [], PROBE, [mode])],
  ['deno', (mode) => denoCommand(['run', '-A', PROBE, mode])],
];

interface Report {
  before: number;
  peak: number;
  after: number;
  warnings: string[];
  ok: number;
  rejected: number;
}
const report = (stderr: string): Report => {
  const line = stderr.trimEnd().split('\n').filter((l) => l.startsWith('{')).at(-1);
  assert(line !== undefined, stderr);
  return JSON.parse(line);
};

describe('writeStdout: one error listener per stream, however many writes are pending', () => {
  for (const [rt, command] of runtimes) {
    it(`${rt}: 50 concurrent writes raise no warning and leave no listener behind`, () => {
      const [cmd, args] = command('ok');
      const r = spawnSync(cmd, args, {
        cwd: resolve('.'),
        encoding: 'utf8',
        timeout: 120_000,
      });
      assertEquals(r.status, 0, r.stderr);
      const rep = report(r.stderr);
      assertEquals(rep.warnings, [], r.stderr);
      assert(!r.stderr.includes('MaxListenersExceededWarning'), r.stderr);
      assert(rep.peak <= rep.before + 1, `${rep.peak} listeners while 50 writes pending`);
      assertEquals(rep.after, rep.before, 'the listener is removed once the writes are done');
      assertEquals(rep.ok, 50);
      assertEquals(r.stdout.split('\n').filter((l) => l.startsWith('line ')).length, 50);
    });

    it(`${rt}: the reader gone, all 50 writes reject once and nothing is unhandled`, async () => {
      const [cmd, args] = command('fail');
      const c = spawn(cmd, args, { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
      c.stdout.destroy();
      let err = '';
      c.stderr.on('data', (d) => (err += d));
      const status = await new Promise<number | null>((done) => c.on('close', done));
      assertEquals(status, 0, err);
      const rep = report(err);
      assertEquals(rep.rejected, 50, err);
      assertEquals(rep.warnings, [], err);
      assert(!/Unhandled 'error'|^\s+at /m.test(err), err);
    });
  }
});
