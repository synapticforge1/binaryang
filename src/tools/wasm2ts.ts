// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// wasm2ts — Phase 8 (deferred pending wasmtk QA/QC).
//
// This module is a placeholder. The implementation will transpile a wasm
// binary to idiomatic TypeScript, producing a typed class whose public
// methods mirror the module's exports. See CLAUDE.md Phase 8 for the
// full design spec.

import type { ErrorList } from '../core/error.ts';
import { Result } from '../core/result.ts';

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

if (import.meta.main) {
  console.error('wasm2ts: not yet implemented (Phase 8 — deferred pending wasmtk QA/QC)');
  Deno.exit(1);
}
