/**
 * @module binaryen-ts/tools/wasm-opt
 *
 * TypeScript implementation of the `wasm-opt` optimization tool.
 *
 * `wasm-opt` is the primary CLI tool produced by the upstream Binaryen project.
 * It reads a `.wasm` binary (or `.wat` text), applies optimization passes, and
 * writes an optimized `.wasm` binary.
 *
 * **Native path** (default): `.wasm` → {@link readForPasses} (the wabt-ts reader,
 * then `prepareForPasses`) → {@link PassRunner} → {@link writeWasm} (wabt-ts's writer) → `.wasm`.
 * Pure TypeScript; no subprocess, no external tool. `-S` prints the result as
 * WAT through the one WAT writer.
 *
 * The `--hybrid` path that handed the work to an upstream `wasm-opt`
 * subprocess left the product at 1.7.0 (owner, 2026-09-28): comparison with
 * upstream lives in the repo's `comparison/` suite, never in the tool.
 *
 * **CLI usage**, through the package root's dispatcher (Deno, Node 22.18+, Bun):
 * ```sh
 * deno run -A jsr:@jrmarcum/binaryang wasm-opt input.wasm -o output.wasm -O2
 * node main.ts wasm-opt input.wasm -o output.wasm -O2
 * bun main.ts wasm-opt input.wasm -o output.wasm -O2
 * ```
 *
 * @license MIT
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { readForPasses } from '../ir/prepare.ts';
import { writeWasm, writeWat } from '../ir/write-wasm.ts';
import { WatInputError } from './read-wat.ts';
import { ErrorFormat, formatErrors, hasErrors, unknownLocation } from '../../wabt-ts/core/error.ts';
import { allFeatures } from '../../wabt-ts/core/feature.ts';
import { wat2wasm } from '../../wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../../wabt-ts/tools/wasm-validate.ts';
import {
  defaultPassOptions,
  formatMinifyMap,
  listPasses,
  type MinifyMap,
  optimizeToConvergence,
  PassRunner,
  shrinkPassOptions,
  takeMinifyMap,
} from '../passes/index.ts';
import type { PassOptions } from '../passes/pass.ts';
import { ModuleBuilder } from '../ir/module.ts';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link wasmOpt}.
 * Mirrors the CLI flags accepted by the upstream `wasm-opt` binary.
 */
export interface WasmOptOptions {
  /** Output file path. Use `"-"` for stdout. Default: `"output.wasm"`. */
  output: string;
  /** Optimization level (0-4). Sets the opt / shrink level presets. */
  optimizeLevel: 0 | 1 | 2 | 3 | 4;
  /** Shrink level (0-2). */
  shrinkLevel: 0 | 1 | 2;
  /**
   * Whether to emit WAT text instead of binary WASM.
   * Equivalent to `--emit-text` / `-S`. The text is the optimized BYTES read
   * back and written by the one WAT writer, so it is exactly what `-o` would
   * have written, `--converge` included.
   */
  emitText: boolean;
  /**
   * Whether to validate the input before optimizing and the module after.
   * Equivalent to `--validate`; `--no-validate` skips both, as upstream's
   * `--no-validation`.
   */
  validate: boolean;
  /**
   * Specific passes to run (overrides the default pass sequence for the level).
   * Equivalent to listing pass names on the `wasm-opt` command line.
   */
  passes: string[];
  /** Whether to preserve debug names in the output. Default: `false`. */
  debugInfo: boolean;
  /** Whether to enable closed-world optimizations. Default: `false`. */
  closedWorld: boolean;
  /**
   * Per-pass tuning arguments, forwarded to {@link PassOptions.passArgs}.
   * Keys follow the upstream convention `passname@argname`; values are strings.
   * Example: `{ "inlining@maxSize": "20" }`.
   */
  passArgs: Record<string, string>;
  /**
   * Maximum number of `if` arms partial inlining (Pattern B) will split out
   * of one function. Mirrors upstream `wasm-opt --partial-inlining-ifs N` /
   * `-pii N`. Default `0` (disabled). Setting >= 1 also enables Pattern A.
   * See {@link PassOptions.partialInliningIfs} for full rationale.
   */
  partialInliningIfs: number;
  /**
   * Repeat the pass schedule in rounds until another round saves under 0.1%
   * (averaged over two rounds), keeping the smallest round's output. Upstream
   * `wasm-opt --converge` / `-c`, with a cheaper stopping rule than its fixed
   * point. Default `false`. See {@link optimizeToConvergence}.
   */
  converge: boolean;
  /**
   * Receives the old → new map when a minify pass ran (`--minify-imports`,
   * `--minify-imports-and-exports`, `…-and-modules`) — the names the HOST
   * must apply. The CLI prints it to stdout, as upstream does.
   */
  onMinifyMap?: (map: MinifyMap) => void;
}

const defaults: WasmOptOptions = {
  output: 'output.wasm',
  optimizeLevel: 0,
  shrinkLevel: 0,
  emitText: false,
  validate: true,
  passes: [],
  debugInfo: false,
  closedWorld: false,
  passArgs: {},
  partialInliningIfs: 0,
  converge: false,
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Runs `wasm-opt` on the given input file.
 *
 * Uses the TypeScript pass infrastructure: parse → run passes → encode.
 *
 * @param inputPath - Path to the input `.wasm` or `.wat` file.
 * @param options   - Optimization options.
 * @returns The optimized WASM binary, or its WAT text when `emitText` is `true`.
 */
export async function wasmOpt(
  inputPath: string,
  options: Partial<WasmOptOptions> = {},
): Promise<Uint8Array | string> {
  const opts: WasmOptOptions = { ...defaults, ...options };

  const inputBytes = new Uint8Array(await readFile(inputPath));
  const isWat = inputPath.endsWith('.wat');

  const out = _nativeOptimize(inputBytes, isWat, opts, inputPath);
  // `validate` (default true) runs the engine's structural validator over the
  // optimized binary. Previously this option was parsed but never enforced — a
  // documented behavior that didn't exist. WebAssembly.compile IS a validator,
  // so it gives the option real meaning and a safety net against encoder bugs.
  if (opts.validate) {
    try {
      await WebAssembly.compile(out as BufferSource);
    } catch (e) {
      throw new Error(
        `optimized module failed validation: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  // `-S`: the bytes just validated, as text — read back by the one reader and
  // printed by the one WAT writer.
  return opts.emitText ? writeWat(readForPasses(out)) : out;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Parses CLI args and runs `wasm-opt`.
 * Defaults to `process.argv.slice(2)` when invoked as a CLI script.
 *
 * Works on Deno, Node 22.18+, and Bun via `node:` standard-library imports.
 *
 * @example
 * ```sh
 * deno run -A jsr:@jrmarcum/binaryang wasm-opt input.wasm -o out.wasm -O2
 * node main.ts wasm-opt input.wasm -o out.wasm -O2
 * ```
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  // A bad argument is a one-line diagnostic, not a stack trace.
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(args);
  } catch (e) {
    console.error(`wasm-opt: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (parsed.printAllPasses) {
    for (const name of listPasses()) {
      console.log(name);
    }
    return;
  }

  if (!parsed.input) {
    console.error('Usage: wasm-opt <input.wasm> [options]');
    console.error('  -o <file>            Output file (default: output.wasm)');
    console.error('  -O0 .. -O4           Optimization level');
    console.error('  -Os, -Oz             Size optimization (shrink level 1, 2)');
    console.error('  -c, --converge       Repeat the passes until a round saves < 0.1%');
    console.error('  -S                   Emit WAT text');
    console.error('  --<pass-name>        Run a specific pass by name');
    console.error('  --pass-arg key=val   Per-pass argument (passname@key=val)');
    console.error('  --partial-inlining-ifs N  Enable split inlining (Pattern A/B); -pii N');
    console.error('  --print-all-passes   List all registered passes and exit');
    process.exit(1);
  }

  // A failure is a DIAGNOSTIC, not a stack trace: nothing above this catches,
  // so an unparseable input surfaced as an uncaught exception.
  let result: Uint8Array | string;
  // The minify map goes to stdout, as upstream prints it — to stderr when
  // stdout carries the module itself (`-o -`).
  const toStdout = (parsed.options.output ?? 'output.wasm') !== '-';
  const onMinifyMap = (map: MinifyMap) => {
    const text = formatMinifyMap(map);
    if (toStdout) process.stdout.write(text);
    else process.stderr.write(text);
  };
  try {
    result = await wasmOpt(parsed.input, { ...parsed.options, onMinifyMap });
  } catch (e) {
    console.error(`wasm-opt: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const outPath = parsed.options.output ?? 'output.wasm';

  if (typeof result === 'string') {
    if (outPath === '-') {
      console.log(result);
    } else {
      await writeFile(outPath, result);
      console.log(`Wrote WAT: ${outPath}`);
    }
  } else {
    if (outPath === '-') {
      process.stdout.write(result);
    } else {
      await writeFile(outPath, result);
      console.log(`Wrote WASM: ${outPath} (${result.byteLength} bytes)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: native TypeScript optimization
// ---------------------------------------------------------------------------

/**
 * Refuse an invalid INPUT before the passes see it, as upstream `wasm-opt`
 * does ("error validating input").
 *
 * Without it, an invalid input was optimized and then reported as
 * "optimized module failed validation: WebAssembly.compile(): …" — which
 * blames the optimizer for the user's module, in V8's words, at an offset into
 * bytes the user never had (2026-09-29, open-work 16).
 *
 * A binary's diagnostics carry offsets into the user's own file. A WAT
 * input's would be offsets into the bytes it was assembled to, so they are
 * shown at the filename alone: the message names the instruction, and a
 * position into bytes the user never sees would only mislead.
 */
function validateInput(bytes: Uint8Array, filename: string, isWat: boolean): void {
  const { errors } = wasmValidate(bytes, { filename, features: allFeatures() });
  if (!hasErrors(errors)) return;
  const shown = isWat ? errors.map((e) => ({ ...e, loc: unknownLocation(filename) })) : errors;
  throw new Error(`input module is not valid:\n${formatErrors(shown)}`);
}

function _nativeOptimize(
  inputBytes: Uint8Array,
  isWat: boolean,
  opts: WasmOptOptions,
  filename = '<input>',
): Uint8Array {
  // External WAT goes through wabt-ts to bytes, then the one reader — the one text
  // route (`readWat` is exactly these two steps; they are spelled out here so
  // the input is validated as the bytes the passes will read). binaryen-ts's
  // own WAT parser reads only a folded subset; it rejected the linear text our
  // own `wasm2wat` writes. A binary takes the same reader (One front end,
  // stage 3: binaryen-ts's own decoder is no longer an entry point).
  let input = inputBytes;
  if (isWat) {
    const text = new TextDecoder().decode(inputBytes);
    const r = wat2wasm(text, { filename });
    if (hasErrors(r.errors)) {
      throw new WatInputError(formatErrors(r.errors, ErrorFormat.Long, text));
    }
    input = r.binary;
  }
  // Read first: bytes that do not DECODE throw the reader's `WasmBinaryError`,
  // which is this entry point's contract (`one_reader.test.ts`); only a
  // module that decodes is then judged valid or not.
  const module = readForPasses(input, filename);
  if (opts.validate) validateInput(input, filename, isWat);

  const passOpts: PassOptions = {
    optimizeLevel: opts.optimizeLevel,
    shrinkLevel: opts.shrinkLevel,
    debugInfo: opts.debugInfo,
    closedWorld: opts.closedWorld,
    passArgs: opts.passArgs,
    partialInliningIfs: opts.partialInliningIfs,
  };

  const schedule = (runner: PassRunner): void => {
    if (opts.passes.length > 0) {
      for (const name of opts.passes) {
        runner.add(name);
      }
    } else if (opts.optimizeLevel > 0 || opts.shrinkLevel > 0) {
      runner.addDefaultOptimizationPasses();
    }
  };

  let bytes: Uint8Array;
  if (opts.converge) {
    bytes = optimizeToConvergence(module, passOpts, schedule).bytes;
  } else {
    const runner = new PassRunner(module, passOpts);
    schedule(runner);
    runner.run();
    bytes = writeWasm(module);
  }
  const map = takeMinifyMap(module);
  if (map !== undefined) opts.onMinifyMap?.(map);
  return bytes;
}

// ---------------------------------------------------------------------------
// Arg parser
// ---------------------------------------------------------------------------

/** Result of parsing `wasm-opt` CLI arguments. Exposed for embedders and tests. */
export interface ParsedArgs {
  /** Positional input file path, or `null` if missing. */
  input: string | null;
  /** Parsed option overrides, layered on top of {@link wasmOpt} defaults. */
  options: Partial<WasmOptOptions>;
  /** Whether `--print-all-passes` was supplied. */
  printAllPasses: boolean;
}

/**
 * Recognized long-option names that are NOT pass names.
 * Everything else that starts with `--` is treated as an explicit pass name.
 */
const RECOGNIZED_LONG_FLAGS = new Set([
  '--output',
  '--emit-text',
  '--debug-info',
  '--validate',
  '--no-validate',
  '--closed-world',
  '--converge',
  '--pass-arg',
  '--partial-inlining-ifs',
  '--print-all-passes',
  '--help',
]);

/**
 * Parses `wasm-opt` CLI argv into a {@link ParsedArgs} structure. Exposed so
 * embedders (and tests) can drive the same parser used by the CLI entry point.
 */
export function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    input: null,
    options: {},
    printAllPasses: false,
  };
  const passes: string[] = [];
  const passArgs: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--output') {
      const v = args[++i];
      if (v === undefined || (v.startsWith('-') && v !== '-')) {
        // Without this guard a trailing `-o` (or `-o -O2`) silently fell back
        // to the default `output.wasm` instead of reporting the missing path.
        // `-` alone is STDOUT, which `main` handles: the guard refused it, so
        // `-o -` — `-S -o -` above all — could not be written (2026-09-29).
        throw new Error(`${a} requires an output path argument`);
      }
      result.options.output = v;
    } else if (a === '-O0') {
      result.options.optimizeLevel = 0;
    } else if (a === '-O1') {
      result.options.optimizeLevel = 1;
    } else if (a === '-O2') {
      result.options.optimizeLevel = 2;
    } else if (a === '-O3') {
      result.options.optimizeLevel = 3;
    } else if (a === '-O4') {
      result.options.optimizeLevel = 4;
    } else if (a === '-Os') {
      result.options.optimizeLevel = 2;
      result.options.shrinkLevel = 1;
    } else if (a === '-Oz') {
      result.options.optimizeLevel = 2;
      result.options.shrinkLevel = 2;
    } else if (a === '-S' || a === '--emit-text') {
      result.options.emitText = true;
    } else if (a === '-g' || a === '--debug-info') {
      result.options.debugInfo = true;
    } else if (a === '--hybrid') {
      // Removed at 1.7.0. Refused by name: left to the pass-name fallback it
      // would read as a request for a pass called "hybrid".
      throw new Error(
        '--hybrid was removed in 1.7.0: binaryang no longer runs upstream wasm-opt. ' +
          'Run upstream wasm-opt directly to compare.',
      );
    } else if (a === '--validate') {
      result.options.validate = true;
    } else if (a === '--no-validate') {
      result.options.validate = false;
    } else if (a === '--closed-world') {
      result.options.closedWorld = true;
    } else if (a === '--converge' || a === '-c') {
      result.options.converge = true;
    } else if (a === '--pass-arg') {
      const kv = args[++i];
      if (kv) {
        const eq = kv.indexOf('=');
        if (eq > 0) {
          passArgs[kv.slice(0, eq)] = kv.slice(eq + 1);
        } else {
          passArgs[kv] = '';
        }
      }
    } else if (a === '--partial-inlining-ifs' || a === '-pii') {
      const n = Number.parseInt(args[++i] ?? '', 10);
      if (Number.isFinite(n) && n >= 0) result.options.partialInliningIfs = n;
    } else if (a === '--print-all-passes') {
      result.printAllPasses = true;
    } else if (a !== undefined && a.startsWith('--') && !RECOGNIZED_LONG_FLAGS.has(a)) {
      // Treat unknown --flags as pass names (e.g. --vacuum, --dce)
      passes.push(a.slice(2));
    } else if (a !== undefined && !a.startsWith('-')) {
      result.input = a;
    }
  }

  if (passes.length > 0) result.options.passes = passes;
  if (Object.keys(passArgs).length > 0) result.options.passArgs = passArgs;
  return result;
}

// ---------------------------------------------------------------------------
// Convenience re-exports from pass layer
// ---------------------------------------------------------------------------

export { defaultPassOptions, listPasses, PassRunner, shrinkPassOptions };
export type { PassOptions };

// Allow `ignore unused` for ModuleBuilder re-export (used in JSDoc examples)
export { ModuleBuilder };

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------
//
// For CLI use, invoke the package root, `main.ts` (Deno, Node 22.18+, Bun):
// it is the ONE entry, and runs its dispatcher under `import.meta.main`. No
// tool module self-executes; each exports `main(args)`, registered in the
// root's COMMANDS table. (This said the check was omitted because
// `import.meta.main` was "not yet universal across Node versions"; the 22.18
// floor has it, and the root uses it since 1.6.1.) Callers that need standalone
// execution can import `main` from this module and call it directly.
