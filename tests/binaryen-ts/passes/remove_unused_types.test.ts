// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedTypes (open-work 6; open-work 2, step 2). The optimizer kept every
// type an optimization had made unused — the one section where our -Oz encoding
// was larger than upstream's (+9,973 bytes on the corpus). Renumbering type
// references is where a wrong index yields a VALID module of the WRONG type, so
// the cases that could compute something else RUN the module.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { RemoveUnusedTypesPass } from '../../../src/binaryen-ts/passes/remove-unused-types.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';

function prune(wat: string) {
  const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
  new PassRunner(m, {}).add('RemoveUnusedTypes').run();
  const bytes = writeWasm(m);
  const { errors } = wasmValidate(bytes, { features: allFeatures() });
  expect(errors.map((e) => e.message)).toEqual([]);
  return { m, bytes };
}
const call = async (bytes: Uint8Array, name: string, ...args: number[]) => {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  return (instance.exports[name] as (...a: number[]) => number)(...args);
};

describe('unused types go, and every reference follows its type', () => {
  it('a call_indirect through a type after a removed one still checks the right signature', async () => {
    const { m, bytes } = prune(`(module
      (type $unused1 (func (param f64)))
      (type $unused2 (func (result f32)))
      (type $binop (func (param i32 i32) (result i32)))
      (table 1 funcref) (elem (i32.const 0) $add)
      (func $add (type $binop) (i32.add (local.get 0) (local.get 1)))
      (func (export "f") (param i32) (result i32)
        (call_indirect (type $binop) (local.get 0) (i32.const 10) (i32.const 0))))`);
    expect(m.types.length).toBe(2); // $binop and the export's (i32) -> i32
    expect(await call(bytes, 'f', 5)).toBe(15);
  });

  it('a multi-value block type after a removed one', async () => {
    const { m, bytes } = prune(`(module
      (type $unused (func (param f64 f64)))
      (type $pair (func (result i32 i32)))
      (func (export "f") (result i32)
        (block (type $pair) (i32.const 3) (i32.const 4))
        (i32.sub)))`);
    expect(m.types.some((t) => t.name === '$unused')).toBe(false);
    expect(await call(bytes, 'f')).toBe(-1);
  });

  it('a struct field type and a ref.test target after removed ones', async () => {
    const { m, bytes } = prune(`(module
      (type $unused (func))
      (type $inner (struct (field i32)))
      (type $outer (struct (field (ref $inner))))
      (type $other (struct (field i32) (field i32)))
      (func (export "f") (result i32)
        (local $o (ref null $outer))
        (local.set $o (struct.new $outer (struct.new $inner (i32.const 42))))
        (i32.add
          (struct.get $inner 0 (struct.get $outer 0 (local.get $o)))
          (ref.test (ref $other) (struct.new $inner (i32.const 0))))))`);
    expect(m.types.some((t) => t.name === '$unused')).toBe(false);
    // $other keeps its identity: the test against it must still FAIL (+0), not match $inner.
    expect(await call(bytes, 'f')).toBe(42);
  });
});

describe('a block that CARRIES its type index keeps it pointing at its type', () => {
  // Through PassRunner a block's written index is dropped as FORM before any
  // pass, and the writer re-derives it — so the case above cannot see this.
  // Run directly, on a tree as read, the block still holds `typeIndex`.
  it('the pass alone, on a module as read', () => {
    const m = readForPasses(
      wat2wasm(
        `(module
      (type $unused (func (param f64 f64)))
      (type $pair (func (result i32 i32)))
      (func (export "f") (result i32)
        (block (type $pair) (i32.const 3) (i32.const 4))
        (i32.sub)))`,
        { textForm: false },
      ).binary,
    );
    new RemoveUnusedTypesPass().run(m, {} as never);
    let index: number | undefined;
    walkExpression(m.functions[0]!.body, (e) => {
      if (
        e.kind === ExpressionKind.Block && (e as { typeIndex?: number }).typeIndex !== undefined
      ) {
        index = (e as { typeIndex?: number }).typeIndex;
      }
    });
    expect(index).toBeDefined();
    expect(m.types[index!]!.name).toBe('$pair');
  });
});

describe('what a used type needs stays', () => {
  it('a whole rec group, when one member is used', () => {
    const { m } = prune(`(module
      (rec (type $a (struct (field i32))) (type $b (struct (field i64))))
      (func (export "f") (result i32) (struct.get $a 0 (struct.new $a (i32.const 1)))))`);
    expect(m.types.map((t) => t.name)).toEqual(expect.arrayContaining(['$a', '$b']));
  });

  it("a used type's supertype", () => {
    const { m } = prune(`(module
      (type $base (sub (struct (field i32))))
      (type $derived (sub $base (struct (field i32) (field i32))))
      (func (export "f") (result i32)
        (struct.get $derived 1 (struct.new $derived (i32.const 1) (i32.const 2)))))`);
    expect(m.types.map((t) => t.name)).toEqual(expect.arrayContaining(['$base', '$derived']));
  });
});

describe('a plain read and write keeps the type section as it was', () => {
  it('no pass, no pruning', () => {
    const wat = `(module (type $unused (func (param f64))) (func (export "f")))`;
    const m = readForPasses(wat2wasm(wat, { textForm: false }).binary);
    expect(m.types.length).toBe(2);
    writeWasm(m);
    expect(m.types.length).toBe(2);
  });
});
