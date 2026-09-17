// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5 item 6 (M2g): a binaryen-ts table or memory holds wabt-ts's
// `Limits` record, and a table its `elemType` and optional `init` region.
//
// 🔧 What the flat numbers could not hold, the decoder lost:
// - the table reader took the whole flag byte as "has a maximum", so a table64
//   read as a 32-bit table and was WRITTEN BACK as one — 11 spec binaries, no
//   diagnostic, and a module whose `call_indirect` takes an i64 came back
//   invalid;
// - sizes were u32 even for a 64-bit memory or table ("LEB128 u32 overflow");
// - a table's initializer (`0x40 0x00`) read as a value type, and was refused;
// - the custom-page-sizes flag and its trailing field were ignored.
// And the constant-expression reader never checked its `end` byte, so a
// two-instruction initializer lost its second instruction.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { bridgeToBinaryen } from '../../../src/bridge/bridge.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm, WasmEncodeError } from '../../../src/binaryen-ts/encoder/index.ts';
import { WasmBinaryError } from '../../../src/binaryen-ts/binary/reader.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { limitsOf, ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ExternalKind } from '../../../src/wabt-ts/core/binary.ts';
import { createModule } from '../../../src/binaryen-ts/api/index.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}

/** The body of known section `id`, as hex (custom sections skipped). */
function section(bytes: Uint8Array, id: number): string {
  let i = 8;
  while (i < bytes.length) {
    const sid = bytes[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const b = bytes[i++]!;
      size += (b & 0x7f) * 2 ** s;
      if ((b & 0x80) === 0) break;
    }
    if (sid === id) {
      return [...bytes.subarray(i, i + size)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    }
    i += size;
  }
  return '';
}

const roundTrip = (b: Uint8Array) => encodeWasm(parseWasm(b));

describe('M2g — a table or memory keeps its limits through decode → encode', () => {
  const cases: [string, string, number][] = [
    ['a table64', '(module (table i64 1 10 funcref))', 4],
    ['a memory64 past 2^32 pages', '(module (memory i64 0x1_0000_0001))', 5],
    ['a custom page size', '(module (memory 1 (pagesize 1)))', 5],
    ['a shared memory', '(module (memory 1 2 shared))', 5],
    ['a table with an initializer', '(module (func $f) (table 2 funcref (ref.func $f)))', 4],
  ];
  for (const [label, wat, id] of cases) {
    it(`${label}: the section comes back byte for byte`, () => {
      const bytes = assemble(wat);
      assertEquals(section(roundTrip(bytes), id), section(bytes, id));
    });
  }

  it('the decoded records say what the binary said', () => {
    const t = parseWasm(assemble('(module (table i64 1 10 funcref))')).tables[0]!;
    assertEquals(t.limits, { initial: 1n, max: 10n, isShared: false, is64: true });
    const m = parseWasm(assemble('(module (memory 1 (pagesize 1)))')).memories[0]!;
    assertEquals(m.limits, { initial: 1n, isShared: false, is64: false, pageSizeLog2: 0 });
    const withInit = parseWasm(assemble('(module (func $f) (table 2 funcref (ref.func $f)))'))
      .tables[0]!;
    assertEquals(withInit.init?.children.map((e) => e.kind), [ExpressionKind.RefFunc]);
    assertEquals(parseWasm(assemble('(module (table 2 funcref))')).tables[0]!.init, undefined);
  });
});

describe('M2g — what cannot be held is refused, not dropped', () => {
  it('an element segment keeps its element type (M3 carries it)', () => {
    const bytes = assemble(
      '(module (table 1 externref) (elem (table 0) (i32.const 0) externref (ref.null extern)))',
    );
    assertEquals(section(roundTrip(bytes), 9), section(bytes, 9));
  });

  it('an undefined limits flag bit', () => {
    const bytes = assemble('(module (memory 1))');
    const at = bytes.indexOf(0x05, 8) + 3; // section id, size, count → the flag byte
    assertEquals(bytes[at], 0x00);
    const bad = bytes.slice();
    bad[at] = 0x10;
    assertThrows(() => parseWasm(bad), WasmBinaryError, 'malformed limits flags: 0x10');
  });

  it('a page size on a table', () => {
    const bytes = assemble('(module (table 1 funcref))');
    const at = bytes.indexOf(0x04, 8) + 4; // section id, size, count, elem type → the flag byte
    assertEquals(bytes[at], 0x00);
    // Flag 0x08 with its trailing field, and the section one byte longer.
    const bad = new Uint8Array([
      ...bytes.subarray(0, at),
      0x08,
      0x01,
      0x00,
      ...bytes.subarray(at + 2),
    ]);
    bad[bytes.indexOf(0x04, 8) + 1]! += 1;
    assertThrows(() => parseWasm(bad), WasmBinaryError, 'a table has no page size');
  });

  // 🔧 These two were REFUSED while the flat import record had nowhere to put a
  // table's `is64` or a memory's page size (M2g). M4 embeds the entity itself,
  // so the import carries the same `Limits` a definition does.
  it('an imported table64 keeps its 64-bit limits (M4)', () => {
    const bytes = assemble('(module (import "m" "t" (table i64 1 funcref)))');
    assertEquals(section(roundTrip(bytes), 2), section(bytes, 2));
    const imp = parseWasm(bytes).imports[0]!;
    assert(imp.kind === ExternalKind.Table);
    assertEquals(imp.table.limits, { initial: 1n, isShared: false, is64: true });
  });

  it('an imported memory keeps its custom page size (M4)', () => {
    const bytes = assemble('(module (import "m" "mem" (memory 1 (pagesize 1))))');
    assertEquals(section(roundTrip(bytes), 2), section(bytes, 2));
    const imp = parseWasm(bytes).imports[0]!;
    assert(imp.kind === ExternalKind.Memory);
    assertEquals(imp.memory.limits.pageSizeLog2, 0);
  });

  it('an imported memory64 keeps its flags and sizes', () => {
    const bytes = assemble('(module (import "m" "mem" (memory i64 2 3 shared)))');
    assertEquals(section(roundTrip(bytes), 2), section(bytes, 2));
  });

  it('the encoder: a 32-bit size past u32', () => {
    const mod = new ModuleBuilder().addMemory('$m', limitsOf(2n ** 32n)).build();
    assertThrows(() => encodeWasm(mod), WasmEncodeError, 'does not fit a 32-bit limit');
  });
});

describe('M2g — serializeToWat writes the memory it holds', () => {
  it('64-bit and shared', () => {
    const mod = createModule((b) => {
      b.addMemory('m', limitsOf(1, 2, { isShared: true, is64: true }));
    });
    const wat = mod.toWat();
    assert(wat.includes('(memory $m i64 1 2 shared)'), wat);
  });
});

describe('M2g — the bridge carries the record', () => {
  function bridged(wat: string): Uint8Array {
    const { module, errors } = parseWatModule(new LexerSource(wat, '<m2g>'));
    assert(!hasErrors(errors), formatErrors(errors));
    const errs = makeErrorList();
    resolveNames(module, errs);
    assert(!hasErrors(errs), formatErrors(errs));
    return encodeWasm(bridgeToBinaryen(module));
  }

  for (
    const wat of [
      '(module (table i64 1 10 funcref))',
      '(module (memory 1 (pagesize 1)))',
      '(module (func $f) (table 2 funcref (ref.func $f)))',
    ]
  ) {
    it(wat, () => {
      const id = wat.includes('memory') ? 5 : 4;
      assertEquals(section(bridged(wat), id), section(assemble(wat), id));
    });
  }
});
