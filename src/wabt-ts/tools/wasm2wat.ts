// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `wasm2wat` — decode a `.wasm` binary and render it as WebAssembly text format.
 *
 * Library entry point ({@link wasm2wat}) returns `{ text, errors, result }`.
 * On decode error the text is empty and `result === Result.Error`; the
 * decoder accumulates errors rather than throwing.
 *
 * CLI form (via `import.meta.main`):
 *
 * ```sh
 * deno run -A jsr:@jrmarcum/binaryang wasm2wat input.wasm > output.wat
 * ```
 *
 * Library usage:
 *
 * ```ts
 * import { wasm2wat } from "jsr:@jrmarcum/binaryang/wasm2wat";
 *
 * const bytes = await Deno.readFile("module.wasm");
 * const { text } = wasm2wat(bytes, { readDebugNames: true });
 * console.log(text);
 * ```
 *
 * Pipeline: `readBinaryIr` (with `readDebugNames: true` by default) →
 * `generateNames` (fills synthetic `$f0` / `$g0` / … for unnamed entities) →
 * `writeWatModule`. The `inlineExport` option controls whether exports are
 * rendered inline inside their defining item (default `true`).
 */

import { readBinaryIr } from '../reader/binary-reader.ts';
import type { ReadBinaryOptions } from '../reader/binary-reader.ts';
import { writeWatModule } from '../writer/wat-writer.ts';
import { generateNames } from '../ir/generate-names.ts';
import { Result } from '../core/result.ts';
import { formatErrors, hasErrors, makeErrorList } from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';
import { cliRead, cliWrite } from '../../cli/io.ts';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link wasm2wat}. */
export interface Wasm2WatOptions {
  /** Source filename shown in error messages. Default: `'<input>'`. */
  filename?: string;
  /** Parse the name section and apply symbolic names. Default: `true`. */
  readDebugNames?: boolean;
  /** Emit inline exports. Default: `true` (passed to wat-writer). */
  inlineExport?: boolean;
}

/** Return value from {@link wasm2wat}. */
export interface Wasm2WatResult {
  /** The rendered WAT text. Empty string on error. */
  text: string;
  /** Accumulated decode errors. */
  errors: ErrorList;
  /** `Result.Ok` on success; `Result.Error` if `errors` is non-empty. */
  result: Result;
}

/**
 * Decode a wasm binary and render it as a WAT text module.
 *
 * On decode errors `text` is empty and `result` is `Result.Error`.
 */
export function wasm2wat(binary: Uint8Array, opts: Wasm2WatOptions = {}): Wasm2WatResult {
  const errors = makeErrorList();
  const readDebugNames = opts.readDebugNames !== false;
  const readOpts: ReadBinaryOptions = { readDebugNames };
  if (opts.filename !== undefined) readOpts.filename = opts.filename;

  const module = readBinaryIr(binary, errors, readOpts);

  if (hasErrors(errors)) {
    return { text: '', errors, result: Result.Error };
  }

  // Fill in synthetic names for any unnamed entities so the WAT output is
  // readable (emits $f0, $g0, … for anonymous functions/globals).
  generateNames(module);

  const text = writeWatModule(module, {
    inlineExport: opts.inlineExport !== false,
  });

  return { text, errors, result: Result.Ok };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  args = args.slice();
  let input: string | undefined;
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
      output = args[++i];
    } else if (arg && !arg.startsWith('-')) {
      input = arg;
    }
  }

  if (!input) {
    console.error('usage: wasm2wat <input.wasm> [-o <output.wat>]');
    process.exit(1);
  }

  const binary = await cliRead('wasm2wat', input);
  const { text, errors, result } = wasm2wat(binary, { filename: input });

  if (errors.length > 0) {
    console.error(formatErrors(errors));
  }
  if (result !== Result.Ok) {
    process.exit(1);
  }

  if (output) {
    await cliWrite('wasm2wat', output, text);
  } else {
    console.log(text);
  }
}
