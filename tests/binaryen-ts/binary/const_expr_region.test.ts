// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5 item 6 (M2b): binaryen-ts holds a constant expression as a
// `RegionExpr`, and an absent one as a missing field — wabt-ts's shape (owner,
// 2026-09-16). A global's `init` and a segment's `offset` were one `Expression`
// (and `null` for none), which cannot hold a sequence.
//
// The encoder writes the SEQUENCE, not its first instruction. Since 2026-09-17
// the decoder reads one too — with the function-body decoder, up to the `end`
// (it read ONE instruction from a fixed set, and refused the rest).

import { assert, assertEquals, assertThrows } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm, WasmEncodeError } from '../../../src/binaryen-ts/encoder/index.ts';
import { createModule } from '../../../src/binaryen-ts/api/index.ts';
import { WasmBinaryError } from '../../../src/binaryen-ts/binary/reader.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { makeI32Const, makeRegion } from '../../../src/binaryen-ts/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

/** The body of section `id`, as hex. */
function section(bytes: Uint8Array, id: number): string {
  let i = 8;
  while (i < bytes.length) {
    const sid = bytes[i++]!;
    let size = 0, shift = 0, b: number;
    do {
      b = bytes[i++]!;
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (sid === id) {
      return Array.from(bytes.subarray(i, i + size)).map((x) => x.toString(16).padStart(2, '0'))
        .join(' ');
    }
    i += size;
  }
  return '';
}

Deno.test('the encoder writes every instruction a constant expression holds, then end', () => {
  // Two values: invalid, and exactly what a binary can say. The region holds it.
  const mod = new ModuleBuilder()
    .addGlobal('$g', ValType.I32, false, makeRegion([makeI32Const(1), makeI32Const(2)]))
    .build();
  // 1 global: i32 (7f), immutable (00), `i32.const 1 i32.const 2 end`
  assertEquals(section(encodeWasm(mod), 6), '01 7f 00 41 01 41 02 0b');
});

Deno.test('a global init and an active offset decode as one-instruction regions', () => {
  const bytes = encodeWasm(
    new ModuleBuilder()
      .addMemory('$m', 1)
      .addGlobal('$g', ValType.I32, false, makeI32Const(7))
      .addDataSegment('$d', makeI32Const(3), new Uint8Array([1]))
      .build(),
  );
  const mod = parseWasm(bytes);
  assertEquals(mod.globals[0]!.init!.children.map((e) => e.kind), ['const']);
  assertEquals(mod.dataSegments[0]!.offset?.children.map((e) => e.kind), ['const']);
  assertEquals(encodeWasm(mod), bytes);
});

Deno.test('a passive data segment has NO offset field (it was null)', () => {
  const bytes = encodeWasm(
    new ModuleBuilder().addMemory('$m', 1).addPassiveDataSegment('$p', new Uint8Array([9]))
      .build(),
  );
  const seg = parseWasm(bytes).dataSegments[0]!;
  assert(seg.passive);
  assertEquals('offset' in seg, false);
});

// M2h: a global's `init` is OPTIONAL, as wabt-ts's is — the record also describes an
// imported global, which has none. Absent means MISSING, so a DEFINED global
// without one is refused where it would be written, and passes step over it.
function withoutInit() {
  const mod = new ModuleBuilder()
    .addGlobal('$g', ValType.I32, false, makeI32Const(7))
    .addFunction('$f', [], [], [])
    .addExport('f', '$f')
    .build();
  delete mod.globals[0]!.init;
  return mod;
}

Deno.test('a defined global with no initializer is refused by the encoder', () => {
  assertThrows(
    () => encodeWasm(withoutInit()),
    WasmEncodeError,
    'global $g: it has no initializer',
  );
});

Deno.test('a defined global with no initializer is refused by toWat', () => {
  const mod = createModule(() => {});
  mod.ir.globals.push(withoutInit().globals[0]!);
  assertThrows(() => mod.toWat(), Error, 'global $$g has no initializer');
});

for (const pass of ['vacuum', 'optimize-instructions', 'remove-unused-module-elements']) {
  Deno.test(`${pass} steps over a global with no initializer`, () => {
    const mod = withoutInit();
    new PassRunner(mod, { optimizeLevel: 2 }).add(pass).run();
    assertEquals(mod.globals.find((g) => g.name === '$g')?.init, undefined);
  });
}

// A constant expression of MORE than one instruction decodes, as the tree it
// is, and re-encodes byte for byte.
for (
  const [label, wat, kinds] of [
    ['extended-const', '(module (global i32 (i32.add (i32.const 1) (i32.const 2))))', [
      ExpressionKind.Binary,
    ]],
    [
      'GC',
      '(module (type $a (array i32)) (global (ref $a) (array.new_fixed $a 2 (i32.const 1) (i32.const 2))))',
      [ExpressionKind.ArrayNewFixed],
    ],
    ['a table initializer', '(module (table 1 i31ref (ref.i31 (i32.const 7))))', [
      ExpressionKind.RefI31,
    ]],
  ] as const
) {
  Deno.test(`a constant expression of several instructions decodes (${label})`, () => {
    const bytes = wat2wasm(wat).binary;
    const mod = parseWasm(bytes);
    const init = mod.globals[0]?.init ?? mod.tables[0]?.init;
    assertEquals(init?.children.map((e) => e.kind), [...kinds]);
    assertEquals(encodeWasm(mod), bytes);
  });
}

Deno.test('a constant expression with no end is refused', () => {
  // `(global i32 (i32.const 7))`, cut after the constant: the section is the
  // rest of the module, so the decoder runs off the end looking for `end`.
  const bytes = wat2wasm('(module (global i32 (i32.const 7)))').binary;
  const at = bytes.indexOf(0x41, 8); // i32.const
  const cut = new Uint8Array([...bytes.subarray(0, at + 2)]);
  cut[at - 4] = cut.length - (at - 3); // the global section's size: to the end of the input
  assertThrows(() => parseWasm(cut), WasmBinaryError, 'no `end`');
});

/** `\0asm` version 1, then the given sections' bytes. */
const moduleOf = (...sections: number[][]) =>
  new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections.flat()]);

Deno.test('a constant expression that consumes a value from beneath a statement is refused', () => {
  // `i32.const 1` `nop` `i32.const 2` `i32.add`: the add's left operand sits under
  // the `nop`. A function body spills it to a local; a constant expression has
  // no locals to spill into, and only an invalid one can need it.
  const expr = [0x41, 0x01, 0x01, 0x41, 0x02, 0x6a, 0x0b];
  const global = [0x01, 0x7f, 0x00, ...expr];
  const bytes = moduleOf([0x06, global.length, ...global]);
  assertThrows(() => parseWasm(bytes), WasmBinaryError, 'consumed from beneath a statement');
});

Deno.test('an element segment elemkind other than funcref (0x00) is refused', () => {
  // `(module (func $f) (elem func $f))` — a passive segment, flag 1, elemkind 0x00.
  const bytes = wat2wasm('(module (func $f) (elem func $f))').binary;
  const at = bytes.indexOf(0x09, 8) + 4; // section id, size, count, flags → elemkind
  assertEquals([bytes[at - 1], bytes[at]], [0x01, 0x00]);
  const bad = bytes.slice();
  bad[at] = 0x01;
  assertThrows(() => parseWasm(bad), WasmBinaryError, 'elemkind 0x1');
});

Deno.test('an element-segment expression of more than one instruction is refused', () => {
  // `(elem funcref (ref.func $f))`: flag 5 … `d2 00 0b`. A `nop` before the `end`,
  // and the section one byte longer: it was read as the end, silently.
  const bytes = wat2wasm('(module (func $f) (elem funcref (ref.func $f)))').binary;
  const sec = bytes.indexOf(0x09, 8);
  const end = bytes.indexOf(0x0b, sec);
  assertEquals([bytes[end - 2], bytes[end - 1]], [0xd2, 0x00]);
  const bad = new Uint8Array([...bytes.subarray(0, end), 0x01, ...bytes.subarray(end)]);
  bad[sec + 1]! += 1;
  assertThrows(() => parseWasm(bad), WasmBinaryError, 'more than one instruction');
});
