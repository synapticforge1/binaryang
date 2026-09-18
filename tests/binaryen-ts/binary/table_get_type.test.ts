// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Found by M8d (2026-09-18): binaryen-ts typed every `table.get` `funcref`,
// whatever the table held. The decoder never passed the element type to
// `makeTableGet`, whose default was `funcref` — and `wasm-opt` reads text
// through that decoder (`readWat`: `wat2wasm`, then `parseWasm`). binaryen-ts's
// own WAT parser, which tests build modules with, wrote `funcref` outright. Over the 2,490 valid spec binaries that was 235
// `table.get`s mistyped, and 99 more nodes typed from them. A type reaches no
// byte by itself, so no byte gate saw it; a pass dispatching on it would have.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';

const WAT = `(module
  (type $s (struct))
  (import "m" "t" (table $imp 1 externref))
  (table $any 1 anyref)
  (table $typed 1 (ref null $s))
  (table $fn 1 funcref)
  (func (export "f")
    (drop (table.get $imp (i32.const 0)))
    (drop (table.get $any (i32.const 0)))
    (drop (table.get $typed (i32.const 0)))
    (drop (table.get $fn (i32.const 0)))))`;

const EXPECTED = [
  ValType.ExternRef,
  ValType.AnyRef,
  { heapType: { kind: 'index', value: 0 }, nullable: true },
  ValType.FuncRef,
];

/** The type of every `table.get` in function 0, in order. */
function tableGetTypes(m: WasmModule): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if ((v as { kind?: unknown }).kind === 'table.get') out.push((v as { type: unknown }).type);
    for (const [k, x] of Object.entries(v)) if (k !== 'loc') walk(x);
  };
  walk(m.functions[0]!.body);
  return out;
}

describe("table.get is typed by its table's element type", () => {
  it('the decoder: imported, anyref, typed-reference and funcref tables', () => {
    assertEquals(tableGetTypes(parseWasm(wat2wasm(WAT).binary)), EXPECTED);
  });

  it("wasm-opt's text route (readWat -> the decoder): the same four", () => {
    assertEquals(tableGetTypes(readWat(WAT)), EXPECTED);
  });

  it("binaryen-ts's own WAT parser: the same four", () => {
    assertEquals(tableGetTypes(parseWat(WAT)), EXPECTED);
  });

  it("binaryen-ts's WAT parser: an out-of-range table index is refused, not typed funcref", () => {
    assertThrows(
      () => parseWat('(module (func (drop (table.get 3 (i32.const 0)))))'),
      Error,
      'table.get: unknown table',
    );
  });
});
