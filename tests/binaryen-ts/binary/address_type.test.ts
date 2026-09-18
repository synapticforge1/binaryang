// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Found by M8d (2026-09-18): `memory.size` / `memory.grow` and `table.size` /
// `table.grow` were typed `i32` whatever the memory or table — the factories
// hard-coded it. A memory64 memory's size, and a table64 table's, is an `i64`.
// The factories now take the address type (required), the decoder records each
// memory's and table's, and `deriveTypes` reads it from the module. The node's
// type is not written, so no byte changed; 4 spec binaries that name a memory
// the module does not have are now refused, as V8 refuses them.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { prepareForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { Module as CompatModule } from '../../../src/binaryen-ts/api/binaryen-compat.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

const WAT = `(module
  (import "m" "mem32" (memory 1))
  (memory $m64 i64 1)
  (table $t32 1 funcref)
  (table $t64 i64 1 funcref)
  (func (export "f")
    (drop (memory.size 0))
    (drop (memory.size $m64))
    (drop (memory.grow 0 (i32.const 1)))
    (drop (memory.grow $m64 (i64.const 1)))
    (drop (table.size $t32))
    (drop (table.size $t64))
    (drop (table.grow $t32 (ref.null func) (i32.const 1)))
    (drop (table.grow $t64 (ref.null func) (i64.const 1)))))`;

const KINDS = ['memory.size', 'memory.grow', 'table.size', 'table.grow'];
const EXPECTED = [
  ['memory.size', ValType.I32],
  ['memory.size', ValType.I64],
  ['memory.grow', ValType.I32],
  ['memory.grow', ValType.I64],
  ['table.size', ValType.I32],
  ['table.size', ValType.I64],
  ['table.grow', ValType.I32],
  ['table.grow', ValType.I64],
];

/** Every size / grow node of function 0, in order, with its type. */
function sizes(m: { functions: { body: unknown }[] }): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    const k = (v as { kind?: string }).kind;
    if (k !== undefined && KINDS.includes(k)) out.push([k, (v as { type: unknown }).type]);
    for (const [key, x] of Object.entries(v)) if (key !== 'loc') walk(x);
  };
  walk(m.functions[0]!.body);
  return out;
}

describe('size and grow are typed by the address type', () => {
  it('the decoder: an i32 and an i64 memory, an i32 and an i64 table', () => {
    assertEquals(sizes(parseWasm(wat2wasm(WAT).binary)), EXPECTED);
  });

  it('deriveTypes, on a text-read tree', () => {
    const { module } = parseWatModule(WAT);
    resolveNames(module);
    synthesizeTypes(module);
    assertEquals(sizes(prepareForPasses(module)), EXPECTED);
  });

  it("the compat API: upstream's (name, memory64)", () => {
    const mod = new CompatModule();
    assertEquals(mod.memory.size().type, ValType.I32);
    assertEquals(mod.memory.size('mem', true).type, ValType.I64);
    assertEquals(mod.memory.grow(mod.i64.const(1), 'mem', true).type, ValType.I64);
  });

  it('the decoder refuses a memory the module does not have, as V8 does', () => {
    const { binary } = wat2wasm('(module (func (drop (memory.size))))');
    assertThrows(() => parseWasm(binary), Error, 'memory index 0 is out of range');
  });
});
