// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `wasm-strip` — remove custom sections (the `name` section, debug info,
 * etc.) from a `.wasm` binary to shrink production builds.
 *
 * Library entry point ({@link wasmStrip}) returns `{ binary, errors, result }`.
 * By default it strips ALL custom sections; pass `opts.sections` to restrict
 * to specific section names.
 *
 * CLI form (via `import.meta.main`):
 *
 * ```sh
 * deno run -A jsr:@jrmarcum/wabt-ts/wasm-strip input.wasm -o stripped.wasm
 * ```
 *
 * Library usage:
 *
 * ```ts
 * import { wasmStrip } from "jsr:@jrmarcum/wabt-ts/wasm-strip";
 *
 * const original = await Deno.readFile("module.wasm");
 * const { binary } = wasmStrip(original);
 * await Deno.writeFile("stripped.wasm", binary);
 * ```
 *
 * Pipeline: `readBinaryIr` with `readDebugNames: false` (so the name section
 * stays in `module.customs`) → clear `module.customs` → `writeBinaryIr`.
 */

import { readBinaryIr } from '../reader/binary-reader.ts';
import type { ReadBinaryOptions } from '../reader/binary-reader.ts';
import { writeBinaryIr } from '../writer/binary-writer.ts';
import { Result } from '../core/result.ts';
import { formatErrors, hasErrors, makeErrorList } from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link wasmStrip}. */
export interface WasmStripOptions {
  /** Source filename shown in error messages. Default: `'<input>'`. */
  filename?: string;
  /**
   * Names of custom sections to strip. If omitted, all custom sections
   * (including the `name` section) are removed.
   */
  sections?: string[];
}

/** Return value from {@link wasmStrip}. */
export interface WasmStripResult {
  /** The stripped wasm binary. Empty on decode error. */
  binary: Uint8Array;
  /** Accumulated decode errors. */
  errors: ErrorList;
  /** `Result.Ok` on success; `Result.Error` if decode fails. */
  result: Result;
}

/**
 * Strip custom sections from a wasm binary.
 *
 * By default removes all custom sections (name section and any others).
 * Pass `sections` to restrict which section names are removed.
 */
export function wasmStrip(binary: Uint8Array, opts: WasmStripOptions = {}): WasmStripResult {
  const errors = makeErrorList();

  // Read without parsing the name section so it stays in module.customs.
  const readOpts: ReadBinaryOptions = { readDebugNames: false };
  if (opts.filename !== undefined) readOpts.filename = opts.filename;

  const module = readBinaryIr(binary, errors, readOpts);

  if (hasErrors(errors)) {
    return { binary: new Uint8Array(0), errors, result: Result.Error };
  }

  // Filter customs in-place.
  if (opts.sections) {
    const keep = new Set(opts.sections);
    module.customs = module.customs.filter((c) => !keep.has(c.name));
  } else {
    module.customs = [];
  }

  const stripped = writeBinaryIr(module);
  return { binary: stripped, errors, result: Result.Ok };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = Deno.args.slice();
  let input: string | undefined;
  let output: string | undefined;
  const stripSections: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
      output = args[++i];
    } else if (arg === '-s' || arg === '--section') {
      const s = args[++i];
      if (s) stripSections.push(s);
    } else if (arg && !arg.startsWith('-')) {
      input = arg;
    }
  }

  if (!input) {
    console.error('usage: wasm-strip <input.wasm> [-o <output.wasm>] [-s <section-name>]');
    Deno.exit(1);
  }

  const binary = await Deno.readFile(input);
  const stripOpts: WasmStripOptions = { filename: input };
  if (stripSections.length > 0) stripOpts.sections = stripSections;
  const { binary: stripped, errors, result } = wasmStrip(binary, stripOpts);

  if (errors.length > 0) {
    console.error(formatErrors(errors));
  }
  if (result !== Result.Ok) {
    Deno.exit(1);
  }

  const dest = output ?? input;
  await Deno.writeFile(dest, stripped);
}
