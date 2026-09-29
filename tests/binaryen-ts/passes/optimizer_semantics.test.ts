// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Three places the optimizer changed what a module DOES — found by replaying
// the spec testsuite's own invocations against every optimization level, on
// both routes (A = binaryen-ts's decoder, B = the wabt-ts reader +
// prepareForPasses):
//
// - `Inlining` (-O3) moved an operand that takes a value FROM THE STACK into its
//   wrapper block, which cannot reach it (Q2): an invalid module.
// - `PassRunner` dropped a `call_indirect`'s written type index as FORM, but
//   with rec groups the derived index can name a DIFFERENT type: a
//   signature-mismatch trap disappeared (`spec/type-rec`, `spec/type-subtyping`).
// - Any pass that maps a tree refused `elem.drop`, so a module holding one could
//   not be optimized at all.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { prepareForPasses, readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { type PassOptions, PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';

const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors), `assembles: ${JSON.stringify(r.errors)}`);
  assert(WebAssembly.validate(r.binary as BufferSource), 'the engine accepts the fixture');
  return r.binary;
};
const ROUTES = {
  A: (b: Uint8Array): WasmModule => readForPasses(b),
  B: (b: Uint8Array): WasmModule =>
    prepareForPasses(readBinaryIr(b, makeErrorList(), { readDebugNames: true })) as WasmModule,
};
const LEVELS = [['-O1', 1, 0], ['-O2', 2, 0], ['-O3', 3, 0], ['-Oz', 2, 2]] as const;
const optimized = (
  load: (b: Uint8Array) => WasmModule,
  bytes: Uint8Array,
  o: PassOptions['optimizeLevel'],
  s: PassOptions['shrinkLevel'],
) => {
  const m = load(bytes);
  new PassRunner(m, { optimizeLevel: o, shrinkLevel: s }).addDefaultOptimizationPasses().run();
  return writeWasm(m);
};
const call = (b: Uint8Array, name: string, ...args: unknown[]) => {
  try {
    const x = new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports;
    return String((x[name] as (...a: unknown[]) => unknown)(...args));
  } catch (e) {
    return `${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
};

describe('Inlining leaves a call whose operand is on the stack (Q2)', () => {
  // `$pick1` returns three values; the second call takes the first call's LAST
  // two, one of them as a `pop`. Inlined, that `pop` became a `local.set` inside
  // the wrapper block: "not enough arguments on the stack for local.set".
  const bytes = asm(`(module
    (func $pick1 (param i64 i64) (result i64 i64 i64) (local.get 0) (local.get 1) (local.get 0))
    (func (export "t") (param i64) (result i64)
      (i64.const 1) (local.get 0)
      (call $pick1) (call $pick1) (i64.mul) (drop) (drop)))`);
  for (const [route, load] of Object.entries(ROUTES)) {
    for (const [level, o, s] of LEVELS) {
      it(`valid and the same after ${level} (route ${route})`, () => {
        assertEquals(call(optimized(load, bytes, o, s), 't', 5n), call(bytes, 't', 5n));
      });
    }
  }
});

describe('a call_indirect keeps a type index that names a different type', () => {
  // `spec/type-rec/type-rec.wast`: `$f1` and `$f2` are both `(func)`, but in
  // different positions of different rec groups — distinct types. Calling `$f1`
  // through `(type $f2)` must trap; with the index dropped, the encoder derived
  // `$f1` (the first structural match), and it returned.
  const bytes = asm(`(module
    (rec (type $f1 (func)) (type (struct)))
    (rec (type (struct)) (type $f2 (func)))
    (table funcref (elem $f1))
    (func $f1 (type $f1))
    (func (export "run") (call_indirect (type $f2) (i32.const 0))))`);
  it('the fixture traps', () => {
    assert(call(bytes, 'run').startsWith('RuntimeError'), call(bytes, 'run'));
  });
  for (const [route, load] of Object.entries(ROUTES)) {
    for (const [level, o, s] of LEVELS) {
      it(`still traps after ${level} (route ${route})`, () => {
        const got = call(optimized(load, bytes, o, s), 'run');
        assert(got.startsWith('RuntimeError'), got);
      });
    }
  }
  it('an index naming the SAME type is still form, and still dropped (T1)', () => {
    // Two identical singleton types: the written `$b` is form, and an optimized
    // module names the first match, as before.
    const same = asm(`(module
      (type $a (func (result i32)))
      (type $b (func (result i32)))
      (table funcref (elem $f))
      (func $f (type $a) (i32.const 9))
      (func (export "run") (result i32) (call_indirect (type $b) (i32.const 0))))`);
    const out = optimized(ROUTES.A, same, 2, 0);
    assertEquals(call(out, 'run'), '9');
  });
});

describe('RemoveUnusedModuleElements counts every constant expression', () => {
  it('a global read only by a segment offset is kept — spec/global/global.50.wasm', () => {
    // `$off` is read by nothing but the element segment's offset. It was removed,
    // the offset still named it, and the encoder refused the module.
    const bytes = asm(`(module
      (global $off i32 (i32.const 1))
      (table 4 funcref)
      (elem (table 0) (global.get $off) func $f)
      (func $f (result i32) (i32.const 5))
      (func (export "run") (result i32) (call_indirect (result i32) (i32.const 1))))`);
    for (const [route, load] of Object.entries(ROUTES)) {
      for (const [level, o, s] of LEVELS) {
        assertEquals(call(optimized(load, bytes, o, s), 'run'), '5', `${level} route ${route}`);
      }
    }
  });
  it("a function referenced only by a global's ref.func is kept", () => {
    const bytes = asm(`(module
      (type $t (func (result i32)))
      (global $g (ref null $t) (ref.func $f))
      (func $f (type $t) (i32.const 6))
      (func (export "run") (result i32) (call_ref $t (global.get $g))))`);
    for (const [route, load] of Object.entries(ROUTES)) {
      for (const [level, o, s] of LEVELS) {
        assertEquals(call(optimized(load, bytes, o, s), 'run'), '6', `${level} route ${route}`);
      }
    }
  });
});

describe('elem.drop is walkable', () => {
  it('a module holding one optimizes, and behaves the same', () => {
    const bytes = asm(`(module
      (table 1 funcref)
      (elem $e func $f)
      (func $f (result i32) (i32.const 3))
      (func (export "run") (result i32)
        (table.init $e (i32.const 0) (i32.const 0) (i32.const 1))
        (elem.drop $e)
        (call_indirect (result i32) (i32.const 0))))`);
    for (const [route, load] of Object.entries(ROUTES)) {
      for (const [level, o, s] of LEVELS) {
        assertEquals(call(optimized(load, bytes, o, s), 'run'), '3', `${level} route ${route}`);
      }
    }
  });
});
