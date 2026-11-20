// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Two defects the spec-expected check (C-R2-5, `scripts/spec-behaviour/script-run.ts`) found in
// `proposals/custom-descriptors`, which the differential could not see (a module with no invocation
// after it is never replayed):
//
// 1. `struct.new_desc` with a NULL descriptor traps, and the effect analysis said it was pure — so
//    RemoveUnusedModuleElements dropped a global whose initializer traps, and the three
//    `assert_trap (module …)` of `struct_new_desc.wast` INSTANTIATED under `-O1` … `-Oz`. Upstream
//    `wasm-opt -O1` keeps the global (measured 2026-11-20, version 133).
// 2. `ref.get_desc`'s derived type was exact for ANY exact operand and `(ref $b)` for the bottom
//    type, the engine's rule being: exact only for an operand exact AND of the named type, or `none`.
//    `--flatten`, which types its temporary by the expression, wrote modules the engine refused.
//
// Behaviour needs the V8 flag, which a test run cannot set (`custom_descriptors.test.ts`), so these
// are trees, types and bytes.

import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { deepEffects } from '../../../src/ir/effects.ts';
import { Result } from '../../../src/core/result.ts';
import { test } from 'node:test';

function asm(text: string): Uint8Array {
  const r = wat2wasm(text, { textForm: false });
  assert(r.result === Result.Ok, String(r.errors[0]?.message));
  return r.binary;
}

const TYPES = `(rec (type $a (descriptor $b) (struct)) (type $b (describes $a) (struct)))`;

test('a global whose initializer traps (struct.new_desc, null descriptor) survives every level', () => {
  const bytes = asm(`(module ${TYPES}
    (global (ref (exact $a)) (struct.new_desc $a (ref.null none))))`);
  for (const [o, s] of [[1, 0], [2, 0], [3, 0], [2, 1], [2, 2]] as const) {
    const m = readForPasses(bytes);
    assertEquals(m.globals.length, 1);
    new PassRunner(m, { optimizeLevel: o, shrinkLevel: s }).addDefaultOptimizationPasses().run();
    assertEquals(m.globals.length, 1, `-O${o} s${s} dropped the trapping global`);
    assertEquals(readForPasses(writeWasm(m)).globals.length, 1);
  }
});

test('an unused global with an initializer that cannot trap is still removed', () => {
  const m = readForPasses(asm('(module (global i32 (i32.const 1)))'));
  new PassRunner(m, { optimizeLevel: 1, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
  assertEquals(m.globals.length, 0);
});

test('struct.new_desc traps (a null descriptor); struct.new does not', () => {
  const m = readForPasses(asm(`(module ${TYPES}
    (global (ref (exact $a)) (struct.new_desc $a (ref.null none)))
    (type $s (struct))
    (global (ref $s) (struct.new_default $s)))`));
  assertEquals(deepEffects(m.globals[0]!.init!).trap, true);
  assertEquals(deepEffects(m.globals[1]!.init!).trap, false);
});

/** The types of the locals `--flatten` added to function 0 (after its parameters). */
function flattenedLocals(text: string): string[] {
  const m = readForPasses(asm(text));
  new PassRunner(m, { optimizeLevel: 0, shrinkLevel: 0 }).add('Flatten').run();
  const f = m.functions[0]!;
  return f.locals.slice(f.sig.params.length).map((l) => {
    const t = l.type as { heapType?: { kind: string } };
    return t.heapType?.kind ?? String(l.type);
  });
}

const SUB = `(rec
  (type $a (sub (descriptor $b) (struct))) (type $b (sub (describes $a) (struct)))
  (type $c (sub $a (descriptor $d) (struct))) (type $d (sub $b (describes $c) (struct))))`;

test('ref.get_desc: exact only for an operand exact AND of the named type, or the bottom type', () => {
  // exact $a, named $a: exact result.
  assertEquals(
    flattenedLocals(
      `(module ${TYPES} (func (param (ref (exact $a))) (result (ref (exact $b)))
        (ref.get_desc $a (local.get 0))))`,
    ).at(-1),
    'exact',
  );
  // ref.null none: exact result (the engine and the testsuite).
  assertEquals(
    flattenedLocals(
      `(module ${TYPES} (func (result (ref (exact $b))) (ref.get_desc $a (ref.null none))))`,
    ).at(-1),
    'exact',
  );
  // exact $c named $a: its own descriptor is a SUBtype of $a's — the result is (ref $b), NOT exact.
  assertEquals(
    flattenedLocals(
      `(module ${SUB} (func (param (ref (exact $c))) (result (ref $b))
        (ref.get_desc $a (local.get 0))))`,
    ).at(-1),
    'index',
  );
  // A non-exact operand: not exact.
  assertEquals(
    flattenedLocals(
      `(module ${TYPES} (func (param (ref $a)) (result (ref $b)) (ref.get_desc $a (local.get 0))))`,
    ).at(-1),
    'index',
  );
});
