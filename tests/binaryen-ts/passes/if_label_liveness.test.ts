// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A branch to an `if`'s LABEL leaves the `if` — and liveness must know it (Q1).
//
// Upstream binaryen has no labels on `if` (its reader wraps one in a block), so
// the CFG builder this port inherited pushed none, and a branch to one resolved
// as an unknown label, which it read as "exits the function". Every local read
// after the `if` then looked dead from that branch, and CoalesceLocals turned
// the last `local.set` before it into a `drop`: `spec/if/if.wast`'s `effects`
// returned −2 instead of −14 at -O2 and up, on both routes. The module stayed
// VALID — only running it showed anything.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { writeWasm } from '../../../src/binaryen-ts/encoder/write-wasm.ts';
import { prepareForPasses, readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { buildCFG } from '../../../src/binaryen-ts/passes/cfg.ts';
import { makeBlock, makeBreak, makeRegion } from '../../../src/binaryen-ts/ir/expressions.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';

const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors), `assembles: ${JSON.stringify(r.errors)}`);
  return r.binary;
};
const ROUTES = {
  A: (b: Uint8Array): WasmModule => readForPasses(b),
  B: (b: Uint8Array): WasmModule =>
    prepareForPasses(readBinaryIr(b, makeErrorList(), { readDebugNames: true })) as WasmModule,
};
const effects = (b: Uint8Array) => {
  const x = new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports;
  const f = x.effects as (v: number) => number;
  return [f(1), f(0)];
};

/** `spec/if/if.wast`'s "effects", as written there. */
const EFFECTS = `(module
  (func (export "effects") (param i32) (result i32)
    (local i32)
    (if
      (block (result i32) (local.set 1 (i32.const 1)) (local.get 0))
      (then
        (local.set 1 (i32.mul (local.get 1) (i32.const 3)))
        (local.set 1 (i32.sub (local.get 1) (i32.const 5)))
        (local.set 1 (i32.mul (local.get 1) (i32.const 7)))
        (br 0)
        (local.set 1 (i32.mul (local.get 1) (i32.const 100))))
      (else
        (local.set 1 (i32.mul (local.get 1) (i32.const 5)))
        (local.set 1 (i32.sub (local.get 1) (i32.const 7)))
        (local.set 1 (i32.mul (local.get 1) (i32.const 3)))
        (br 0)
        (local.set 1 (i32.mul (local.get 1) (i32.const 1000)))))
    (local.get 1)))`;

describe('a branch to an if label (Q1)', () => {
  const bytes = asm(EFFECTS);
  it('the fixture is the spec test: -14 and -6', () => {
    assertEquals(effects(bytes), [-14, -6]);
  });
  for (const [route, load] of Object.entries(ROUTES)) {
    for (const [level, o, s] of [['-O2', 2, 0], ['-O3', 3, 0], ['-Oz', 2, 2]] as const) {
      it(`computes the same after ${level} (route ${route})`, () => {
        const m = load(bytes);
        new PassRunner(m, { optimizeLevel: o, shrinkLevel: s }).addDefaultOptimizationPasses()
          .run();
        assertEquals(effects(writeWasm(m)), [-14, -6]);
      });
    }
  }
  it('CoalesceLocals alone keeps the set the branch leaves live', () => {
    const m = ROUTES.A(bytes);
    new PassRunner(m).add('CoalesceLocals').run();
    assertEquals(effects(writeWasm(m)), [-14, -6]);
  });
});

describe('the CFG refuses a label no construct declares', () => {
  it('instead of reading it as a return — how Q1 stayed silent', () => {
    const body = makeRegion([makeBlock([makeBreak('$nowhere')], '$b')]);
    assertThrows(() => buildCFG(body, '$fn'), Error, 'no enclosing construct declares');
  });
  it('the function frame IS an exit', () => {
    const body = makeRegion([makeBreak('$fn')]);
    buildCFG(body, '$fn');
  });
});
