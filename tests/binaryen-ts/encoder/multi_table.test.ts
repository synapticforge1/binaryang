// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Several tables (W5). binaryen-ts's encoder REFUSED any module with more than
// one: element segments had been written as kind 0 (table 0) and the decoder read
// `call_indirect` against table 0. Both were fixed long before, but the guard
// stayed, and 164 spec modules could not be written back or optimized at all.
//
// Each table-indexed form is exercised against a table that is NOT table 0 —
// the only place a leftover "table 0" would show — with an imported table first,
// so the defined tables' indices are shifted too. Checked both ways: a decode ->
// encode is byte-identical, and every level on both routes (A = binaryen-ts's
// decoder, B = the wabt-ts reader + prepareForPasses) computes what the original
// does.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { prepareForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { type PassOptions, PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';

const WAT = `(module
  (import "env" "t0" (table $t0 2 funcref))
  (table $a 4 funcref)
  (table $b 4 externref)
  (type $r (func (result i32)))
  (func $one (type $r) (i32.const 1))
  (func $two (type $r) (i32.const 2))
  (func $three (type $r) (i32.const 3))
  ;; flag 2 (function indices, explicit table) and flag 6 (expressions)
  (elem (table $a) (i32.const 0) func $one $two)
  (elem (table $a) (i32.const 2) funcref (ref.func $three))
  (elem $late funcref (ref.func $three))
  (func (export "call") (param i32) (result i32)
    (call_indirect $a (type $r) (local.get 0)))
  (func (export "sizes") (result i32)
    (i32.add (i32.mul (table.size $a) (i32.const 100)) (table.size $b)))
  (func (export "grow") (result i32)
    (drop (table.grow $b (ref.null extern) (i32.const 2)))
    (table.size $b))
  (func (export "externs") (param externref) (result i32)
    (table.fill $b (i32.const 1) (local.get 0) (i32.const 2))
    (table.set $b (i32.const 0) (table.get $b (i32.const 2)))
    (i32.add
      (ref.is_null (table.get $b (i32.const 0)))
      (i32.mul (ref.is_null (table.get $b (i32.const 3))) (i32.const 10))))
  (func (export "copy") (result i32)
    (table.copy $t0 $a (i32.const 0) (i32.const 1) (i32.const 1))
    (call_indirect $t0 (type $r) (i32.const 0)))
  (func (export "init") (result i32)
    (table.init $a $late (i32.const 3) (i32.const 0) (i32.const 1))
    (call_indirect $a (type $r) (i32.const 3))))`;

const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors), `assembles: ${JSON.stringify(r.errors)}`);
  assert(WebAssembly.validate(r.binary as BufferSource), 'the engine accepts the fixture');
  return r.binary;
};
const ROUTES = {
  A: (b: Uint8Array): WasmModule => parseWasm(b),
  B: (b: Uint8Array): WasmModule =>
    prepareForPasses(readBinaryIr(b, makeErrorList(), { readDebugNames: true })) as WasmModule,
};
const LEVELS = [
  ['-O1', 1, 0],
  ['-O2', 2, 0],
  ['-O3', 3, 0],
  ['-Os', 2, 1],
  ['-Oz', 2, 2],
] as const satisfies readonly [string, PassOptions['optimizeLevel'], PassOptions['shrinkLevel']][];

/** Every export's result, with a fresh instance each — tables are state. */
function behaviour(bytes: Uint8Array): string[] {
  const run = (name: string, ...args: unknown[]) => {
    try {
      const t0 = new WebAssembly.Table({ element: 'anyfunc', initial: 2 });
      const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {
        env: { t0 },
      }).exports;
      return `${name} = ${(x[name] as (...a: unknown[]) => unknown)(...args)}`;
    } catch (e) {
      return `${name} ! ${(e as Error).message}`;
    }
  };
  return [
    run('call', 0),
    run('call', 1),
    run('call', 2),
    run('call', 3),
    run('sizes'),
    run('grow'),
    run('externs', { x: 1 }),
    run('copy'),
    run('init'),
  ];
}

describe('several tables (W5)', () => {
  const bytes = asm(WAT);
  const want = behaviour(bytes);

  it('the fixture does what it says', () => {
    // Slot 3 of `$a` is empty until `init` fills it: calling it traps (the
    // engine's wording is not pinned). `externs`: slots 1-2 of `$b` filled,
    // slot 0 copied from 2, slot 3 still null -> 0 + 1 * 10.
    assert(want[3]!.startsWith('call !'), `an empty slot traps: ${want[3]}`);
    assertEquals([...want.slice(0, 3), ...want.slice(4)], [
      'call = 1',
      'call = 2',
      'call = 3',
      'sizes = 404',
      'grow = 6',
      'externs = 10',
      'copy = 2',
      'init = 3',
    ]);
  });

  for (const [route, load] of Object.entries(ROUTES)) {
    it(`decode -> encode is byte-identical (route ${route})`, () => {
      assertEquals([...encodeWasm(load(bytes))], [...bytes]);
    });
    for (const [level, o, s] of LEVELS) {
      it(`${level} behaves the same (route ${route})`, () => {
        const m = load(bytes);
        new PassRunner(m, { optimizeLevel: o, shrinkLevel: s }).addDefaultOptimizationPasses()
          .run();
        assertEquals(behaviour(encodeWasm(m)), want);
      });
    }
  }
});
