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
 * CLI form, through the package root's dispatcher (`main.ts`):
 *
 * ```sh
 * deno run -A jsr:@jrmarcum/binaryang wasm-validate input.wasm
 * ```
 *
 * Library usage:
 *
 * ```ts
 * import { wasmValidate } from "jsr:@jrmarcum/binaryang/wasm-validate";
 * import { Result, formatErrors } from "jsr:@jrmarcum/binaryang/core/wabt-ts";
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
import { checkBranchHints } from '../validator/branch-hints.ts';
import { countImports } from '../ir/ir.ts';
import { ExternalKind } from '../core/binary.ts';
import { defaultFeatures } from '../core/feature.ts';
import type { Features } from '../core/feature.ts';
import { combineResults, Result } from '../core/result.ts';
import { formatErrors, hasErrors, makeErrorList } from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';
import { cliRead } from '../../cli/io.ts';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// The feature sets `WasmValidateOptions.features` takes. 🔧 The option named
// `allFeatures` and nothing exported it: a caller could pass only a feature set
// it wrote by hand — the drift wasmtk refused to take on (their letter of
// 2026-09-28, item 2). Also exported from `./core/wabt-ts`.
export { allFeatures, defaultFeatures } from '../core/feature.ts';
export type { Features } from '../core/feature.ts';

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
 * Errors from the binary reader, or else from the validator, are accumulated
 * in `errors`. Returns `Result.Ok` only if neither phase produced errors.
 *
 * ⚠️ A module that fails to DECODE is not validated, as upstream. The
 * validator run over a half-decoded module reports code that was never read
 * (a truncated body is "expected 1 elements on the stack but got 0"), and the
 * real error scrolls away under it: 81 of the spec's 715 malformed binaries did
 * this (`deno task diagnostics`, 2026-09-29).
 */
export function wasmValidate(
  binary: Uint8Array,
  opts: WasmValidateOptions = {},
): WasmValidateResult {
  const errors = makeErrorList();

  const readOpts: ReadBinaryOptions = {};
  if (opts.filename !== undefined) readOpts.filename = opts.filename;

  const module = readBinaryIr(binary, errors, readOpts);
  if (hasErrors(errors)) return { errors, result: Result.Error };

  const valOpts: ValidateOptions = {};
  if (opts.features !== undefined) valOpts.features = opts.features;
  const valResult = validateModule(module, errors, valOpts);
  // Code metadata the reader keeps raw: a branch hint must point at a branch.
  const before = errors.length;
  checkBranchHints(binary, countImports(module, ExternalKind.Func), errors);
  const hintResult = errors.length > before ? Result.Error : Result.Ok;

  return { errors, result: combineResults(valResult, hintResult) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * CLI entry point for `wasm-validate`, registered in the top-level command dispatcher.
 *
 * Reads `process.argv` by default so it runs unchanged on Deno, Node and Bun;
 * pass `args` explicitly to drive it from a test or another tool.
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  args = args.slice();
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
    process.exit(1);
  }

  if (inputs.length === 0) {
    console.error('usage: wasm-validate [--enable-all|--enable-<feature>] <input.wasm> [...]');
    process.exit(1);
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

  if (anyFailed) process.exit(1);
}
