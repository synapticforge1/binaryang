// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// A program, not a test: run by tests/wabt-ts/cli/stream_listeners.test.ts under Bun, Node and Deno.
// It makes 50 concurrent `writeStdout` calls and reports on stderr, as one JSON line, how many
// 'error' listeners the stream held before, at most while writing, and after, the warnings the process raised, and
// how the writes settled. `fail` waits for the reader to be gone first (its stdout pipe destroyed).

import { cliProcess, writeStdout } from '../../../src/host.ts';

const p = cliProcess();
const warnings: string[] = [];
p.on('warning', (w: Error) => warnings.push(w.name));
const before = p.stdout.listenerCount('error');
// The most listeners the stream held at any write (the writes begin a tick after the call).
let peak = before;
const realWrite = p.stdout.write.bind(p.stdout) as (...a: unknown[]) => boolean;
(p.stdout as { write: unknown }).write = (...a: unknown[]) => {
  peak = Math.max(peak, p.stdout.listenerCount('error'));
  return realWrite(...a);
};
if (p.argv[2] === 'fail') await new Promise((done) => setTimeout(done, 300));
const settled = Array.from(
  { length: 50 },
  (_, i) => writeStdout(`line ${i}\n`).then(() => 'ok', (e: Error) => `rejected: ${e.message}`),
);
const results = await Promise.all(settled);
// A warning is raised on a later tick: let it arrive.
await new Promise((done) => setTimeout(done, 100));
const after = p.stdout.listenerCount('error');
p.stderr.write(
  JSON.stringify({
    before,
    peak,
    after,
    warnings,
    ok: results.filter((r) => r === 'ok').length,
    rejected: results.filter((r) => r.startsWith('rejected')).length,
  }) + '\n',
);
p.exit(0);
