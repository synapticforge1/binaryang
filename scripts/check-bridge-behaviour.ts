// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * S6's BEHAVIOURAL gate: the bridge path and the wabt-ts path, run in lockstep.
 *
 * `deno task bridge` compiles both and runs neither, which is how the bridge
 * came to drop every element segment and every start function while that gate
 * read 421/421 — an empty table is perfectly valid. This one instantiates and
 * calls. What each module does, and why the comparison is sound, is in
 * `bridge-behaviour/differential.ts`.
 *
 * This file is only the driver, and the driver exists for one reason: some
 * corpus entry points (`_start`, `main`) do not terminate under stub imports,
 * and a synchronous wasm call cannot be bounded from its own thread. So the
 * differential runs in a worker, one module at a time, posting a result per
 * module; if a module goes quiet for longer than the budget the worker is
 * TERMINATED, that module is recorded as `timeout`, and a fresh worker picks up
 * the rest. The alternative — not calling entry points — silently cost 419 of
 * the corpus's exports, and a coverage hole that size makes "they agree" mean
 * much less than it looks like it means.
 *
 * **What it catches, measured 2026-09-15 by mutating the bridge:**
 * restoring the old element-segment drop takes it to **39 DIVERGE, exit 1** —
 * while `deno task bridge` reads a clean **421/421** on that same mutant. That
 * is the whole reason this file exists.
 *
 * ⚠️ **What it CANNOT see, measured the same way:** dropping the start function
 * again leaves it fully green, because not one of the 421 corpus modules has a
 * `(start …)` section. Only `tests/bridge/module_surface.test.ts` covers that.
 * A gate is evidence about what it reaches, and this one does not reach start
 * sections — nor the 441 exports that are memories, globals and tables rather
 * than functions, which it reports on every run.
 *
 * Usage: `deno task bridge-behaviour`
 */

import { CORPUS, type Row, type Status } from './bridge-behaviour/differential.ts';

/**
 * Per-module budget. Generous on purpose: the cost of being wrong here is a
 * module wrongly reported as hanging, which reads as a regression. The real
 * hangs do not terminate at all, so no finite budget separates them from a slow
 * module incorrectly — only from one slower than this.
 */
const BUDGET_MS = 20_000;

const WORKER = new URL('./bridge-behaviour/worker.ts', import.meta.url);

const files: string[] = [];
for await (const entry of Deno.readDir(CORPUS)) {
  if (entry.isFile && entry.name.endsWith('.wat')) files.push(entry.name);
}
files.sort((a, b) => a.localeCompare(b));

const rows: Row[] = [];

/**
 * Run `queue` in a worker until it finishes or one module goes quiet. Resolves
 * with what is LEFT to do: empty when the queue drained.
 */
function drain(queue: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER, { type: 'module' });
    let next = 0; // index in `queue` the worker is currently on
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (remaining: string[]) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(remaining);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // The module that never posted is the one that hung.
        const stuck = queue[next]!;
        rows.push({
          file: stuck,
          status: 'timeout',
          exports: 0,
          calls: 0,
          detail: `no result in ${BUDGET_MS / 1000}s — an export did not return`,
          notRun: {},
        });
        finish(queue.slice(next + 1));
      }, BUDGET_MS);
    };

    worker.onmessage = (ev: MessageEvent<{ row?: Row; done?: boolean }>) => {
      if (ev.data.done) return finish([]);
      rows.push(ev.data.row!);
      next++;
      arm();
    };
    worker.onerror = (ev) => {
      rows.push({
        file: queue[next] ?? '<unknown>',
        status: 'DIVERGE',
        exports: 0,
        calls: 0,
        detail: `worker error: ${ev.message}`,
        notRun: {},
      });
      finish(queue.slice(next + 1));
    };

    arm();
    worker.postMessage({ files: queue });
  });
}

let queue = files;
while (queue.length > 0) queue = await drain(queue);

rows.sort((a, b) => a.file.localeCompare(b.file));

const by = (s: Status) => rows.filter((r) => r.status === s);
const calls = rows.reduce((n, r) => n + r.calls, 0);
const exportCount = rows.reduce((n, r) => n + r.exports, 0);
const diverged = by('DIVERGE');
const timedOut = by('timeout');

const notRun = new Map<string, number>();
for (const r of rows) {
  for (const [k, n] of Object.entries(r.notRun)) notRun.set(k, (notRun.get(k) ?? 0) + n);
}

console.log('  === bridge path vs wabt-ts path, RUN in lockstep ===');
console.log(`    modules compared        ${String(rows.length).padStart(5)}`);
console.log(`    agree                   ${String(by('agree').length).padStart(5)}`);
console.log(`    DIVERGE                 ${String(diverged.length).padStart(5)}`);
console.log(`    no runnable export      ${String(by('no-runnable-export').length).padStart(5)}`);
console.log(`    skipped (A unavailable) ${String(by('skip').length).padStart(5)}`);
console.log(`    timed out (not run)     ${String(timedOut.length).padStart(5)}`);
console.log(`    exports exercised       ${String(exportCount).padStart(5)}`);
console.log(`    calls compared          ${String(calls).padStart(5)}`);

if (notRun.size > 0) {
  console.log('\n  === exports NOT exercised, and why (this is the coverage hole) ===');
  for (const [k, n] of [...notRun].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(n).padStart(5)}  ${k}`);
  }
}

if (timedOut.length > 0) {
  console.log(`\n  === ${timedOut.length} did not terminate, so nothing was compared in them ===`);
  for (const r of timedOut) console.log(`    ${r.file}`);
}

if (diverged.length > 0) {
  console.log(`\n  === the ${diverged.length} that diverge (first 30) ===`);
  for (const r of diverged.slice(0, 30)) {
    console.log(`    ${r.file.padEnd(44)} ${r.detail.slice(0, 120)}`);
  }
  // One root cause usually explains many files; group before reading.
  const reasons = new Map<string, number>();
  for (const r of diverged) {
    const key = r.detail.replace(/\d+/g, 'N').slice(0, 120);
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  console.log('\n  === distinct reasons ===');
  for (const [k, n] of [...reasons].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(n).padStart(3)}x  ${k}`);
  }
  Deno.exit(1);
}

console.log(
  `\n  TOTAL — ${calls} calls across ${exportCount} exports, and the two paths agree on every one.`,
);

// ⚠️ **Exit explicitly, or this gate never exits.** `worker.terminate()` cannot
// interrupt a worker already inside a synchronous wasm loop, so that thread
// outlives the driver and the process stays alive with its verdict already
// printed. Measured 2026-09-15: the first full run printed this exact summary
// and then sat until an external 1500s timeout killed it -- exit code 124 on a
// run where every module agreed. A gate whose exit code is a timeout is not a
// gate.
Deno.exit(0);
