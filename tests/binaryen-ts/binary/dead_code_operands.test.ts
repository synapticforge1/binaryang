// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Operands the stack does not hold as one node each — phantoms in dead code, and
// the values a multi-value `br_if` leaves — and a name the decoder rewrote.
// Found by replaying the spec testsuite's own invocations against a plain
// decode -> encode and against every optimization level, on both routes
// (A = binaryen-ts's decoder, B = the wabt-ts reader + prepareForPasses). Each
// module here stayed VALID while computing something else, or was refused by the
// engine after a round trip that should have changed nothing.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { writeWasm } from '../../../src/binaryen-ts/encoder/write-wasm.ts';
import { prepareForPasses, readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
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
/** `f(...args)` as a string, or what went wrong. */
const call = (b: Uint8Array, ...args: unknown[]) => {
  try {
    const x = new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports;
    return String((x.f as (...a: unknown[]) => unknown)(...args));
  } catch (e) {
    return `${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
};
/** The module unchanged, and after -O2, on each route. */
const variants = (bytes: Uint8Array) =>
  Object.entries(ROUTES).flatMap(([route, load]) => [
    [`${route} decode -> encode`, writeWasm(load(bytes))] as const,
    [
      `${route} -O2`,
      (() => {
        const m = load(bytes);
        new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses()
          .run();
        return writeWasm(m);
      })(),
    ] as const,
  ]);

describe('a phantom operand never runs before the transfer that made it dead', () => {
  it("`br 0; i32.add` branches — spec/br/br.0.wasm's type-i32-i32", () => {
    // `i32.add` takes two values from a stack `br 0` made polymorphic. Each
    // front end filled the missing left operand with `unreachable`, which the
    // tree evaluates BEFORE the `br`: it trapped where it must return.
    const bytes = asm(`(module (func (export "f") (block (drop (i32.add (br 0))))))`);
    assertEquals(call(bytes), 'undefined');
    for (const [name, out] of variants(bytes)) assertEquals(call(out), 'undefined', name);
  });

  it('a real value before the transfer is still evaluated', () => {
    const bytes = asm(`(module
      (global $g (mut i32) (i32.const 0))
      (func (export "f") (result i32)
        (block (drop (i32.add (global.set $g (i32.const 7)) (br 0))))
        (global.get $g)))`);
    assertEquals(call(bytes), '7');
    for (const [name, out] of variants(bytes)) assertEquals(call(out), '7', name);
  });

  it('`unreachable; i32.add` keeps its shape — both trap either way', () => {
    // The bare-`unreachable` case is left alone: upstream decodes it as
    // `(i32.add (unreachable) (unreachable))` and a round trip is a fixed point.
    const bytes = asm(`(module (func (export "f") (result i32) (i32.add (unreachable))))`);
    const once = writeWasm(readForPasses(bytes));
    assertEquals([...writeWasm(readForPasses(once))], [...once], 'a fixed point');
    assert(call(once).startsWith('RuntimeError'));
  });
});

describe('a multi-value br_if leaves every value (route A)', () => {
  it("spec/func/func.0.wasm's break-br_if-num-num round-trips byte for byte", () => {
    // The decoder held the `br_if` as ONE stack entry however many values it
    // leaves, so the first `drop` took both and the second got a phantom that
    // TRAPPED — on a plain decode -> encode.
    const bytes = asm(`(module
      (func (export "f") (param i32) (result i32 i64)
        (drop (drop (br_if 0 (i32.const 50) (i64.const 51) (local.get 0))))
        (i32.const 51) (i64.const 52)))`);
    assertEquals([...writeWasm(readForPasses(bytes))], [...bytes]);
    for (const arg of [0, 1]) {
      for (const [name, out] of variants(bytes)) {
        assertEquals(call(out, arg), call(bytes, arg), `${name}, f(${arg})`);
      }
    }
  });

  it('the entry values below a back-edge br_if survive a round trip (Q3)', () => {
    // A loop's entry values sit BELOW the two a `br_if` carries back; the
    // decoder lost them, so a round trip of a module returning 30 trapped.
    const bytes = asm(`(module
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
        end))`);
    assertEquals([...writeWasm(readForPasses(bytes))], [...bytes]);
    for (const [name, out] of variants(bytes)) assertEquals(call(out, 0), '30', name);
  });
});

describe('a name is kept as written', () => {
  it('an export named "\\uFEFF" is not stripped to ""', () => {
    // A default TextDecoder strips a leading U+FEFF. `spec/names/names.2.wasm`
    // exports "U+FEFF" beside "": decoded as two "" exports, and the engine
    // refused the round trip ("Duplicate export name").
    const bytes = asm(`(module
      (func (export "") (result i32) (i32.const 1))
      (func (export "\\ef\\bb\\bf") (result i32) (i32.const 2)))`);
    const names = (b: Uint8Array) =>
      WebAssembly.Module.exports(new WebAssembly.Module(b as BufferSource)).map((e) => e.name);
    assertEquals(names(bytes), ['', '﻿']);
    for (const [name, out] of variants(bytes)) assertEquals(names(out), ['', '﻿'], name);
  });
});
