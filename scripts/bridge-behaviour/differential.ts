// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * One corpus module, run down BOTH paths and compared. The library half of
 * `deno task bridge-behaviour`; the driver is `../check-bridge-behaviour.ts`
 * and the worker that isolates a hang is `worker.ts`.
 *
 * `deno task bridge` asks whether the bridge's output COMPILES. That question
 * cannot see a module that compiles and then does the wrong thing — which is
 * exactly what happened: the bridge dropped every element segment and every
 * start function, and the gate read 421/421 straight through it, because a
 * module with an empty table is perfectly valid.
 *
 * So this asks the other question. For each corpus module it builds:
 *
 *   A — `wat2wasm`: wabt-ts parse -> resolve -> synthesize -> wabt-ts writer
 *   B — the bridge: the same front end -> bridge -> binaryen-ts encoder
 *
 * instantiates BOTH against structurally identical, deterministic import stubs,
 * calls every numerically-typed export on both in lockstep with the same
 * sampled arguments, and compares trap-or-return per call plus a hash of linear
 * memory at the end. Two stubbed instances driven by the same call sequence
 * agree iff the two paths agree — the stubs need not be meaningful, only
 * identical, for the differential to be valid. (The method is `equiv_check.ts`'s;
 * the two sides are different here.)
 *
 * ⚠️ **This is S6 step 5's before/after instrument, and it outlives the step.**
 * Step 5 deletes the bridge by making the two IRs one type; B then becomes the
 * binaryen-ts encoder over that one IR, and the differential still means what
 * it means. Whatever this prints on the commit before step 5 is the baseline
 * step 5 is judged against — not "421 modules compiled", but "N calls agreed".
 */

import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../src/wabt-ts/ir/synthesize-types.ts';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';
import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';
import { parseWasm } from '../../src/binaryen-ts/binary/wasm-parser.ts';
import type { WasmModule } from '../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../src/binaryen-ts/ir/types.ts';
import type { ValueType } from '../../src/binaryen-ts/ir/gc-types.ts';
import { requireName } from '../../src/wabt-ts/ir/ir.ts';

/** The corpus both halves walk. */
export const CORPUS = new URL('../../tests/wabt-ts/wasmtk/', import.meta.url);

const NUMERIC = new Set<ValType>([ValType.I32, ValType.I64, ValType.F32, ValType.F64]);

type Arg = number | bigint;

/** Three sampled argument vectors, or `null` if a param type is not numeric. */
function argVectors(params: ValType[]): Arg[][] | null {
  const pick = (t: ValType, k: number): Arg | undefined => {
    switch (t) {
      case ValType.I32:
        return [0, 1, 0x10000][k];
      case ValType.I64:
        return [0n, 1n, 1_000_000n][k];
      case ValType.F32:
      case ValType.F64:
        return [0, 1.5, -3][k];
      default:
        return undefined;
    }
  };
  const vecs: Arg[][] = [];
  for (let k = 0; k < 3; k++) {
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

/** Deterministic imports rebuilt from the IR, plus any Memory we created. */
function makeImports(
  mod: WasmModule,
): { obj: Record<string, Record<string, unknown>>; mem: WebAssembly.Memory | null } {
  const obj: Record<string, Record<string, unknown>> = {};
  let mem: WebAssembly.Memory | null = null;
  const put = (m: string, b: string, v: unknown) => {
    (obj[m] ??= {})[b] = v;
  };
  for (const imp of mod.imports) {
    if (imp.kind === 'function') {
      const i64 = (imp.results ?? []).length === 1 && imp.results![0] === ValType.I64;
      put(imp.module, imp.base, (..._a: unknown[]) => (i64 ? 0n : 0));
    } else if (imp.kind === 'memory') {
      const desc: WebAssembly.MemoryDescriptor = { initial: imp.initial ?? 0 };
      if (imp.max != null) desc.maximum = imp.max;
      if (imp.shared) (desc as { shared?: boolean }).shared = true;
      mem = new WebAssembly.Memory(desc);
      put(imp.module, imp.base, mem);
    } else if (imp.kind === 'global') {
      const t = imp.type === ValType.I64
        ? 'i64'
        : imp.type === ValType.F32
        ? 'f32'
        : imp.type === ValType.F64
        ? 'f64'
        : 'i32';
      put(
        imp.module,
        imp.base,
        new WebAssembly.Global(
          { value: t, mutable: !!imp.mutable },
          imp.type === ValType.I64 ? 0n : 0,
        ),
      );
    } else if (imp.kind === 'table') {
      const desc: WebAssembly.TableDescriptor = {
        element: (imp.type === ValType.ExternRef ? 'externref' : 'anyfunc') as 'anyfunc',
        initial: imp.initial ?? 0,
      };
      if (imp.max != null) desc.maximum = imp.max;
      put(imp.module, imp.base, new WebAssembly.Table(desc));
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

function call(fn: (...a: Arg[]) => unknown, args: Arg[]): Outcome {
  try {
    const r = fn(...args);
    let ret: string;
    if (r === undefined) ret = 'void';
    else if (typeof r === 'bigint') ret = `${r}n`;
    else if (typeof r === 'number' && Number.isNaN(r)) ret = 'nan';
    else ret = String(r);
    return { trap: false, ret };
  } catch {
    // The TRAP ITSELF is the comparison, not its message: V8 words the same
    // trap differently for different modules, and a message diff would be
    // noise. Two paths that both trap here have agreed.
    return { trap: true, ret: 'trap' };
  }
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
export function check(file: string, wat: string): Row {
  const notRun: Record<string, number> = {};
  const bump = (why: string) => {
    notRun[why] = (notRun[why] ?? 0) + 1;
  };
  const row: Row = { file, status: 'agree', exports: 0, calls: 0, detail: '', notRun };

  // A: the shipping wabt-ts path.
  const a = wat2wasm(wat, { filename: file });
  if (a.binary.length === 0) return { ...row, status: 'skip', detail: 'wat2wasm could not' };

  // B: the same front end, then the bridge.
  const parsed = parseWatModule(wat);
  if (!parsed.module) return { ...row, status: 'skip', detail: 'no module' };
  resolveNames(parsed.module);
  synthesizeTypes(parsed.module);
  let b: Uint8Array;
  try {
    b = encodeWasm(bridgeToBinaryen(parsed.module));
  } catch (e) {
    return { ...row, status: 'DIVERGE', detail: `bridge path threw: ${(e as Error).message}` };
  }

  let mod: WasmModule;
  try {
    mod = parseWasm(a.binary);
  } catch (e) {
    return { ...row, status: 'skip', detail: `cannot read back A: ${(e as Error).message}` };
  }

  // Instantiation is itself observable: the START function runs here. A module
  // whose start traps on one path and not on the other has already diverged.
  let ia, ib, instA: WebAssembly.Instance, instB: WebAssembly.Instance;
  try {
    ia = makeImports(mod);
    instA = new WebAssembly.Instance(
      new WebAssembly.Module(a.binary as BufferSource),
      ia.obj as WebAssembly.Imports,
    );
  } catch (e) {
    return { ...row, status: 'skip', detail: `A will not instantiate: ${(e as Error).message}` };
  }
  try {
    ib = makeImports(mod);
    instB = new WebAssembly.Instance(
      new WebAssembly.Module(b as BufferSource),
      ib.obj as WebAssembly.Imports,
    );
  } catch (e) {
    return {
      ...row,
      status: 'DIVERGE',
      detail: `A instantiated, B will not: ${(e as Error).message}`,
    };
  }

  const sigByName = new Map<string, { params: ValueType[]; results: ValueType[] }>();
  for (const fn of mod.functions) {
    sigByName.set(fn.name, { params: fn.params, results: fn.results });
  }

  const diffs: string[] = [];
  for (const exp of mod.exports) {
    if (exp.kind !== 'function') {
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
    const fa = instA.exports[exp.name] as ((...a: Arg[]) => unknown) | undefined;
    const fb = instB.exports[exp.name] as ((...a: Arg[]) => unknown) | undefined;
    if (typeof fa !== 'function' || typeof fb !== 'function') {
      bump('export missing on an instance');
      continue;
    }

    row.exports++;
    for (const args of vecs) {
      const ra = call(fa, args);
      const rb = call(fb, args);
      row.calls++;
      if (ra.trap !== rb.trap || ra.ret !== rb.ret) {
        diffs.push(`${exp.name}(${args.join(',')}): wabt=${ra.ret} bridge=${rb.ret}`);
      }
    }
  }

  // Memory last: a call that wrote the wrong bytes without returning a wrong
  // value is invisible to the per-call comparison, and shows up only here.
  const ha = hashMem(instanceMemory(instA, ia.mem));
  const hb = hashMem(instanceMemory(instB, ib.mem));
  if (ha !== hb) diffs.push(`memory hash ${ha} vs ${hb}`);

  if (diffs.length > 0) return { ...row, status: 'DIVERGE', detail: diffs.join(' | ') };
  if (row.calls === 0) return { ...row, status: 'no-runnable-export' };
  return row;
}
