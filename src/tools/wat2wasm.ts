// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { LexerSource } from '../parser/lexer-source.ts';
import { parseWatModule } from '../parser/wast-parser.ts';
import { writeBinaryIr } from '../writer/binary-writer.ts';
import { resolveNames } from '../ir/resolve-names.ts';
import { Result } from '../core/result.ts';
import { makeErrorList, hasErrors, formatErrors } from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Wat2WasmOptions {
  /** Source filename shown in error messages. Default: '<input>'. */
  filename?: string;
}

export interface Wat2WasmResult {
  binary: Uint8Array;
  errors: ErrorList;
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

  const binary = writeBinaryIr(module);
  return { binary, errors, result: Result.Ok };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

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
    console.error('usage: wat2wasm <input.wat> [-o <output.wasm>]');
    Deno.exit(1);
  }

  const source = await Deno.readFile(input);
  const { binary, errors, result } = wat2wasm(source, { filename: input });

  if (errors.length > 0) {
    console.error(formatErrors(errors));
  }
  if (result !== Result.Ok) {
    Deno.exit(1);
  }

  if (output) {
    await Deno.writeFile(output, binary);
  } else {
    await Deno.stdout.write(binary);
  }
}
