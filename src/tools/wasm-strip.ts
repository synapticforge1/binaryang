// Based on WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/tools/wasm-strip.cc
// Copyright 2018 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

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
 * CLI form, through the package root's dispatcher (`main.ts`):
 *
 * ```sh
 * deno run -A jsr:@jrmarcum/binaryang wasm-strip input.wasm -o stripped.wasm
 * ```
 *
 * Library usage:
 *
 * ```ts
 * import { wasmStrip } from "jsr:@jrmarcum/binaryang/wasm-strip";
 *
 * const original = await Deno.readFile("module.wasm");
 * const { binary } = wasmStrip(original);
 * await Deno.writeFile("stripped.wasm", binary);
 * ```
 *
 * Pipeline, as upstream's `wasm-strip.cc`: the module is DECODED (so malformed input is reported
 * in `errors`, never stripped blind), then the custom sections to remove are cut out of the
 * input and every other byte is COPIED — nothing is re-encoded. A re-encoding would write
 * LLVM's relocation-padded LEBs minimally, changing the code and leaving any kept section that
 * names code offsets (`reloc.CODE`, `.debug_line`) stale (open-work 45, divergence ST1).
 */

import { readBinaryIr } from '../reader/binary-reader.ts';
import type { ReadBinaryOptions } from '../reader/binary-reader.ts';
import { Result } from '../core/result.ts';
import {
  addError,
  formatErrors,
  hasErrors,
  makeErrorList,
  unknownLocation,
} from '../core/error.ts';
import type { ErrorList } from '../core/error.ts';
import { cliExit, cliProcess, cliRead, cliWrite } from '../cli/io.ts';
import { helpText, type ToolHelp, wantsHelp } from '../cli/help.ts';

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
 * Pass `sections` to name the ones to remove; every other custom section is
 * kept, in the position it held in the input.
 */
export function wasmStrip(binary: Uint8Array, opts: WasmStripOptions = {}): WasmStripResult {
  const errors = makeErrorList();

  // Read without parsing the name section so it stays in module.customSections.
  const readOpts: ReadBinaryOptions = { readDebugNames: false };
  if (opts.filename !== undefined) readOpts.filename = opts.filename;

  // The decode is the contract, not the source of the output: malformed input is reported here
  // and never stripped blind (T13.29). Its result is not written back.
  readBinaryIr(binary, errors, readOpts);

  if (hasErrors(errors)) {
    return { binary: new Uint8Array(0), errors, result: Result.Error };
  }

  // INTENT: `opts.sections` names the sections to REMOVE, not the ones to keep — see
  // `WasmStripOptions.sections`. With none named, every custom section goes: the `name`
  // section and S7's `binaryang.text-form` are custom sections like any other here.
  const remove = opts.sections ? new Set(opts.sections) : undefined;
  const stripped = removeCustomSections(binary, remove);
  if (stripped === undefined) {
    // The reader accepted the framing, so this cannot be reached by any input it decodes; if
    // the two ever disagree, report it rather than emit bytes the walk could not justify.
    addError(errors, unknownLocation(), 'wasm-strip: the section framing could not be walked');
    return { binary: new Uint8Array(0), errors, result: Result.Error };
  }
  return { binary: stripped, errors, result: Result.Ok };
}

/**
 * Cuts custom sections out of `binary` (all of them, or those named in `remove`) and copies every
 * other byte verbatim, in its position: the 8-byte header, every known section, every kept custom
 * section. Returns `undefined` if a section header runs past the end.
 */
function removeCustomSections(
  binary: Uint8Array,
  remove: Set<string> | undefined,
): Uint8Array | undefined {
  const readU32 = (p: number): [number, number] | undefined => {
    let result = 0;
    for (let i = 0; i < 5; i++) {
      if (p + i >= binary.length) return undefined;
      const b = binary[p + i]!;
      result += (b & 0x7f) * 2 ** (7 * i);
      if ((b & 0x80) === 0) return [result, p + i + 1];
    }
    return undefined;
  };
  const kept: Uint8Array[] = [binary.subarray(0, 8)];
  let length = 8;
  let p = 8;
  while (p < binary.length) {
    const start = p;
    const id = binary[p]!;
    const size = readU32(p + 1);
    if (size === undefined) return undefined;
    const end = size[1] + size[0];
    if (end > binary.length) return undefined;
    let drop = false;
    if (id === 0) {
      const nameLen = readU32(size[1]);
      if (nameLen === undefined || nameLen[1] + nameLen[0] > end) return undefined;
      const name = new TextDecoder().decode(binary.subarray(nameLen[1], nameLen[1] + nameLen[0]));
      drop = remove === undefined || remove.has(name);
    }
    if (!drop) {
      kept.push(binary.subarray(start, end));
      length += end - start;
    }
    p = end;
  }
  const out = new Uint8Array(length);
  let o = 0;
  for (const k of kept) {
    out.set(k, o);
    o += k.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * CLI entry point for `wasm-strip`, registered in the top-level command dispatcher.
 *
 * Reads `process.argv` by default so it runs unchanged on Deno, Node and Bun;
 * pass `args` explicitly to drive it from a test or another tool.
 */
const HELP: ToolHelp = {
  usage: 'wasm-strip [options] <input.wasm>',
  description:
    'Remove custom sections from a WebAssembly binary: all of them (the name section included),\nor only those named.',
  examples: [
    ['remove every custom section from test.wasm, in place', 'wasm-strip test.wasm'],
    ['remove only the name section, writing out.wasm', 'wasm-strip test.wasm -s name -o out.wasm'],
  ],
  options: [
    ['-o, --output <file>', 'Output file (default: overwrite the input)'],
    ['-s, --section <name>', 'Remove only this custom section (repeat for more)'],
  ],
};

export async function main(args: string[] = cliProcess().argv.slice(2)): Promise<void> {
  if (wantsHelp(args)) {
    console.log(helpText(HELP));
    return;
  }
  args = args.slice();
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
    cliExit(1);
  }

  const binary = await cliRead('wasm-strip', input);
  const stripOpts: WasmStripOptions = { filename: input };
  if (stripSections.length > 0) stripOpts.sections = stripSections;
  const { binary: stripped, errors, result } = wasmStrip(binary, stripOpts);

  if (errors.length > 0) {
    console.error(formatErrors(errors));
  }
  if (result !== Result.Ok) {
    cliExit(1);
  }

  const dest = output ?? input;
  await cliWrite('wasm-strip', dest, stripped);
}
