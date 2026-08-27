// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T10.6 — the round trip produced INVALID wasm. Two causes, both in the parser.
//
// 1. **Linear `try_table` was a stub.** It skipped the catch clauses AND the
//    body to the matching `end` and built a plain `BlockExpr`. The reason it
//    came out empty rather than merely un-caught: catch clauses are
//    parenthesised IMMEDIATES that come BEFORE the body, and `parseInstrList`
//    stops at the first `(catch …)` because a catch clause is not an
//    instruction. So the body was empty and every catch edge was lost.
//
//    Our own `wasm2wat` emits LINEAR form, so a round trip silently gutted any
//    module using `try_table`. V8 rejected the result with "expected 1
//    elements on the stack for fallthru, found 0" — the block's declared
//    result had nothing left to produce it. Three of the four T10.6 modules
//    (throw_ref.wast#0, try_table.wast#1, try_table.wast#2).
//
// 2. **`array.new_fixed` drained the operand stack.** Same class as T10.5's
//    `call`, except the arity needs no module context at all: it is the second
//    immediate. `array.new_fixed $T N elem1 … elemN`. Draining handed it
//    whatever else was on the stack, and V8 said so precisely —
//    `array.new_fixed[0] expected type f32, found local.get of type i32`
//    (array.wast#3).
//
// Round-trip fidelity: spec testsuite 2102 -> 2111 / 2120, files affected
// 10 -> 6, V8-invalid-after-round-trip 5 -> 1. Campaign metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(binary: Uint8Array): boolean {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

function roundTrip(binary: Uint8Array): Uint8Array {
  return compile(wasm2wat(binary).text!);
}

describe('T10.6 — linear try_table keeps its catch clauses and its body', () => {
  it('parses the linear form into a real try_table, not a block', () => {
    const { module, errors } = parseWatModule(`(module
      (tag $e)
      (func $f (result i32)
        block $h
          try_table (result i32) (catch_all $h)
            i32.const 1
          end
          return
        end
        i32.const 3))`);
    assert(!hasErrors(errors), formatErrors(errors));

    // The try_table produces the i32 the `return` carries, so it lands in the
    // return's operand slot rather than standing alone in the block body.
    const outer = module.funcs[0]!.body[0]!;
    assertEquals(outer.kind, 'block');
    const ret = (outer as unknown as { body: { kind: string }[] }).body[0]!;
    assertEquals(ret.kind, 'return');
    const tryTable = (ret as unknown as { values: { kind: string }[] }).values[0]!;
    assertEquals(tryTable.kind, 'try_table', 'built a block instead of a try_table');
    const tt = tryTable as unknown as { catches: unknown[]; body: unknown[] };
    assertEquals(tt.catches.length, 1, 'catch clause was dropped');
    assertEquals(tt.body.length, 1, 'body was skipped to `end`');
  });

  it('reads a tagged catch and a numeric target the way the writer emits them', () => {
    const { module, errors } = parseWatModule(`(module
      (tag $e)
      (func $f
        block $h
          try_table (catch $e 0) (catch_all 0)
            nop
          end
        end))`);
    assert(!hasErrors(errors), formatErrors(errors));
    const outer = module.funcs[0]!.body[0]! as unknown as { body: { kind: string }[] };
    const tt = outer.body[0]! as unknown as { kind: string; catches: unknown[] };
    assertEquals(tt.kind, 'try_table');
    assertEquals(tt.catches.length, 2);
  });

  it('re-encodes the linear form to the same bytes it was written from', () => {
    const first = compile(`(module
      (tag $e)
      (func $f (export "f") (result i32)
        (block $h
          (try_table (result i32) (catch_all $h) (i32.const 1))
          (return))
        (i32.const 3)))`);
    assertEquals(v8Accepts(first), true);
    assertEquals(roundTrip(first), first);
  });

  it('round-trips the spec shape that exposed it, and keeps it valid', () => {
    // try_table.wast's "imported-mismatch": nested try_tables, one catch each,
    // both with a declared result. This is what came back gutted.
    const first = compile(`(module
      (func $imported-throw (import "test" "throw"))
      (tag $e0)
      (func (export "imported-mismatch") (result i32)
        (block $h
          (try_table (result i32) (catch_all $h)
            (block $h0
              (try_table (result i32) (catch $e0 $h0)
                (i32.const 1)
                (call $imported-throw))
              (return))
            (i32.const 2))
          (return))
        (i32.const 3)))`);
    assertEquals(v8Accepts(first), true, 'fixture must start valid');

    const again = roundTrip(first);
    assertEquals(v8Accepts(again), true, 'round-trip produced invalid wasm');
    assertEquals(again, first);
  });

  it('still parses the folded form', () => {
    // The folded path always worked; it must keep working, and the two forms
    // now share `parseTryTableCatch` so they cannot drift apart.
    const { module, errors } = parseWatModule(`(module
      (tag $e)
      (func $f (result i32)
        (block $h
          (try_table (result i32) (catch_all $h) (i32.const 1))
          (return))
        (i32.const 3)))`);
    assert(!hasErrors(errors), formatErrors(errors));
    const outer = module.funcs[0]!.body[0]! as unknown as { body: { kind: string }[] };
    const ret = outer.body[0]! as unknown as { kind: string; values: { kind: string }[] };
    assertEquals(ret.kind, 'return');
    assertEquals(ret.values[0]!.kind, 'try_table');
  });
});

describe('T10.6 — array.new_fixed takes its immediate count, not the stack', () => {
  it('leaves a value below the elements for the instruction that owns it', () => {
    const { module, errors } = parseWatModule(`(module
      (type $a (array f32))
      (global $g (mut i32) (i32.const 0))
      (func $f (param i32)
        local.get 0
        f32.const 1
        f32.const 2
        array.new_fixed $a 2
        drop
        global.set $g))`);
    assert(!hasErrors(errors), formatErrors(errors));

    const body = module.funcs[0]!.body;
    const drop = body.find((e) => e.kind === 'drop');
    assert(drop, 'expected the drop to survive');
    const anf = (drop as unknown as { value: { kind: string; operands: unknown[] } }).value;
    assertEquals(anf.kind, 'array.new_fixed');
    // Two elements, per the immediate — not three, which is what draining gave.
    assertEquals(anf.operands.length, 2);
    // And the local.get is still there for the global.set below it. It sits in
    // statement position rather than in the global.set's operand slot — the
    // parser flushes the operand stack when it commits a statement — but the
    // encoding is what matters, and the next case pins that.
    assert(body.some((e) => e.kind === 'local.get'), 'the local.get was swallowed');
  });

  it('re-encodes that module to the bytes it was written from', () => {
    const first = compile(`(module
      (type $a (array f32))
      (global $g (mut i32) (i32.const 0))
      (func $f (export "f") (param i32)
        local.get 0
        f32.const 1
        f32.const 2
        array.new_fixed $a 2
        drop
        global.set $g))`);
    assertEquals(v8Accepts(first), true, 'fixture must start valid');
    assertEquals(roundTrip(first), first);
  });

  it('round-trips an array.new_fixed module byte-identically', () => {
    const first = compile(`(module
      (type $a (array f32))
      (func (export "f") (param f32 f32)
        (drop (array.new_fixed $a 2 (local.get 0) (local.get 1)))))`);
    assertEquals(v8Accepts(first), true);
    assertEquals(roundTrip(first), first);
  });
});
