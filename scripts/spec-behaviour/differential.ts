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
 * - `A round trip` — binaryen-ts's decoder, then its encoder (the published
 *   `parseWasm` / `encodeWasm`, until the bump that unpublishes them), no pass.
 * - `B round trip` — what the tools do (One front end stages 3a and 4): the
 *   wabt-ts reader through `readForPasses`, the wabt-ts writer through
 *   `writeWasm`, no pass.
 * - `A -O1` … `B -Oz` — each route through `PassRunner` at the five levels.
 *
 * What a variant can come to:
 *
 * - it agrees;
 * - it DIVERGES — an outcome differs, or the engine refuses the bytes we wrote;
 * - it is REFUSED — our pipeline threw (an unsupported opcode, say). A loud
 *   refusal is not a miscompile; the driver counts them against a pinned
 *   budget instead.
 *
 * Imports are satisfied by inert stand-ins (the `spectest` names as the suite
 * defines them, anything else by its kind), the SAME ones for the original and
 * every variant, so a module whose behaviour depends on them is still compared
 * like for like. A module the engine will not instantiate with them compares
 * that failure too.
 */

import { parseWasm } from '../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';
import { readForPasses } from '../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../src/binaryen-ts/encoder/write-wasm.ts';
import { type PassOptions, PassRunner } from '../../src/binaryen-ts/passes/index.ts';
import type { WasmModule } from '../../src/binaryen-ts/ir/module.ts';

/** One `invoke` from a manifest: an export, its arguments as the manifest spells them. */
export interface Invoke {
  line: number;
  field: string;
  args: { type: string; value: unknown }[];
}

/** A module and the invocations that follow it in its manifest. */
export interface SpecInput {
  /** `<dir>/<file>`, for reporting. */
  name: string;
  path: string;
  invokes: Invoke[];
}

export type Status = 'agree' | 'DIVERGE' | 'timeout';

export interface Row {
  name: string;
  status: Status;
  invocations: number;
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

/** Each route: how bytes are read, and how the module is written back. */
const ROUTES: Record<
  'A' | 'B',
  { read: (b: Uint8Array) => WasmModule; write: (m: WasmModule) => Uint8Array }
> = {
  A: { read: (b) => parseWasm(b), write: (m) => encodeWasm(m) },
  B: { read: (b) => readForPasses(b), write: (m) => writeWasm(m) },
};

/** Every variant, built lazily so one that throws is refused alone. */
function variants(bytes: Uint8Array): [string, () => Uint8Array][] {
  const out: [string, () => Uint8Array][] = [];
  for (const [route, { read, write }] of Object.entries(ROUTES)) {
    out.push([`${route} round trip`, () => write(read(bytes))]);
    for (const [level, o, s] of LEVELS) {
      out.push([`${route} ${level}`, () => {
        const m = read(bytes);
        new PassRunner(m, { optimizeLevel: o, shrinkLevel: s }).addDefaultOptimizationPasses()
          .run();
        return write(m);
      }]);
    }
  }
  return out;
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

/** Inert stand-ins for every import — the same for the original and each variant. */
function importsFor(mod: WebAssembly.Module): WebAssembly.Imports {
  const out: Record<string, Record<string, unknown>> = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    const ns = (out[imp.module] ??= {});
    if (imp.module === 'spectest') {
      ns[imp.name] = spectest(imp.name);
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
function outcomes(bytes: Uint8Array, invokes: Invoke[]): string[] {
  let exports: WebAssembly.Exports;
  try {
    const mod = new WebAssembly.Module(bytes as BufferSource);
    exports = new WebAssembly.Instance(mod, importsFor(mod)).exports;
  } catch (e) {
    const err = e as Error;
    const kind = err instanceof WebAssembly.CompileError ? 'INVALID' : 'instantiation fails';
    return [`${kind}: ${err.message.replace(/@\+\d+/g, '')}`];
  }
  return invokes.map(({ line, field, args }) => {
    const f = exports[field];
    if (typeof f !== 'function') return `${line} ${field}: not a function export`;
    try {
      return `${line} ${field} = ${show((f as (...a: unknown[]) => unknown)(...args.map(arg)))}`;
    } catch (e) {
      const kind = e instanceof RangeError ? 'exhaustion' : (e as Error).constructor.name;
      return `${line} ${field} ! ${kind}`;
    }
  });
}

/** Compares every variant of `input` with the original. */
export function check(input: SpecInput): Row {
  const bytes = Deno.readFileSync(input.path);
  const want = outcomes(bytes, input.invokes);
  const row: Row = {
    name: input.name,
    status: 'agree',
    invocations: input.invokes.length,
    variants: 0,
    refused: [],
    detail: [],
  };
  for (const [variant, make] of variants(bytes)) {
    let out: Uint8Array;
    try {
      out = make();
    } catch (e) {
      row.refused.push(`${variant}: ${(e as Error).message.split('\n')[0]!.slice(0, 100)}`);
      continue;
    }
    row.variants++;
    const got = outcomes(out, input.invokes);
    const k = want.findIndex((w, i) => got[i] !== w);
    if (k >= 0 || got.length !== want.length) {
      const at = k >= 0 ? k : Math.min(want.length, got.length);
      row.status = 'DIVERGE';
      row.detail.push(`${variant}: want «${want[at]}» got «${got[at]}»`);
    }
  }
  return row;
}
