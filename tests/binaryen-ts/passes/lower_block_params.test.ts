// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Block-parameter lowering as a TREE pass (One front end, stage 2, R15), on both
// routes: A = binaryen-ts's decoder, B = the wabt-ts reader + prepareForPasses.
//
// It replaced a lowering that re-encoded the module and decoded it again with
// the decoder's `lowerBlockParams`, and that lowering was WRONG for two of the
// eight corpus modules with block parameters before any pass ran:
// `spec/fac/fac.0.wasm` (a back-edge whose values a multi-result call produces
// INSIDE the branch's condition) and `spec/if/if.0.wasm` (a one-armed
// parametrised `if`, which needs an `else` once its parameters are locals). The
// first tree-pass attempt then failed six of the eight, three of them for shapes
// kept here: parameters that pass straight through a region, a condition that is
// a multi-result call, and a `block` around `local.set`s of values it could not
// reach.
//
// ⚠️ Every assertion is made on the lowering ALONE as well as after -O2: a pass
// can repair — or hide — what the lowering got wrong. And "no parameters remain"
// is asserted, not assumed: a lowering that did nothing produced VALID modules,
// because the encoder writes parameters as written, and read as a success.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { prepareForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import {
  hasBlockParams,
  lowerBlockParams,
} from '../../../src/binaryen-ts/passes/lower-block-params.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { varName } from '../../../src/wabt-ts/ir/ir.ts';

const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors) && r.binary.length > 0, `assembles: ${JSON.stringify(r.errors)}`);
  assert(WebAssembly.validate(r.binary as BufferSource), 'the engine accepts the fixture');
  return r.binary;
};
const ROUTES = {
  A: (bytes: Uint8Array): WasmModule => parseWasm(bytes),
  B: (bytes: Uint8Array): WasmModule =>
    prepareForPasses(readBinaryIr(bytes, makeErrorList(), { readDebugNames: true })) as WasmModule,
};
const anyParams = (m: WasmModule) => m.functions.some((f) => hasBlockParams(f.body));
/** What `f` returns for each argument list, or why the module would not run. */
const results = (bytes: Uint8Array, args: readonly unknown[][]) => {
  let f: (...a: unknown[]) => unknown;
  try {
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports;
    f = x.f as typeof f;
  } catch (e) {
    return `rejected: ${(e as Error).message.slice(0, 100)}`;
  }
  return args.map((a) => String(f(...a)));
};

/** Each fixture is a shape that broke a lowering, and the arguments that show it. */
const FIXTURES: { name: string; wat: string; args: unknown[][]; routes?: string[] }[] = [
  {
    // `spec/fac/fac.0.wasm`'s "fac-ssa": the `br_if`'s two carried values are
    // produced inside its CONDITION, by `$pick0`, a two-result call. The decoder's
    // lowering wrote them before they existed; so did the first tree pass.
    name: 'a back-edge whose values a multi-result call in its condition produces',
    wat: `(module
      (func $pick0 (param i64) (result i64 i64) (local.get 0) (local.get 0))
      (func $pick1 (param i64 i64) (result i64 i64 i64)
        (local.get 0) (local.get 1) (local.get 0))
      (func (export "f") (param i64) (result i64)
        (i64.const 1) (local.get 0)
        (loop $l (param i64 i64) (result i64)
          (call $pick1) (call $pick1) (i64.mul)
          (call $pick1) (i64.const 1) (i64.sub)
          (call $pick0) (i64.const 0) (i64.gt_u)
          (br_if $l)
          (drop) (return))))`,
    // Not 0: `0 - 1` is compared UNSIGNED, and the original loops ~2^64 times.
    args: [[1n], [5n], [25n]],
  },
  {
    // `spec/if/if.0.wasm` f44: the parameters pass through a one-armed `if` that
    // consumes nothing. Without parameters it must have an `else`, and both arms
    // must put them back.
    name: 'a one-armed if its parameters pass straight through',
    wat: `(module
      (func (export "f") (param i32) (result i32)
        i32.const 1
        i32.const 2
        local.get 0
        if (param i32 i32) (result i32 i32)
        end
        i32.add))`,
    args: [[0], [1]],
  },
  {
    // `spec/block/block.0.wasm` f49: the same, for a block — the region never
    // mentions its parameters, so there is no `pop` to rewrite.
    name: 'a block its parameters pass straight through',
    wat: `(module
      (func (export "f") (param i32) (result i32)
        i32.const 1
        local.get 0
        block (param i32 i32) (result i32 i32)
        end
        i32.sub))`,
    args: [[0], [5]],
  },
  {
    // `spec/if/if.0.wasm` f50: the condition is the LAST value of a two-result
    // call whose FIRST value is the parameter. The condition's temporary took
    // the first value's type.
    name: 'an if whose condition and parameter come from one multi-result call',
    wat: `(module
      (func $carry (param i64 i64 i32) (result i64 i32) (local $k i64)
        (local.set $k
          (i64.add (i64.add (local.get 0) (local.get 1)) (i64.extend_i32_u (local.get 2))))
        (return (local.get $k) (i64.lt_u (local.get $k) (local.get 0))))
      (func (export "f") (param i64 i64) (result i64)
        (call $carry (local.get 0) (local.get 1) (i32.const 0))
        (if (param i64) (result i64) (then (drop) (i64.const -1)))))`,
    args: [[1n, 2n], [-1n, 1n], [-1n, 0n]],
  },
  {
    // Not taken, a `br_if` leaves its values ABOVE the entry values, and code
    // after it still takes those. A lowering that rewrote each entry `pop` into a
    // read of its local would read what the branch just WROTE there: 3, not 30.
    name: 'entry values still taken after a br_if back-edge that was not taken',
    wat: `(module
      (func (export "f") (param i32) (result i32)
        i32.const 10
        i32.const 20
        loop $l (param i32 i32) (result i32)
          i32.const 1
          i32.const 2
          local.get 0
          br_if $l
          drop
          drop
          i32.add
        end))`,
    args: [[0]],
    // 🔧 Route B only until Q3 was fixed: route A's decoder lost these entry
    // values before any lowering (dead_code_operands.test.ts).
  },
  {
    name: 'an unconditional back-edge',
    wat: `(module
      (func (export "f") (param i32) (result i32)
        (local.get 0)
        (loop $l (param i32) (result i32)
          (local.set 0)
          (if (i32.eqz (local.get 0)) (then (return (i32.const 42))))
          (br $l (i32.sub (local.get 0) (i32.const 1))))))`,
    args: [[0], [3]],
  },
  {
    name: 'a br_table whose every target is the same parametrised loop',
    wat: `(module
      (func (export "f") (param i32) (result i32)
        (local.get 0)
        (loop $l (param i32) (result i32)
          (local.set 0)
          (if (i32.eqz (local.get 0)) (then (return (i32.const 7))))
          (br_table $l $l (i32.sub (local.get 0) (i32.const 1)) (local.get 0)))))`,
    args: [[0], [2]],
  },
  {
    // A parametrised construct in an OPERAND, with an earlier operand evaluated
    // before its entry values: the split must keep that order.
    name: 'a parametrised block in an operand, after another operand',
    wat: `(module
      (global $g (mut i32) (i32.const 0))
      (func $bump (result i32) (global.set $g (i32.add (global.get $g) (i32.const 1)))
        (global.get $g))
      (func (export "f") (param i32) (result i32)
        (i32.sub
          (call $bump)
          (local.get 0)
          (block (param i32) (result i32)
            (i32.const 10) (i32.mul) (call $bump) (i32.add)))))`,
    args: [[1], [2]],
  },
  {
    // The targets MIX the parametrised loop (the default) with the function's
    // block: a trampoline, each case in its target's convention. Counts down to
    // index 0, which leaves with the last value, -1. The guard makes a lowering
    // that loses the loop's value TRAP rather than spin: the loop would re-read
    // a stale local forever, and a hung test names no culprit.
    name: 'a br_table mixing a parametrised loop with another target',
    wat: `(module
      (global $trips (mut i32) (i32.const 0))
      (func (export "f") (param i32) (result i32)
        (block $out (result i32)
          (local.get 0)
          (loop $l (param i32) (result i32)
            (local.set 0)
            (global.set $trips (i32.add (global.get $trips) (i32.const 1)))
            (if (i32.gt_u (global.get $trips) (i32.const 100)) (then unreachable))
            (br_table $out $l (i32.sub (local.get 0) (i32.const 1)) (local.get 0))))))`,
    args: [[0], [3]],
  },
];

describe('lowerBlockParams: each shape, lowered alone and at -O2, on both routes', () => {
  for (const { name, wat, args, routes } of FIXTURES) {
    for (const [route, load] of Object.entries(ROUTES)) {
      if (routes !== undefined && !routes.includes(route)) continue;
      it(`${name} (route ${route})`, () => {
        const bytes = asm(wat);
        const want = results(bytes, args);
        const m = load(bytes);
        assert(anyParams(m), 'the fixture keeps a block parameter — it discriminates');
        assert(lowerBlockParams(m) > 0, 'a function was lowered');
        assertEquals(anyParams(m), false, 'no parameter is left');
        assertEquals(results(encodeWasm(m), args), want, 'lowered alone: valid, and the same');

        const o = load(bytes);
        new PassRunner(o, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses()
          .run();
        assertEquals(results(encodeWasm(o), args), want, '-O2: valid, and the same');
      });
    }
  }
});

describe('lowerBlockParams: what it refuses rather than mis-lowers', () => {
  it('a br_on_* to a parametrised loop', () => {
    const bytes = asm(`(module
      (func (export "f") (param externref) (result i32)
        (i32.const 1)
        (loop $l (param i32) (result i32)
          (br_on_null $l (local.get 0))
          (drop))))`);
    for (const load of Object.values(ROUTES)) {
      assertThrows(() => lowerBlockParams(load(bytes)), Error, 'br_on_* to a parametrised loop');
    }
  });
});

describe('lowerBlockParams: a tree pass, not a round trip', () => {
  it('lowers a module renamed after decoding — names are never re-derived', () => {
    // The re-decoding lowering refused this: the decoder names entities by
    // index, so a renamed module would have got bodies calling names it no
    // longer had.
    // Renamed consistently — the export follows — so the module still encodes.
    const bytes = asm(FIXTURES[1]!.wat);
    const m = parseWasm(bytes);
    const f = m.functions[0]!;
    const old = f.name;
    f.name = '$renamed';
    for (const e of m.exports) {
      if (e.var.kind === 'name' && e.var.name === old) e.var = varName('$renamed');
    }
    assert(lowerBlockParams(m) > 0);
    assertEquals(anyParams(m), false);
    assertEquals(results(encodeWasm(m), FIXTURES[1]!.args), results(bytes, FIXTURES[1]!.args));
  });
});
