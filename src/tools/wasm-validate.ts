// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { readBinaryIr } from '../reader/binary-reader.ts';
import type { ReadBinaryOptions } from '../reader/binary-reader.ts';
import { validateModule } from '../validator/validator.ts';
import { combineResults, Result } from '../core/result.ts';
import { formatErrors, hasErrors, makeErrorList } from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WasmValidateOptions {
  /** Source filename shown in error messages. Default: '<input>'. */
  filename?: string;
}

export interface WasmValidateResult {
  errors: ErrorList;
  result: Result;
}

/**
 * Decode a wasm binary and validate it.
 *
 * Errors from both the binary reader and the validator are accumulated in
 * `errors`. Returns `Result.Ok` only if neither phase produced errors.
 */
export function wasmValidate(
  binary: Uint8Array,
  opts: WasmValidateOptions = {},
): WasmValidateResult {
  const errors = makeErrorList();

  const readOpts: ReadBinaryOptions = {};
  if (opts.filename !== undefined) readOpts.filename = opts.filename;

  const module = readBinaryIr(binary, errors, readOpts);
  const readResult = hasErrors(errors) ? Result.Error : Result.Ok;

  const valResult = validateModule(module, errors);

  return { errors, result: combineResults(readResult, valResult) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = Deno.args.slice();
  const inputs: string[] = [];

  for (const arg of args) {
    if (!arg.startsWith('-')) inputs.push(arg);
  }

  if (inputs.length === 0) {
    console.error('usage: wasm-validate <input.wasm> [...]');
    Deno.exit(1);
  }

  let anyFailed = false;

  for (const input of inputs) {
    const binary = await Deno.readFile(input);
    const { errors, result } = wasmValidate(binary, { filename: input });

    if (errors.length > 0) {
      console.error(formatErrors(errors));
    }

    if (result === Result.Ok) {
      console.log(`${input}: OK`);
    } else {
      console.error(`${input}: INVALID`);
      anyFailed = true;
    }
  }

  if (anyFailed) Deno.exit(1);
}
