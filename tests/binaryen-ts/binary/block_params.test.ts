// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Block PARAMETERS stay on the node through the fidelity phase, and are lowered
// to locals where optimization starts (S6 decision 7b(i), divergence B1).
//
// Before, the decoder lowered them while reading: every entry value spilled to
// a fresh local, every back-edge to a parametrised loop rewritten, a mixed
// `br_table` turned into a trampoline. Valid and the same behaviour — but a
// module with block parameters never re-encoded as written.
//
// Fixtures are hand-assembled; each is validated and RUN by V8 first, since a
// fixture that is not itself valid proves nothing. The block / if / loop /
// back-edge / trampoline fixtures in multivalue.test.ts cover the same three
// paths for those constructs.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import {
  type BlockExpr,
  type BreakExpr,
  type Expression,
  ExpressionKind,
  type LoopExpr,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/pass.ts';
import {
  hasBlockParams,
  lowerBlockParams,
} from '../../../src/binaryen-ts/passes/lower-block-params.ts';
import '../../../src/binaryen-ts/passes/index.ts'; // side-effect: register all built-in passes

/**
 * `(func (export "f") (result i32) <body>)` in a module whose types are
 * `0: () -> i32` and `1: (i32) -> i32` — the second is every fixture's block type.
 */
function moduleWith(body: number[]): Uint8Array {
  return new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...[0x01, 0x0a, 0x02, 0x60, 0x00, 0x01, 0x7f, 0x60, 0x01, 0x7f, 0x01, 0x7f],
    ...[0x03, 0x02, 0x01, 0x00],
    ...[0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00],
    ...[0x0a, body.length + 2, 0x01, body.length, ...body],
  ]);
}

/** `i32.const 7; block (type 1) end` — the parameter falls through: 7. */
const BLOCK = moduleWith([0x00, 0x41, 0x07, 0x02, 0x01, 0x0b, 0x0b]);
/** `i32.const 7; try_table (type 1) end` — no handlers: 7. */
const TRY_TABLE = moduleWith([0x00, 0x41, 0x07, 0x1f, 0x01, 0x00, 0x0b, 0x0b]);
/** `i32.const 7; try (type 1) end` — legacy EH: 7. */
const LEGACY_TRY = moduleWith([0x00, 0x41, 0x07, 0x06, 0x01, 0x0b, 0x0b]);
/**
 * `(local i32) i32.const 3; loop (type 1) i32.const 1; i32.sub; local.tee 0;
 * local.get 0; br_if 0; end` — counts 3 → 0, the back-edge re-supplying the
 * parameter: 0.
 */
const LOOP_BACKEDGE = moduleWith([
  0x01,
  0x01,
  0x7f,
  0x41,
  0x03,
  0x03,
  0x01,
  0x41,
  0x01,
  0x6b,
  0x22,
  0x00,
  0x20,
  0x00,
  0x0d,
  0x00,
  0x0b,
  0x0b,
]);

async function run(bytes: Uint8Array): Promise<number> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
  return (instance.exports.f as () => number)();
}

function first<T extends Expression>(root: Expression, kind: ExpressionKind): T {
  let hit: Expression | undefined;
  walkExpression(root, (e) => {
    if (hit === undefined && e.kind === kind) hit = e;
  });
  assert(hit, `no ${kind} in the tree`);
  return hit as T;
}

describe('kept: a parametrised construct re-encodes as written', () => {
  for (
    const [name, bytes, expected] of [
      ['block', BLOCK, 7],
      ['try_table', TRY_TABLE, 7],
      ['legacy try', LEGACY_TRY, 7],
      ['loop with a back-edge', LOOP_BACKEDGE, 0],
    ] as const
  ) {
    it(name, async () => {
      assertEquals(await run(bytes), expected, 'the fixture itself');
      const kept = encodeWasm(parseWasm(bytes));
      assertEquals(kept, bytes);
      // The other two paths, for the constructs multivalue.test.ts lacks.
      const lowered = encodeWasm(parseWasm(bytes, undefined, { lowerBlockParams: true }));
      assertEquals(await run(lowered), expected, 'lowered at decode');
      const m = parseWasm(bytes);
      new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 2 }).addDefaultOptimizationPasses().run();
      assertEquals(await run(encodeWasm(m)), expected, 'lowered by PassRunner, then -Oz');
    });
  }
});

describe('kept: what the node holds', () => {
  it("the entry values are the construct's params; its body starts with a Pop", () => {
    const block = first<BlockExpr>(parseWasm(BLOCK).functions[0]!.body, ExpressionKind.Block);
    assertEquals(block.params?.types, [ValType.I32]);
    assertEquals(block.params?.values.map((v) => v.kind), [ExpressionKind.Const]);
    assertEquals(block.children.map((c) => c.kind), [ExpressionKind.Pop]);
  });

  it('a back-edge to a parametrised loop CARRIES the parameter; no locals are added', () => {
    const mod = parseWasm(LOOP_BACKEDGE);
    const loop = first<LoopExpr>(mod.functions[0]!.body, ExpressionKind.Loop);
    assertEquals(loop.params?.types, [ValType.I32]);
    const br = first<BreakExpr>(loop.body, ExpressionKind.Break);
    assertEquals(br.values.length, 1);
    assertEquals(mod.functions[0]!.locals.length, 1, 'only the declared local');
  });

  it('lowered at decode, the same module has NO params and spills to a local', () => {
    const mod = parseWasm(LOOP_BACKEDGE, undefined, { lowerBlockParams: true });
    assertEquals(hasBlockParams(mod.functions[0]!.body), false);
    assert(mod.functions[0]!.locals.length > 1, 'a spill local was added');
  });
});

describe('lowerBlockParams — where optimization starts', () => {
  it('lowers to EXACTLY what decode-time lowering gives', () => {
    for (const bytes of [BLOCK, TRY_TABLE, LEGACY_TRY, LOOP_BACKEDGE]) {
      const m = parseWasm(bytes);
      assertEquals(lowerBlockParams(m), 1);
      assertEquals(hasBlockParams(m.functions[0]!.body), false);
      assertEquals(
        encodeWasm(m),
        encodeWasm(parseWasm(bytes, undefined, { lowerBlockParams: true })),
      );
    }
  });

  it('PassRunner.run lowers even with an empty queue — no pass ever sees params', () => {
    const m = parseWasm(BLOCK);
    new PassRunner(m).run();
    assertEquals(hasBlockParams(m.functions[0]!.body), false);
  });

  it('leaves a module with no params untouched', () => {
    const m = parseWasm(moduleWith([0x00, 0x41, 0x07, 0x0b]));
    const body = m.functions[0]!.body;
    assertEquals(lowerBlockParams(m), 0);
    assert(m.functions[0]!.body === body, 'the body object was replaced');
  });

  it('refuses, loudly, a module renamed after decoding', () => {
    // The re-decoded bodies name entities as the decoder does, by index; a
    // renamed module would get bodies calling names it no longer has.
    // Renamed consistently — the export follows — so the module still encodes.
    const m = parseWasm(BLOCK);
    const old = m.functions[0]!.name;
    m.functions[0]!.name = '$renamed';
    for (const e of m.exports) if (e.value === old) e.value = '$renamed';
    assertThrows(() => lowerBlockParams(m), Error, 'names no longer match');
  });
});
