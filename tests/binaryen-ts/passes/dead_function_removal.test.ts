// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Where dead functions are removed — aligned with upstream (owner decision,
// 2026-09-14; was divergence I1).
//
// Upstream's Inlining removes only functions it INLINED (`Inlining.cpp`,
// `inlinedUses.contains(name)`), and dead code is RemoveUnusedModuleElements'
// job, which upstream schedules before the function passes from -O2 and again
// at the end at EVERY level (`pass.cpp`, addDefaultGlobalOptimization{Pre,Post}
// Passes). Ours ran RemoveUnusedModuleElements at -Os / -Oz only, and let
// Inlining delete never-inlined dead functions as a side effect — so -O3 was the
// one other level that removed them, and -O1 / -O2 kept every one. Trial over
// the 421 corpus modules before deciding: -O1 / -O2 −39% bytes, -O3 −13%,
// -Os / -Oz unchanged, no new invalid output.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const WAT = `(module
  (table 1 funcref)
  (elem (i32.const 0) $in_table)
  (func $dead (result i32) (i32.const 99))
  (func $in_table (result i32) (i32.const 7))
  (func $start_fn)
  (start $start_fn)
  (func $callee (param i32) (result i32) (i32.add (local.get 0) (i32.const 1)))
  (func (export "f") (param i32) (result i32)
    (i32.add (call $callee (local.get 0)) (call_indirect (type 0) (i32.const 0)))))`;

function optimize(
  level: { optimizeLevel: 1 | 2 | 3; shrinkLevel: 0 | 1 | 2 },
  only?: string,
): WasmModule {
  const r = wat2wasm(WAT);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = parseWasm(r.binary);
  const runner = new PassRunner(mod, level);
  if (only) runner.add(only);
  else runner.addDefaultOptimizationPasses();
  runner.run();
  return mod;
}

/** Function names that survived, with the export found by its export entry. */
function survivors(mod: WasmModule): string[] {
  return mod.functions.map((fn) => fn.name);
}

function runF(mod: WasmModule): number {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(encodeWasm(mod) as BufferSource));
  return (inst.exports.f as (x: number) => number)(4);
}

for (
  const [label, level] of [
    ['-O1', { optimizeLevel: 1, shrinkLevel: 0 }],
    ['-O2', { optimizeLevel: 2, shrinkLevel: 0 }],
    ['-O3', { optimizeLevel: 3, shrinkLevel: 0 }],
    ['-Oz', { optimizeLevel: 2, shrinkLevel: 2 }],
  ] as const
) {
  Deno.test(`${label}: a function nothing references is removed`, () => {
    const mod = optimize(level);
    assertEquals(survivors(mod).includes('$dead'), false, survivors(mod).join(' '));
    assertEquals(runF(mod), 12);
  });

  Deno.test(`${label}: a function in a table, or the start function, is kept`, () => {
    const names = survivors(optimize(level));
    assert(names.includes('$in_table'), names.join(' '));
    assert(names.includes('$start_fn'), names.join(' '));
  });
}

Deno.test('Inlining alone keeps a dead function it never inlined — that is not its job', () => {
  const names = survivors(optimize({ optimizeLevel: 3, shrinkLevel: 0 }, 'Inlining'));
  assert(names.includes('$dead'), names.join(' '));
});

Deno.test('Inlining alone still removes a function it inlined at every call site', () => {
  const names = survivors(optimize({ optimizeLevel: 3, shrinkLevel: 0 }, 'Inlining'));
  assertEquals(names.includes('$callee'), false, names.join(' '));
});
