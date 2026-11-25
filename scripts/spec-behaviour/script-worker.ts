// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The killable half of the spec-expected check — the protocol of `worker.ts`: the driver posts the
 * scripts, this posts one `{ row }` per script as it finishes, then `{ done: true }`.
 */

import { checkScript, emptyRow, type ScriptInput } from './script-run.ts';

import { parentPort } from 'node:worker_threads';

const port = parentPort!;

port.on('message', (data: { inputs: ScriptInput[] }) => {
  for (const input of data.inputs) {
    try {
      port.postMessage({ row: checkScript(input) });
    } catch (e) {
      // An unexpected throw is itself a finding; never let one script hide the rest.
      const row = emptyRow(input.name);
      row.original.push(`unexpected: ${(e as Error).message}`);
      port.postMessage({ row });
    }
  }
  port.postMessage({ done: true });
});
