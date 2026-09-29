/**
 * @module binaryen-ts/tests/passes/asyncify_analyzer_test
 *
 * Stage 2 tests for the Asyncify ModuleAnalyzer: the whole-program analysis
 * that decides which functions can change the unwind/rewind state and must be
 * instrumented — unit tests on hand-built modules (precise control of the call
 * graph).
 *
 * The DIFFERENTIAL half — our instrument set against the real
 * `wasm-opt --asyncify --pass-arg=asyncify-verbose`, the authoritative oracle
 * for the ABI TinyGo depends on — lives in the comparison suite
 * (`comparison/tests/asyncify_vs_wasm_opt.compare.ts`, 1.7.0): it needs upstream
 * installed, and upstream is never part of the product or its gate.
 *
 * @license MIT
 */

import { assert, assertEquals } from '@std/assert';

import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import {
  analyzeModule,
  parseAsyncifyOptions,
  resolveAsyncifyImports,
} from '../../../src/binaryen-ts/passes/asyncify.ts';
import { ExternalKind } from '../../../src/wabt-ts/core/binary.ts';
import {
  IMPORT_CALL,
  INDIRECT,
  ourInstrumentSet,
  TRANSITIVE,
  TWO_IMPORTS,
} from './asyncify_helpers.ts';

Deno.test('analyzeModule — import caller is instrumented, pure function is not', () => {
  const s = ourInstrumentSet(IMPORT_CALL, {});
  assertEquals(s, new Set(['foo']));
});

Deno.test('analyzeModule — state change propagates transitively up the call graph', () => {
  const s = ourInstrumentSet(TRANSITIVE, {});
  assertEquals(s, new Set(['a', 'b']));
});

Deno.test('analyzeModule — indirect calls change state by default', () => {
  assertEquals(ourInstrumentSet(INDIRECT, {}), new Set(['foo']));
});

Deno.test('analyzeModule — asyncify-ignore-indirect drops indirect-only functions', () => {
  assertEquals(ourInstrumentSet(INDIRECT, { 'asyncify-ignore-indirect': '' }), new Set());
});

Deno.test('analyzeModule — asyncify-ignore-imports makes imports non-state-changing', () => {
  assertEquals(ourInstrumentSet(IMPORT_CALL, { 'asyncify-ignore-imports': '' }), new Set());
});

Deno.test('analyzeModule — asyncify-imports restricts to the listed imports', () => {
  const s = ourInstrumentSet(TWO_IMPORTS, { 'asyncify-imports': 'env.sleep' });
  assertEquals(s, new Set(['foo']));
});

Deno.test('analyzeModule — remove-list forces a function out of the set', () => {
  // $a calls $b calls import; removing $b stops propagation so only $b is
  // dropped AND $a no longer reaches a state-change → set is empty.
  const s = ourInstrumentSet(TRANSITIVE, { 'asyncify-removelist': '$b' });
  assertEquals(s, new Set());
});

Deno.test('analyzeModule — only-list restricts to exactly the listed functions', () => {
  const s = ourInstrumentSet(TRANSITIVE, { 'asyncify-onlylist': '$a' });
  assertEquals(s, new Set(['a']));
});

Deno.test('resolveAsyncifyImports — in-wasm asyncify.* import mode: topMost excluded, callers instrumented', () => {
  // `$park` calls asyncify.start_unwind (top of the runtime — must NOT be
  // instrumented); `$worker`/`$main` transitively call it and MUST be.
  const wat = `(module
    (import "asyncify" "start_unwind" (func $su (param i32)))
    (memory 1)
    (func $park (call $su (i32.const 0)))
    (func $worker (call $park))
    (func $main (call $worker)))`;
  const mod = readWat(wat);
  const importMode = resolveAsyncifyImports(mod);
  assert(importMode, 'should detect the in-wasm asyncify-import mode');
  assert(
    !mod.imports.some((i) => i.kind === ExternalKind.Func && i.module === 'asyncify'),
    'the asyncify.* import must be removed',
  );
  const res = analyzeModule(mod, parseAsyncifyOptions({}));
  assert(!res.instrumentedFuncs.has('$park'), 'park (topMost runtime) must NOT be instrumented');
  assert(res.instrumentedFuncs.has('$worker'), 'worker (calls park) must be instrumented');
  assert(res.instrumentedFuncs.has('$main'), 'main (transitive) must be instrumented');
});

Deno.test('resolveAsyncifyImports — returns false and no-ops when there are no asyncify imports', () => {
  const mod = readWat(TRANSITIVE);
  assert(!resolveAsyncifyImports(mod), 'no asyncify imports → host-driven mode');
});
