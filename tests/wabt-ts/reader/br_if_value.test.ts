// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A `br_if` whose target carries ONE value falls through WITH that value, so it
// is an operand — `(i32.add (br_if 0 v c) x)` (post-M8 fix 4, found by M8d).
//
// The reader committed every `br_if` as a statement, so that read back as two
// siblings and folded `wasm2wat` printed `(br_if 0 v c) (i32.add x)` where
// upstream's prints the nesting. The bytes were right either way — the writer
// emits the siblings in order — so assert the TREE, not only the bytes.
//
// Two or more carried values stay a statement, as upstream folds them: one stack
// slot for a tuple would let a `drop` take all of it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import type { Expr, Module } from '../../../src/wabt-ts/ir/ir.ts';

const WAT = `(module
  (func (export "nested") (param i32) (result i32)
    (block (result i32)
      (br_if 0 (br_if 0 (i32.const 7) (local.get 0)) (local.get 0))))
  (func (export "consumed") (param i32) (result i32)
    (block (result i32)
      (i32.add (br_if 0 (i32.const 3) (local.get 0)) (i32.const 1))))
  (func (export "dropped") (param i32) (result i32)
    (block (result i32)
      (drop (br_if 0 (i32.const 5) (local.get 0)))
      (i32.const 0)))
  (func (export "void") (param i32) (result i32)
    (block (br_if 0 (local.get 0)) (nop))
    (i32.const 2))
  (func (export "pair") (param i32) (result i32)
    (i32.add
      (block (result i32 i32)
        i32.const 1
        i32.const 2
        local.get 0
        br_if 0
        drop
        i32.const 10
        i32.add
        i32.const 20)))
  (func (export "between") (param i32) (result i32)
    block
      i32.const 1
      i32.const 2
      local.get 0
      br_if 0
      i32.add
      drop
    end
    i32.const 2))`;

function assemble(): Uint8Array {
  const r = wat2wasm(WAT, { filename: 'br_if_value.wat' });
  assert(r.binary !== undefined && !hasErrors(r.errors), 'fixture must assemble');
  assert(WebAssembly.validate(r.binary as BufferSource), 'fixture must be valid');
  return r.binary;
}

function read(bytes: Uint8Array): Module {
  const errors = makeErrorList();
  const m = readBinaryIr(bytes, errors);
  assert(!hasErrors(errors));
  return m;
}

/** The statements of function `i`'s outermost block. */
function blockChildren(m: Module, i: number): Expr[] {
  const b = m.functions[i]!.body.children.find((e) => e.kind === 'block');
  assert(b !== undefined && b.kind === 'block');
  return b.children;
}

const isBrIf = (e: Expr | undefined) => e?.kind === 'br' && e.condition !== undefined;

describe('binary reader — a br_if carrying one value is an operand', () => {
  it('is the value of another br_if', () => {
    const [only, ...rest] = blockChildren(read(assemble()), 0);
    assertEquals(rest.length, 0);
    assert(isBrIf(only) && only!.kind === 'br');
    assert(isBrIf(only.values[0]), "the inner br_if is the outer one's value");
  });

  it('is an operand of an arithmetic op', () => {
    const [only, ...rest] = blockChildren(read(assemble()), 1);
    assertEquals(rest.length, 0);
    assert(only?.kind === 'binary' && isBrIf(only.left));
  });

  it('is what a drop drops', () => {
    const [first, second] = blockChildren(read(assemble()), 2);
    assert(first?.kind === 'drop' && isBrIf(first.value));
    assertEquals(second?.kind, 'const');
  });

  it('a void br_if is still a statement', () => {
    const [first, second] = blockChildren(read(assemble()), 3);
    assert(isBrIf(first));
    assertEquals(second?.kind, 'nop');
  });

  // A void `br_if` leaves nothing behind, so the operands below it are not its
  // business — nothing that follows may take the `br_if` itself as a value.
  it('a void br_if is never an operand of what follows it', () => {
    const drop = blockChildren(read(assemble()), 5).find((e) => e.kind === 'drop');
    assert(drop?.kind === 'drop' && drop.value.kind === 'binary');
    assert(!isBrIf(drop.value.left) && !isBrIf(drop.value.right));
  });

  it('a br_if carrying TWO values is still a statement, not what the drop takes', () => {
    // The two-result block is ONE stack slot to the reader (as a multi-result
    // `call` is), so which side of the `i32.add` holds it is not the point here.
    const [add] = read(assemble()).functions[4]!.body.children;
    assert(add?.kind === 'binary');
    const block = [add.left, add.right].find((e) => e.kind === 'block');
    assert(block?.kind === 'block');
    const kinds = block.children.map((e) => e.kind);
    assertEquals(kinds.slice(0, 2), ['br', 'drop']);
  });

  it('folded wasm2wat prints the nesting', () => {
    const text = wasm2wat(assemble()).text;
    assert(/\(br_if 0 \(;@1;\)\s+\(br_if 0 \(;@1;\)/.test(text), text);
    assert(/\(i32\.add\s+\(br_if 0 \(;@1;\)/.test(text), text);
    assert(/\(drop\s+\(br_if 0 \(;@1;\)/.test(text), text);
  });

  it('both text forms re-assemble to the same bytes, and they run', () => {
    const bytes = assemble();
    const code = wat2wasm(WAT, { textForm: false }).binary;
    for (const fold of [true, false]) {
      // The same CODE: forcing a form changes the S7 text-form record, and
      // only that — so both sides are assembled without it.
      const text = wasm2wat(bytes, { fold, asWritten: false }).text;
      const back = wat2wasm(text, { filename: 'back.wat', textForm: false }).binary;
      assertEquals(back, code, `fold: ${fold}`);
    }
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports as Record<string, (c: number) => number>;
    assertEquals([x.nested!(0), x.nested!(1)], [7, 7]);
    assertEquals([x.consumed!(0), x.consumed!(1)], [4, 3]);
    assertEquals([x.dropped!(0), x.dropped!(1)], [0, 5]);
    assertEquals([x.void!(0), x.void!(1)], [2, 2]);
    assertEquals([x.pair!(0), x.pair!(1)], [31, 3]);
    assertEquals([x.between!(0), x.between!(1)], [2, 2]);
  });
});
