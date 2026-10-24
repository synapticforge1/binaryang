// Based on WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/tools/wasm-validate.cc
// Copyright 2017 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

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
 * import { Result, formatErrors } from "jsr:@jrmarcum/binaryang/ir";
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
import { countImports, locOf } from '../ir/ir.ts';
import type { Location } from '../core/error.ts';
import { ExternalKind } from '../core/binary.ts';
import type { Features } from '../core/feature.ts';
import { combineResults, Result } from '../core/result.ts';
import {
  addError,
  formatErrors,
  hasErrors,
  isStackExhausted,
  makeErrorList,
  nestingTooDeep,
} from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';
import { cliExit, cliProcess, cliRead } from '../cli/io.ts';
import { helpText, type ToolHelp, wantsHelp } from '../cli/help.ts';
import { FeatureFlags } from '../cli/feature-flags.ts';

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
 * this (`bun run diagnostics`, 2026-09-29).
 */
export function wasmValidate(
  binary: Uint8Array,
  opts: WasmValidateOptions = {},
): WasmValidateResult {
  // Too deeply nested to walk: REPORTED, never a bare RangeError (open-work 13).
  try {
    return validate(binary, opts);
  } catch (e) {
    if (!isStackExhausted(e)) throw e;
    return { errors: nestingTooDeep(opts.filename), result: Result.Error };
  }
}

function validate(binary: Uint8Array, opts: WasmValidateOptions): WasmValidateResult {
  const errors = makeErrorList();

  const readOpts: ReadBinaryOptions = {};
  if (opts.filename !== undefined) readOpts.filename = opts.filename;

  const module = readBinaryIr(binary, errors, readOpts);
  if (hasErrors(errors)) return { errors, result: Result.Error };

  const valOpts: ValidateOptions = {};
  if (opts.features !== undefined) valOpts.features = opts.features;
  const valResult = combineResults(
    validateModule(module, errors, valOpts),
    opts.features?.multiValue === false ? refuseIndexedBlockTypes(module, errors) : Result.Ok,
  );
  // Code metadata the reader keeps raw: a branch hint must point at a branch.
  const before = errors.length;
  checkBranchHints(binary, countImports(module, ExternalKind.Func), errors);
  const hintResult = errors.length > before ? Result.Error : Result.Ok;

  return { errors, result: combineResults(valResult, hintResult) };
}

const CARRIERS: ReadonlySet<string> = new Set(['block', 'loop', 'if', 'try', 'try_table']);

/**
 * Without multi-value, a block type must be empty or one value type: the BINARY form of a type
 * index is refused, whatever the type — upstream wabt's binary reader ("expected valid block
 * signature type"), and wasm-tools likewise (open-work 35, measured 2026-10-24). It is the binary
 * path's rule only: upstream `wat2wasm` accepts `(block (type $t))` naming a one-result type, so it
 * lives here and not in the shared validator.
 */
function refuseIndexedBlockTypes(module: object, errors: ErrorList): Result {
  let result: Result = Result.Ok;
  const seen = new Set<object>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    if (
      typeof rec['kind'] === 'string' && CARRIERS.has(rec['kind']) && rec['typeIndex'] !== undefined
    ) {
      addError(errors, locOf(rec as { loc?: Location }), 'expected valid block signature type');
      result = Result.Error;
    }
    for (const value of Object.values(rec)) {
      if (value !== null && typeof value === 'object') visit(value);
    }
  };
  visit(module);
  return result;
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
const HELP: ToolHelp = {
  usage: 'wasm-validate [options] <input.wasm> [...]',
  description:
    'Read WebAssembly binaries and check them against the specification, with the features\nupstream wabt enables by default unless the options say otherwise.',
  examples: [
    ['validate test.wasm', 'wasm-validate test.wasm'],
    [
      'validate a module that uses GC and tail calls',
      'wasm-validate --enable-gc --enable-tail-call test.wasm',
    ],
  ],
  options: [],
  features: true,
};

export async function main(args: string[] = cliProcess().argv.slice(2)): Promise<void> {
  if (wantsHelp(args)) {
    console.log(helpText(HELP));
    return;
  }
  args = args.slice();
  const inputs: string[] = [];

  // `--enable-<feature>` / `--disable-<feature>`, plus `--enable-all`
  // (`cli/feature-flags.ts`, shared with `wat2wasm`).
  const flags = new FeatureFlags();
  const features = flags.features;

  let bad = false;
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      inputs.push(arg);
      continue;
    }
    if (flags.apply(arg) !== true) {
      console.error(`wasm-validate: unknown option ${arg}`);
      bad = true;
    }
  }
  if (bad) {
    console.error(flags.help());
    cliExit(1);
  }

  if (inputs.length === 0) {
    console.error('usage: wasm-validate [--enable-all|--enable-<feature>] <input.wasm> [...]');
    cliExit(1);
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

  if (anyFailed) cliExit(1);
}
