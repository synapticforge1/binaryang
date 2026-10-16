// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The browser recipe's Worker (open-work 28.7): optimizes ONE module off the page's thread.
 *
 * Message in: `{ bytes: Uint8Array, optimizeLevel, shrinkLevel }`. Message out:
 * `{ ok: true, bytes }` or `{ ok: false, error }`. `validate: true` makes `wasmOpt` compile its
 * output in THIS engine before returning it, so a result the browser would refuse comes back as an
 * error, never as bytes.
 *
 * Bundle it as its own entry point next to `optimize.ts` (or pass `workerUrl` to
 * `optimizeInBrowser`). See README.md § "Optimizing in the browser".
 */

import { wasmOpt } from '@jrmarcum/binaryang/tools/wasm-opt';

export interface OptimizeRequest {
  bytes: Uint8Array;
  optimizeLevel: 0 | 1 | 2 | 3 | 4;
  shrinkLevel: 0 | 1 | 2;
}
export type OptimizeReply = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** The Worker's own global, as far as this file uses it (the DOM types describe a page). */
interface WorkerScope {
  onmessage: ((e: MessageEvent<OptimizeRequest>) => void) | null;
  postMessage(message: OptimizeReply, transfer?: Transferable[]): void;
}
const scope = globalThis as unknown as WorkerScope;

scope.onmessage = async (e) => {
  const { bytes, optimizeLevel, shrinkLevel } = e.data;
  try {
    const out = await wasmOpt(bytes, { optimizeLevel, shrinkLevel, validate: true });
    if (typeof out === 'string') throw new Error('wasmOpt returned text');
    scope.postMessage({ ok: true, bytes: out }, [out.buffer]);
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
