// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// An unconditional transfer is an operand for what follows it (divergence
// W10b; owner, 2026-09-19: "the more accurate the folded nature the better").
//
// After `br`, `br_table`, `return`, `unreachable`, `throw_ref` or a return call
// the stack is polymorphic, and upstream `wasm2wat --fold-exprs` counts each as
// leaving a value (`GetExprArity`: 1, a return call its results), so the next
// instruction that wants an operand nests it: `(br 0 (br_table 0 0 …))`. Both
// our front ends committed every transfer as a statement, and our folded text
// printed siblings. Same bytes either way.
//
// ⚠️ W10a is NOT this: where a statement splits operands upstream folds none
// and we fold what we hold — kept by the owner. The two are tested apart.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import type { Expr, Module } from '../../../src/wabt-ts/ir/ir.ts';

const LINEAR = `(module
  (func $one (result i32) i32.const 1)
  (func (export "br_table") (result i32)
    block (result i32)
      i32.const 9
      i32.const 0
      br_table 0 0
      br 0
    end)
  (func (export "unreachable") (result i32)
    block (result i32)
      unreachable
      i32.eqz
    end)
  (func (export "br") (result i32)
    block (result i32)
      i32.const 4
      br 0
      i32.eqz
    end)
  (func (export "return") (result i32)
    i32.const 5
    return
    i32.eqz)
  (func (export "return_call") (result i32)
    return_call $one
    i32.eqz))`;

/** Each function's body, in order (the block's children where it has one). */
function bodies(m: Module): Expr[][] {
  return m.functions.map((f) => {
    const [first] = f.body.children;
    return first?.kind === 'block' ? first.children : f.body.children;
  });
}

function fromBinary(): Module {
  const bytes = wat2wasm(LINEAR).binary;
  assert(bytes !== undefined && WebAssembly.validate(bytes as BufferSource), 'valid');
  const errors = makeErrorList();
  const m = readBinaryIr(bytes, errors);
  assert(!hasErrors(errors));
  return m;
}

function fromText(): Module {
  const p = parseWatModule(LINEAR);
  assert(p.module);
  return p.module;
}

/** `[head kind, first operand's kind]` for the one statement each body holds. */
function shapes(m: Module): [string, string | undefined][] {
  return bodies(m).slice(1).map((b) => {
    assertEquals(b.length, 1, 'one statement: the transfer is nested, not a sibling');
    const e = b[0]!;
    const inner = e.kind === 'br' ? e.values[0] : e.kind === 'unary' ? e.value : undefined;
    return [e.kind, inner?.kind];
  });
}

const EXPECTED: [string, string | undefined][] = [
  ['br', 'br_table'], // (br 0 (br_table 0 0 …))
  ['unary', 'unreachable'], // (i32.eqz (unreachable))
  ['unary', 'br'], // (i32.eqz (br 0 …))
  ['unary', 'return'], // (i32.eqz (return …))
  ['unary', 'call'], // (i32.eqz (return_call $one))
];

describe('an unconditional transfer is the next instruction’s operand', () => {
  it('the binary reader nests each kind', () => {
    assertEquals(shapes(fromBinary()), EXPECTED);
  });

  it('the WAT parser, linear, nests them the same way', () => {
    assertEquals(shapes(fromText()), EXPECTED);
  });

  it('folded wasm2wat prints the nesting upstream prints', () => {
    const text = wasm2wat(wat2wasm(LINEAR).binary!).text;
    assert(/\(br 0 \(;@1;\)\s+\(br_table 0 \(;@1;\) 0 \(;@1;\)/.test(text), text);
    assert(/\(i32\.eqz\s+\(unreachable\)\)/.test(text), text);
  });

  it('both text forms re-assemble to the same bytes, and they run', () => {
    const bytes = wat2wasm(LINEAR).binary!;
    for (const fold of [true, false]) {
      assertEquals(wat2wasm(wasm2wat(bytes, { fold }).text).binary, bytes, `fold: ${fold}`);
    }
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports as Record<string, () => number>;
    assertEquals([x.br_table!(), x.br!(), x.return!(), x.return_call!()], [9, 4, 5, 1]);
  });

  it('throw / rethrow leave nothing, so they stay statements', () => {
    const p = parseWatModule(`(module (tag $e)
      (func (result i32) block (result i32) throw $e i32.eqz end))`);
    assert(p.module);
    const [first] = p.module.functions[0]!.body.children;
    assert(first?.kind === 'block');
    assertEquals(first.children.map((e) => e.kind), ['throw', 'unary']);
  });
});
