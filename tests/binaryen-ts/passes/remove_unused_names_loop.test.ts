// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// RemoveUnusedNames replaces a loop nothing branches back to with its body.
// The body takes the LOOP's place, so a body of several instructions becomes a
// block DECLARING the loop's type (S6 step 5 item 5 (3)) — declared void, a
// value loop's replacement leaves its value where the block's `end` refuses it.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

Deno.test('RemoveUnusedNames: a value loop with no back-edge becomes a block of its type', () => {
  const r = wat2wasm(
    `(module (func (export "f") (param i32) (result i32)
      (i32.add (loop $l (result i32) (drop (local.get 0)) (i32.const 5)) (i32.const 1))))`,
  );
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const mod = parseWasm(r.binary);
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).add('RemoveUnusedNames').run();
  const add = mod.functions[0]!.body.children[0]!;
  assert(add.kind === ExpressionKind.Binary);
  assertEquals(add.left.kind, ExpressionKind.Block, 'the loop was replaced');
  assertEquals(add.left.type, 0x7f);
  const out = encodeWasm(mod);
  const f = new WebAssembly.Instance(new WebAssembly.Module(out as BufferSource)).exports.f as (
    x: number,
  ) => number;
  assertEquals(f(3), 6);
});
