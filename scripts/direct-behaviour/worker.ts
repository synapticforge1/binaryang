// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The killable half of `bun run direct-behaviour`.
 *
 * `differential.ts` calls corpus entry points, and some of them never return
 * under stub imports. There is no way to bound a synchronous wasm call from
 * inside the same thread — V8 offers no fuel limit to JS — so the work runs
 * here, where the driver can terminate it.
 *
 * Protocol: the driver posts a list of modules, each a name and its text (the
 * corpus and the fixture, `direct-inputs.ts`); this posts one `{ row }` per
 * module as it finishes, then `{ done: true }`. The driver's watchdog measures
 * the gap between messages, so a module that never posts is the one that hung.
 */

import { check, type Row } from './differential.ts';
import type { DirectInput } from '../direct-inputs.ts';

import { parentPort } from 'node:worker_threads';

const port = parentPort!;

port.on('message', (data: { inputs: DirectInput[] }) => {
  for (const { name: file, wat } of data.inputs) {
    let row: Row;
    try {
      row = check(file, wat);
    } catch (e) {
      // An unexpected throw is itself a finding; never let one file hide the
      // rest of the corpus.
      row = {
        file,
        status: 'DIVERGE',
        exports: 0,
        calls: 0,
        detail: `unexpected: ${(e as Error).message}`,
        notRun: {},
      };
    }
    port.postMessage({ row });
  }
  port.postMessage({ done: true });
});
