// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, item 5 (3b): `mapWithSequences` — a rewrite that is several
// statements, standing where one expression stood.
//
// A construct's type is what it DECLARES (owner, 2026-09-16), so a pass can no
// longer put a block typed `unreachable` where a stack-polymorphic instruction
// stood and rely on the encoder to write an `unreachable` after its `end`. It
// returns a Sequence instead, and the walk puts the statements in the tree:
// spliced into a list; in an operand slot, the consumer (which never runs) is
// replaced by its earlier operands and the sequence, its later operands gone.
//
// Each fixture replaces `local.get 1` with `drop (local.get 0)`, `unreachable`,
// and checks the tree, that the module validates, and what running it does.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import {
  type Expression,
  ExpressionKind,
  makeDrop,
  makeUnreachable,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { mapWithSequences, type Sequence } from '../../../src/binaryen-ts/ir/walk.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

/** `local.get 1` → `drop (local.get 0)`, `unreachable`. */
function trapOnSecondLocal(e: Expression): Expression | Sequence {
  if (e.kind !== ExpressionKind.LocalGet || e.var.kind !== 'index' || e.var.value !== 1) return e;
  return { sequence: [makeDrop({ ...e, var: { kind: 'index', value: 0 } }), makeUnreachable()] };
}

/** The module, rewritten; the kinds of `f`'s body; and `f`, with the side-effect counter. */
function rewrite(funcs: string) {
  const r = wat2wasm(
    `(module (global $n (export "n") (mut i32) (i32.const 0))
       (func $side (result i32) (global.set $n (i32.add (global.get $n) (i32.const 1))) (i32.const 10))
       ${funcs})`,
  );
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = parseWasm(r.binary);
  const f = mod.functions[1]!; // after $side
  f.body = mapWithSequences(f.body, trapOnSecondLocal);
  const out = encodeWasm(mod);
  assert(WebAssembly.validate(out as BufferSource), 'the rewritten module validates');
  const inst = new WebAssembly.Instance(new WebAssembly.Module(out as BufferSource));
  const run = inst.exports.f as (a: number, b: number) => number;
  const n = inst.exports.n as WebAssembly.Global;
  const call = (): string => {
    try {
      return String(run(1, 2));
    } catch (e) {
      return e instanceof WebAssembly.RuntimeError ? 'trap' : 'exception';
    }
  };
  return { kinds: f.body.children.map((c) => c.kind), body: f.body, call, n };
}

Deno.test('in a list, the statements are spliced — no block', () => {
  const { kinds, call } = rewrite(
    '(func (export "f") (param i32 i32) (result i32) (local.get 1))',
  );
  assertEquals(kinds, [ExpressionKind.Drop, ExpressionKind.Unreachable]);
  assertEquals(call(), 'trap');
});

Deno.test('in an operand slot, the consumer goes: earlier operands kept, later ones dead', () => {
  // i32.add (call $side) (i32.sub (local.get 1) (call $side)): the FIRST call
  // runs before the trap, the second never would.
  const { kinds, call, n, body } = rewrite(
    '(func (export "f") (param i32 i32) (result i32)' +
      ' (i32.add (call $side) (i32.sub (local.get 1) (call $side))))',
  );
  assertEquals(kinds, [ExpressionKind.Drop, ExpressionKind.Drop, ExpressionKind.Unreachable]);
  const first = body.children[0]!;
  assert(first.kind === ExpressionKind.Drop && first.value.kind === ExpressionKind.Call);
  assertEquals([call(), n.value], ['trap', 1]);
});

Deno.test("a carrier's operand: the if never runs, and is replaced", () => {
  const { kinds, call } = rewrite(
    '(func (export "f") (param i32 i32) (result i32)' +
      ' (if (result i32) (local.get 1) (then (i32.const 1)) (else (i32.const 2))))',
  );
  assertEquals(kinds, [ExpressionKind.Drop, ExpressionKind.Unreachable]);
  assertEquals(call(), 'trap');
});

Deno.test('inside a block, the block absorbs it and keeps its declared type', () => {
  const { body, call } = rewrite(
    '(func (export "f") (param i32 i32) (result i32)' +
      ' (i32.add (block (result i32) (local.get 1)) (i32.const 1)))',
  );
  const add = body.children[0]!;
  assert(add.kind === ExpressionKind.Binary, `the add stays: ${add.kind}`);
  const block = add.left;
  assert(block.kind === ExpressionKind.Block);
  assertEquals(block.children.map((c) => c.kind), [
    ExpressionKind.Drop,
    ExpressionKind.Unreachable,
  ]);
  assertEquals(block.type, 0x7f);
  assertEquals(call(), 'trap');
});

Deno.test('untouched nodes pass through, and a later sequence still settles', () => {
  const { kinds, call, n } = rewrite(
    '(func (export "f") (param i32 i32) (result i32)' +
      ' (drop (call $side)) (drop (local.get 0)) (local.get 1))',
  );
  assertEquals(kinds, [
    ExpressionKind.Drop,
    ExpressionKind.Drop,
    ExpressionKind.Drop,
    ExpressionKind.Unreachable,
  ]);
  assertEquals([call(), n.value], ['trap', 1]);
});

Deno.test("a block's ENTRY VALUE is an operand: the block never runs, and is replaced", () => {
  const { kinds, call, n } = rewrite(
    '(type $p (func (param i32 i32) (result i32)))' +
      '(func (export "f") (param i32 i32) (result i32)' +
      ' (call $side) (local.get 1) (block (type $p) (i32.add)))',
  );
  assertEquals(kinds, [
    ExpressionKind.Drop,
    ExpressionKind.Drop,
    ExpressionKind.Unreachable,
  ]);
  assertEquals([call(), n.value], ['trap', 1]);
});
