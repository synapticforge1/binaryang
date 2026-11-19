// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The host engine's known refusals of VALID modules, each a fact of that engine, not of the
 * module (owner, 2026-11-19: no failures or skips left to track). A test that runs a module in the
 * engine asks {@link refusedFor} first: on V8 the answer is always `false` and the engine check
 * runs as before; on JavaScriptCore (Bun) the answer is `true` only when the engine refuses the
 * bytes with EXACTLY the known message, and the test then checks the module another way (the
 * values it pins, which the V8 leg also checks against the engine). Any other refusal throws.
 *
 * JavaScriptCore, Bun 1.4.4 with memory64 on (measured 2026-11-19; no option changes either):
 * - `memories`: more than 100 memories — "there can be at most 100 memories" (the spec has no cap;
 *   V8 accepts them).
 * - `delegate`: a legacy `delegate` naming a plain block, or a `try` from inside its own `catch` —
 *   "delegate target isn't a try block" or "… isn't a try or the top level block" (V8 accepts
 *   both shapes; `delegate` to an outer `try` is accepted by both engines).
 */

/** Whether the engine running this file is JavaScriptCore (Bun). */
export const isJavaScriptCore: boolean = typeof (process.versions as { bun?: string }).bun ===
  'string';

const LIMITS = {
  memories: /doesn't parse at byte \d+: there can be at most 100 memories/,
  // Two wordings of one rule: "isn't a try block" (a block or a catch inside a try), "isn't a try
  // or the top level block" (a block at the top of the function).
  delegate: /doesn't validate: delegate target isn't a try (or the top level )?block/,
} as const;

/** A known refusal: its name. */
export type EngineLimit = keyof typeof LIMITS;

/**
 * `false` when the engine compiles `bytes`; `true` when JavaScriptCore refuses them with exactly
 * the `limit` message. Any other refusal — on V8 any refusal at all — is rethrown.
 */
export function refusedFor(bytes: Uint8Array, limit: EngineLimit): boolean {
  try {
    new WebAssembly.Module(bytes as BufferSource);
    return false;
  } catch (e) {
    if (isJavaScriptCore && LIMITS[limit].test(String(e))) return true;
    throw e;
  }
}
