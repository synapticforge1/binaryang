// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A `throw` or `catch` of an IMPORTED tag decodes with the tag's payload.
//
// The decoder looked a tag's payload up in `tagInfos`, which holds only the
// DEFINED tags, by the tag INDEX, where imported tags come first. So with an
// imported `(param i32 i64)` tag, `throw 0` found no entry, the `?? []` fallback
// said "no payload", and the throw popped nothing: its two operands were left
// as loose statements before it. The bytes still round-tripped, because the
// operands were written where they had been read — the IR said something else.
// Found while naming tags for N1 P4.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import type { Expression } from '../../../src/binaryen-ts/ir/expressions.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
function find(body: Expression, kind: string): Expression[] {
  const out: Expression[] = [];
  walkExpression(body, (e) => {
    if (e.kind === kind) out.push(e);
  });
  return out;
}

const WAT = `(module
  (import "env" "e" (tag $imp (param i32 i64)))
  (tag $def (param f32))
  (func (export "f") (throw $imp (i32.const 1) (i64.const 2)))
  (func (export "g") (throw $def (f32.const 3))))`;

describe('a throw of an imported tag carries its payload', () => {
  const bytes = assemble(WAT);
  const m = parseWasm(bytes);

  it("the imported tag's throw has both operands", () => {
    const [t] = find(m.functions[0]!.body, 'throw') as unknown as { operands: Expression[] }[];
    assertEquals(t!.operands.map((o) => o.kind), ['const', 'const']);
    // …and nothing is left behind it.
    assertEquals(m.functions[0]!.body.children.length, 1);
  });

  it('a defined tag after it still finds ITS payload', () => {
    const [t] = find(m.functions[1]!.body, 'throw') as unknown as { operands: Expression[] }[];
    assertEquals(t!.operands.length, 1);
  });

  it('and the module still round-trips byte for byte', () => {
    const out = encodeWasm(m);
    assert(out.length === bytes.length && out.every((x, i) => x === bytes[i]));
  });
});
