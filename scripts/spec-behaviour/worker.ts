// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The killable half of `deno task spec-behaviour`.
 *
 * A miscompiled module can loop forever, and a synchronous wasm call cannot be
 * bounded from its own thread, so the work runs here, where the driver can
 * terminate it — the same protocol as `direct-behaviour/worker.ts`: the driver
 * posts the inputs, this posts one `{ row }` per module as it finishes, then
 * `{ done: true }`; a module that never posts is the one that hung.
 */

import { check, type Row, type SpecInput } from './differential.ts';

declare const self: Worker;

self.onmessage = (ev: MessageEvent<{ inputs: SpecInput[] }>) => {
  for (const input of ev.data.inputs) {
    let row: Row;
    try {
      row = check(input);
    } catch (e) {
      // An unexpected throw is itself a finding; never let one module hide the rest.
      row = {
        name: input.name,
        status: 'DIVERGE',
        invocations: input.invokes.length,
        v128: 0,
        blind: 0,
        variants: 0,
        refused: [],
        detail: [`unexpected: ${(e as Error).message}`],
      };
    }
    self.postMessage({ row });
  }
  self.postMessage({ done: true });
};
