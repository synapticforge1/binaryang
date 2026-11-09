// Based on WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/tools/wasm-objdump.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `wasm-objdump` — inspect the section layout and item counts of a `.wasm`
 * binary, similar to upstream wabt's `wasm-objdump`.
 *
 * Library entry point ({@link wasmObjdump}) returns `{ text, errors, result }`
 * with a human-readable section dump. Section counts are derived from the
 * decoded `module.*` arrays rather than `SectionMeta.count` (the reader
 * does not currently populate the meta-count field).
 *
 * CLI form, through the package root's dispatcher (`main.ts`):
 *
 * ```sh
 * deno run -A jsr:@jrmarcum/binaryang wasm-objdump input.wasm
 * ```
 *
 * Library usage:
 *
 * ```ts
 * import { wasmObjdump } from "jsr:@jrmarcum/binaryang/wasm-objdump";
 *
 * const bytes = await Deno.readFile("module.wasm");
 * const { text } = wasmObjdump(bytes, { details: true });
 * console.log(text);
 * ```
 */

import { indexOf, locOf, recGroups, valueTypeName } from '../ir/ir.ts';
import { withEmptyRecGroups } from '../ir/fidelity.ts';
import { readBinaryIr } from '../reader/binary-reader.ts';
import { isRealName } from '../ir/made-up-names.ts';
import { Result } from '../core/result.ts';
import {
  formatErrors,
  hasErrors,
  isStackExhausted,
  makeErrorList,
  nestingTooDeep,
} from '../core/error.ts';
import { BinarySection, binarySectionName, ExternalKind } from '../core/binary.ts';
import type { ErrorList } from '../core/error.ts';
import type { Limits, Module, SectionMeta, ValueType, Var } from '../ir/ir.ts';
import { cliExit, cliProcess, cliRead } from '../cli/io.ts';
import { helpText, type ToolHelp, wantsHelp } from '../cli/help.ts';
import { countImports } from '../ir/ir.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link wasmObjdump}. */
export interface WasmObjdumpOptions {
  /** Source filename shown in headers. Default: `'<input>'`. */
  filename?: string;
  /** Show section headers table. Default: `true`. */
  headers?: boolean;
  /** Show section detail (imports, exports, functions, …). Default: `false`. */
  details?: boolean;
}

/** Return value from {@link wasmObjdump}. */
export interface WasmObjdumpResult {
  /** The rendered text dump. */
  text: string;
  /** Accumulated decode errors. */
  errors: ErrorList;
  /** `Result.Ok` on success; `Result.Error` if the binary fails to decode. */
  result: Result;
}

/**
 * Dump section information from a wasm binary.
 *
 * Output mirrors the format of the `wasm-objdump` C++ tool.
 */
export function wasmObjdump(
  binary: Uint8Array,
  opts: WasmObjdumpOptions = {},
): WasmObjdumpResult {
  // Too deeply nested to walk: REPORTED, never a bare RangeError (open-work 13).
  try {
    return dump(binary, opts);
  } catch (e) {
    if (!isStackExhausted(e)) throw e;
    return { text: '', errors: nestingTooDeep(opts.filename), result: Result.Error };
  }
}

function dump(binary: Uint8Array, opts: WasmObjdumpOptions): WasmObjdumpResult {
  const errors = makeErrorList();
  const filename = opts.filename ?? '<input>';

  const module = readBinaryIr(binary, errors, { filename, readDebugNames: true });

  if (hasErrors(errors)) {
    return { text: '', errors, result: Result.Error };
  }

  const lines: string[] = [];
  lines.push(`${filename}:\tfile format wasm 0x1`);
  lines.push('');

  const showHeaders = opts.headers !== false;
  const showDetails = opts.details === true;

  if (showHeaders) {
    lines.push('Sections:');
    lines.push('');
    for (const meta of module.sectionMeta) {
      const name = sectionLabel(meta, module);
      const start = meta.offset;
      const end = meta.offset + meta.size;
      const count = sectionCount(meta, module);
      const countStr = meta.section === BinarySection.Custom || meta.section === BinarySection.Start
        ? ''
        : ` count: ${count}`;
      lines.push(
        `  ${name.padStart(12)} start=0x${hex8(start)} end=0x${hex8(end)} (size=0x${
          hex8(meta.size)
        })${countStr}`,
      );
    }
    lines.push('');
  }

  if (showDetails) {
    lines.push('Section Details:');
    lines.push('');
    appendDetails(lines, module);
  }

  return { text: lines.join('\n'), errors, result: Result.Ok };
}

// ---------------------------------------------------------------------------
// Detail output
// ---------------------------------------------------------------------------

// Upstream's `-x` lines, field for field (`binary-reader-objdump.cc`, wabt 1.0.41): a function or
// tag result list is `nil`, one type, or `(a, b)`; limits print `max=` only when there is one and
// ` i64` for a 64-bit table or memory; a global says `mutable=0|1`; a function and a tag carry
// their type index as `sig=`. CL7 (2026-11-05) — the lines were `-> ()`, `sig=?`, `<$add>`, and
// limits without their maximum or address type.
function appendDetails(lines: string[], m: Module): void {
  const funcNames = functionNames(m);
  const tagNames = tagNamesOf(m);

  // Type section
  if (m.types.length > 0) {
    lines.push(`Type[${m.types.length}]:`);
    for (const [i, t] of m.types.entries()) {
      if (t.kind === 'func') {
        const params = t.sig.params.map(valueTypeName).join(', ');
        lines.push(` - type[${i}] (${params}) -> ${resultList(t.sig.results)}`);
      } else {
        lines.push(` - type[${i}] (${t.kind})`);
      }
    }
  }

  // Import section
  if (m.imports.length > 0) {
    lines.push(`Import[${m.imports.length}]:`);
    let fi = 0, ti = 0, mi = 0, gi = 0, tgi = 0;
    for (const imp of m.imports) {
      const from = ` <- ${imp.module}.${imp.field}`;
      switch (imp.kind) {
        case ExternalKind.Func: {
          const i = fi++;
          lines.push(` - func[${i}] sig=${sigOf(imp.func.typeVar)}${named(funcNames[i])}${from}`);
          break;
        }
        case ExternalKind.Table:
          lines.push(
            ` - table[${ti++}] type=${valueTypeName(imp.table.elemType)} initial=${
              limitsText(imp.table.limits)
            }${from}`,
          );
          break;
        case ExternalKind.Memory:
          lines.push(` - memory[${mi++}] pages: initial=${limitsText(imp.memory.limits)}${from}`);
          break;
        case ExternalKind.Global:
          lines.push(
            ` - global[${gi++}] ${valueTypeName(imp.global.type)} mutable=${
              imp.global.mutable ? 1 : 0
            }${from}`,
          );
          break;
        case ExternalKind.Tag: {
          const i = tgi++;
          lines.push(` - tag[${i}] sig=${sigOf(imp.tag.typeVar)}${named(tagNames[i])}${from}`);
          break;
        }
      }
    }
  }

  // Function section
  const totalFuncImports = countImports(m, ExternalKind.Func);
  if (m.functions.length > 0) {
    lines.push(`Function[${m.functions.length}]:`);
    for (const [i, f] of m.functions.entries()) {
      const index = totalFuncImports + i;
      lines.push(` - func[${index}] sig=${sigOf(f.typeVar)}${named(funcNames[index])}`);
    }
  }

  // Export section: upstream names only an exported FUNCTION.
  if (m.exports.length > 0) {
    lines.push(`Export[${m.exports.length}]:`);
    for (const exp of m.exports) {
      const kindStr = extKindName(exp.kind);
      const idx = indexOf(exp.var);
      const name = exp.kind === ExternalKind.Func && idx !== undefined ? named(funcNames[idx]) : '';
      lines.push(` - ${kindStr}[${idx ?? '?'}]${name} -> "${exp.name}"`);
    }
  }
}

/**
 * Every function's name as upstream's prepass sets it, a later source overriding an earlier: an
 * import is `module.field`, an export its export name, and the name section has the last word.
 * Only a REAL name-section name counts (owner decision 4; M7c3b b1b) — the reader makes one up for
 * every function the section did not name, and that one is not the module's.
 */
function functionNames(m: Module): (string | undefined)[] {
  const names: (string | undefined)[] = [];
  const all = [
    ...m.imports.flatMap((imp) => (imp.kind === ExternalKind.Func ? [imp.func] : [])),
    ...m.functions,
  ];
  let fi = 0;
  for (const imp of m.imports) {
    if (imp.kind === ExternalKind.Func) names[fi++] = `${imp.module}.${imp.field}`;
  }
  for (const exp of m.exports) {
    const idx = indexOf(exp.var);
    if (exp.kind === ExternalKind.Func && idx !== undefined) names[idx] = exp.name;
  }
  for (const [i, f] of all.entries()) {
    if (isRealName(m.explicitNames, m.explicitNames?.functions, f.name)) names[i] = bare(f.name);
  }
  return names;
}

/** Each imported tag's name: `module.field`, or the name section's real name. */
function tagNamesOf(m: Module): (string | undefined)[] {
  const names: (string | undefined)[] = [];
  let ti = 0;
  for (const imp of m.imports) {
    if (imp.kind !== ExternalKind.Tag) continue;
    const real = isRealName(m.explicitNames, m.explicitNames?.tags, imp.tag.name);
    names[ti++] = real ? bare(imp.tag.name) : `${imp.module}.${imp.field}`;
  }
  return names;
}

/** An IR name without the text format's `$`, as upstream prints a name-section entry. */
function bare(name: string): string {
  return name.startsWith('$') ? name.slice(1) : name;
}

function named(name: string | undefined): string {
  return name === undefined || name === '' ? '' : ` <${name}>`;
}

function sigOf(typeVar: Var | undefined): string {
  const i = typeVar === undefined ? undefined : indexOf(typeVar);
  return i === undefined ? '?' : String(i);
}

function resultList(results: readonly ValueType[]): string {
  if (results.length === 0) return 'nil';
  if (results.length === 1) return valueTypeName(results[0]!);
  return `(${results.map(valueTypeName).join(', ')})`;
}

/** `initial[ max=N][ shared][ i64][ (pagesize N)]`, the text after upstream's `initial=`. */
function limitsText(l: Limits): string {
  let s = String(l.initial);
  if (l.max !== undefined) s += ` max=${l.max}`;
  if (l.isShared) s += ' shared';
  if (l.is64) s += ' i64';
  if (l.pageSizeLog2 !== undefined && l.pageSizeLog2 !== 16) {
    s += ` (pagesize ${2 ** l.pageSizeLog2})`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex8(n: number): string {
  return n.toString(16).padStart(8, '0');
}

function sectionLabel(meta: SectionMeta, m: Module): string {
  if (meta.section === BinarySection.Custom) {
    // Match by byte offset — custom sections that were parsed (e.g. name
    // section with readDebugNames:true) won't be in m.customSections; fall back.
    const custom = m.customSections.find((c) =>
      locOf(c).offset >= meta.offset && locOf(c).offset < meta.offset + meta.size
    );
    return custom ? `"${custom.name}"` : 'custom';
  }
  return binarySectionName(meta.section);
}

function sectionCount(meta: SectionMeta, m: Module): number {
  switch (meta.section) {
    case BinarySection.Type:
      // The section is a vector of REC GROUPS: `(rec (type) (type))` is one entry, an empty
      // `(rec)` is one too. 🔧 It was `m.types.length`, the TYPE count — 5 for a module whose
      // section says 4, as `wasm-tools objdump` reports (divergence CL8).
      return withEmptyRecGroups(recGroups(m.types), m.fidelity, m.types.length).length;
    case BinarySection.Import:
      return m.imports.length;
    case BinarySection.Function:
      return m.functions.length;
    case BinarySection.Table:
      return m.tables.length;
    case BinarySection.Memory:
      return m.memories.length;
    case BinarySection.Global:
      return m.globals.length;
    case BinarySection.Export:
      return m.exports.length;
    case BinarySection.Elem:
      return m.elements.length;
    case BinarySection.Code:
      return m.functions.length;
    case BinarySection.Data:
      return m.dataSegments.length;
    case BinarySection.Tag:
      return m.tags.length;
    default:
      return 0;
  }
}

function extKindName(kind: ExternalKind): string {
  switch (kind) {
    case ExternalKind.Func:
      return 'func';
    case ExternalKind.Table:
      return 'table';
    case ExternalKind.Memory:
      return 'memory';
    case ExternalKind.Global:
      return 'global';
    case ExternalKind.Tag:
      return 'tag';
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP: ToolHelp = {
  usage: 'wasm-objdump [options] <input.wasm> [...]',
  description: 'Print information about the contents of WebAssembly binaries.',
  examples: [
    ['the section headers', 'wasm-objdump test.wasm'],
    ['the headers and every section in detail', 'wasm-objdump -h -x test.wasm'],
  ],
  options: [
    ['-h, --headers', 'Print the section headers (the default when no other option is given)'],
    ['-x, --details', 'Print the contents of every section'],
    [
      '-d, --disassemble',
      "Upstream's disassembly of the code section — NOT SUPPORTED YET: refused (exit 1). " +
      'Until 3.0.0 -d printed the details; use -x',
    ],
  ],
};

/**
 * CLI entry point for `wasm-objdump`, registered in the top-level command dispatcher.
 *
 * Reads `process.argv` by default so it runs unchanged on Deno, Node and Bun;
 * pass `args` explicitly to drive it from a test or another tool.
 */
export async function main(args: string[] = cliProcess().argv.slice(2)): Promise<void> {
  if (wantsHelp(args)) {
    console.log(helpText(HELP));
    return;
  }
  args = args.slice();
  const inputs: string[] = [];
  let details = false;
  let headers: boolean | undefined;
  let bad = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-x' || arg === '--details') {
      details = true;
    } else if (arg === '-d' || arg === '--disassemble') {
      // CL7 step 2 (owner, 2026-11-05: upstream's flags; landed in 3.0.0): `-d` is upstream's
      // `--disassemble`. binaryang has no disassembler yet, so it is REFUSED — never silently
      // another meaning. Before 3.0.0 `-d` printed the details, as `-x` does (2.2.x).
      console.error(
        `wasm-objdump: ${arg} (disassembly) is not supported yet; use -x for the section details`,
      );
      bad = true;
    } else if (arg === '-h' || arg === '--headers') {
      headers = true;
    } else if (!arg.startsWith('-')) {
      inputs.push(arg);
    } else {
      // An option this tool does not have is an ERROR, never skipped (workspace contract S2:
      // "an error in syntax of the CLI options or commands throws"; code lens pass 2,
      // 2026-10-28: `-x`, upstream's details flag and not yet ours, silently printed the headers).
      console.error(`wasm-objdump: unknown option ${arg}`);
      bad = true;
    }
  }
  if (bad) cliExit(1);
  // Show what was asked for, as upstream does: `-x` alone is the details
  // alone, `-h -x` both, and no flag the headers. (`headers` started `true`
  // here, so `-h` re-set a default and could never mean anything.)
  headers ??= !details;

  if (inputs.length === 0) {
    console.error('usage: wasm-objdump [-h] [-x] <input.wasm> [...]');
    cliExit(1);
  }

  let anyFailed = false;

  for (const input of inputs) {
    const binary = await cliRead('wasm-objdump', input);
    const { text, errors, result } = wasmObjdump(binary, {
      filename: input,
      headers,
      details,
    });

    if (errors.length > 0) {
      console.error(formatErrors(errors));
    }
    if (result !== Result.Ok) {
      anyFailed = true;
    } else {
      console.log(text);
    }
  }

  if (anyFailed) cliExit(1);
}
