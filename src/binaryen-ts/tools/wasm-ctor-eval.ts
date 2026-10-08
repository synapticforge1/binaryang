// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/tools/wasm-ctor-eval
 *
 * `wasm-ctor-eval` (open-work 23, E4): runs a module's constructors at BUILD
 * time on the interpreter and writes what they computed back into the module
 * — memory into data segments, globals into their initialisers — so the
 * program starts in the state the constructors would have built. What a
 * constructor cannot finish (a call to the host, a trap, a value this tool
 * cannot write back) is left in it: the statements that ran are removed, the
 * locals they left are set at its entry, and the rest runs at start as before.
 * Upstream: `binaryen/src/tools/wasm-ctor-eval.cpp`.
 *
 * **Opt-in, never part of `-O`.** `--ignore-external-input` assumes the
 * program's arguments and environment are EMPTY (WASI's `args_*` /
 * `environ_*` answer so, and a constructor's parameters are zero): that is a
 * decision about the deployment, so the caller makes it.
 *
 * **The cut is always at a statement boundary with an empty operand stack**,
 * after a snapshot of the whole state, and the state written back is that
 * snapshot — never the state after a statement that trapped or stopped part
 * way. A snapshot is written back only if every value in it can be: numbers,
 * vectors, nulls and references to this module's own functions; a table that
 * changed, a passive segment dropped, or a GC object in a global or local
 * stops the evaluation at the boundary before.
 *
 * A fully evaluated constructor's export is REMOVED unless `keptExports`
 * names it; then it becomes a function returning the results it computed. A
 * start function is evaluated first and removed when complete.
 *
 * @license MIT
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { readForPasses } from '../ir/prepare.ts';
import { writeWasm, writeWat } from '../ir/write-wasm.ts';
import { readWat, WatInputError } from './read-wat.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import {
  type Expression,
  type Literal,
  makeConst,
  makeLocalSet,
  makeRefFunc,
  makeRefNull,
  makeRegion,
} from '../ir/expressions.ts';
import { mapExpression } from '../ir/walk.ts';
import { ValType } from '../ir/types.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { type DataSegment, type ValueType, type Var, varIndex } from '../../wabt-ts/ir/ir.ts';
import {
  type GlobalCell,
  type HostImport,
  type InstanceState,
  Interpreter,
  Stop,
  Trap,
  type Value,
  WasmException,
} from '../interp/interpreter.ts';

// ---------------------------------------------------------------------------
// Options and report
// ---------------------------------------------------------------------------

/** Options for {@link ctorEval}. */
export interface CtorEvalOptions {
  /** Exported functions to evaluate, in order (`--ctors`). The start function always comes first. */
  ctors: string[];
  /** Exports to keep even once fully evaluated (`--kept-exports`): each then returns its results. */
  keptExports: string[];
  /** Assume empty program arguments and environment, zero constructor parameters (`--ignore-external-input`). */
  ignoreExternalInput: boolean;
  /** Instructions one constructor may run before it is given up on. */
  fuel: number;
  /** Progress lines, as upstream prints them; `undefined` for none (`--quiet`). */
  log?: ((line: string) => void) | undefined;
}

/** What became of one constructor. */
export interface CtorOutcome {
  name: string;
  /** Top-level statements evaluated, of how many the body has. */
  statements: number;
  of: number;
  /** The body completed: its effects are in the module and the code is gone. */
  complete: boolean;
  /** Why it stopped short, when it did. */
  reason?: string;
}

const defaults: CtorEvalOptions = {
  ctors: [],
  keptExports: [],
  ignoreExternalInput: false,
  fuel: 20_000_000,
  log: (line) => console.log(line),
};

const WASI = 'wasi_snapshot_preview1';

// ---------------------------------------------------------------------------
// State snapshots
// ---------------------------------------------------------------------------

interface Snapshot {
  readonly memories: Uint8Array[];
  /** Defined globals only, in module order. */
  readonly globals: Value[];
  readonly tables: Value[][];
  readonly data: Uint8Array[];
  readonly elems: Value[][];
}

function snapshot(s: InstanceState, importedGlobals: number): Snapshot {
  return {
    memories: s.memories.map((m) => m.bytes.slice()),
    globals: s.globals.slice(importedGlobals).map((g) => g.value),
    tables: s.tables.map((t) => t.elems.slice()),
    data: [...s.data],
    elems: [...s.elems],
  };
}

/** Whether `v` can be written into the module as a constant expression. */
function writable(v: Value, inst: Interpreter): boolean {
  if (v.type !== 'ref') return true;
  if (v.kind === 'null') return true;
  return v.kind === 'func' && v.func.owner === inst;
}

/** `v` as the constant expression a global initialiser or a `local.set` holds. */
function constOf(v: Value, type: ValueType): Expression {
  if (v.type !== 'ref') return makeConst(v as Literal);
  if (v.kind === 'null') return makeRefNull(type);
  if (v.kind !== 'func') throw new Error('ctor-eval: not a writable value');
  return makeRefFunc(varIndex(v.func.index), type as ValType);
}

/**
 * Why `snap` cannot be written back relative to the state at instantiation,
 * or `null` when it can: a table that changed, a passive segment dropped, a
 * value that is not a constant.
 */
function unwritable(
  snap: Snapshot,
  init: Snapshot,
  inst: Interpreter,
  module: WasmModule,
  locals: readonly Value[],
): string | null {
  for (const [i, t] of snap.tables.entries()) {
    const t0 = init.tables[i]!;
    if (t.length !== t0.length || t.some((v, k) => v !== t0[k])) return 'a table changed';
  }
  for (const [i, d] of module.dataSegments.entries()) {
    if (d.kind === 'passive' && snap.data[i] !== init.data[i]) {
      return 'a passive data segment dropped';
    }
  }
  for (const [i, e] of module.elements.entries()) {
    if (e.kind === 'passive' && snap.elems[i] !== init.elems[i]) {
      return 'a passive element segment dropped';
    }
  }
  for (const v of snap.globals) {
    if (!writable(v, inst)) return 'a global holding a value that is not a constant';
  }
  for (const v of locals) {
    if (!writable(v, inst)) return 'a local holding a value that is not a constant';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Writing the state back
// ---------------------------------------------------------------------------

/** Zero bytes between two runs of data for them to become separate segments. */
const GAP = 32;

/** The non-zero runs of `bytes` as `[offset, data]` pairs, runs closer than {@link GAP} merged. */
export function packMemory(bytes: Uint8Array, gap = GAP): { offset: number; data: Uint8Array }[] {
  const out: { offset: number; data: Uint8Array }[] = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    while (i < n && bytes[i] === 0) i++;
    if (i >= n) break;
    const start = i;
    let end = i; // one past the last non-zero byte seen
    while (i < n) {
      if (bytes[i] !== 0) {
        end = ++i;
        continue;
      }
      let z = i;
      while (z < n && bytes[z] === 0) z++;
      if (z - i >= gap || z >= n) break;
      i = z;
    }
    out.push({ offset: start, data: bytes.slice(start, end) });
    i = end;
  }
  return out;
}

function applyToModule(module: WasmModule, snap: Snapshot, imported: Counts): void {
  // Memories: the size they grew to, and their contents as data segments.
  const segments: DataSegment[] = [];
  module.memories.forEach((m, j) => {
    const bytes = snap.memories[imported.memories + j]!;
    const pageSize = 1n << BigInt(m.limits.pageSizeLog2 ?? 16);
    m.limits.initial = BigInt(bytes.length) / pageSize;
    for (const { offset, data } of packMemory(bytes)) {
      segments.push({
        name: '',
        kind: 'active',
        memoryVar: varIndex(imported.memories + j),
        offset: makeRegion([
          makeConst(
            m.limits.is64
              ? { type: ValType.I64, value: BigInt(offset) }
              : { type: ValType.I32, value: offset },
          ),
        ]),
        data,
      });
    }
  });
  // Every active segment was applied at instantiation, so its bytes are in
  // the image. A passive one may still be named by `memory.init` / `data.drop`
  // (by INDEX), so when any exists the active ones are emptied in place and
  // the image appended; otherwise the image replaces them all.
  if (module.dataSegments.some((d) => d.kind === 'passive')) {
    for (const d of module.dataSegments) {
      if (d.kind !== 'active') continue;
      d.data = new Uint8Array(0);
    }
    module.dataSegments.push(...segments);
  } else {
    module.dataSegments.splice(0, module.dataSegments.length, ...segments);
  }
  // Globals: each defined one starts as the value it reached.
  module.globals.forEach((g, j) => {
    g.init = makeRegion([constOf(snap.globals[j]!, g.type)]);
  });
}

interface Counts {
  functions: number;
  memories: number;
  globals: number;
}

/** A fresh function name not yet in the module. */
function freshName(module: WasmModule, base: string): string {
  const taken = new Set(module.functions.map((f) => f.name));
  let name = `${base}__ctor_evalled`;
  for (let k = 2; taken.has(name); k++) name = `${base}__ctor_evalled${k}`;
  return name;
}

/** A deep copy of `e` — the new function must not share nodes with the old one. */
const deepCopy = (e: Expression): Expression => mapExpression(e, (x) => ({ ...x }));

// ---------------------------------------------------------------------------
// The evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates `options.ctors` (after the start function, if any) on
 * `module` and writes the state they reached back into it. Mutates
 * `module`; returns what became of each constructor. A module the
 * interpreter cannot instantiate — an imported memory or table, a start
 * that traps — is returned untouched, with the reason in the report.
 */
export function ctorEval(
  module: WasmModule,
  options: Partial<CtorEvalOptions> = {},
): { outcomes: CtorOutcome[]; reason?: string } {
  const opts: CtorEvalOptions = { ...defaults, ...options };
  const log = opts.log ?? (() => {});
  const imported: Counts = {
    functions: module.imports.filter((i) => i.kind === ExternalKind.Func).length,
    memories: module.imports.filter((i) => i.kind === ExternalKind.Memory).length,
    globals: module.imports.filter((i) => i.kind === ExternalKind.Global).length,
  };
  const outcomes: CtorOutcome[] = [];

  // The constructors: the start function first, then the named exports.
  const ctors: { name: string; var: Var; export?: number; start?: true }[] = [];
  if (module.start !== undefined) ctors.push({ name: '(start)', var: module.start, start: true });
  for (const name of opts.ctors) {
    const k = module.exports.findIndex((e) => e.name === name && e.kind === ExternalKind.Func);
    if (k < 0) throw new Error(`export not found: ${name}`);
    ctors.push({ name, var: module.exports[k]!.var, export: k });
  }
  if (ctors.length === 0) {
    return { outcomes, reason: 'nothing to evaluate: no --ctors and no start function' };
  }

  // The host: WASI's "no arguments, no environment" under --ignore-external-input;
  // an imported global that stops when read or written; nothing else.
  let inst: Interpreter | undefined;
  const i32 = (value: number): Value => ({ type: ValType.I32, value });
  const writeI32 = (at: Value, value: number) => {
    const mem = inst!.state().memories[0];
    if (mem === undefined) throw new Stop('host', 'WASI without a memory');
    const off = Number(
      at.type === ValType.I32 ? at.value >>> 0 : at.type === ValType.I64 ? at.value : 0,
    );
    mem.view.setUint32(off, value, true);
  };
  const imports = (m: string, f: string): HostImport | undefined => {
    const imp = module.imports.find((i) => i.module === m && i.field === f);
    if (imp?.kind === ExternalKind.Global) {
      const cell: GlobalCell = {
        get value(): Value {
          throw new Stop('host', `read from imported global ${m}.${f}`);
        },
        set value(_: Value) {
          throw new Stop('host', `write to imported global ${m}.${f}`);
        },
      };
      return { kind: 'global', cell };
    }
    if (imp?.kind !== ExternalKind.Func) return undefined;
    if (m === WASI && opts.ignoreExternalInput) {
      if (f === 'environ_sizes_get' || f === 'args_sizes_get') {
        return {
          kind: 'func',
          call: (args) => {
            writeI32(args[0]!, 0);
            writeI32(args[1]!, 0);
            return [i32(0)];
          },
        };
      }
      if (f === 'environ_get' || f === 'args_get') return { kind: 'func', call: () => [i32(0)] };
    }
    if (m === 'env' && f === '___cxa_atexit') return { kind: 'func', call: () => [i32(0)] };
    return undefined;
  };

  try {
    inst = new Interpreter(module, { imports, runStart: false, fuel: opts.fuel });
  } catch (e) {
    const reason = e instanceof Stop
      ? `cannot instantiate: ${e.message}`
      : e instanceof Trap
      ? `instantiation traps: ${e.message}`
      : null;
    if (reason === null) throw e;
    log(`  ...${reason}`);
    return { outcomes, reason };
  }
  const state = inst.state();
  const init = snapshot(state, imported.globals);

  for (const [c, ctor] of ctors.entries()) {
    // A constructor that did not complete still has code that runs at start,
    // AFTER anything written back here — so no later constructor may be
    // evaluated onto that state (🔧 the second one's effect was baked in and
    // then overwritten by the first one's remainder at run time).
    const earlier = outcomes[c - 1];
    if (earlier !== undefined && !earlier.complete) {
      log(`  ...not evaluating ${ctor.name}: ${earlier.name} did not complete`);
      outcomes.push({
        name: ctor.name,
        statements: 0,
        of: 0,
        complete: false,
        reason: `${earlier.name} did not complete`,
      });
      continue;
    }
    log(`trying to eval ${ctor.name}`);
    const index = inst.functionIndex(ctor.var);
    const defined = index - imported.functions;
    const fn = module.functions[defined];
    if (fn === undefined) {
      log(`  ...stopping since could not eval: call import`);
      outcomes.push({
        name: ctor.name,
        statements: 0,
        of: 0,
        complete: false,
        reason: 'an imported function',
      });
      continue;
    }
    const of = fn.body.children.length;
    if (fn.sig.params.length > 0 && !opts.ignoreExternalInput) {
      log(`  ...stopping due to params\n  RECOMMENDATION: consider --ignore-external-input`);
      outcomes.push({ name: ctor.name, statements: 0, of, complete: false, reason: 'parameters' });
      continue;
    }
    const params: Value[] = fn.sig.params.map((t) => zeroValue(t));
    let last = init;
    let done = 0;
    let localsAtLast: Value[] = [...params];
    let results: Value[] | undefined;
    let reason: string | undefined;
    inst.refuel(opts.fuel);
    try {
      results = inst.runStatements(index, params, (k, locals, stackEmpty) => {
        if (!stackEmpty) return;
        const snap = snapshot(state, imported.globals);
        const why = unwritable(snap, init, inst!, module, locals);
        if (why !== null) throw new Stop('unsupported', `cannot write back: ${why}`);
        last = snap;
        done = k + 1;
        localsAtLast = [...locals];
      });
      const why = results.some((v) => !writable(v, inst!))
        ? 'a result that is not a constant'
        : null;
      if (why !== null) {
        results = undefined;
        reason = why;
      } else {
        const snap = snapshot(state, imported.globals);
        reason = unwritable(snap, init, inst, module, []) ?? undefined;
        if (reason === undefined) {
          last = snap;
          done = of;
        } else results = undefined;
      }
    } catch (e) {
      if (e instanceof Stop) reason = e.message;
      else if (e instanceof Trap) reason = `trap: ${e.message}`;
      else if (e instanceof WasmException) reason = `an uncaught exception (tag ${e.tag.name})`;
      else throw e;
    }
    // The live state is not restored to `last`: what is written back is the
    // snapshot, and after a constructor that did not complete no further one
    // runs on the instance (above), so nothing reads the state it left.
    const complete = results !== undefined;
    if (complete) log(`  ...success on ${ctor.name}`);
    else if (done === 0) log(`  ...stopping since could not eval: ${reason}`);
    else log(`  ...partial evalling successful, but stopping since could not eval: ${reason}`);
    outcomes.push({
      name: ctor.name,
      statements: done,
      of,
      complete,
      ...(reason ? { reason } : {}),
    });

    if (done === 0) continue;
    applyToModule(module, last, imported);
    if (complete) {
      if (ctor.start) {
        delete module.start;
        continue;
      }
      if (!opts.keptExports.includes(ctor.name)) {
        module.exports.splice(ctor.export!, 1);
        for (const c of ctors) if (c.export !== undefined && c.export > ctor.export!) c.export--;
        continue;
      }
      // Kept: the export becomes a function returning what the constructor computed.
      const copy: WasmFunction = {
        ...fn,
        name: freshName(module, fn.name),
        locals: fn.locals.slice(0, fn.sig.params.length).map((l) => ({ ...l })),
        body: makeRegion(
          results!.map((v, i) => constOf(v, fn.sig.results[i]!)),
          fn.body.type,
        ),
      };
      module.functions.push(copy);
      module.exports[ctor.export!]!.var = varIndex(
        imported.functions + module.functions.length - 1,
      );
      continue;
    }
    // Partial: a copy without the statements that ran, its locals set at entry.
    const sets = localsAtLast.map((v, i) =>
      makeLocalSet(varIndex(i), constOf(v, fn.locals[i]!.type))
    );
    const copy: WasmFunction = {
      ...fn,
      name: freshName(module, fn.name),
      locals: fn.locals.map((l) => ({ ...l })),
      body: makeRegion([...sets, ...fn.body.children.slice(done).map(deepCopy)], fn.body.type),
    };
    module.functions.push(copy);
    const target = varIndex(imported.functions + module.functions.length - 1);
    if (ctor.start) module.start = target;
    else module.exports[ctor.export!]!.var = target;
  }
  return { outcomes };
}

/** The zero of a numeric, vector or reference type. */
function zeroValue(t: ValueType): Value {
  switch (t) {
    case ValType.I32:
      return { type: ValType.I32, value: 0 };
    case ValType.I64:
      return { type: ValType.I64, value: 0n };
    case ValType.F32:
      return { type: ValType.F32, bits: 0 };
    case ValType.F64:
      return { type: ValType.F64, bits: 0n };
    case ValType.V128:
      return { type: ValType.V128, bytes: new Uint8Array(16) };
    default:
      return { type: 'ref', kind: 'null' };
  }
}

// ---------------------------------------------------------------------------
// Files and the CLI
// ---------------------------------------------------------------------------

/** Options for {@link wasmCtorEval}: the evaluation's, plus the output. */
export interface WasmCtorEvalOptions extends CtorEvalOptions {
  /** Output path; `"-"` for stdout. Default `output.wasm`. */
  output: string;
  /** Emit WAT text (`-S`). */
  emitText: boolean;
}

/** Reads `inputPath` (`.wat` or binary), evaluates, and returns the bytes — or the text, with `emitText`. */
export async function wasmCtorEval(
  inputPath: string,
  options: Partial<WasmCtorEvalOptions> = {},
): Promise<{ output: Uint8Array | string; outcomes: CtorOutcome[]; reason?: string }> {
  const bytes = new Uint8Array(await readFile(inputPath));
  const module = inputPath.endsWith('.wat')
    ? readWat(new TextDecoder().decode(bytes), inputPath)
    : readForPasses(bytes, inputPath);
  const result = ctorEval(module, options);
  const out = writeWasm(module);
  return {
    output: options.emitText ? writeWat(readForPasses(out)) : out,
    outcomes: result.outcomes,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

function usage(): void {
  console.error('Usage: wasm-ctor-eval <input.wasm|.wat> [options]');
  console.error('  -o <file>                  Output file (default: output.wasm; - for stdout)');
  console.error('  --ctors=a,b                Exported functions to evaluate, in order');
  console.error('  --kept-exports=a,b         Keep these exports once fully evaluated');
  console.error('  --ignore-external-input    Assume no arguments or environment; zero parameters');
  console.error(
    '  --fuel=N                   Instructions one constructor may run (default 20000000)',
  );
  console.error('  -q, --quiet                No progress lines');
  console.error('  -S                         Emit WAT text');
}

/** The CLI: parses `args` and runs {@link wasmCtorEval}. */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  let input: string | undefined;
  const options: Partial<WasmCtorEvalOptions> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-o') options.output = args[++i] ?? 'output.wasm';
    else if (a.startsWith('--ctors=')) options.ctors = a.slice(8).split(',').filter(Boolean);
    else if (a.startsWith('--kept-exports=')) {
      options.keptExports = a.slice(15).split(',').filter(Boolean);
    } else if (a === '--ignore-external-input') options.ignoreExternalInput = true;
    else if (a.startsWith('--fuel=')) options.fuel = Number(a.slice(7));
    else if (a === '-q' || a === '--quiet') options.log = undefined;
    else if (a === '-S') options.emitText = true;
    else if (a.startsWith('-')) {
      console.error(`wasm-ctor-eval: unknown option ${a}`);
      usage();
      process.exit(1);
    } else input = a;
  }
  if (input === undefined) {
    usage();
    process.exit(1);
  }
  if (!('log' in options)) options.log = (line) => console.log(line);
  let result: Awaited<ReturnType<typeof wasmCtorEval>>;
  try {
    result = await wasmCtorEval(input, options);
  } catch (e) {
    console.error(
      `wasm-ctor-eval: ${e instanceof WatInputError || e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  }
  const outPath = options.output ?? 'output.wasm';
  if (outPath === '-') {
    if (typeof result.output === 'string') console.log(result.output);
    else process.stdout.write(result.output);
    return;
  }
  await writeFile(outPath, result.output);
  if (options.log !== undefined) {
    console.log(
      typeof result.output === 'string'
        ? `Wrote WAT: ${outPath}`
        : `Wrote WASM: ${outPath} (${result.output.byteLength} bytes)`,
    );
  }
}
