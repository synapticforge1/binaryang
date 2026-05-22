// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { readBinaryIr } from '../reader/binary-reader.ts';
import { Result } from '../core/result.ts';
import { makeErrorList, hasErrors, formatErrors } from '../core/error.ts';
import { BinarySection, binarySectionName, ExternalKind } from '../core/binary.ts';
import type { ErrorList } from '../core/error.ts';
import type { Module, SectionMeta } from '../ir/ir.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WasmObjdumpOptions {
  /** Source filename shown in headers. Default: '<input>'. */
  filename?: string;
  /** Show section headers table. Default: true. */
  headers?: boolean;
  /** Show section detail (imports, exports, functions, …). Default: false. */
  details?: boolean;
}

export interface WasmObjdumpResult {
  text: string;
  errors: ErrorList;
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
        `  ${name.padStart(12)} start=0x${hex8(start)} end=0x${hex8(end)} (size=0x${hex8(meta.size)})${countStr}`,
      );
    }
    lines.push('');
  }

  if (showDetails) {
    appendDetails(lines, module);
  }

  return { text: lines.join('\n'), errors, result: Result.Ok };
}

// ---------------------------------------------------------------------------
// Detail output
// ---------------------------------------------------------------------------

function appendDetails(lines: string[], m: Module): void {
  // Type section
  if (m.types.length > 0) {
    lines.push(`Type[${m.types.length}]:`);
    for (const [i, t] of m.types.entries()) {
      if (t.kind === 'func') {
        const params = t.sig.params.map(typeName).join(', ');
        const results = t.sig.results.map(typeName).join(', ');
        lines.push(` - type[${i}] (${params}) -> (${results})`);
      } else {
        lines.push(` - type[${i}] (${t.kind})`);
      }
    }
    lines.push('');
  }

  // Import section
  if (m.imports.length > 0) {
    lines.push(`Import[${m.imports.length}]:`);
    let fi = 0, ti = 0, mi = 0, gi = 0;
    for (const imp of m.imports) {
      switch (imp.kind) {
        case ExternalKind.Func:
          lines.push(` - func[${fi++}] sig=? <${imp.module}.${imp.field}> <- ${imp.module}.${imp.field}`);
          break;
        case ExternalKind.Table:
          lines.push(` - table[${ti++}] type=${typeName(imp.table.elemType)} <- ${imp.module}.${imp.field}`);
          break;
        case ExternalKind.Memory:
          lines.push(` - memory[${mi++}] pages: initial=${imp.memory.limits.initial} <- ${imp.module}.${imp.field}`);
          break;
        case ExternalKind.Global:
          lines.push(` - global[${gi++}] ${typeName(imp.global.type)}${imp.global.mutable ? ' mutable' : ''} <- ${imp.module}.${imp.field}`);
          break;
        case ExternalKind.Tag:
          lines.push(` - tag <- ${imp.module}.${imp.field}`);
          break;
      }
    }
    lines.push('');
  }

  // Function section
  const totalFuncImports = m.numFuncImports;
  if (m.funcs.length > 0) {
    lines.push(`Function[${m.funcs.length}]:`);
    for (const [i, f] of m.funcs.entries()) {
      const name = f.name ? ` <${f.name}>` : '';
      lines.push(` - func[${totalFuncImports + i}]${name}`);
    }
    lines.push('');
  }

  // Export section
  if (m.exports.length > 0) {
    lines.push(`Export[${m.exports.length}]:`);
    for (const exp of m.exports) {
      const kindStr = extKindName(exp.kind);
      const idx = exp.var.kind === 'index' ? exp.var.value : '?';
      lines.push(` - ${kindStr}[${idx}] -> "${exp.name}"`);
    }
    lines.push('');
  }
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
    // section with readDebugNames:true) won't be in m.customs; fall back.
    const custom = m.customs.find((c) => c.loc.offset >= meta.offset && c.loc.offset < meta.offset + meta.size);
    return custom ? `"${custom.name}"` : 'custom';
  }
  return binarySectionName(meta.section);
}

function sectionCount(meta: SectionMeta, m: Module): number {
  switch (meta.section) {
    case BinarySection.Type:     return m.types.length;
    case BinarySection.Import:   return m.imports.length;
    case BinarySection.Function: return m.funcs.length;
    case BinarySection.Table:    return m.tables.length;
    case BinarySection.Memory:   return m.memories.length;
    case BinarySection.Global:   return m.globals.length;
    case BinarySection.Export:   return m.exports.length;
    case BinarySection.Elem:     return m.elemSegments.length;
    case BinarySection.Code:     return m.funcs.length;
    case BinarySection.Data:     return m.dataSegments.length;
    case BinarySection.Tag:      return m.tags.length;
    default:                     return 0;
  }
}

function typeName(t: number): string {
  switch (t) {
    case 0x7f: return 'i32';
    case 0x7e: return 'i64';
    case 0x7d: return 'f32';
    case 0x7c: return 'f64';
    case 0x7b: return 'v128';
    case 0x70: return 'funcref';
    case 0x6f: return 'externref';
    default:   return `0x${t.toString(16)}`;
  }
}

function extKindName(kind: ExternalKind): string {
  switch (kind) {
    case ExternalKind.Func:   return 'func';
    case ExternalKind.Table:  return 'table';
    case ExternalKind.Memory: return 'memory';
    case ExternalKind.Global: return 'global';
    case ExternalKind.Tag:    return 'tag';
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = Deno.args.slice();
  const inputs: string[] = [];
  let details = false;
  let headers = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-d' || arg === '--details') {
      details = true;
    } else if (arg === '-h' || arg === '--headers') {
      headers = true;
    } else if (arg && !arg.startsWith('-')) {
      inputs.push(arg);
    }
  }

  if (inputs.length === 0) {
    console.error('usage: wasm-objdump [-d] <input.wasm> [...]');
    Deno.exit(1);
  }

  let anyFailed = false;

  for (const input of inputs) {
    const binary = await Deno.readFile(input);
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

  if (anyFailed) Deno.exit(1);
}
