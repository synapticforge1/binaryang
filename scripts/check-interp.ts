// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The interpreter against the spec testsuite (open-work 23, stage E3).
 *
 * Every manifest's `assert_return`, `assert_trap` and `assert_exhaustion` is
 * replayed on `interp/interpreter.ts`, and the outcome compared with what the
 * MANIFEST expects — here the testsuite is the oracle, not an engine: the
 * interpreter is a second implementation of the spec, and its result must be
 * the spec's. Values compare by bits; `nan:canonical` / `nan:arithmetic` as the
 * spec defines them; a trap by its message.
 *
 * An assertion the interpreter cannot run — it STOPPED (an instruction it does
 * not run yet, a host import it was not given) — is counted by reason, never
 * as a pass and never as a failure. The counts are its coverage, and they
 * should only fall as increments land.
 *
 * Verdict: exit 1 on any FAIL — a wrong value, a missing or wrong trap, a JS
 * error out of the interpreter.
 *
 * Usage: `deno task interp <prepared spec dir>... [--verbose] [--only=a,b]` — each a corpus
 * `deno task spec:prepare` writes: the gate passes the core suite, the legacy-EH suite
 * (`testsuite-main/legacy`) and each `proposals/<name>` the `proposals` step prepares
 * (owner, 2026-10-07: "Yes (runs everywhere)"). Totals are per corpus and overall.
 */

import { readForPasses } from '../src/binaryen-ts/ir/prepare.ts';
import {
  type HostImport,
  Interpreter,
  MemoryCell,
  NULL,
  Stop,
  TableCell,
  Trap,
  type Value,
  WasmException,
} from '../src/binaryen-ts/interp/interpreter.ts';
import { ExternalKind } from '../src/wabt-ts/core/binary.ts';
import { ValType } from '../src/binaryen-ts/ir/types.ts';
import { f32BitsOf, f64BitsOf } from '../src/binaryen-ts/ir/expressions.ts';

interface Arg {
  type: string;
  /** A `v128`'s lane type (`i8` … `f64`); its `value` is then one string per lane. */
  lane_type?: string;
  value?: string | string[];
}
interface Action {
  type: 'invoke' | 'get';
  module?: string;
  field: string;
  args?: Arg[];
}
interface Command {
  type: string;
  line: number;
  filename?: string;
  name?: string;
  as?: string;
  action?: Action;
  expected?: Arg[];
  /**
   * A relaxed-SIMD assertion: the result may be ANY of these (one value each),
   * as the spec lists the alternatives an engine may pick. The interpreter
   * computes the deterministic profile; the harness accepts any (owner,
   * 2026-10-07).
   */
  either?: Arg[];
  text?: string;
}

/** Instructions one invocation may run. The suite's longest takes far fewer. */
const FUEL = 50_000_000;

/** Every prepared corpus to run — the core suite, the legacy-EH suite, each proposal's. */
const roots = Deno.args.filter((a) => !a.startsWith('--'));
const verbose = Deno.args.includes('--verbose');
/** `--only=a,b`: just those manifests — to read one area's numbers (never in the gate). */
const only = Deno.args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
if (roots.length === 0) {
  console.error('usage: deno task interp <prepared spec dir>... [--verbose] [--only=a,b]');
  Deno.exit(2);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Bytes per lane of a `v128`'s lane type. */
const LANE_BYTES: Record<string, number> = { i8: 1, i16: 2, i32: 4, i64: 8, f32: 4, f64: 8 };

/** A manifest `v128` — a lane type and one unsigned integer (or bits) per lane — as bytes. */
function v128Bytes(a: Arg): Uint8Array | null {
  if (a.type !== 'v128' || !Array.isArray(a.value) || a.lane_type === undefined) return null;
  const n = LANE_BYTES[a.lane_type];
  if (n === undefined || a.value.length * n !== 16) return null;
  const bytes = new Uint8Array(16);
  const v = new DataView(bytes.buffer);
  for (const [i, lane] of a.value.entries()) {
    if (!/^\d+$/.test(lane)) return null; // a NaN pattern: an expectation, never a value
    const x = BigInt(lane);
    if (n === 1) v.setUint8(i, Number(x & 0xffn));
    else if (n === 2) v.setUint16(2 * i, Number(x & 0xffffn), true);
    else if (n === 4) v.setUint32(4 * i, Number(BigInt.asUintN(32, x)), true);
    else v.setBigUint64(8 * i, BigInt.asUintN(64, x), true);
  }
  return bytes;
}

/** A manifest value as a runtime value, or `null` for one that is not a value. */
function toValue(a: Arg): Value | null {
  if (a.type === 'v128') {
    const bytes = v128Bytes(a);
    return bytes === null ? null : { type: ValType.V128, bytes };
  }
  if (typeof a.value !== 'string' || a.value.startsWith('nan:')) return null;
  switch (a.type) {
    case 'i32':
      return { type: ValType.I32, value: Number(BigInt.asIntN(32, BigInt(a.value))) };
    case 'i64':
      return { type: ValType.I64, value: BigInt.asIntN(64, BigInt(a.value)) };
    case 'f32':
      return { type: ValType.F32, bits: Number(BigInt.asUintN(32, BigInt(a.value))) };
    case 'f64':
      return { type: ValType.F64, bits: BigInt.asUintN(64, BigInt(a.value)) };
    default: {
      const r = refExpectation(a);
      if (r === 'null') return NULL;
      // As an ARGUMENT only a value can be built: a host extern, or one in `any`.
      if (r !== null && typeof r === 'object' && 'extern' in r) {
        return { type: 'ref', kind: 'extern', host: r.extern };
      }
      if (r !== null && typeof r === 'object' && 'hostany' in r) {
        return { type: 'ref', kind: 'hostany', host: r.hostany };
      }
      return null;
    }
  }
}

/** The bottom reference types: only null is in them. */
const NULL_TYPES = new Set(['nullref', 'nullfuncref', 'nullexternref', 'nullexnref', 'refnull']);

/**
 * With no value, a manifest reference type asks for ANY non-null value of a
 * kind (wast's `(ref.func)`, `(ref.struct)`, …): which interpreter reference
 * kinds that admits.
 */
const NON_NULL_OF: Record<string, readonly string[]> = {
  funcref: ['func'],
  externref: ['extern'],
  exnref: ['exn'],
  anyref: ['i31', 'struct', 'array', 'hostany'],
  eqref: ['i31', 'struct', 'array'],
  i31ref: ['i31'],
  structref: ['struct'],
  arrayref: ['array'],
};

/**
 * What a manifest reference value asks for: `null`; a non-null value of some
 * kinds; an extern host value by its string; a host value brought into `any`
 * (`anyref` with a number); or `null` (the JS value) for one this harness
 * cannot judge.
 */
function refExpectation(
  a: Arg,
): 'null' | { kinds: readonly string[] } | { extern: string } | { hostany: string } | null {
  const isRefType = NULL_TYPES.has(a.type) || a.type in NON_NULL_OF;
  if (!isRefType) return null;
  if (a.value === 'null' || (a.value === undefined && NULL_TYPES.has(a.type))) return 'null';
  if (a.value === undefined) return { kinds: NON_NULL_OF[a.type]! };
  if (typeof a.value === 'string' && /^\d+$/.test(a.value)) {
    if (a.type === 'externref') return { extern: a.value };
    if (a.type === 'anyref') return { hostany: a.value };
  }
  return null;
}

/** Whether the harness can judge an expected value at all. */
const checkable = (w: Arg): boolean =>
  toValue(w) !== null || refExpectation(w) !== null ||
  (typeof w.value === 'string' && w.value.startsWith('nan:')) ||
  (w.type === 'v128' && Array.isArray(w.value) && w.lane_type !== undefined &&
    w.value.every((l) => /^\d+$/.test(l) || l === 'nan:canonical' || l === 'nan:arithmetic'));

/** Whether a `v128` result matches lane by lane: bits, or a NaN pattern per float lane. */
function matchesV128(want: Arg, got: Uint8Array): boolean {
  const lanes = want.value as string[];
  const n = LANE_BYTES[want.lane_type!]!;
  const v = new DataView(got.buffer, got.byteOffset, 16);
  return lanes.every((lane, i) => {
    const at = i * n;
    const bits = n === 1
      ? BigInt(v.getUint8(at))
      : n === 2
      ? BigInt(v.getUint16(at, true))
      : n === 4
      ? BigInt(v.getUint32(at, true))
      : v.getBigUint64(at, true);
    if (lane === 'nan:canonical') {
      return n === 4
        ? (bits & 0x7fffffffn) === 0x7fc00000n
        : (bits & 0x7fffffffffffffffn) === 0x7ff8000000000000n;
    }
    if (lane === 'nan:arithmetic') {
      return n === 4
        ? (bits & 0x7fc00000n) === 0x7fc00000n
        : (bits & 0x7ff8000000000000n) === 0x7ff8000000000000n;
    }
    return bits === BigInt.asUintN(n * 8, BigInt(lane));
  });
}

/** Whether `got` is what `want` asks for — bits, a NaN pattern, a vector's lanes, or a reference. */
function matches(want: Arg, got: Value): boolean {
  if (want.type === 'v128') return got.type === ValType.V128 && matchesV128(want, got.bytes);
  const ref = refExpectation(want);
  if (ref !== null) {
    if (got.type !== 'ref') return false;
    if (ref === 'null') return got.kind === 'null';
    if ('kinds' in ref) return ref.kinds.includes(got.kind);
    if ('extern' in ref) return got.kind === 'extern' && got.host === ref.extern;
    return got.kind === 'hostany' && got.host === ref.hostany;
  }
  if (typeof want.value !== 'string') return false;
  const nan = want.value.startsWith('nan:') ? want.value.slice(4) : null;
  if (want.type === 'f32' && got.type === ValType.F32) {
    const bits = got.bits >>> 0;
    if (nan === 'canonical') return (bits & 0x7fffffff) === 0x7fc00000;
    if (nan === 'arithmetic') return (bits & 0x7fc00000) === 0x7fc00000;
  }
  if (want.type === 'f64' && got.type === ValType.F64) {
    const bits = BigInt.asUintN(64, got.bits);
    if (nan === 'canonical') return (bits & 0x7fffffffffffffffn) === 0x7ff8000000000000n;
    if (nan === 'arithmetic') return (bits & 0x7ff8000000000000n) === 0x7ff8000000000000n;
  }
  const w = toValue(want);
  if (w === null || w.type !== got.type) return false;
  switch (w.type) {
    case ValType.I32:
      return (w.value | 0) === ((got as typeof w).value | 0);
    case ValType.I64:
      return w.value === BigInt.asIntN(64, (got as typeof w).value);
    case ValType.F32:
      return w.bits >>> 0 === (got as typeof w).bits >>> 0;
    case ValType.F64:
      return w.bits === BigInt.asUintN(64, (got as typeof w).bits);
    default:
      return false;
  }
}

const show = (v: Value): string =>
  v.type === 'ref'
    ? (v.kind === 'extern' ? `ref.extern ${v.host}` : `ref.${v.kind}`)
    : v.type === ValType.I32 || v.type === ValType.I64
    ? `${v.type === ValType.I32 ? 'i32' : 'i64'}:${v.value}`
    : v.type === ValType.F32
    ? `f32:0x${(v.bits >>> 0).toString(16)}`
    : v.type === ValType.F64
    ? `f64:0x${BigInt.asUintN(64, v.bits).toString(16)}`
    : v.type === ValType.V128
    ? `v128:0x${[...v.bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
    : '?';

// ---------------------------------------------------------------------------
// Imports: `spectest`, and what `register` names
// ---------------------------------------------------------------------------

/** `spectest`, as `spec/interpreter` defines it; one instance per script, so its memory is shared. */
function spectest(
  field: string,
  memory: () => MemoryCell,
  table: () => TableCell<Value>,
): HostImport | undefined {
  switch (field) {
    case 'table':
      return { kind: 'table', cell: table() };
    case 'memory':
      return { kind: 'memory', cell: memory() };
    case 'global_i32':
      return { kind: 'global', cell: { value: { type: ValType.I32, value: 666 } } };
    case 'global_i64':
      return { kind: 'global', cell: { value: { type: ValType.I64, value: 666n } } };
    case 'global_f32':
      return { kind: 'global', cell: { value: { type: ValType.F32, bits: f32BitsOf(666.6) } } };
    case 'global_f64':
      return { kind: 'global', cell: { value: { type: ValType.F64, bits: f64BitsOf(666.6) } } };
    default:
      return field.startsWith('print') ? { kind: 'func', call: () => [] } : undefined;
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const tally = { pass: 0, fail: 0, stopped: 0, modules: 0, modulesStopped: 0 };
const stops = new Map<string, number>();
const failures: string[] = [];
const stopKey = (s: Stop): string =>
  s.message.startsWith('unsupported: state shared with code that stopped')
    ? 'state shared with code that stopped (any reason)'
    : s.message.replace(/ 0x[0-9a-f]+$/, ' …');

let manifests = 0;
const perRoot: { root: string; pass: number; fail: number; stopped: number }[] = [];
for (const root of roots) {
  const before = { ...tally };
  const dirs = [...Deno.readDirSync(root)].filter((e) => e.isDirectory).map((e) => e.name)
    .filter((d) => only === undefined || only.includes(d)).sort();
  manifests += dirs.length;
  for (const dir of dirs) {
    let manifest: { commands: Command[] };
    try {
      manifest = JSON.parse(Deno.readTextFileSync(`${root}/${dir}/${dir}.json`));
    } catch {
      continue;
    }
    const named = new Map<string, Interpreter | Stop>();
    const registered = new Map<string, Interpreter>();
    let current: Interpreter | Stop | null = null;

    let spectestMemory: MemoryCell | undefined;
    const memory = () =>
      spectestMemory ??= new MemoryCell({ initial: 1n, max: 2n, isShared: false, is64: false });
    let spectestTable: TableCell<Value> | undefined;
    const table = () =>
      spectestTable ??= new TableCell<Value>(
        { initial: 10n, max: 20n, isShared: false, is64: false },
        NULL,
      );
    const imports = (module: string, field: string): HostImport | undefined => {
      if (module === 'spectest') return spectest(field, memory, table);
      const inst = registered.get(module);
      if (inst === undefined) return undefined;
      switch (inst.exportKind(field)) {
        case ExternalKind.Func:
          return {
            kind: 'func',
            call: (args) => inst.invoke(field, args),
            func: inst.funcRefOf(field),
          };
        case ExternalKind.Global:
          return { kind: 'global', cell: inst.globalCell(field) };
        case ExternalKind.Tag:
          return { kind: 'tag', cell: inst.tagCell(field) };
        case ExternalKind.Table:
          return { kind: 'table', cell: inst.tableCell(field) };
        case ExternalKind.Memory:
          return { kind: 'memory', cell: inst.memoryCell(field) };
        default:
          return undefined;
      }
    };
    // The instances a module being loaded imports from. If it STOPS while being
    // set up, it may have stopped before writes the spec says land in their
    // shared memory or globals (`linking.wast`: data written, then the start
    // function traps) — so their state is no longer the spec's, and every later
    // assertion on them is stopped too, never a pass or a failure.
    const touched = new Set<Interpreter>();
    // Which instances share state — an importer and every instance it imported
    // from, both ways. A partial write through a shared memory, table or global
    // reaches every instance in the group, so a taint does too.
    const links = new Map<Interpreter, Set<Interpreter>>();
    const link = (a: Interpreter, b: Interpreter) => {
      if (!links.has(a)) links.set(a, new Set());
      if (!links.has(b)) links.set(b, new Set());
      links.get(a)!.add(b);
      links.get(b)!.add(a);
    };
    const taintAll = (start: Iterable<Interpreter>, why: Stop) => {
      const stop = new Stop(why.reason, `state shared with code that stopped (${why.message})`);
      const group = new Set<Interpreter>();
      const todo = [...start];
      while (todo.length > 0) {
        const inst = todo.pop()!;
        if (group.has(inst)) continue;
        group.add(inst);
        todo.push(...(links.get(inst) ?? []));
      }
      for (const inst of group) {
        for (const [k, v] of registered) if (v === inst) registered.delete(k);
        for (const [k, v] of named) if (v === inst) named.set(k, stop);
        if (current === inst) current = stop;
      }
    };
    const taint = (why: Stop) => taintAll(touched, why);
    const taintInstance = (inst: Interpreter, why: Stop) => taintAll([inst], why);
    const load = (filename: string) => {
      touched.clear();
      try {
        const inst = new Interpreter(
          readForPasses(Deno.readFileSync(`${root}/${dir}/${filename}`)),
          {
            imports: (m, f) => {
              const from = registered.get(m);
              if (from !== undefined) touched.add(from);
              return imports(m, f);
            },
          },
        );
        for (const from of touched) link(inst, from);
        return inst;
      } catch (e) {
        if (e instanceof Stop) taint(e);
        throw e;
      }
    };

    for (const cmd of manifest.commands) {
      const where = `${dir}:${cmd.line}`;
      if (cmd.type === 'assert_uninstantiable' && cmd.filename) {
        // The module links and its instantiation TRAPS — a data segment out of
        // bounds, a start function that traps.
        try {
          load(cmd.filename);
          tally.fail++;
          failures.push(`${where}: instantiated, want trap "${cmd.text}"`);
        } catch (e) {
          if (e instanceof Stop) {
            tally.stopped++;
            stops.set(stopKey(e), (stops.get(stopKey(e)) ?? 0) + 1);
          } else if (e instanceof Trap && e.message.startsWith(cmd.text ?? '')) tally.pass++;
          else {
            tally.fail++;
            failures.push(
              `${where}: ${
                e instanceof Trap ? `trapped "${e.message}"` : `threw ${e}`
              }, want "${cmd.text}"`,
            );
          }
        }
        continue;
      }
      if (cmd.type === 'module' && cmd.filename) {
        tally.modules++;
        try {
          current = load(cmd.filename);
        } catch (e) {
          if (e instanceof Trap) {
            // The suite instantiates every plain `module`: a trap here is wrong.
            tally.fail++;
            failures.push(`${where}: instantiation trapped "${e.message}"`);
            current = new Stop('unsupported', 'a module whose instantiation trapped');
          } else if (!(e instanceof Stop)) {
            // A module the reader takes and the interpreter cannot set up is a
            // stop of its own kind, not a pass: count it.
            current = new Stop(
              'unsupported',
              `instantiate: ${e instanceof Error ? e.message.slice(0, 60) : e}`,
            );
          } else current = e;
          tally.modulesStopped++;
        }
        if (cmd.name) named.set(cmd.name, current);
        continue;
      }
      if (cmd.type === 'register' && cmd.as) {
        const inst = cmd.name ? named.get(cmd.name) : current;
        if (inst instanceof Interpreter) registered.set(cmd.as, inst);
        continue;
      }
      if (
        !['assert_return', 'assert_trap', 'assert_exhaustion', 'assert_exception', 'action']
          .includes(
            cmd.type,
          ) ||
        !cmd.action
      ) continue;

      const target = cmd.action.module ? named.get(cmd.action.module) : current;
      const stopped = (s: Stop) => {
        if (cmd.type === 'action') return;
        tally.stopped++;
        const k = stopKey(s);
        stops.set(k, (stops.get(k) ?? 0) + 1);
      };
      if (!(target instanceof Interpreter)) {
        if (target instanceof Stop) stopped(target);
        continue;
      }
      const args = (cmd.action.args ?? []).map(toValue);
      if (args.some((a) => a === null)) {
        stopped(
          new Stop(
            'unsupported',
            `a ${cmd.action.args!.find((a) => toValue(a) === null)!.type} argument`,
          ),
        );
        continue;
      }
      let outcome: { values: Value[] } | { trap: string } | { exception: string };
      target.refuel(FUEL);
      try {
        outcome = cmd.action.type === 'get'
          ? { values: [target.global(cmd.action.field)] }
          : { values: target.invoke(cmd.action.field, args as Value[]) };
      } catch (e) {
        // Out of fuel is NOT a stop here: every testsuite invocation finishes, so
        // one that does not is wrong — and without the limit it hangs the run.
        if (e instanceof Stop && e.reason !== 'fuel') {
          // It stopped PART WAY: whatever it wrote before stopping — memory, a
          // table, a global — is not the state the suite's next commands assume
          // (`ref_eq.wast`'s `(invoke "init")` stopped on `struct.new`, and every
          // `eq` after it compared nulls). Its instance is stopped from here on.
          stopped(e);
          taintInstance(target, e);
          continue;
        }
        if (e instanceof Trap) outcome = { trap: e.message };
        else if (e instanceof WasmException) outcome = { exception: e.tag.name };
        else {
          tally.fail++;
          failures.push(
            `${where} ${cmd.action.field}: interpreter threw ${e instanceof Error ? e.message : e}`,
          );
          continue;
        }
      }
      const got = 'trap' in outcome
        ? `trapped "${outcome.trap}"`
        : 'exception' in outcome
        ? `threw an exception (tag ${outcome.exception})`
        : `returned [${outcome.values.map(show).join(' ')}]`;
      if (cmd.type === 'action') {
        // A bare action must complete: the suite has no expectation for it to fail.
        if (!('values' in outcome)) {
          tally.fail++;
          failures.push(`${where} ${cmd.action.field}: the action ${got}`);
        }
        continue;
      }

      let ok: boolean;
      let detail = '';
      if (cmd.type === 'assert_return') {
        // One expected list — or, for a relaxed-SIMD `either`, several
        // single-value alternatives, any of which is a pass.
        const alternatives = cmd.either !== undefined
          ? cmd.either.map((a) => [a])
          : [cmd.expected ?? []];
        const unjudged = alternatives.flat().find((w) => !checkable(w));
        if (unjudged !== undefined) {
          stopped(new Stop('unsupported', `an expected ${unjudged.type}`));
          continue;
        }
        ok = 'values' in outcome &&
          alternatives.some((want) =>
            (outcome as { values: Value[] }).values.length === want.length &&
            want.every((w, i) => matches(w, (outcome as { values: Value[] }).values[i]!))
          );
        detail = `${got}, want ${
          alternatives.map((want) => `[${want.map((w) => `${w.type}:${w.value}`).join(' ')}]`)
            .join(' or ')
        }`;
      } else if (cmd.type === 'assert_exception') {
        // An exception that leaves the invocation uncaught — not a trap.
        ok = 'exception' in outcome;
        detail = `${got}, want an uncaught exception`;
      } else {
        // assert_trap / assert_exhaustion: a trap whose message STARTS with the
        // expected text (the spec's convention; D3's prefix rule).
        ok = 'trap' in outcome && outcome.trap.startsWith(cmd.text ?? '');
        detail = `${got}, want trap "${cmd.text}"`;
      }
      if (ok) tally.pass++;
      else {
        tally.fail++;
        failures.push(`${where} ${cmd.action.field}: ${detail}`);
      }
    }
  }

  perRoot.push({
    root,
    pass: tally.pass - before.pass,
    fail: tally.fail - before.fail,
    stopped: tally.stopped - before.stopped,
  });
}

const run = tally.pass + tally.fail;
console.log(
  `interpreter vs spec testsuite — ${roots.length} corpora, ${manifests} manifests, ${tally.modules} modules`,
);
for (const r of perRoot) {
  console.log(
    `  ${
      r.root.split(/[\\/]/).slice(-2).join('/')
    }: pass ${r.pass}, FAIL ${r.fail}, stopped ${r.stopped}`,
  );
}
console.log(
  `  pass ${tally.pass}   FAIL ${tally.fail}   stopped ${tally.stopped}   (ran ${run} of ${
    run + tally.stopped
  })`,
);
console.log(`  modules the interpreter could not set up: ${tally.modulesStopped}`);
const top = [...stops].sort((a, b) => b[1] - a[1]);
console.log('  stopped, by reason:');
for (const [k, n] of verbose ? top : top.slice(0, 15)) {
  console.log(`    ${String(n).padStart(6)}  ${k}`);
}
if (failures.length > 0) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures.slice(0, verbose ? Infinity : 40)) console.log(`  ${f}`);
}
console.log(
  tally.fail === 0
    ? '\nTOTAL — every assertion the interpreter ran holds.'
    : `\n${tally.fail} FAILED`,
);
Deno.exit(tally.fail === 0 ? 0 : 1);
