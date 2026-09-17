// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5 item 6 (M2b): binaryen-ts holds a constant expression as a
// `RegionExpr`, and an absent one as a missing field — wabt-ts's shape (owner,
// 2026-09-16). A global's `init` and a segment's `offset` were one `Expression`
// (and `null` for none), which cannot hold a sequence.
//
// ⚠️ The DECODER still reads one instruction from a fixed set; the region can
// hold more, and the encoder writes whatever it holds. That is what is pinned
// here: the encoder writes the SEQUENCE, not its first instruction.

import { assert, assertEquals, assertThrows } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm, WasmEncodeError } from '../../../src/binaryen-ts/encoder/index.ts';
import { createModule } from '../../../src/binaryen-ts/api/index.ts';
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
