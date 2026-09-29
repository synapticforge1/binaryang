/**
 * @module binaryen-ts/tests/passes/asyncify_helpers
 *
 * What the Asyncify tests share with the comparison suite
 * (`comparison/tests/asyncify_vs_wasm_opt.compare.ts`): the fixtures, our
 * analyzer's instrument set, the full pipeline, and the unwind/rewind driver.
 * A plain module, not a test file — importing a `.test.ts` would register its
 * tests a second time wherever it was imported.
 *
 * @license MIT
 */

import { assertEquals } from '@std/assert';

import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { buildCallResultTypes, flattenFunction } from '../../../src/binaryen-ts/passes/flatten.ts';
import {
  analyzeModule,
  computeRelevantLocals,
  type FlowCtx,
  flowInstrumentFunction,
  localsInstrumentFunction,
  parseAsyncifyOptions,
  synthesizeRuntimeSupport,
} from '../../../src/binaryen-ts/passes/asyncify.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';

// ---------------------------------------------------------------------------
// Analyzer fixtures
// ---------------------------------------------------------------------------

export const IMPORT_CALL = `(module
  (import "env" "sleep" (func $sleep))
  (memory 1)
  (func $foo (call $sleep))
  (func $pure (result i32) (i32.const 1)))`;

export const TRANSITIVE = `(module
  (import "env" "sleep" (func $sleep))
  (memory 1)
  (func $a (call $b))
  (func $b (call $sleep))
  (func $c (result i32) (i32.const 0)))`;

export const INDIRECT = `(module
  (memory 1)
  (table 1 funcref)
  (type $v (func))
  (func $foo (call_indirect (type $v) (i32.const 0)))
  (func $pure (result i32) (i32.const 1)))`;

export const TWO_IMPORTS = `(module
  (import "env" "sleep" (func $sleep))
  (import "env" "log" (func $log))
  (memory 1)
  (func $foo (call $sleep))
  (func $bar (call $log)))`;

/** Our analyzer's instrument set for `wat` under `passArgs` (names sans `$`). */
export function ourInstrumentSet(wat: string, passArgs: Record<string, string>): Set<string> {
  const mod = readWat(wat);
  const { instrumentedFuncs } = analyzeModule(mod, parseAsyncifyOptions(passArgs));
  return new Set([...instrumentedFuncs].map((n) => (n.startsWith('$') ? n.slice(1) : n)));
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

/** Run the complete asyncify transformation over `mod` (in place). */
export function asyncify(mod: WasmModule, passArgs: Record<string, string> = {}): WasmModule {
  const opts = parseAsyncifyOptions(passArgs);
  const analysis = analyzeModule(mod, opts);
  const callResultTypes = buildCallResultTypes(mod);
  for (const func of mod.functions) {
    if (!analysis.instrumentedFuncs.has(func.name)) continue;
    flattenFunction(func, callResultTypes);
    const relevant = computeRelevantLocals(
      func,
      analysis.canChangeState,
      !opts.ignoreIndirect,
      analysis.addedFromList,
    );
    const flowCtx: FlowCtx = {
      func,
      canChangeState: analysis.canChangeState,
      canIndirect: !opts.ignoreIndirect,
      addedFromList: analysis.addedFromList,
      callIndex: { n: 0 },
      fakeGlobals: new Map(),
      savedCondTemps: new Set(),
    };
    flowInstrumentFunction(func, flowCtx);
    localsInstrumentFunction(func, flowCtx.fakeGlobals, [
      ...relevant,
      ...(flowCtx.savedCondTemps ?? []),
    ]);
  }
  synthesizeRuntimeSupport(mod, opts);
  return mod;
}

// ---------------------------------------------------------------------------
// Unwind/rewind driver
// ---------------------------------------------------------------------------

interface Exports {
  memory: WebAssembly.Memory;
  asyncify_start_unwind: (data: number) => void;
  asyncify_stop_unwind: () => void;
  asyncify_start_rewind: (data: number) => void;
  asyncify_stop_rewind: () => void;
  asyncify_get_state: () => number;
  [k: string]: unknown;
}

const DATA_PTR = 16;
const STACK_BASE = 24;
const STACK_END = 1024;

/**
 * Drive one export through a single suspend/resume, where the "async" import
 * `asyncImport` unwinds on the first hit and yields `asyncResult` on rewind.
 * Returns the export's final result.
 */
export function driveOnce(
  bytes: Uint8Array,
  exportName: string,
  args: number[],
  asyncImportName: string,
  asyncResult: number,
): number {
  // Holder lets the import closure reach the instance's exports, which only
  // exist after instantiation (which itself needs the closure).
  const box = { exp: undefined as unknown as Exports };
  let suspended = false;
  const asyncImport = (): number => {
    const e = box.exp;
    if (e.asyncify_get_state() === 2) { // rewinding — resuming the suspended call
      e.asyncify_stop_rewind();
      return asyncResult;
    }
    if (!suspended) { // first (normal) hit — begin the unwind
      suspended = true;
      e.asyncify_start_unwind(DATA_PTR);
      return 0; // ignored while unwinding
    }
    return asyncResult; // later normal calls (e.g. loop iterations) return directly
  };
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(bytes as BufferSource),
    { env: { [asyncImportName]: asyncImport } },
  );
  const exp = instance.exports as unknown as Exports;
  box.exp = exp;

  // Init the asyncify data struct: { stackPos, stackEnd }.
  const dv = new DataView(exp.memory.buffer);
  dv.setInt32(DATA_PTR, STACK_BASE, true);
  dv.setInt32(DATA_PTR + 4, STACK_END, true);

  const fn = exp[exportName] as (...a: number[]) => number;
  fn(...args); // first call — unwinds, returns a dummy
  assertEquals(exp.asyncify_get_state(), 1, 'expected Unwinding state after first call');
  exp.asyncify_stop_unwind();
  exp.asyncify_start_rewind(DATA_PTR);
  const result = fn(...args); // second call — rewinds + completes
  assertEquals(exp.asyncify_get_state(), 0, 'expected Normal state after completion');
  return result;
}

// ---------------------------------------------------------------------------
// End-to-end fixtures
// ---------------------------------------------------------------------------

/** compute(x) = x + get();  get() is the async import. */
export const ADD_GET = `(module
  (import "env" "get" (func $get (result i32)))
  (memory 1)
  (export "memory" (memory 0))
  (func $compute (export "compute") (param $x i32) (result i32)
    (i32.add (local.get $x) (call $get))))`;

/** Async import inside a loop: sum get() n times (locals must survive rewind). */
export const LOOP_GET = `(module
  (import "env" "get" (func $get (result i32)))
  (memory 1)
  (export "memory" (memory 0))
  (func $sum (export "sum") (param $n i32) (result i32)
    (local $i i32) (local $acc i32)
    (block $done
      (loop $lp
        (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $acc (i32.add (local.get $acc) (call $get)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)))
    (local.get $acc)))`;
