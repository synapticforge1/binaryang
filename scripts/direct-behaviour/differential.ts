// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * One corpus module, run down BOTH paths and compared. The library half of
 * `bun run direct-behaviour`; the driver is `../check-direct-behaviour.ts`
 * and the worker that isolates a hang is `worker.ts`.
 *
 * A gate that asks whether output COMPILES cannot see a module that compiles
 * and then does the wrong thing — which is exactly what happened: the bridge
 * (deleted in S6 step 5, M8e) dropped every element segment and every start
 * function, and its compile gate read 421/421 straight through it, because a
 * module with an empty table is perfectly valid.
 *
 * So this asks the other question. For each corpus module it builds:
 *
 *   A — `wat2wasm`: wabt-ts parse -> resolve -> synthesize -> wabt-ts writer
 *   B — the OPTIMIZER on that tree, at EVERY level the CLI offers (-O0 … -O4, -Os, -Oz): the
 *       same front end -> `prepareForPasses` (names + types, M8c/M8d) -> the pipeline -> its
 *       encoder
 *
 * instantiates BOTH against structurally identical, deterministic import stubs,
 * calls every numerically-typed export on both in lockstep with the same
 * sampled arguments, and compares trap-or-return per call (a float by its BITS, so -0 is not
 * +0), the calls each export made to IMPORTS (logged with their arguments, in order) and a hash
 * of linear memory at the end. Two stubbed instances driven by the same call sequence
 * agree iff the two paths agree — the stubs need not be meaningful, only
 * identical, for the differential to be valid. (The method is `equiv_check.ts`'s;
 * the two sides are different here.)
 *
 * ⚠️ **This was S6 step 5's before/after instrument, and it outlives the step.**
 * B was the bridge until M8e deleted it (1,806 calls across 602 exports agreed,
 * the baseline). Unoptimized, the direct path's bytes ARE `wat2wasm`'s
 * (`bun run direct` holds that), so B runs the optimizer: this is now the one
 * gate that checks what the optimizer does to a text-read tree by RUNNING it.
 * -O3 because that is where this route's output differs from the decoder
 * route's (the inliner sizes `pop`s and the decoder's local spills
 * differently).
 */

import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { synthesizeTypes } from '../../src/ir/synthesize-types.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { prepareForPasses, readForPasses } from '../../src/ir/prepare.ts';
import { PassRunner } from '../../src/passes/index.ts';
import { writeWasm } from '../../src/ir/write-wasm.ts';
import type { WasmModule } from '../../src/ir/module.ts';
import { ValType } from '../../src/ir/types.ts';
import type { ValueType } from '../../src/ir/gc-types.ts';
import { requireName } from '../../src/ir/ir.ts';
import { ExternalKind } from '../../src/core/binary.ts';

/** Every level the CLI offers, as `wasm-opt` spells them. -O0 runs no pass (read, write). */
export const LEVELS: [string, 0 | 1 | 2 | 3 | 4, 0 | 1 | 2][] = [
  ['-O0', 0, 0],
  ['-O1', 1, 0],
  ['-O2', 2, 0],
  ['-O3', 3, 0],
  ['-O4', 4, 0],
  ['-Os', 2, 1],
  ['-Oz', 2, 2],
];

const NUMERIC = new Set<ValType>([ValType.I32, ValType.I64, ValType.F32, ValType.F64]);

type Arg = number | bigint;

/**
 * Four sampled argument vectors, or `null` if a param type is not numeric. The fourth carries
 * -0 for a float (and 7 for an integer: -1 would run a countdown loop 2^32 times): a sign of zero is where a fold that
 * treats `-0 == 0` shows.
 */
function argVectors(params: ValType[]): Arg[][] | null {
  const pick = (t: ValType, k: number): Arg | undefined => {
    switch (t) {
      case ValType.I32:
        return [0, 1, 0x10000, 7][k];
      case ValType.I64:
        return [0n, 1n, 1_000_000n, 7n][k];
      case ValType.F32:
      case ValType.F64:
        return [0, 1.5, -3, -0][k];
      default:
        return undefined;
    }
  };
  const vecs: Arg[][] = [];
  for (let k = 0; k < 4; k++) {
    const v: Arg[] = [];
    for (const t of params) {
      const x = pick(t, k);
      if (x === undefined) return null;
      v.push(x);
    }
    vecs.push(v);
  }
  return vecs;
}

const BITS = new DataView(new ArrayBuffer(8));

/**
 * A comparable spelling of a value of type `t`, BY BITS: `-0` is not `+0` (`String(-0)` is
 * `"0"`, which is how a pass that flipped a zero's sign went unseen). A NaN is `nan` whatever its
 * payload: the spec leaves an arithmetic NaN's payload nondeterministic, and the JS boundary
 * does not carry it reliably.
 */
export function show(t: ValType | undefined, v: unknown): string {
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'nan';
    if (t === ValType.F32) {
      BITS.setFloat32(0, v);
      return `f32:${BITS.getUint32(0)}`;
    }
    if (t === ValType.F64 || !Number.isInteger(v) || Object.is(v, -0)) {
      BITS.setFloat64(0, v);
      return `f64:${BITS.getBigUint64(0)}`;
    }
  }
  return String(v);
}

/** Deterministic imports rebuilt from the IR, plus any Memory we created. */
function makeImports(
  mod: WasmModule,
  log: string[],
): { obj: Record<string, Record<string, unknown>>; mem: WebAssembly.Memory | null } {
  const obj: Record<string, Record<string, unknown>> = {};
  let mem: WebAssembly.Memory | null = null;
  const put = (m: string, b: string, v: unknown) => {
    (obj[m] ??= {})[b] = v;
  };
  for (const imp of mod.imports) {
    if (imp.kind === ExternalKind.Func) {
      // EVERY call to an import is LOGGED with its arguments, in order: the log is part of what
      // two paths must agree on (a pass that drops, duplicates or reorders a call to an import
      // changes it, and returns nothing a return-value comparison could see). The results are a
      // counter, so a changed call sequence also changes what the module computes from them.
      const { params, results } = imp.func.sig;
      const name = `${imp.module}.${imp.field}`;
      let n = 0;
      put(imp.module, imp.field, (...a: unknown[]) => {
        log.push(`${name}(${a.map((x, i) => show(params[i] as ValType, x)).join(',')})`);
        const one = (t: ValType): unknown => {
          n++;
          return t === ValType.I64
            ? BigInt(n)
            : t === ValType.F32 || t === ValType.F64
            ? n + 0.5
            : n;
        };
        return results.length === 0
          ? undefined
          : results.length === 1
          ? one(results[0] as ValType)
          : results.map((t) => one(t as ValType));
      });
    } else if (imp.kind === ExternalKind.Memory) {
      const { limits } = imp.memory;
      const desc: WebAssembly.MemoryDescriptor = { initial: Number(limits.initial) };
      if (limits.max !== undefined) desc.maximum = Number(limits.max);
      if (limits.isShared) (desc as { shared?: boolean }).shared = true;
      mem = new WebAssembly.Memory(desc);
      put(imp.module, imp.field, mem);
    } else if (imp.kind === ExternalKind.Global) {
      const vt = imp.global.type;
      const t = vt === ValType.I64
        ? 'i64'
        : vt === ValType.F32
        ? 'f32'
        : vt === ValType.F64
        ? 'f64'
        : 'i32';
      put(
        imp.module,
        imp.field,
        new WebAssembly.Global(
          { value: t, mutable: imp.global.mutable },
          vt === ValType.I64 ? 0n : 0,
        ),
      );
    } else if (imp.kind === ExternalKind.Table) {
      const { limits, elemType } = imp.table;
      const desc: WebAssembly.TableDescriptor = {
        element: (elemType === ValType.ExternRef ? 'externref' : 'anyfunc') as 'anyfunc',
        initial: Number(limits.initial),
      };
      if (limits.max !== undefined) desc.maximum = Number(limits.max);
      put(imp.module, imp.field, new WebAssembly.Table(desc));
    }
  }
  return { obj, mem };
}

function instanceMemory(
  inst: WebAssembly.Instance,
  imported: WebAssembly.Memory | null,
): WebAssembly.Memory | null {
  for (const v of Object.values(inst.exports)) {
    if (v instanceof WebAssembly.Memory) return v;
  }
  return imported;
}

/** FNV-1a over committed memory. */
function hashMem(mem: WebAssembly.Memory | null): string {
  if (!mem) return 'n/a';
  const bytes = new Uint8Array(mem.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface Outcome {
  trap: boolean;
  ret: string;
}

function call(
  fn: (...a: Arg[]) => unknown,
  args: Arg[],
  result: ValType | undefined,
  log: string[],
): Outcome {
  log.length = 0;
  let out: Outcome;
  try {
    const r = fn(...args);
    out = { trap: false, ret: r === undefined ? 'void' : show(result, r) };
  } catch {
    // The TRAP ITSELF is the comparison, not its message: V8 words the same
    // trap differently for different modules, and a message diff would be
    // noise. Two paths that both trap here have agreed.
    out = { trap: true, ret: 'trap' };
  }
  // The calls to imports this export made, in order, up to its return or trap.
  return { ...out, ret: `${out.ret} [${log.join(' ')}]` };
}

/** `timeout` is the driver's verdict, never this module's — see the driver. */
export type Status = 'agree' | 'DIVERGE' | 'no-runnable-export' | 'skip' | 'timeout';

export interface Row {
  file: string;
  status: Status;
  exports: number;
  calls: number;
  detail: string;
  /**
   * Why exports were NOT exercised. A differential is only as good as what it
   * reaches, so the misses are reported rather than swallowed: a reader told
   * only "they agree" will read it as a far stronger claim than it is.
   */
  notRun: Record<string, number>;
}

/**
 * Test seams: `afterPasses` sees each level's tree after the passes, before it is written, so a
 * test can plant the defect the comparison must catch (`tests/binaryen-ts/passes/behaviour_fidelity.test.ts`).
 */
export interface CheckHooks {
  afterPasses?: (level: string, prepared: WasmModule) => void;
}

/**
 * Run one module down both paths.
 *
 * ⚠️ **This can hang and is meant to.** Corpus entry points (`_start`, `main`)
 * are whole-program drivers and some of them do not terminate under stub
 * imports — a 421-module run with them called in-process produced no output in
 * ten minutes (measured 2026-09-15). Skipping them would have cost 419 of the
 * corpus's exports, so instead the caller runs this inside a worker it can
 * kill: the hang is contained rather than avoided, and the module is reported
 * as `timeout` instead of quietly not counted.
 */
export function check(file: string, wat: string, hooks?: CheckHooks): Row {
  const notRun: Record<string, number> = {};
  const bump = (why: string) => {
    notRun[why] = (notRun[why] ?? 0) + 1;
  };
  const row: Row = { file, status: 'agree', exports: 0, calls: 0, detail: '', notRun };

  // A: the shipping wabt-ts path.
  const a = wat2wasm(wat, { filename: file });
  if (a.binary.length === 0) return { ...row, status: 'skip', detail: 'wat2wasm could not' };

  const parsedOk = parseWatModule(wat);
  if (!parsedOk.module) return { ...row, status: 'skip', detail: 'no module' };

  let mod: WasmModule;
  try {
    mod = readForPasses(a.binary);
  } catch (e) {
    return { ...row, status: 'skip', detail: `cannot read back A: ${(e as Error).message}` };
  }
  const sigByName = new Map<string, { params: ValueType[]; results: ValueType[] }>();
  for (const fn of mod.functions) {
    sigByName.set(fn.name, { params: fn.sig.params, results: fn.sig.results });
  }

  // Instantiation is itself observable: the START function runs here, and it may call imports.
  const instantiate = (bytes: Uint8Array) => {
    const log: string[] = [];
    const imports = makeImports(mod, log);
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(bytes as BufferSource),
      imports.obj as WebAssembly.Imports,
    );
    return { instance, mem: imports.mem, log, start: log.join(' ') };
  };
  let A: ReturnType<typeof instantiate>;
  try {
    A = instantiate(a.binary);
  } catch (e) {
    return { ...row, status: 'skip', detail: `A will not instantiate: ${(e as Error).message}` };
  }

  // The exports to call, once: their numeric signatures.
  const plan: { name: string; vecs: Arg[][]; result: ValType | undefined }[] = [];
  for (const exp of mod.exports) {
    if (exp.kind !== ExternalKind.Func) {
      bump('export is not a function');
      continue;
    }
    const sig = sigByName.get(requireName(exp.var, 'export'));
    if (!sig) {
      bump('signature not found (exported import?)');
      continue;
    }
    if (sig.results.length > 1) {
      bump('multi-value result');
      continue;
    }
    if (sig.results.some((t) => !NUMERIC.has(t as ValType))) {
      bump('non-numeric result');
      continue;
    }
    const vecs = argVectors(sig.params as ValType[]);
    if (!vecs) {
      bump('non-numeric param');
      continue;
    }
    plan.push({ name: exp.name, vecs, result: sig.results[0] as ValType | undefined });
  }

  // A's outcome of every call, then of the memory, is what every variant must reproduce.
  const run = (inst: ReturnType<typeof instantiate>) => {
    const outcomes: string[] = [`start [${inst.start}]`];
    for (const { name, vecs, result } of plan) {
      const f = inst.instance.exports[name] as ((...a: Arg[]) => unknown) | undefined;
      for (const args of vecs) {
        if (typeof f !== 'function') {
          outcomes.push(`${name}: missing`);
          continue;
        }
        const o = call(f, args, result, inst.log);
        outcomes.push(
          `${name}(${args.map((x) => show(undefined, x)).join(',')}) = ${
            o.trap ? 'trap' : ''
          }${o.ret}`,
        );
      }
    }
    outcomes.push(`memory ${hashMem(instanceMemory(inst.instance, inst.mem))}`);
    return outcomes;
  };
  const want = run(A);
  row.exports = plan.length;
  row.calls = plan.reduce((n, e) => n + e.vecs.length, 0);
  for (const p of plan) {
    const f = A.instance.exports[p.name];
    if (typeof f !== 'function') bump('export missing on an instance');
  }

  // B, at EVERY level the CLI offers (-O0 .. -O4, -Os, -Oz; `wasm-opt`'s own spellings): the same
  // front end, then the optimizer. -O3 alone was what this ran until security review round 4
  // (R2 fidelity): a pass that only -O1, -O4, -Os or -Oz runs went unseen.
  const diffs: string[] = [];
  for (const [tag, optimizeLevel, shrinkLevel] of LEVELS) {
    let b: Uint8Array;
    try {
      // A fresh tree per level: the passes edit it in place.
      const parsed = parseWatModule(wat);
      resolveNames(parsed.module!);
      synthesizeTypes(parsed.module!);
      const prepared = prepareForPasses(parsed.module!);
      const runner = new PassRunner(prepared, { optimizeLevel, shrinkLevel });
      if (optimizeLevel > 0 || shrinkLevel > 0) runner.addDefaultOptimizationPasses();
      runner.run();
      hooks?.afterPasses?.(tag, prepared);
      b = writeWasm(prepared);
    } catch (e) {
      diffs.push(`${tag}: optimizer path threw: ${(e as Error).message}`);
      continue;
    }
    let B: ReturnType<typeof instantiate>;
    try {
      B = instantiate(b);
    } catch (e) {
      diffs.push(`${tag}: A instantiated, B will not: ${(e as Error).message}`);
      continue;
    }
    const got = run(B);
    const k = want.findIndex((w, j) => got[j] !== w);
    if (k >= 0) diffs.push(`${tag}: ${want[k]} (wabt) vs ${got[k]} (optimized)`);
  }

  if (diffs.length > 0) return { ...row, status: 'DIVERGE', detail: diffs.join(' | ') };
  if (row.calls === 0) return { ...row, status: 'no-runnable-export' };
  return row;
}
