// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// One tree per bytes: what the two routes into the optimizer used to spell
// differently (One front end, stage 1 — owner, 2026-09-19: option A on both).
//   A = binaryen-ts's decoder; B = the wabt-ts reader + prepareForPasses.
//
// - `struct.new`'s `defaultInit`: A wrote `false`, B wrote nothing. Now `true`
//   or ABSENT, as a call's `isReturn` (M8a2) — `false` is unrepresentable.
// - a `br_if` with an unreachable operand: A said `unreachable` (upstream
//   `Break::finalize`), `deriveTypes` said the target's type. The optimizer
//   deletes what follows an unreachable-typed node, so the routes saw
//   different programs.
// - an IMPORTED function's empty body: A typed it `none`, B left it untyped —
//   the only difference on 3,381 corpus modules.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import type { StructNewExpr } from '../../src/wabt-ts/ir/ir.ts';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../src/wabt-ts/reader/binary-reader.ts';
import { makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { prepareForPasses, readForPasses } from '../../src/binaryen-ts/ir/prepare.ts';
import { ExternalKind } from '../../src/wabt-ts/core/binary.ts';

const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false });
  assert(r.binary.length > 0, 'assembles');
  return r.binary;
};
const routes = (bytes: Uint8Array) => ({
  A: readForPasses(bytes),
  B: prepareForPasses(readBinaryIr(bytes, makeErrorList(), { readDebugNames: true })),
});

describe('struct.new — `defaultInit` is `true` or absent, never `false`', () => {
  const SRC = `(module
    (type $s (struct (field i32)))
    (func (export "n") (result (ref $s)) (struct.new $s (i32.const 1)))
    (func (export "d") (result (ref $s)) (struct.new_default $s)))`;
  const bytes = asm(SRC);

  it('every front end spells it the same way', () => {
    const flags = (fns: readonly { body: { children: readonly unknown[] } }[]) =>
      fns.map((f) => (f.body.children[0] as StructNewExpr).defaultInit);
    const { A, B } = routes(bytes);
    assertEquals(flags(A.functions), [undefined, true]);
    assertEquals(flags(B.functions), [undefined, true]);
    assertEquals(flags(parseWatModule(SRC).module!.functions), [undefined, true]);
  });

  it('`false` does not typecheck', () => {
    const node: StructNewExpr = {
      kind: 'struct.new',
      typeVar: { kind: 'index', value: 0 },
      operands: [],
      // @ts-expect-error `defaultInit` is `true` or absent — one spelling.
      defaultInit: false,
    };
    assertEquals(node.defaultInit, false as unknown as true);
  });
});

describe('types both routes must agree on', () => {
  it('a br_if whose carried value is unreachable is unreachable', () => {
    // `(drop (br_if $l (br $l (i32.const 8)) (i32.const 1)))` — the spec's
    // br.0 shape, the 6 nodes the corpus measurement found.
    const bytes = asm(`(module (func (export "f") (result i32)
      (block $l (result i32)
        (drop (br_if $l (br $l (i32.const 8)) (i32.const 1)))
        (i32.const 7))))`);
    const { A, B } = routes(bytes);
    const typeOfBrIf = (
      m: { functions: readonly { body: { children: readonly unknown[] } }[] },
    ) => {
      const block = m.functions[0]!.body.children[0] as { children: readonly unknown[] };
      const drop = block.children[0] as { value: { type?: unknown } };
      return drop.value.type;
    };
    assertEquals(typeOfBrIf(B), 'unreachable');
    assertEquals(typeOfBrIf(B), typeOfBrIf(A));
  });

  it('a br_if whose CONDITION is unreachable is unreachable', () => {
    const bytes = asm(`(module (func (export "f") (result i32)
      (block $l (result i32)
        (drop (br_if $l (i32.const 8) (unreachable)))
        (i32.const 7))))`);
    const { A, B } = routes(bytes);
    const typeOfBrIf = (
      m: { functions: readonly { body: { children: readonly unknown[] } }[] },
    ) => {
      const block = m.functions[0]!.body.children[0] as { children: readonly unknown[] };
      const drop = block.children[0] as { value: { type?: unknown } };
      return drop.value.type;
    };
    assertEquals(typeOfBrIf(B), 'unreachable');
    assertEquals(typeOfBrIf(B), typeOfBrIf(A));
  });

  it("an imported function's empty body is typed `none`", () => {
    const bytes = asm('(module (import "e" "f" (func $i (param i32))) (func (export "g") nop))');
    const { A, B } = routes(bytes);
    const bodyType = (
      m: { imports: readonly { kind: number; func?: { body: { type?: unknown } } }[] },
    ) => m.imports.find((i) => i.kind === ExternalKind.Func)!.func!.body.type;
    assertEquals(bodyType(B), 'none');
    assertEquals(bodyType(B), bodyType(A));
  });
});
