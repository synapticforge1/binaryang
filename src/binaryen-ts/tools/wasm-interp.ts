// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/tools/wasm-interp
 *
 * `wasm-interp` (open-work 23, E4): runs a module's exported functions on the
 * interpreter and prints each result, as upstream wabt's tool does — a trap
 * by its message, and a {@link Stop} (a host function the tool was not given,
 * an instruction the interpreter does not run) as what it is, never as a
 * result. An import is a Stop unless `--dummy-import-func` supplies one that
 * returns zeros.
 *
 * ```
 * add(1, 2) => i32:3
 * div(1, 0) => trap: integer divide by zero
 * ```
 *
 * @license MIT
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { readForPasses } from '../ir/prepare.ts';
import { readWat, WatInputError } from './read-wat.ts';
import type { WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { f32BitsOf, f64BitsOf, literalFloat } from '../ir/expressions.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import type { ValueType } from '../../wabt-ts/ir/ir.ts';
import {
  type HostImport,
  Interpreter,
  Stop,
  Trap,
  type Value,
  WasmException,
} from '../interp/interpreter.ts';

/** Options for {@link wasmInterp}. */
export interface WasmInterpOptions {
  /** Run every exported function (`--run-all-exports`), each with zero arguments. */
  runAllExports: boolean;
  /** Run this export (`--run-export`), with {@link args}. */
  runExport?: string | undefined;
  /** Arguments for {@link runExport}, as written (`--argument`): `3`, `-1`, `2.5`, `nan`. */
  args: string[];
  /** Supply every imported function as one returning zeros (`--dummy-import-func`). */
  dummyImportFunc: boolean;
  /** Instructions one call may run before stopping. */
  fuel: number;
}

const defaults: WasmInterpOptions = {
  runAllExports: false,
  args: [],
  dummyImportFunc: false,
  fuel: 1_000_000_000,
};

/** One call's line of output. */
export interface Invocation {
  name: string;
  args: Value[];
  outcome: { values: Value[] } | { trap: string } | { stop: string } | { exception: string };
}

/** A written argument as a value of `type`; zero when `text` is absent. */
function argValue(type: ValueType, text: string | undefined): Value {
  const t = text ?? '0';
  switch (type) {
    case ValType.I32:
      return { type, value: Number(BigInt.asIntN(32, BigInt(t))) };
    case ValType.I64:
      return { type, value: BigInt.asIntN(64, BigInt(t)) };
    case ValType.F32:
      return { type, bits: f32BitsOf(Number(t)) };
    case ValType.F64:
      return { type, bits: f64BitsOf(Number(t)) };
    default:
      if (text !== undefined) throw new Error(`cannot pass an argument of type ${String(type)}`);
      return { type: 'ref', kind: 'null' };
  }
}

/** A value as the tool prints it: `i32:3`, `f64:2.5`, `v128:0x…`, `ref.null`. */
export function showValue(v: Value): string {
  switch (v.type) {
    case ValType.I32:
      return `i32:${v.value}`;
    case ValType.I64:
      return `i64:${v.value}`;
    case ValType.F32:
      return `f32:${literalFloat(v)}`;
    case ValType.F64:
      return `f64:${literalFloat(v)}`;
    case ValType.V128:
      return `v128:0x${[...v.bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    default:
      return `ref.${v.kind}`;
  }
}

/** A result's line of output. */
export function showInvocation(inv: Invocation): string {
  const call = `${inv.name}(${inv.args.map(showValue).join(', ')})`;
  const o = inv.outcome;
  if ('values' in o) return `${call} => ${o.values.map(showValue).join(', ')}`;
  if ('trap' in o) return `${call} => trap: ${o.trap}`;
  if ('exception' in o) return `${call} => uncaught exception: ${o.exception}`;
  return `${call} => stopped: ${o.stop}`;
}

/** Runs the exports `options` ask for on `module`; one {@link Invocation} each. */
export function interpModule(
  module: WasmModule,
  options: Partial<WasmInterpOptions> = {},
): Invocation[] {
  const opts: WasmInterpOptions = { ...defaults, ...options };
  const imports = (m: string, f: string): HostImport | undefined => {
    const imp = module.imports.find((i) => i.module === m && i.field === f);
    if (imp?.kind !== ExternalKind.Func || !opts.dummyImportFunc) return undefined;
    const results = imp.func.sig.results;
    return { kind: 'func', call: () => results.map((t) => argValue(t, undefined)) };
  };
  const inst = new Interpreter(module, { imports, fuel: opts.fuel });
  const exports = module.exports.filter((e) => e.kind === ExternalKind.Func);
  const targets = opts.runExport !== undefined
    ? exports.filter((e) => e.name === opts.runExport)
    : opts.runAllExports
    ? exports
    : [];
  if (opts.runExport !== undefined && targets.length === 0) {
    throw new Error(`no exported function "${opts.runExport}"`);
  }
  const out: Invocation[] = [];
  for (const ex of targets) {
    const fn = inst.functionIndex(ex.var);
    const sig = functionSignature(module, fn);
    const given = ex.name === opts.runExport ? opts.args : [];
    const args = sig.map((t, i) => argValue(t, given[i]));
    inst.refuel(opts.fuel);
    let outcome: Invocation['outcome'];
    try {
      outcome = { values: inst.invoke(ex.name, args) };
    } catch (e) {
      if (e instanceof Trap) outcome = { trap: e.message };
      else if (e instanceof Stop) outcome = { stop: e.message };
      else if (e instanceof WasmException) outcome = { exception: e.tag.name };
      else throw e;
    }
    out.push({ name: ex.name, args, outcome });
  }
  return out;
}

/** The parameter types of function `index` (index space: imports first). */
function functionSignature(module: WasmModule, index: number): ValueType[] {
  let k = 0;
  for (const imp of module.imports) {
    if (imp.kind !== ExternalKind.Func) continue;
    if (k === index) return imp.func.sig.params;
    k++;
  }
  const fn = module.functions[index - k];
  if (fn === undefined) throw new Error(`no function ${index}`);
  return fn.sig.params;
}

/** Reads `inputPath` (`.wat` or binary) and runs it. */
export async function wasmInterp(
  inputPath: string,
  options: Partial<WasmInterpOptions> = {},
): Promise<Invocation[]> {
  const bytes = new Uint8Array(await readFile(inputPath));
  const module = inputPath.endsWith('.wat')
    ? readWat(new TextDecoder().decode(bytes), inputPath)
    : readForPasses(bytes, inputPath);
  return interpModule(module, options);
}

function usage(): void {
  console.error('Usage: wasm-interp <input.wasm|.wat> [options]');
  console.error('  --run-all-exports          Run every exported function with zero arguments');
  console.error('  --run-export=NAME          Run one export');
  console.error('  --argument=V               An argument for --run-export (repeat, in order)');
  console.error('  --dummy-import-func        Every imported function returns zeros');
  console.error('  --fuel=N                   Instructions one call may run');
}

/** The CLI: parses `args` and runs {@link wasmInterp}. */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  let input: string | undefined;
  const options: Partial<WasmInterpOptions> = { args: [] };
  for (const a of args) {
    if (a === '--run-all-exports') options.runAllExports = true;
    else if (a.startsWith('--run-export=')) options.runExport = a.slice(13);
    else if (a.startsWith('--argument=')) options.args!.push(a.slice(11));
    else if (a === '--dummy-import-func') options.dummyImportFunc = true;
    else if (a.startsWith('--fuel=')) options.fuel = Number(a.slice(7));
    else if (a.startsWith('-')) {
      console.error(`wasm-interp: unknown option ${a}`);
      usage();
      process.exit(1);
    } else input = a;
  }
  if (input === undefined) {
    usage();
    process.exit(1);
  }
  let invocations: Invocation[];
  try {
    invocations = await wasmInterp(input, options);
  } catch (e) {
    console.error(
      `wasm-interp: ${e instanceof WatInputError || e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  }
  for (const inv of invocations) console.log(showInvocation(inv));
}
