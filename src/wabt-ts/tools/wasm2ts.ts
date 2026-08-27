// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `wasm2ts` — wasm-binary to TypeScript AOT transpiler (Phase 8, **stub**).
 *
 * Calling {@link wasm2ts} currently throws — the implementation is deferred
 * pending wasmtk QA/QC. When it lands it will transpile a `.wasm` binary
 * into idiomatic TypeScript, emitting a typed class whose public methods
 * mirror the module's exports (matching the patterns wasmtk recognises so
 * the round-trip TS → WAT (wasmtk) → wasm → TS (wasm2ts) → WAT yields
 * semantically equivalent WAT at each cycle).
 *
 * The full design lives in the project's CLAUDE.md → Phase 8 section,
 * including the wasm → TypeScript type mapping (i32 → number, i64 →
 * bigint, linear memory → Uint8Array + DataView, function tables →
 * `Array<(...args) => R>`, exports → typed class, imports → typed
 * `interface`).
 *
 * Until Phase 8 ships, this entry point exists for shape compatibility
 * with the other tools; calling it throws with a clear "not yet
 * implemented" message.
 */

import type { ErrorList } from '../core/error.ts';
import { Result } from '../core/result.ts';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Public API (stub)
// ---------------------------------------------------------------------------

export interface Wasm2TsOptions {
  filename?: string;
}

export interface Wasm2TsResult {
  text: string;
  errors: ErrorList;
  result: Result;
}

/** Not yet implemented — Phase 8 is deferred pending wasmtk QA/QC. */
export function wasm2ts(_binary: Uint8Array, _opts: Wasm2TsOptions = {}): Wasm2TsResult {
  throw new Error('wasm2ts is not yet implemented (Phase 8 — deferred pending wasmtk QA/QC)');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(_args: string[] = process.argv.slice(2)): Promise<void> {
  console.error('wasm2ts: not yet implemented (Phase 8 — deferred pending wasmtk QA/QC)');
  process.exit(1);
}
