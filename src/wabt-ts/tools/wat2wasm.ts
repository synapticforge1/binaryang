// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `wat2wasm` — compile WebAssembly text format (WAT) to a binary `.wasm` module.
 *
 * Library entry point ({@link wat2wasm}) returns `{ binary, errors, result }`.
 * On parse or encode error the binary is empty and `result === Result.Error`;
 * errors are accumulated in the `errors` array rather than thrown so callers
 * can pretty-print or aggregate them.
 *
 * Also runs as a CLI when imported with `import.meta.main`:
 *
 * ```sh
 * deno run -A jsr:@jrmarcum/binaryang wat2wasm input.wat -o output.wasm
 * ```
 *
 * Library usage:
 *
 * ```ts
 * import { wat2wasm } from "jsr:@jrmarcum/binaryang/wat2wasm";
 * import { Result, formatErrors } from "jsr:@jrmarcum/binaryang/core/wabt-ts";
 *
 * const r = wat2wasm("(module (func (export \"f\") (result i32) (i32.const 42)))");
 * if (r.result !== Result.Ok) throw new Error(formatErrors(r.errors));
 * await WebAssembly.instantiate(r.binary);
 * ```
 *
 * Pipeline: `parseWatModule` → `resolveNames` → `synthesizeTypes` →
 * `writeBinaryIr`. The `synthesizeTypes` pass back-fills the type section
 * for inline `(param …) (result …)` signatures on funcs / tags / func-imports.
 */

import { LexerSource } from '../parser/lexer-source.ts';
import { parseWatModule } from '../parser/wast-parser.ts';
import { writeBinaryIr } from '../writer/binary-writer.ts';
import { resolveNames } from '../ir/resolve-names.ts';
import { synthesizeTypes } from '../ir/synthesize-types.ts';
import { Result } from '../core/result.ts';
import { addError, formatErrors, hasErrors, unknownLocation } from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';
import { cliRead, cliWrite, writeStdout } from '../../cli/io.ts';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link wat2wasm}. */
export interface Wat2WasmOptions {
  /** Source filename shown in error messages. Default: `'<input>'`. */
  filename?: string;
}

/** Return value from {@link wat2wasm}. */
export interface Wat2WasmResult {
  /** The encoded wasm binary. Empty `Uint8Array(0)` on error. */
  binary: Uint8Array;
  /** Accumulated parse / resolve / encode errors. */
  errors: ErrorList;
  /** `Result.Ok` on success; `Result.Error` if `errors` is non-empty. */
  result: Result;
}

/**
 * Parse a WAT text module and encode it as a wasm binary.
 *
 * On parse errors `binary` is an empty array and `result` is `Result.Error`.
 */
export function wat2wasm(source: string | Uint8Array, opts: Wat2WasmOptions = {}): Wat2WasmResult {
  const src = new LexerSource(source, opts.filename ?? '<input>');
  const { module, errors } = parseWatModule(src);

  if (hasErrors(errors)) {
    return { binary: new Uint8Array(0), errors, result: Result.Error };
  }

  // Resolve symbolic names to indices before encoding.
  resolveNames(module, errors);
  if (hasErrors(errors)) {
    return { binary: new Uint8Array(0), errors, result: Result.Error };
  }

  // Ensure module.types contains an entry for every inline-declared function
  // signature; otherwise the function section emits dangling type-index
  // references and the resulting binary fails to decode. The WAT parser
  // stores inline sigs on Func / Tag / Func-import / Tag-import nodes but
  // does not back-fill the type section; this pass closes the gap.
  synthesizeTypes(module);

  // The encoder is FAIL-LOUD on a module it cannot represent -- a limits value
  // that does not fit its field, a tag whose type is not in the type section,
  // an unresolved name-var. Every one of those used to be a silent repair, and
  // making them throw was the fix; but a throw out of a TOOL is not a
  // diagnostic, so turn it into one here. Same rule as the validator's: a
  // failure must REPORT.
  let binary: Uint8Array;
  try {
    binary = writeBinaryIr(module);
  } catch (e) {
    addError(
      errors,
      unknownLocation(),
      `cannot encode module: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { binary: new Uint8Array(0), errors, result: Result.Error };
  }
  return { binary, errors, result: Result.Ok };
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
    console.error('usage: wat2wasm <input.wat> [-o <output.wasm>]');
    process.exit(1);
  }

  const source = await cliRead('wat2wasm', input);
  const { binary, errors, result } = wat2wasm(source, { filename: input });

  if (errors.length > 0) {
    console.error(formatErrors(errors));
  }
  if (result !== Result.Ok) {
    process.exit(1);
  }

  if (output) {
    await cliWrite('wat2wasm', output, binary);
  } else {
    await writeStdout(binary);
  }
}
