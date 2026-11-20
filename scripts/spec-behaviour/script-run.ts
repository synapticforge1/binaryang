// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * One spec SCRIPT (a `.wast`, as its prepared manifest lists it), run command by command against
 * the bytes binaryang writes, and every assertion compared with the value the script itself
 * expects (`expected.ts`) — C-R2-5. Unlike the differential in `differential.ts`, which replays one
 * module's invocations in isolation against V8's run of the original, this runs the script as
 * `spectest-interp` does: modules in order, named instances, `register`ed modules importable by the
 * ones after them, `get` of globals, and the shared `spectest` memory, table and globals.
 *
 * It runs the script once per VARIANT — the original bytes (V8 against the spec: the harness
 * itself, reported apart), the round trip, `-O1` … `-Oz`, `-Oz --converge`, `--flatten` and the
 * minify pass through its map — each module of the script made by that variant, exactly as the
 * differential makes them.
 *
 * What it does not run: a module given only as text, `module_definition` / `module_instance` (the
 * component-style commands of the 33 files `wasm-tools` splits), `assert_unlinkable` (the engine's
 * link check, not what we write), and an invocation whose argument is a NaN with a payload the JS
 * API cannot carry. Each is COUNTED, never silently dropped.
 */

import { readFileSync } from 'node:fs';
import { arg, renaming, spectest, variants } from './differential.ts';
import type { MinifyMap } from '../../src/passes/index.ts';
import { type Expect, expectOf, meets, type Raw } from './expected.ts';
import { type Sig, v128Lanes, withV128Wrappers, wrapperName } from './v128.ts';

type Cmd = Record<string, unknown>;

/** A prepared manifest: its directory, name and commands. */
export interface ScriptInput {
  /** `<dir>`, prefixed for a proposal, for reporting. */
  name: string;
  /** The folder holding the manifest's `.wasm` files. */
  dir: string;
  commands: Cmd[];
}

/** What a script came to. */
export interface ScriptRow {
  name: string;
  /** Assertions checked in the ORIGINAL's run. */
  asserted: number;
  /** Assertions (and actions) not run, with the count of each cause. */
  unchecked: Record<string, number>;
  /** Assertion checks across the variants (each assertion times each variant that ran it). */
  variantChecks: number;
  /** Literal NaNs met without their payload being observable. */
  nanBoundary: number;
  /** The ORIGINAL, run by V8, against the script: the oracle's or the harness's own limits. */
  original: string[];
  /** A variant, as binaryang wrote it, against the script. */
  variant: string[];
  /** Modules a variant's pipeline refused (counted: the differential pins them). */
  refused: number;
}

export function emptyRow(name: string): ScriptRow {
  return {
    name,
    asserted: 0,
    unchecked: {},
    variantChecks: 0,
    nanBoundary: 0,
    original: [],
    variant: [],
    refused: 0,
  };
}

/** A running instance: its exports under the names the ORIGINAL module gave them. */
interface Inst {
  get(field: string): unknown;
  /** The name an export has in these bytes (renamed by the minify variant). */
  exportName(field: string): string;
  exports: WebAssembly.Exports;
}

/** Why a module has no instance: a cause the run counts, not a disagreement. */
type Dead = { dead: string };

const isDead = (x: Inst | Dead | undefined): x is Dead => x !== undefined && 'dead' in x;

/** The module's binary file in a manifest command, if it has one. */
function binaryOf(c: Cmd): string | undefined {
  const bf = c['binary_filename'];
  if (typeof bf === 'string') return bf;
  const f = c['filename'];
  return typeof f === 'string' && f.endsWith('.wasm') ? f : undefined;
}

/**
 * The signature of each export, per module command (by its index), from the script's own
 * assertions: argument types, and the result types an `assert_return`, `assert_trap` … lists. The
 * `v128` ones get a wrapper the JS API can call (`v128.ts`).
 */
function signatures(cmds: Cmd[]): Map<number, Map<string, Sig>> {
  const out = new Map<number, Map<string, Sig>>();
  const byName = new Map<string, number>();
  let last = -1;
  for (const [i, c] of cmds.entries()) {
    if (c['type'] === 'module') {
      last = i;
      if (typeof c['name'] === 'string') byName.set(c['name'], i);
      continue;
    }
    const a = c['action'] as
      | { type: string; module?: string; field: string; args?: { type: string }[] }
      | undefined;
    if (a?.type !== 'invoke') continue;
    const at = a.module === undefined ? last : byName.get(a.module);
    const types = (c['expected'] ?? (c['either'] as unknown[] | undefined)?.slice(0, 1)) as
      | { type: string }[]
      | undefined;
    if (at === undefined || at < 0 || types === undefined) continue;
    const sigs = out.get(at) ?? new Map<string, Sig>();
    if (!sigs.has(a.field)) {
      sigs.set(a.field, {
        params: (a.args ?? []).map((x) => x.type),
        results: types.map((x) => x.type),
      });
    }
    out.set(at, sigs);
  }
  return out;
}

/** A float argument that the JS API cannot carry bit-exactly: any NaN but the positive quiet one. */
function nanArgumentLost(a: { type: string; value?: unknown }): boolean {
  if (a.type !== 'f32' && a.type !== 'f64') return false;
  const bits = BigInt(a.value as string);
  const exp = a.type === 'f32' ? 0x7f800000n : 0x7ff0000000000000n;
  const mant = a.type === 'f32' ? 0x7fffffn : 0xfffffffffffffn;
  const canonical = a.type === 'f32' ? 0x7fc00000n : 0x7ff8000000000000n;
  return (bits & exp) === exp && (bits & mant) !== 0n && bits !== canonical;
}

const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1);

/**
 * The `spectest` imports of the script interpreter: `differential.ts`'s, and the two it lacks —
 * `table64` (an `i64`-indexed table, memory64) and `shared_memory` (threads).
 */
function spectestImport(name: string): unknown {
  switch (name) {
    case 'table64':
      return new WebAssembly.Table(
        {
          element: 'anyfunc',
          initial: 10n,
          maximum: 20n,
          address: 'i64',
        } as unknown as WebAssembly.TableDescriptor,
      );
    case 'shared_memory':
      return new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    default:
      return spectest(name);
  }
}

/** Runs the script under ONE variant, appending to `into` (the original's or the variants'). */
function run(
  script: ScriptInput,
  variant: string,
  sigs: Map<number, Map<string, Sig>>,
  engineRefused: Set<number>,
  note: {
    problems: string[];
    asserted: { n: number };
    unchecked: Record<string, number>;
    nan: { n: number };
    refused: { n: number };
  },
): void {
  const { problems, unchecked } = note;
  const named = new Map<string, Inst | Dead>();
  const registry = new Map<string, Inst>();
  const shared = new Map<string, unknown>(); // the one `spectest`, as every module sees it
  const spectestOf = (name: string): unknown => {
    if (!shared.has(name)) shared.set(name, spectestImport(name));
    return shared.get(name);
  };
  let last: Inst | Dead | undefined;
  const miss = (cause: string) => bump(unchecked, cause);

  /** Makes and instantiates a module the way `variant` would; a `Dead` says why not. */
  const instantiate = (c: Cmd, at: number): Inst | Dead | Error => {
    const file = binaryOf(c);
    if (file === undefined) return { dead: 'module given as text only' };
    const original = new Uint8Array(readFileSync(`${script.dir}/${file}`));
    let bytes: Uint8Array = original;
    let map: MinifyMap | undefined;
    if (variant !== 'original') {
      try {
        const make = variants(original).find(([n]) => n === variant)![1];
        const made = make();
        if (made instanceof Uint8Array) bytes = made;
        else {
          bytes = made.bytes;
          map = made.map;
        }
      } catch {
        note.refused.n++;
        return { dead: 'a variant the pipeline refused' };
      }
    }
    const { exportName, original: was } = renaming(map);
    const wrapSigs = new Map(
      [...(sigs.get(at) ?? [])].map(([field, sig]) => [exportName(field), sig]),
    );
    try {
      const mod = new WebAssembly.Module(withV128Wrappers(bytes, wrapSigs, true) as BufferSource);
      const imports: Record<string, Record<string, unknown>> = {};
      for (const imp of WebAssembly.Module.imports(mod)) {
        const [om, on] = was(imp.module, imp.name);
        let value: unknown;
        if (om === 'spectest') value = spectestOf(on);
        else {
          const from = registry.get(om);
          if (from === undefined) return { dead: 'imports a module the script did not register' };
          value = from.get(on);
        }
        (imports[imp.module] ??= {})[imp.name] = value;
      }
      const inst = new WebAssembly.Instance(mod, imports as WebAssembly.Imports);
      return {
        exports: inst.exports,
        exportName,
        get: (field) => inst.exports[exportName(field)],
      };
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  };

  const target = (a: { module?: string }): Inst | Dead | undefined =>
    a.module === undefined ? last : named.get(a.module);

  for (const [at, c] of script.commands.entries()) {
    const type = c['type'] as string;
    if (type === 'module') {
      const r = instantiate(c, at);
      if (r instanceof Error && variant !== 'original' && engineRefused.has(at)) {
        last = { dead: 'the engine refuses the ORIGINAL module too (pinned)' };
      } else if (r instanceof Error) {
        if (variant === 'original') engineRefused.add(at);
        // The script says this module is valid and instantiates: the variant broke it.
        problems.push(
          `${variant} line ${c['line']}: module ${c['filename']}: ${r.message.slice(0, 140)}`,
        );
        last = { dead: 'a module that did not instantiate (reported)' };
      } else last = r;
      if (typeof c['name'] === 'string') named.set(c['name'], last);
      continue;
    }
    if (type === 'register') {
      const inst = typeof c['name'] === 'string' ? named.get(c['name']) : last;
      if (inst !== undefined && !isDead(inst)) registry.set(c['as'] as string, inst);
      continue;
    }
    if (type === 'module_definition' || type === 'module_instance') {
      last = { dead: 'module_definition / module_instance' };
      const n = (c['instance'] ?? c['name']) as string | undefined;
      if (n !== undefined) named.set(n, last);
      continue;
    }
    if (type === 'assert_uninstantiable') {
      // The module is valid and links, and its start / segments TRAP: what we write must still do so.
      const r = instantiate(c, at);
      if (!(r instanceof Error) && isDead(r)) miss(`assert_uninstantiable: ${r.dead}`);
      else {
        note.asserted.n++;
        if (!(r instanceof Error)) {
          problems.push(`${variant} line ${c['line']}: assert_uninstantiable: instantiated`);
        } else if (!(r instanceof WebAssembly.RuntimeError)) {
          problems.push(
            `${variant} line ${c['line']}: assert_uninstantiable: ${r.constructor.name}: ${
              r.message.slice(0, 100)
            }`,
          );
        }
      }
      continue;
    }
    const expect: Expect | undefined = expectOf(c);
    const a = c['action'] as
      | {
        type: string;
        module?: string;
        field: string;
        args?: { type: string; value?: unknown; lane_type?: string }[];
      }
      | undefined;
    if (expect === undefined || a === undefined) continue; // assert_invalid, assert_malformed, …
    const inst = target(a);
    if (inst === undefined || isDead(inst)) {
      miss(inst === undefined ? 'no instance' : inst.dead);
      continue;
    }
    const raw = invoke(inst, a);
    if (typeof raw === 'string') {
      miss(raw);
      continue;
    }
    note.asserted.n++;
    const v = meets(expect, raw);
    if (v.nanBoundary) note.nan.n++;
    if (v.problem !== undefined) {
      problems.push(`${variant} line ${c['line']} ${a.field}: ${v.problem}`);
    }
  }
}

/** The action, run; `undefined` when the JS API cannot make the call at all. */
function invoke(
  inst: Inst,
  a: {
    type: string;
    field: string;
    args?: { type: string; value?: unknown; lane_type?: string }[];
  },
): Raw | string {
  if (a.type === 'get') {
    const g = inst.get(a.field);
    if (!(g instanceof WebAssembly.Global)) return 'get: not a global export';
    try {
      return { ok: true, values: [g.value], wrapped: false };
    } catch {
      return 'get: a v128 global (the JS API cannot read it)';
    }
  }
  const args = a.args ?? [];
  const wrapped = inst.exports[wrapperName(inst.exportName(a.field))];
  // Only an UNWRAPPED call (a signature the script did not reveal) passes a float as a JS number.
  if (typeof wrapped !== 'function' && args.some(nanArgumentLost)) {
    return 'a NaN argument with a payload (the JS API cannot carry it)';
  }
  const f = typeof wrapped === 'function' ? wrapped : inst.get(a.field);
  if (typeof f !== 'function') return 'not a function export';
  const conv = (x: { type: string; value?: unknown }) =>
    // `ref.host n` is a host value as an `anyref` too: the same object an `externref` gets.
    x.type === 'anyref' && x.value !== 'null'
      ? { extern: x.value }
      : arg(x as { type: string; value: unknown });
  // Through a wrapper a float is its bits (an `i32` / `i64`): the payload of a NaN survives.
  const bitsOf = (x: { type: string; value?: unknown }) =>
    x.type === 'f32'
      ? Number(BigInt.asIntN(32, BigInt(x.value as string)))
      : x.type === 'f64'
      ? BigInt.asIntN(64, BigInt(x.value as string))
      : conv(x);
  const values = typeof wrapped === 'function'
    ? args.flatMap((x) => x.type === 'v128' ? v128Lanes({ ...x, value: x.value }) : [bitsOf(x)])
    : args.map(conv);
  try {
    const result = (f as (...x: unknown[]) => unknown)(...values);
    return {
      ok: true,
      values: Array.isArray(result) ? result : result === undefined ? [] : [result],
      wrapped: typeof wrapped === 'function',
      bits: typeof wrapped === 'function',
    };
  } catch (e) {
    // An argument or result the JS API cannot carry (a `v128` the script's types did not reveal,
    // a reference type JS has no value for).
    if (e instanceof TypeError) {
      return `JS API TypeError: ${e.message.replace(/d+/g, 'N').slice(0, 70)}`;
    }
    return {
      ok: false,
      kind: e instanceof RangeError
        ? 'exhaustion'
        : e instanceof WebAssembly.RuntimeError
        ? 'trap'
        : e instanceof WebAssembly.Exception
        ? 'exception'
        : 'other',
      detail: (e as Error).message ?? String(e),
    };
  }
}

/** The variants a script is run under, `original` first. */
export const VARIANTS: string[] = ['original', ...variants(new Uint8Array(0)).map(([n]) => n)];

/** Runs `script` under every variant. */
export function checkScript(script: ScriptInput): ScriptRow {
  const row = emptyRow(script.name);
  const sigs = signatures(script.commands);
  const engineRefused = new Set<number>();
  for (const variant of VARIANTS) {
    const note = {
      problems: [] as string[],
      asserted: { n: 0 },
      unchecked: {} as Record<string, number>,
      nan: { n: 0 },
      refused: { n: 0 },
    };
    run(script, variant, sigs, engineRefused, note);
    row.refused += note.refused.n;
    row.nanBoundary += note.nan.n;
    if (variant === 'original') {
      row.asserted = note.asserted.n;
      row.unchecked = note.unchecked;
      row.original = note.problems;
    } else {
      row.variantChecks += note.asserted.n;
      row.variant.push(...note.problems);
    }
  }
  return row;
}
