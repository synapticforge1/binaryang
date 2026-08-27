// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `wasm-validate` — validate a `.wasm` binary against the WebAssembly spec.
 *
 * Library entry point ({@link wasmValidate}) returns `{ errors, result }`.
 * Decode errors and validation errors land in the same `ErrorList` so a
 * single pass produces every diagnostic; `result` is the combined
 * `Result.Ok` / `Result.Error`.
 *
 * CLI form (via `import.meta.main`):
 *
 * ```sh
 * deno run -A jsr:@jrmarcum/wabt-ts/wasm-validate input.wasm
 * ```
 *
 * Library usage:
 *
 * ```ts
 * import { wasmValidate } from "jsr:@jrmarcum/wabt-ts/wasm-validate";
 * import { Result, formatErrors } from "jsr:@jrmarcum/wabt-ts";
 *
 * const bytes = await Deno.readFile("module.wasm");
 * const r = wasmValidate(bytes);
 * if (r.result !== Result.Ok) console.error(formatErrors(r.errors));
 * ```
 *
 * Pipeline: `readBinaryIr` → `validateModule`. Both share the same
 * `ErrorList` so callers see decode + validation errors together.
 */

import { readBinaryIr } from '../reader/binary-reader.ts';
import type { ReadBinaryOptions } from '../reader/binary-reader.ts';
import { validateModule } from '../validator/validator.ts';
import type { ValidateOptions } from '../validator/shared-validator.ts';
import { defaultFeatures } from '../core/feature.ts';
import type { Features } from '../core/feature.ts';
import { combineResults, Result } from '../core/result.ts';
import { formatErrors, hasErrors, makeErrorList } from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link wasmValidate}. */
export interface WasmValidateOptions {
  /** Source filename shown in error messages. Default: `'<input>'`. */
  filename?: string;
  /**
   * Which proposals the module may use. Defaults to {@link defaultFeatures}.
   * Pass {@link allFeatures} to accept every proposal wabt-ts knows, which is
   * roughly what a current browser accepts.
   */
  features?: Features;
}

/** Return value from {@link wasmValidate}. */
export interface WasmValidateResult {
  /** Accumulated decode + validation errors. */
  errors: ErrorList;
  /** `Result.Ok` if the binary decodes and validates; `Result.Error` otherwise. */
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

  const valOpts: ValidateOptions = {};
  if (opts.features !== undefined) valOpts.features = opts.features;
  const valResult = validateModule(module, errors, valOpts);

  return { errors, result: combineResults(readResult, valResult) };
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
  const inputs: string[] = [];

  // `--enable-<feature>` / `--disable-<feature>`, plus `--enable-all`.
  //
  // These exist because the validator now ENFORCES the feature set (T13.10);
  // before that it accepted every proposal regardless, so there was nothing to
  // turn on. Without these flags a gated validator would reject any GC, SIMD,
  // threads, tail-call or EH module from the command line with no way to opt
  // in — a worse regression than the bug being fixed.
  const features = defaultFeatures();
  const featureNames = Object.keys(features) as (keyof Features)[];
  const byFlagName = new Map<string, keyof Features>(
    // `multiMemory` -> `multi-memory`, matching wabt's spelling.
    featureNames.map((n) => [n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), n]),
  );

  let bad = false;
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      inputs.push(arg);
      continue;
    }
    if (arg === '--enable-all') {
      for (const n of featureNames) features[n] = true;
      continue;
    }
    const m = /^--(enable|disable)-(.+)$/.exec(arg);
    const key = m ? byFlagName.get(m[2]!) : undefined;
    if (!m || key === undefined) {
      console.error(`wasm-validate: unknown option ${arg}`);
      bad = true;
      continue;
    }
    features[key] = m[1] === 'enable';
  }
  if (bad) {
    console.error(
      'features: --enable-all, or --enable-/--disable- one of:\n  ' +
        [...byFlagName.keys()].join(' '),
    );
    Deno.exit(1);
  }

  if (inputs.length === 0) {
    console.error('usage: wasm-validate [--enable-all|--enable-<feature>] <input.wasm> [...]');
    Deno.exit(1);
  }

  let anyFailed = false;

  for (const input of inputs) {
    const binary = await cliRead('wasm-validate', input);
    const { errors, result } = wasmValidate(binary, { filename: input, features });

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
