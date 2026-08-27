// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.2 — our own validator rejecting modules V8 accepts.
//
// T9.2 was logged as one bug: `checkType` was left on the flat `Type` lattice
// after the T7.4 `ValueType` refactor, so a `ref.cast` feeding a block result
// failed. Measuring it properly — run `wasmValidate` over every spec-testsuite
// module V8 accepts, and treat any disagreement as our bug — turned up SEVEN,
// across 418 of 2120 modules:
//
//   218  MVP-era restrictions with no feature gate ("only one table allowed",
//        "only one memory block allowed"). `ValidateOptions` was
//        `Record<string, never>` — the validator had no feature awareness at
//        all.
//    77  Every SIMD entry in the opcode table keyed on `(0xfd << 8) | sub`,
//        the packing T7.7 replaced with `<< 16`. All ~76 became DEAD and fell
//        through to the `(v128,v128) -> v128` default, so SIMD memory ops
//        rejected their address and wrong-arity SIMD operands validated
//        clean. `memory.atomic.notify` had the same stale key in validator.ts.
//        Nobody noticed because `wat2wasm` does not run the validator.
//    56  Active data / elem segment offsets checked as i32 regardless of the
//        memory's or table's index type.
//    39  Table ops (`table.get/set/grow/size/fill/copy/init`) hard-coding i32
//        indices; `table.copy`'s COUNT is typed at the smaller of the two
//        index types, not the destination's.
//    ~30 The reference lattice — the originally-logged T9.2.
//     7  MVP's "constant expression may only reference an imported global",
//        which extended-const and GC both relax.
//     1  memarg OFFSET read as u32; it is u64 under memory64, and
//        align64.wast stores at 0xffffffffffffffff.
//
// Agreement went 1702 -> 2120 of 2120.
//
// The reference lattice deserves its own note. The first attempt made every
// reference type satisfy every other, which passed the testsuite and BROKE an
// existing test that asserted `(result funcref) (ref.null extern)` is
// rejected. That test was right: `func` and `extern` are separate hierarchies
// with no subtyping between them, and giving up on all reference types threw
// away a check we could keep. `refSatisfies` now models the abstract heap-type
// lattice and gives up ONLY where the IR's coarsening already destroyed the
// answer — `Type.Ref` / `Type.RefNull` (what ref.test / ref.cast report) and
// `Type.StructRef` (what every concrete `(ref $T)` collapses to).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures, defaultFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toBuf(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return buf;
}

/** Our verdict on `wat`, with every proposal enabled. Null means "valid". */
function ours(wat: string): string | null {
  const v = wasmValidate(compile(wat), { features: allFeatures() });
  return hasErrors(v.errors) ? formatErrors(v.errors).split('\n')[0]! : null;
}

/** Assert V8 accepts it AND we agree. */
function agree(wat: string): void {
  assert(WebAssembly.validate(toBuf(compile(wat))), `V8 rejected — bad test input:\n${wat}`);
  assertEquals(ours(wat), null, 'V8 accepted it but we did not');
}

describe('T9.2 — proposals are feature-gated, not hard-coded MVP rules', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['two tables', '(module (table 1 funcref) (table 1 funcref))'],
    ['two memories', '(module (memory 1) (memory 1))'],
    [
      'a constant expression reading a defined global',
      '(module (global $g i32 (i32.const 1)) (global i32 (global.get $g)))',
    ],
  ];
  for (const [name, wat] of cases) {
    it(name, () => agree(wat));
  }

  it('and the MVP rule is still enforced when the proposal is off', () => {
    const v = wasmValidate(compile('(module (table 1 funcref) (table 1 funcref))'), {
      features: { ...defaultFeatures(), referenceTypes: false },
    });
    assertEquals(v.result, Result.Error);
  });
});

describe('T9.2 — SIMD opcode keys match the current packing', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['v128.load', '(module (memory 1) (func (result v128) (v128.load (i32.const 0))))'],
    [
      'v128.load on a 64-bit memory',
      '(module (memory i64 1) (func (result v128) (v128.load (i64.const 0))))',
    ],
    [
      'v128.store',
      '(module (memory 1) (func (param v128) (v128.store (i32.const 0) (local.get 0))))',
    ],
    [
      'v128.load32x2_s',
      '(module (memory 1) (func (result v128) (v128.load32x2_s (i32.const 0))))',
    ],
    [
      'a unary SIMD op keeps its arity',
      '(module (func (param v128) (result v128) (f32x4.abs (local.get 0))))',
    ],
  ];
  for (const [name, wat] of cases) {
    it(name, () => agree(wat));
  }

  it('a wrong-arity SIMD operand is still caught', () => {
    // With the stale keys every SIMD op defaulted to (v128,v128) -> v128, so
    // this validated clean. `f32x4.abs` is unary.
    const v = wasmValidate(
      compile('(module (memory 1) (func (param v128) (result v128) (v128.load (local.get 0))))'),
      { features: allFeatures() },
    );
    assertEquals(v.result, Result.Error, 'v128.load must reject a v128 address');
  });
});

describe('T9.2 — 64-bit index types reach every indexed operation', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['data segment offset', '(module (memory i64 1) (data (i64.const 0) "abc"))'],
    [
      'elem segment offset',
      '(module (func $f) (table i64 1 funcref) (elem (i64.const 0) $f))',
    ],
    [
      'memarg offset beyond u32',
      '(module (memory i64 0) (func (drop (i32.load offset=0xffffffffffffffff (i64.const 0)))))',
    ],
    [
      'table.get / table.size',
      '(module (table i64 1 funcref) (func (result i64) (drop (table.get (i64.const 0))) (table.size)))',
    ],
    [
      'table.fill',
      '(module (table i64 1 funcref) (func (table.fill (i64.const 0) (ref.null func) (i64.const 1))))',
    ],
    [
      'table.grow',
      '(module (table i64 1 funcref) (func (result i64) (table.grow (ref.null func) (i64.const 1))))',
    ],
    [
      'table.copy between a 64-bit and a 32-bit table',
      `(module (table $a i64 1 funcref) (table $b 1 funcref)
        (func (table.copy $a $b (i64.const 0) (i32.const 0) (i32.const 0))))`,
    ],
    [
      'call_indirect on a 64-bit table',
      `(module (type $t (func)) (table i64 1 funcref)
        (func (call_indirect (type $t) (i64.const 0))))`,
    ],
  ];
  for (const [name, wat] of cases) {
    it(name, () => agree(wat));
  }
});

describe('T9.2 — the reference lattice keeps the checks it can', () => {
  it('accepts a cast feeding a block of the cast type', () => {
    agree(`(module (func (param anyref) (result i32)
      (block (result (ref null i31)) (ref.cast (ref null i31) (local.get 0)))
      (drop) (i32.const 1)))`);
  });

  it('accepts a subtype where a supertype is wanted', () => {
    // i31ref <: eqref <: anyref — a real subtype relation this must not reject.
    agree('(module (func (param i31ref) (result anyref) (local.get 0)))');
    agree('(module (func (param i31ref) (result eqref) (local.get 0)))');
    agree('(module (func (param nullfuncref) (result funcref) (local.get 0)))');
  });

  it('still REJECTS a cross-hierarchy mismatch', () => {
    // `func` and `extern` are separate hierarchies. This is the check the
    // first, blanket-permissive attempt threw away.
    const v = wasmValidate(compile('(module (func (result funcref) (ref.null extern)))'), {
      features: allFeatures(),
    });
    assertEquals(v.result, Result.Error);
  });

  it('and a supertype where a subtype is wanted', () => {
    const v = wasmValidate(
      compile('(module (func (param anyref) (result i31ref) (local.get 0)))'),
      {
        features: allFeatures(),
      },
    );
    assertEquals(v.result, Result.Error);
  });

  it('non-reference types are still compared exactly', () => {
    const v = wasmValidate(compile('(module (func (result i32) (i64.const 0)))'), {
      features: allFeatures(),
    });
    assertEquals(v.result, Result.Error);
  });
});
