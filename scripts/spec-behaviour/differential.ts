// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * One spec module, run as a DIFFERENTIAL: its own invocations replayed against
 * the original bytes and against everything this toolchain makes of them.
 *
 * `deno task spec` checks what the testsuite asks us to ACCEPT and REJECT, and
 * skips `assert_return` / `assert_trap` by design. Those are what show a
 * module that stays VALID while doing something else — a miscompile — and on
 * 2026-09-28, run like this from a scratch script, they found eight defects
 * that every gate had passed (Q1–Q8 in cmem/divergences.md), one a silent
 * -O2 miscompile shipped in 1.5.4.
 *
 * **The oracle is the original module, run by the engine.** Each invocation's
 * outcome on the original — a value, compared by bits, or a trap — must be the
 * outcome on every variant. So the manifests' `expected` values are never
 * needed, and our code never decides what is right. The variants:
 *
 * - `round trip` — what the tools do: the one reader through `readForPasses`,
 *   the one writer through `writeWasm`, no pass.
 * - `-O1` … `-Oz` — the same through `PassRunner` at the five levels.
 *
 * Until 1.6.0 each variant also ran on "route A", binaryen-ts's own decoder and
 * encoder; both were deleted then (One front end stages 3b and 4b).
 *
 * What a variant can come to:
 *
 * - it agrees;
 * - it DIVERGES — an outcome differs, or the engine refuses the bytes we wrote;
 * - it is REFUSED — our pipeline threw (an unsupported opcode, say). A loud
 *   refusal is not a miscompile; the driver counts them against a pinned
 *   budget instead.
 *
 * An export with a `v128` in its signature, which the JS API cannot call, is
 * called through a wrapper appended to the bytes — the original's and each
 * variant's alike — that carries each vector as two `i64` lanes (`v128.ts`).
 * Before that, every SIMD invocation threw a TypeError on both sides and
 * "agreed" unrun. What the JS API still cannot call is counted as `blind`.
 *
 * Imports are satisfied by inert stand-ins (the `spectest` names as the suite
 * defines them, anything else by its kind), the SAME ones for the original and
 * every variant, so a module whose behaviour depends on them is still compared
 * like for like. A module the engine will not instantiate with them compares
 * that failure too.
 */

import { readForPasses } from '../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../src/binaryen-ts/ir/write-wasm.ts';
import {
  type MinifyMap,
  optimizeToConvergence,
  type PassOptions,
  PassRunner,
  takeMinifyMap,
} from '../../src/binaryen-ts/passes/index.ts';
import type { WasmModule } from '../../src/binaryen-ts/ir/module.ts';
import { type Sig, v128Lanes, withV128Wrappers, wrapperName } from './v128.ts';

/** One `invoke` from a manifest: an export, its arguments as the manifest spells them. */
export interface Invoke {
  line: number;
  field: string;
  args: { type: string; value: unknown; lane_type?: string }[];
}

/** A module and the invocations that follow it in its manifest. */
export interface SpecInput {
  /** `<dir>/<file>`, for reporting. */
  name: string;
  path: string;
  invokes: Invoke[];
  /**
   * The signature of each invoked export that has a `v128` in it, as the
   * manifest shows it (`v128.ts`): each gets a wrapper the JS API can call.
   */
  v128?: [string, Sig][];
}

/**
 * `blind` — the engine would not compile the ORIGINAL, a module the spec calls
 * valid, so nothing was compared. It used to read as `agree`: original and
 * every variant fail to compile ALIKE. That is how a missing V8 flag would pass
 * silently (a proposal's flag renamed by a Deno upgrade: V8 only warns).
 */
export type Status = 'agree' | 'DIVERGE' | 'timeout' | 'blind';

export interface Row {
  name: string;
  status: Status;
  invocations: number;
  /** Invocations made through a `v128` wrapper (`v128.ts`). */
  v128: number;
  /**
   * Invocations the JS API could not make even so — a `TypeError` on the
   * ORIGINAL (a `v128` export whose signature the manifest does not show, a
   * reference type JS cannot pass). They agree on every variant by
   * construction, so they are counted, not compared.
   */
  blind: number;
  /** Variants compared in full. */
  variants: number;
  /** Variants our pipeline refused, with why. */
  refused: string[];
  /** For a DIVERGE: which variant, which invocation, want vs got. */
  detail: string[];
}

const LEVELS: [string, PassOptions['optimizeLevel'], PassOptions['shrinkLevel']][] = [
  ['-O1', 1, 0],
  ['-O2', 2, 0],
  ['-O3', 3, 0],
  ['-Os', 2, 1],
  ['-Oz', 2, 2],
];

/**
 * A variant's bytes, and — for one that renamed the interface — the map the
 * HOST applies: it supplies its imports under the new names and calls the
 * exports by them.
 */
type Made = Uint8Array | { bytes: Uint8Array; map: MinifyMap };

/** Every variant, built lazily so one that throws is refused alone. */
function variants(bytes: Uint8Array): [string, () => Made][] {
  const out: [string, () => Made][] = [];
  out.push(['round trip', () => writeWasm(readForPasses(bytes))]);
  for (const [level, o, s] of LEVELS) {
    out.push([level, () => {
      const m: WasmModule = readForPasses(bytes);
      new PassRunner(m, { optimizeLevel: o, shrinkLevel: s }).addDefaultOptimizationPasses().run();
      return writeWasm(m);
    }]);
  }
  // `wasm-opt -Oz --converge`: rounds of -Oz, the smallest kept. Every round
  // must behave as the input, and so must the one that wins.
  out.push(['-Oz --converge', () =>
    optimizeToConvergence(
      readForPasses(bytes),
      { optimizeLevel: 2, shrinkLevel: 2 },
      (r) => r.addDefaultOptimizationPasses(),
    ).bytes]);
  // `wasm-opt --flatten` alone: Flat IR computes what the input computes.
  // It refuses `br_on_*` and `try_table` as upstream does (REFUSED_BUDGET).
  out.push(['--flatten', () => {
    const m: WasmModule = readForPasses(bytes);
    new PassRunner(m, { optimizeLevel: 0, shrinkLevel: 0 }).add('Flatten').run();
    return writeWasm(m);
  }]);
  // `wasm-opt --minify-imports-and-exports-and-modules`, run THROUGH its map:
  // every import and export renamed, every module `a`. The map is the
  // contract, and this is its round trip (cmem/names.md § 1a).
  out.push(['minify through its map', () => {
    const m: WasmModule = readForPasses(bytes);
    new PassRunner(m, {}).add('MinifyImportsAndExportsAndModules').run();
    const map = takeMinifyMap(m);
    if (map === undefined) throw new Error('the minify pass produced no map');
    return { bytes: writeWasm(m), map };
  }]);
  return out;
}

/** The names a host uses for `map`'s module: export old → new, import new → old. */
function renaming(map: MinifyMap | undefined) {
  const exports = new Map(map?.exports ?? []);
  const imports = new Map(
    (map?.imports ?? []).map(([m, f, n]) => [`${map!.module ?? m}\0${n}`, [m, f] as const]),
  );
  return {
    exportName: (field: string) => exports.get(field) ?? field,
    original: (module: string, field: string) =>
      imports.get(`${module}\0${field}`) ?? [module, field] as const,
  };
}

/** The testsuite's `spectest` module, as `spec/interpreter` defines it. */
function spectest(name: string): unknown {
  switch (name) {
    case 'global_i32':
      return new WebAssembly.Global({ value: 'i32', mutable: false }, 666);
    case 'global_i64':
      return new WebAssembly.Global({ value: 'i64', mutable: false }, 666n);
    case 'global_f32':
      return new WebAssembly.Global({ value: 'f32', mutable: false }, 666.6);
    case 'global_f64':
      return new WebAssembly.Global({ value: 'f64', mutable: false }, 666.6);
    case 'table':
      return new WebAssembly.Table({ initial: 10, maximum: 20, element: 'anyfunc' });
    case 'memory':
      return new WebAssembly.Memory({ initial: 1, maximum: 2 });
    default:
      return () => {}; // the `print*` functions
  }
}

/**
 * Inert stand-ins for every import — the same for the original and each
 * variant. A renamed import gets the stand-in of the name it had (`original`).
 */
function importsFor(
  mod: WebAssembly.Module,
  original: (module: string, field: string) => readonly [string, string] = (m, f) => [m, f],
): WebAssembly.Imports {
  const out: Record<string, Record<string, unknown>> = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    const ns = (out[imp.module] ??= {});
    const [was, wasName] = original(imp.module, imp.name);
    if (was === 'spectest') {
      ns[imp.name] = spectest(wasName);
      continue;
    }
    switch (imp.kind) {
      case 'function':
        ns[imp.name] = () => {};
        break;
      case 'memory':
        ns[imp.name] = new WebAssembly.Memory({ initial: 1 });
        break;
      case 'table':
        ns[imp.name] = new WebAssembly.Table({ initial: 10, element: 'anyfunc' });
        break;
      case 'global':
        ns[imp.name] = new WebAssembly.Global({ value: 'i32', mutable: false }, 0);
        break;
      default:
        ns[imp.name] = undefined;
    }
  }
  return out as WebAssembly.Imports;
}

/** An argument as the manifest spells it, as the JS API takes it. */
function arg(a: { type: string; value: unknown }): unknown {
  const v = a.value as string;
  switch (a.type) {
    case 'i32':
      return Number(BigInt.asIntN(32, BigInt(v)));
    case 'i64':
      return BigInt.asIntN(64, BigInt(v));
    case 'f32': {
      const d = new DataView(new ArrayBuffer(4));
      d.setUint32(0, Number(v));
      return d.getFloat32(0);
    }
    case 'f64': {
      const d = new DataView(new ArrayBuffer(8));
      d.setBigUint64(0, BigInt(v));
      return d.getFloat64(0);
    }
    case 'externref':
      return v === 'null' ? null : { extern: v };
    default:
      return v === 'null' ? null : v;
  }
}

/** A comparable spelling of a result: numbers by their bits, references by kind. */
function show(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(show).join(',')}]`;
  if (typeof x === 'number') {
    const d = new DataView(new ArrayBuffer(8));
    d.setFloat64(0, x);
    return `n:${d.getBigUint64(0)}`;
  }
  if (typeof x === 'bigint') return `b:${x}`;
  if (x === null || x === undefined) return String(x);
  if (typeof x === 'object' && 'extern' in x) return `extern:${(x as { extern: unknown }).extern}`;
  return typeof x;
}

/**
 * Every invocation's outcome, in order. A trap is compared by its CLASS, not
 * its message: which trap an optimized module reaches first may legitimately
 * differ; that it traps, or overflows the stack, may not.
 */
function outcomes(
  bytes: Uint8Array,
  invokes: Invoke[],
  v128: Map<string, Sig>,
  map?: MinifyMap,
): string[] {
  const { exportName, original } = renaming(map);
  let exports: WebAssembly.Exports;
  try {
    // The wrappers go onto the bytes as they are: the original's and each
    // variant's alike, after the variant was made (`v128.ts`) — keyed by the
    // name each export has in THESE bytes.
    const sigs = new Map([...v128].map(([field, sig]) => [exportName(field), sig]));
    const mod = new WebAssembly.Module(withV128Wrappers(bytes, sigs) as BufferSource);
    exports = new WebAssembly.Instance(mod, importsFor(mod, original)).exports;
  } catch (e) {
    const err = e as Error;
    const kind = err instanceof WebAssembly.CompileError ? 'INVALID' : 'instantiation fails';
    // An import is named in the message; a renamed one has other names, and the
    // failure is the same one — so it is compared by its position alone.
    const msg = err.message.replace(/@\+\d+/g, '').replace(/(Import #\d+) "[^"]*" "[^"]*"/g, '$1');
    return [`${kind}: ${msg}`];
  }
  return invokes.map(({ line, field, args }) => {
    // Through its wrapper, where it has one: each vector as two i64 lanes.
    const wrapped = exports[wrapperName(exportName(field))];
    const f = typeof wrapped === 'function' ? wrapped : exports[exportName(field)];
    if (typeof f !== 'function') return `${line} ${field}: not a function export`;
    const values = typeof wrapped === 'function'
      ? args.flatMap((a) => a.type === 'v128' ? v128Lanes(a) : [arg(a)])
      : args.map(arg);
    try {
      return `${line} ${field} = ${show((f as (...a: unknown[]) => unknown)(...values))}`;
    } catch (e) {
      const kind = e instanceof RangeError ? 'exhaustion' : (e as Error).constructor.name;
      return `${line} ${field} ! ${kind}`;
    }
  });
}

/** Compares every variant of `input` with the original. */
export function check(input: SpecInput): Row {
  const bytes = Deno.readFileSync(input.path);
  const v128 = new Map(input.v128 ?? []);
  const want = outcomes(bytes, input.invokes, v128);
  const row: Row = {
    name: input.name,
    status: 'agree',
    invocations: input.invokes.length,
    v128: input.invokes.filter((i) => v128.has(i.field)).length,
    blind: want.filter((w) => w.endsWith(' ! TypeError')).length,
    variants: 0,
    refused: [],
    detail: [],
  };
  if (want.length === 1 && want[0]!.startsWith('INVALID: ')) {
    row.status = 'blind';
    row.detail.push(`the engine refuses the original: ${want[0]!.slice(9, 160)}`);
    return row;
  }
  for (const [variant, make] of variants(bytes)) {
    let made: Made;
    try {
      made = make();
    } catch (e) {
      row.refused.push(`${variant}: ${(e as Error).message.split('\n')[0]!.slice(0, 100)}`);
      continue;
    }
    row.variants++;
    const got = made instanceof Uint8Array
      ? outcomes(made, input.invokes, v128)
      : outcomes(made.bytes, input.invokes, v128, made.map);
    const k = want.findIndex((w, i) => got[i] !== w);
    if (k >= 0 || got.length !== want.length) {
      const at = k >= 0 ? k : Math.min(want.length, got.length);
      row.status = 'DIVERGE';
      row.detail.push(`${variant}: want «${want[at]}» got «${got[at]}»`);
    }
  }
  return row;
}
