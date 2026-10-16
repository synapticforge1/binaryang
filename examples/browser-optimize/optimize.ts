// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The browser recipe (open-work 28.7): shrink a WebAssembly module the page does not control, on
 * the user's machine, without ever making things worse. A RECIPE to copy, not a library export.
 *
 * What it is for: SIZE. Measured 2026-10-13 in Chrome, Firefox and Safari's engine on real compiler
 * output (cmem/optimizer.md § "Real compiler output, in three browsers"): code bytes −0.1% to −27%,
 * 60 ms – 1.7 s to optimize in a Worker, and NO run-time speedup, even on debug builds; the engines'
 * own tiers already optimize. A site that builds its own module should optimize at BUILD time.
 *
 * The rules it follows:
 * - the original is kept, and returned whenever anything goes wrong;
 * - the work runs in a Worker, with a time limit;
 * - the result is used only if THIS browser accepts it (the Worker compiles it) and it is smaller;
 * - a result is cached under the SHA-256 of the input and the options (Cache API, when present).
 */

import type { OptimizeReply, OptimizeRequest } from './optimize-worker.ts';

export interface OptimizeInBrowserOptions {
  /** The Worker script. Default: `optimize-worker.js` next to this module. */
  workerUrl?: URL | string;
  /** Default 2. */
  optimizeLevel?: OptimizeRequest['optimizeLevel'];
  /** Default 2 (`-Oz`: the goal is size). */
  shrinkLevel?: OptimizeRequest['shrinkLevel'];
  /** Give up and keep the original after this long. Default 10 s. */
  timeoutMs?: number;
  /** The Cache API cache to use; `null` for none. Default `"binaryang-optimized-v1"`. */
  cacheName?: string | null;
}

export interface OptimizeInBrowserResult {
  /** The bytes to use: the optimized module, or the original. */
  bytes: Uint8Array;
  optimized: boolean;
  fromCache: boolean;
  /** Why the original was kept, or `"optimized"`. */
  reason: string;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function runWorker(url: URL | string, request: OptimizeRequest, timeoutMs: number) {
  return new Promise<OptimizeReply>((resolve) => {
    const worker = new Worker(url, { type: 'module' });
    const done = (reply: OptimizeReply) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(reply);
    };
    const timer = setTimeout(
      () => done({ ok: false, error: `timed out after ${timeoutMs} ms` }),
      timeoutMs,
    );
    worker.onmessage = (e: MessageEvent<OptimizeReply>) => done(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      done({ ok: false, error: `worker error: ${e.message}` });
    };
    // A COPY is transferred, so the caller's original stays intact.
    const copy = request.bytes.slice();
    worker.postMessage({ ...request, bytes: copy }, [copy.buffer]);
  });
}

/** Optimizes `original` for size in a Worker; returns the original whenever that is not a win. */
export async function optimizeInBrowser(
  original: Uint8Array,
  options: OptimizeInBrowserOptions = {},
): Promise<OptimizeInBrowserResult> {
  const keep = (reason: string): OptimizeInBrowserResult => ({
    bytes: original,
    optimized: false,
    fromCache: false,
    reason,
  });
  // Only a module THIS browser accepts goes on. That also keeps out WAT text, which `wasmOpt` would
  // otherwise read as text (it takes anything without the `\0asm` header for WAT).
  if (!WebAssembly.validate(original as BufferSource)) {
    return keep('this browser refuses the original');
  }

  const optimizeLevel = options.optimizeLevel ?? 2;
  const shrinkLevel = options.shrinkLevel ?? 2;
  const cacheName = options.cacheName === undefined ? 'binaryang-optimized-v1' : options.cacheName;
  const cache = cacheName !== null && 'caches' in globalThis ? await caches.open(cacheName) : null;
  const key = `/binaryang-optimized/${await sha256(original)}-O${optimizeLevel}s${shrinkLevel}`;

  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      // A cached result is re-checked: the cache outlives browser updates.
      if (WebAssembly.validate(bytes as BufferSource) && bytes.length < original.length) {
        return { bytes, optimized: true, fromCache: true, reason: 'optimized' };
      }
      await cache.delete(key);
    }
  }

  const reply = await runWorker(
    options.workerUrl ?? new URL('./optimize-worker.js', import.meta.url),
    { bytes: original, optimizeLevel, shrinkLevel },
    options.timeoutMs ?? 10_000,
  );
  // The Worker's `validate: true` compiled the result in this same engine: a result this browser
  // refuses comes back as an error, so it lands here.
  if (!reply.ok) return keep(reply.error);
  if (reply.bytes.length >= original.length) return keep('no smaller');

  if (cache) await cache.put(key, new Response(reply.bytes as BufferSource));
  return { bytes: reply.bytes, optimized: true, fromCache: false, reason: 'optimized' };
}
