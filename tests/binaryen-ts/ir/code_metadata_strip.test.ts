// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, item 5 (6a): `code_metadata` in binaryen-ts's tree.
//
// It is wabt-ts's node to BUILD — the text form of a `metadata.code.*` section,
// which binaryen-ts reads and writes raw (divergence K2). With one node union a
// tree reaching binaryen-ts may hold one, and the owner decided what happens
// (2026-09-16): binaryen-ts STRIPS it in its optimization runs. A plain write
// keeps it: since W8 the one writer (`writeWasm`, wabt-ts's) writes it as its
// `metadata.code.*` section. (binaryen-ts's own encoder refused it, rather than
// write nothing; it was deleted at 1.6.0.)

import { assert, assertEquals, assertThrows } from '@std/assert';

import { writeWasm } from '../../../src/binaryen-ts/encoder/write-wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import {
  type CodeMetadataExpr,
  type Expression,
  ExpressionKind,
  makeBlock,
  makeDrop,
  makeNop,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { stripCodeMetadata, walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

const hint = (): CodeMetadataExpr => ({
  kind: ExpressionKind.CodeMetadata,
  type: 'none',
  name: 'branch_hint',
  data: new Uint8Array([1]),
});

/** `f(x) = x ? 1 : 2`, with an annotation before the `if` and one inside a nested block. */
function annotated(): WasmModule {
  const r = wat2wasm(`(module (func (export "f") (param i32) (result i32)
    (block (nop))
    (if (result i32) (local.get 0) (then (i32.const 1)) (else (i32.const 2)))))`);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = readForPasses(r.binary);
  const fn = mod.functions[0]!;
  const [block, iff] = fn.body.children as [Expression, Expression];
  assert(block.kind === ExpressionKind.Block);
  fn.body = {
    ...fn.body,
    children: [{ ...block, children: [hint(), ...block.children] }, hint(), iff],
  };
  return mod;
}

function annotations(mod: WasmModule): number {
  let n = 0;
  for (const fn of mod.functions) {
    walkExpression(fn.body, (e) => {
      if (e.kind === ExpressionKind.CodeMetadata) n++;
    });
  }
  return n;
}

function call(bytes: Uint8Array, x: number): number {
  return (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    x: number,
  ) => number)(x);
}

Deno.test('an optimization run strips every annotation, at any depth, before its first pass', () => {
  const mod = annotated();
  assertEquals(annotations(mod), 2, 'the fixture holds two');
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).add('Vacuum').run();
  assertEquals(annotations(mod), 0);
  const out = writeWasm(mod);
  assertEquals([call(out, 1), call(out, 0)], [1, 2]);
  assert(!new TextDecoder().decode(out).includes('metadata.code.'), 'no section either');
});

Deno.test('a plain write keeps them, as their metadata.code section — not nothing', () => {
  const out = writeWasm(annotated());
  assert(new TextDecoder().decode(out).includes('metadata.code.branch_hint'));
  assertEquals([call(out, 1), call(out, 0)], [1, 2]);
});

Deno.test('a PassRunner with nothing queued keeps it — only an optimization run strips', () => {
  const mod = annotated();
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).run();
  assertEquals(annotations(mod), 2);
});

// W8: a binary's `metadata.code.*` sections are kept RAW by the reader. Their
// offsets point into the bodies a pass rewrites, so an optimization run drops
// them as it drops the annotations; a plain read-and-write keeps them.
Deno.test('an optimization run drops a raw metadata.code section; a plain write keeps it', () => {
  const r = wat2wasm(`(module (func (export "f") (param i32) (result i32)
    local.get 0
    (@metadata.code.branch_hint "\\01")
    if (result i32) i32.const 1 else i32.const 2 end)
    (@custom "producers" "\\00"))`);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  // The `name` section's place (M2f) is not what this is about.
  const customs = (m: { customSections: { name: string }[] }) =>
    m.customSections.map((c) => c.name).filter((n) => n !== 'name');

  const kept = readForPasses(r.binary);
  assertEquals(customs(kept), ['metadata.code.branch_hint', 'producers']);
  new PassRunner(kept, { optimizeLevel: 2, shrinkLevel: 0 }).run();
  assertEquals(customs(kept), ['metadata.code.branch_hint', 'producers'], 'nothing queued');

  const optimized = readForPasses(r.binary);
  new PassRunner(optimized, { optimizeLevel: 2, shrinkLevel: 0 }).add('Vacuum').run();
  assertEquals(customs(optimized), ['producers'], 'only the stale one goes');
  const out = writeWasm(optimized);
  assertEquals([call(out, 1), call(out, 0)], [1, 2]);
});

Deno.test('one outside a statement list is refused, not dropped', () => {
  const mod = annotated();
  const fn = mod.functions[0]!;
  fn.body = { ...fn.body, children: [makeDrop(hint()), ...fn.body.children] };
  assertThrows(() => stripCodeMetadata(fn.body), Error, 'outside a statement list');
});

Deno.test('a block of nothing but annotations is left an empty block', () => {
  const region = annotated().functions[0]!.body;
  // Beside another statement: a region's SOLE unnamed block dissolves (asRegion).
  const stripped = stripCodeMetadata({
    ...region,
    children: [makeBlock([hint(), hint()]), makeNop()],
  });
  assertEquals(stripped.children.map((c) => c.kind), [ExpressionKind.Block, ExpressionKind.Nop]);
  const block = stripped.children[0]!;
  assert(block.kind === ExpressionKind.Block);
  assertEquals(block.children, []);
});
