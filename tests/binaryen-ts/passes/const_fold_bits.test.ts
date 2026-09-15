// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Constant folding over float BITS (S6 step 5, stage C1) -- and the two defects
// that the bits found, both measured on `main` before the change:
//
//  - `f32.reinterpret_i32` of a constant folded to an i32 CONSTANT holding a
//    float, so `-O2` emitted an INVALID module. `deno task optimize-corpus`
//    never saw it: no corpus module reinterprets a constant.
//  - `i32.reinterpret_f32` of a signalling NaN folded through a JS number, which
//    quiets it: `-O2` returned 0x7fc00000 where the unoptimized module returned
//    0x7fa00000.
//
// And the key LocalCSE uses: `${-0}` is `"0"`, so a number-keyed `0.0` and
// `-0.0` were ONE key, which would let CSE substitute one for the other.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import {
  BinaryOp,
  makeBinary,
  makeF64ConstBits,
  makeLocalGet,
  makeLocalSet,
  makeRegion,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { varIndex } from '../../../src/wabt-ts/ir/ir.ts';

/** `-O2` over the module, as `Module.optimize('-O2')` runs it. */
function optimized(bytes: Uint8Array): Uint8Array {
  const m = parseWasm(bytes);
  const r = new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 });
  r.addDefaultOptimizationPasses();
  r.run();
  return encodeWasm(m);
}

async function call(bytes: Uint8Array, arg?: number): Promise<unknown> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  return (instance.exports.f as (x?: number) => unknown)(arg);
}

describe('constant folding keeps float bits', () => {
  it('f32.reinterpret_i32 of a constant folds to an F32 -- -O2 stays valid', async () => {
    // 1065353216 = 0x3f800000 = 1.0f
    const bytes = wat2wasm(
      `(module (func (export "f") (result f32) (f32.reinterpret_i32 (i32.const 1065353216))))`,
    ).binary;
    const out = optimized(bytes);
    assert(WebAssembly.validate(out as BufferSource), '-O2 produced an invalid module');
    assertEquals(await call(out), 1);
    assertEquals(await call(out), await call(bytes));
  });

  it('i32.reinterpret_f32 of a signalling NaN folds to its exact bits', async () => {
    const bytes = wat2wasm(
      `(module (func (export "f") (result i32) (i32.reinterpret_f32 (f32.const nan:0x200000))))`,
    ).binary;
    assertEquals(await call(bytes), 0x7fa00000);
    assertEquals(await call(optimized(bytes)), 0x7fa00000);
  });

  it('i64.reinterpret_f64 of a signalling NaN folds to its exact bits', async () => {
    const bytes = wat2wasm(
      `(module (func (export "f") (result i64)
        (i64.reinterpret_f64 (f64.const nan:0x4000000000000))))`,
    ).binary;
    const want = 0x7ff4000000000000n;
    assertEquals(await call(bytes), want);
    assertEquals(await call(optimized(bytes)), want);
  });

  it('LocalCSE keeps 0.0 and -0.0 apart', async () => {
    // `x + 0.0` then `x + -0.0`, both reaching the result. For x = -0 they
    // differ: (-0) + 0.0 is +0, (-0) + (-0.0) is -0. Built from BITS, because
    // wabt-ts's WAT parser drops the sign of the integer-spelled `-0`.
    const m = new ModuleBuilder();
    m.addFunction(
      'f',
      [ValType.F64],
      [ValType.F64],
      makeRegion([
        makeLocalSet(
          varIndex(1),
          makeBinary(BinaryOp.AddF64, makeLocalGet(varIndex(0), ValType.F64), makeF64ConstBits(0n)),
        ),
        makeBinary(
          BinaryOp.AddF64,
          makeLocalGet(varIndex(0), ValType.F64),
          makeF64ConstBits(0x8000000000000000n),
        ),
      ], ValType.F64),
      [{ type: ValType.F64 }],
    );
    m.addExport('f', 'f');
    const bytes = encodeWasm(m.build());
    assert(Object.is(await call(bytes, -0), -0), 'the fixture itself must yield -0');
    assert(Object.is(await call(optimized(bytes), -0), -0), '-O2 changed -0.0 into 0.0');
  });
});
