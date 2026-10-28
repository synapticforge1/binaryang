// Based on WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/tools/wasm-interp.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module tools/wasm-interp
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

import { readValidForPasses } from '../ir/prepare.ts';
import { readValidWat, WatInputError } from './read-wat.ts';
import type { WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { f32BitsOf, f64BitsOf, literalFloat } from '../ir/expressions.ts';
import { ExternalKind } from '../core/binary.ts';
import { funcAt, type ValueType, varIndex } from '../ir/ir.ts';
import {
  type HostImport,
  Interpreter,
  Stop,
  Trap,
  type Value,
  WasmException,
} from '../interp/interpreter.ts';
import { cliExit, cliProcess, fsRead } from '../cli/io.ts';
import { helpText, type ToolHelp, wantsHelp } from '../cli/help.ts';

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
  /**
   * Milliseconds of running before each check for a loop that provably never
   * exits (`--hang-check=SECONDS`; `null` for none, `--no-hang-check`). See
   * `InterpreterOptions.hangCheck`.
   */
  hangCheck: number | null;
}

const defaults: WasmInterpOptions = {
  runAllExports: false,
  args: [],
  dummyImportFunc: false,
  fuel: 1_000_000_000,
  hangCheck: 2_000,
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
    // 🔧 A v128 zero. It fell to the reference default below, so every export
    // taking a v128 — and every stand-in import returning one — got `ref.null`,
    // and the run stopped as `invalid: expected a v128 operand` on a valid module
    // (open-work 13, the code lens: the spec's relaxed-SIMD modules, run whole).
    case ValType.V128:
      if (text !== undefined && text !== '0') {
        throw new Error(`cannot pass an argument of type v128 (only the zero default)`);
      }
      return { type, bytes: new Uint8Array(16) };
    default:
      if (text !== undefined) throw new Error(`cannot pass an argument of type ${String(type)}`);
      // 🔧 A NON-NULLABLE reference has no default. `ref.null` was passed for
      // `(ref extern)`, and a stand-in import returned it for one: the run went
      // on with a value the type forbids, and printed results no valid
      // execution has (open-work 13, the code lens: spec `local_init`,
      // `type-equivalence`, against V8). The export is not run.
      if (typeof type === 'object' && type !== null && 'nullable' in type && !type.nullable) {
        throw new Stop('unsupported', 'no default value for a non-nullable reference');
      }
      return { type: 'ref', kind: 'null' };
  }
}

/** A value as the tool prints it: `i32:3`, `f64:2.5`, `v128:0x…`, `ref.null`. */
/**
 * A float as text that keeps every bit a JavaScript number's own text drops (code lens pass 2,
 * 2026-10-28: a template string wrote -0 as `0` and every NaN as `NaN`): -0 is `-0`, and a NaN is
 * WAT's `nan:0x<payload>` with its sign, which reads back to the same bits. Every other value is
 * the number's text, as before.
 */
function showFloat(v: Value & { type: typeof ValType.F32 | typeof ValType.F64 }): string {
  const x = literalFloat(v);
  if (Object.is(x, -0)) return '-0';
  if (!Number.isNaN(x)) return String(x);
  const bits = BigInt.asUintN(v.type === ValType.F32 ? 32 : 64, BigInt(v.bits));
  const width = v.type === ValType.F32 ? 32n : 64n;
  const fraction = v.type === ValType.F32 ? 23n : 52n;
  const sign = (bits >> (width - 1n)) & 1n;
  const payload = bits & ((1n << fraction) - 1n);
  return `${sign ? '-' : ''}nan:0x${payload.toString(16)}`;
}

export function showValue(v: Value): string {
  switch (v.type) {
    case ValType.I32:
      return `i32:${v.value}`;
    case ValType.I64:
      return `i64:${v.value}`;
    case ValType.F32:
      return `f32:${showFloat(v)}`;
    case ValType.F64:
      return `f64:${showFloat(v)}`;
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
  const inst = new Interpreter(module, { imports, fuel: opts.fuel, hangCheck: opts.hangCheck });
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
    let args: Value[] = [];
    inst.refuel(opts.fuel);
    let outcome: Invocation['outcome'];
    try {
      args = sig.map((t, i) => argValue(t, given[i])); // may Stop: no default for the type
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
  const fn = funcAt(module, varIndex(index));
  if (fn === undefined) throw new Error(`no function ${index}`);
  return fn.sig.params;
}

/** Reads `inputPath` (`.wat` or binary) and runs it. */
export async function wasmInterp(
  inputPath: string,
  options: Partial<WasmInterpOptions> = {},
): Promise<Invocation[]> {
  const bytes = new Uint8Array(await fsRead(inputPath));
  const module = inputPath.endsWith('.wat')
    ? readValidWat(new TextDecoder().decode(bytes), inputPath)
    : readValidForPasses(bytes, inputPath);
  return interpModule(module, options);
}

function usage(): void {
  console.error('Usage: wasm-interp <input.wasm|.wat> [options]');
  console.error('  --run-all-exports          Run every exported function with zero arguments');
  console.error('  --run-export=NAME          Run one export');
  console.error('  --argument=V               An argument for --run-export (repeat, in order)');
  console.error('  --dummy-import-func        Every imported function returns zeros');
  console.error('  --fuel=N                   Instructions one call may run');
  console.error(
    '  --hang-check=SECONDS       Check for a loop that provably never exits after this long,',
  );
  console.error(
    '                             and every this long after (default 2; 0 from the start)',
  );
  console.error('  --no-hang-check            Do not check');
}

/** The CLI: parses `args` and runs {@link wasmInterp}. */
const HELP: ToolHelp = {
  usage: 'wasm-interp [options] <input.wasm|.wat>',
  description:
    "Run a module's exported functions on binaryang's interpreter and print each result.",
  examples: [
    ['run every export that takes no arguments', 'wasm-interp test.wasm --run-all-exports'],
    [
      'run add(2, 3) — each value typed by the parameter it fills',
      'wasm-interp test.wasm --run-export=add --argument=2 --argument=3',
    ],
  ],
  options: [
    ['--run-all-exports', 'Run every exported function with zero arguments'],
    ['--run-export=NAME', 'Run one export'],
    [
      '--argument=V',
      'An argument for --run-export, as written: 3, -1, 2.5, nan (repeat, in order)',
    ],
    ['--dummy-import-func', 'Every imported function returns zeros'],
    ['--fuel=N', 'Instructions one call may run'],
    [
      '--hang-check=SECONDS',
      'Check for a loop that provably never exits after this long, and every this long after (default 2; 0 from the start)',
    ],
    ['--no-hang-check', 'Do not check'],
  ],
};

export async function main(args: string[] = cliProcess().argv.slice(2)): Promise<void> {
  if (wantsHelp(args)) {
    console.log(helpText(HELP));
    return;
  }
  let input: string | undefined;
  const options: Partial<WasmInterpOptions> = { args: [] };
  for (const a of args) {
    if (a === '--run-all-exports') options.runAllExports = true;
    else if (a.startsWith('--run-export=')) options.runExport = a.slice(13);
    else if (a.startsWith('--argument=')) options.args!.push(a.slice(11));
    else if (a === '--dummy-import-func') options.dummyImportFunc = true;
    else if (a.startsWith('--fuel=')) options.fuel = Number(a.slice(7));
    else if (a.startsWith('--hang-check=')) {
      const seconds = Number(a.slice(13));
      if (!Number.isFinite(seconds) || seconds < 0) {
        console.error(`wasm-interp: --hang-check takes a number of seconds, not "${a.slice(13)}"`);
        cliExit(1);
      }
      options.hangCheck = seconds * 1000;
    } else if (a === '--no-hang-check') options.hangCheck = null;
    else if (a.startsWith('-')) {
      console.error(`wasm-interp: unknown option ${a}`);
      usage();
      cliExit(1);
    } else input = a;
  }
  if (input === undefined) {
    usage();
    cliExit(1);
  }
  let invocations: Invocation[];
  try {
    invocations = await wasmInterp(input, options);
  } catch (e) {
    console.error(
      `wasm-interp: ${e instanceof WatInputError || e instanceof Error ? e.message : e}`,
    );
    cliExit(1);
  }
  for (const inv of invocations) console.log(showInvocation(inv));
}
