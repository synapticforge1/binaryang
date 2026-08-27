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
 * deno run -A jsr:@jrmarcum/wabt-ts/wasm2wat input.wasm > output.wat
 * ```
 *
 * Library usage:
 *
 * ```ts
 * import { wasm2wat } from "jsr:@jrmarcum/wabt-ts/wasm2wat";
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

/**
 * Read a file for the CLI, or exit with a one-line message.
 *
 * A bare `await Deno.readFile(path)` throws an uncaught `NotFound` /
 * `IsADirectory` on a mistyped argument, which Deno renders as a stack trace
 * naming its own internals and the absolute path of this file. That is the
 * wrong output for a user typo, and it is the same "report, do not throw" rule
 * the library side got in T13.29 — applied to the CLI layer (T13.31).
 */
async function cliRead(tool: string, path: string): Promise<Uint8Array> {
  try {
    return await Deno.readFile(path);
  } catch (e) {
    console.error(`${tool}: cannot read '${path}': ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  }
}

/** Write a file for the CLI, or exit with a one-line message. See {@link cliRead}. */
async function cliWrite(tool: string, path: string, data: Uint8Array | string): Promise<void> {
  try {
    if (typeof data === 'string') await Deno.writeTextFile(path, data);
    else await Deno.writeFile(path, data);
  } catch (e) {
    console.error(`${tool}: cannot write '${path}': ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  const args = Deno.args.slice();
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
    Deno.exit(1);
  }

  const binary = await cliRead('wasm2wat', input);
  const { text, errors, result } = wasm2wat(binary, { filename: input });

  if (errors.length > 0) {
    console.error(formatErrors(errors));
  }
  if (result !== Result.Ok) {
    Deno.exit(1);
  }

  if (output) {
    await cliWrite('wasm2wat', output, text);
  } else {
    console.log(text);
  }
}
