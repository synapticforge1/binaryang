// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.16 — `data.drop` / `elem.drop` swallowed a value that was not theirs,
// and the compiler silently DELETED it.
//
// Both are `[] -> []`: the segment is an IMMEDIATE and nothing comes off the
// operand stack. `instrInputCount` had them in the arity-**1** group, sharing a
// `case` label with genuine one-operand instructions (`table.get`, `ref.test`,
// `memory.grow`, `throw_ref`). So `parseFoldedInstr`'s deficit fill popped a
// value from the surrounding scope — and `buildPlainExpr` has no slot to put it
// in, so the popped expression was discarded without a trace.
//
// The result is the worst failure mode there is: `(call $bump) (data.drop $d)`
// emits a module V8 and Wasmtime both ACCEPT, that runs, and that computes a
// DIFFERENT ANSWER, with no diagnostic anywhere in the pipeline. It is the same
// shape as the v1.3.0 statement-ordering bug (a void call sinking past a
// `return` into dead code) reached by a different route.
//
// Structurally this is T13.11 one table over: a `case` label shared with
// instructions that do not match. There the leaf was `table.size` and the
// non-leaf `table.get`; here the arity-1 group absorbed two arity-0 members.
//
// No metric could see it. Round-trip is unmoved (measured: identical baseline)
// because no spec-testsuite or wasmtk-corpus module puts a stacked value
// immediately before a `data.drop`.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function instantiate(binary: Uint8Array): WebAssembly.Instance {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return new WebAssembly.Instance(new WebAssembly.Module(buf), {});
}

function decoded(binary: Uint8Array): string {
  const { text } = wasm2wat(binary);
  assert(text);
  return text;
}

describe('T13.16 — data.drop / elem.drop consume no operands', () => {
  it('does not delete a side-effecting call that precedes data.drop', () => {
    // The whole bug in one module: `$bump` sets the global to 7. If the call
    // survives, `run()` is 7; if it was swallowed, `run()` is 0 — and the
    // module is valid either way, which is why nothing caught this.
    const binary = compile(`(module
      (memory 1)
      (data $d "xy")
      (global $g (mut i32) (i32.const 0))
      (func $bump (global.set $g (i32.const 7)))
      (func (export "run") (result i32)
        (call $bump)
        (data.drop $d)
        (global.get $g)))`);

    const run = instantiate(binary).exports.run as () => number;
    assertEquals(run(), 7, 'the call before data.drop was deleted');
    assert(/call/.test(decoded(binary)), 'the call is missing from the emitted binary');
  });

  it('does not delete a side-effecting call that precedes elem.drop', () => {
    const binary = compile(`(module
      (table 1 funcref)
      (func $t)
      (elem $e func $t)
      (global $g (mut i32) (i32.const 0))
      (func $bump (global.set $g (i32.const 7)))
      (func (export "run") (result i32)
        (call $bump)
        (elem.drop $e)
        (global.get $g)))`);

    const run = instantiate(binary).exports.run as () => number;
    assertEquals(run(), 7, 'the call before elem.drop was deleted');
  });

  for (
    const [form, body] of [
      ['linear', 'i32.const 42\n        data.drop $d'],
      ['folded', '(i32.const 42)\n        (data.drop $d)'],
    ] as const
  ) {
    it(`keeps a stacked constant across data.drop in ${form} form`, () => {
      // The constant is the function's result. If data.drop eats it, the body
      // produces nothing and the module stops being valid at all — which is
      // how the bug first showed up, before the call fixture pinned down that
      // it can also stay valid and just be wrong.
      const binary = compile(`(module (memory 1) (data $d "xy")
        (func (export "run") (result i32)
        ${body}))`);
      const run = instantiate(binary).exports.run as () => number;
      assertEquals(run(), 42);
    });
  }

  it('still lets genuine one-operand instructions take their operand', () => {
    // The guard against over-correcting: these share the arity-1 group that
    // `data.drop` was wrongly in, and must keep consuming exactly one operand.
    const binary = compile(`(module
      (memory 1)
      (table $t 4 funcref)
      (func $f)
      (elem (i32.const 1) $f)
      (func (export "grow") (result i32) (memory.grow (i32.const 0)))
      (func (export "get") (result i32)
        (ref.is_null (table.get $t (i32.const 1)))))`);
    const ex = instantiate(binary).exports as Record<string, () => number>;
    // memory.grow by 0 returns the previous size (1 page).
    assertEquals(ex.grow!(), 1);
    // table slot 1 holds $f, so ref.is_null is 0.
    assertEquals(ex.get!(), 0);
  });

  it('round-trips a data.drop that follows a value', () => {
    // The reported shape must also survive `wasm2wat` -> `wat2wasm`, since a
    // swallow on the way back in would reintroduce the bug at the second hop.
    const src = `(module (memory 1) (data $d "xy")
      (func (export "run") (result i32) (i32.const 42) (data.drop $d)))`;
    const first = compile(src);
    const second = compile(decoded(first));
    assertEquals([...second], [...first], 'round trip is not a fixed point');
    assertEquals((instantiate(second).exports.run as () => number)(), 42);
  });
});
