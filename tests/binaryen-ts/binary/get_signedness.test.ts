// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `struct.get` / `array.get` have THREE spellings, and the node has to hold all
// three: plain `get` (a non-packed field), `get_s` and `get_u` (a packed one).
//
// binaryen-ts carried `signed: boolean`, and decoded a plain `get` to `false`
// -- the same value as `get_u`. Its own encoder never noticed, because it
// derives the sub-opcode from the field's storage type. But wabt-ts's node is
// `signed?: boolean` and its text writer prints `undefined` as `get`, `true` as
// `get_s` and `false` as `get_u`; S6 step 5 makes those one node, so a decoded
// plain `struct.get` of an `i32` field would have PRINTED as `struct.get_u` --
// text that no longer validates, from a module that did.
//
// Fidelity binds, so wabt-ts's three states control: absent means plain `get`.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';

const WAT = `(module
  (type $s (struct (field i32) (field i8)))
  (type $a (array i8))
  (type $b (array i32))
  (func (export "sget") (param (ref $s)) (result i32)
    (drop (struct.get $s 0 (local.get 0)))
    (drop (struct.get_s $s 1 (local.get 0)))
    (struct.get_u $s 1 (local.get 0)))
  (func (export "aget") (param (ref $a)) (param (ref $b)) (result i32)
    (drop (array.get $b (local.get 1) (i32.const 0)))
    (drop (array.get_s $a (local.get 0) (i32.const 0)))
    (array.get_u $a (local.get 0) (i32.const 0))))`;

/** `signed` of every struct.get / array.get, in walk order, as a spelling. */
function spellings(m: WasmModule): string[] {
  const out: string[] = [];
  for (const f of m.functions) {
    walkExpression(f.body, (e) => {
      if (e.kind === ExpressionKind.StructGet || e.kind === ExpressionKind.ArrayGet) {
        const family = e.kind === ExpressionKind.StructGet ? 'struct' : 'array';
        // `in` rather than `=== undefined`: absent must mean ABSENT, not a
        // property that holds undefined.
        const suffix = !('signed' in e) ? '' : e.signed ? '_s' : '_u';
        out.push(`${family}.get${suffix}`);
      }
    });
  }
  return out.sort();
}

const EXPECTED = [
  'array.get',
  'array.get_s',
  'array.get_u',
  'struct.get',
  'struct.get_s',
  'struct.get_u',
];

describe('binaryen-ts — a get keeps which of its three spellings it was', () => {
  const bytes = wat2wasm(WAT).binary;

  it('the fixture is valid wasm, so every spelling here is legal', () => {
    assert(bytes.length > 0, 'wat2wasm produced a module');
    assert(WebAssembly.validate(bytes as BufferSource));
  });

  it('decoding binary keeps all three', () => {
    assertEquals(spellings(parseWasm(bytes)), EXPECTED);
  });

  it('parsing text keeps all three', () => {
    assertEquals(spellings(parseWat(WAT)), EXPECTED);
  });

  it('and re-encoding is byte-identical', () => {
    assertEquals(encodeWasm(parseWasm(bytes)), bytes);
  });
});
