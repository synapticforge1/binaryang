// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The killable half of `deno task bridge-behaviour`.
 *
 * `differential.ts` calls corpus entry points, and some of them never return
 * under stub imports. There is no way to bound a synchronous wasm call from
 * inside the same thread — V8 offers no fuel limit to JS — so the work runs
 * here, where the driver can terminate it.
 *
 * Protocol: the driver posts a list of filenames; this posts one `{ row }` per
 * file as it finishes, then `{ done: true }`. The driver's watchdog measures
 * the gap between messages, so a file that never posts is the file that hung.
 */

import { check, CORPUS, type Row } from './differential.ts';

declare const self: Worker;

self.onmessage = async (ev: MessageEvent<{ files: string[] }>) => {
  for (const file of ev.data.files) {
    let row: Row;
    try {
      const wat = await Deno.readTextFile(new URL(file, CORPUS));
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
    self.postMessage({ row });
  }
  self.postMessage({ done: true });
};
