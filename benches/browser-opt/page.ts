// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The measurement page (open-work 28.6): starts the measuring module Worker (worker.ts) and puts
 * its report on `globalThis.__result`, where scripts/browsers/driver.ts collects it.
 */

const g = globalThis as { __result?: unknown };
const worker = new Worker('/worker.js', { type: 'module' });
worker.onmessage = (e: MessageEvent) => {
  g.__result = { userAgent: navigator.userAgent, ...(e.data as object) };
};
worker.onerror = (e: ErrorEvent) => {
  g.__result = { userAgent: navigator.userAgent, error: `worker: ${e.message}` };
};
