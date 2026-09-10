// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `memory-access.ts` is now the ONE place a load/store opcode's width,
// signedness and type are written down. It replaced five copies, two of which
// carried inverse rotations of the i64 narrow stores that cancelled across every
// round trip. So the table is checked against sources that are NOT itself:
//
//   - the MNEMONIC in each row must equal wabt-ts's `anyOpcodeName(opcode)`, so
//     a row cannot name one instruction while holding another's opcode (it is
//     `anyOpcodeName`, not `opcodeName`: the latter covers only the one-byte
//     opcodes and returns `undefined` for `v128.load`/`v128.store`);
//   - the WIDTH must be the one the MNEMONIC states (`store8` is 1 byte, a plain
//     `i64.load` is 8), so a row cannot carry the right opcode with a rotated
//     width — which is exactly the shape of the defect this table replaced.
//
// Either check alone would have missed half of it: the rotated encoder had every
// NAME right and every WIDTH wrong.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import {
  loadByName,
  loadShape,
  MEMORY_ACCESS_TABLE,
  storeByName,
  withSigned,
} from '../../../src/binaryen-ts/ir/memory-access.ts';
import { anyOpcodeName, Opcode } from '../../../src/wabt-ts/core/opcode.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

/** The width a mnemonic states: `load8`/`store16` explicitly, else the type's. */
function widthFromName(name: string): number {
  const m = name.match(/(?:load|store)(8|16|32)/);
  if (m) return Number(m[1]) / 8;
  if (name.startsWith('v128')) return 16;
  return name.startsWith('i64') || name.startsWith('f64') ? 8 : 4;
}

describe('memory-access table: each row checked against sources that are not itself', () => {
  const rows = [...MEMORY_ACCESS_TABLE.loads, ...MEMORY_ACCESS_TABLE.stores];

  for (const row of rows) {
    it(`${row.name}: mnemonic matches wabt-ts's name for 0x${row.opcode.toString(16)}`, () => {
      assertEquals(anyOpcodeName(row.opcode), row.name);
    });

    it(`${row.name}: width ${row.bytes} is what the mnemonic says`, () => {
      assertEquals(row.bytes, widthFromName(row.name));
    });
  }

  it('signedness matches the mnemonic: `_s` signed, everything else not', () => {
    for (const l of MEMORY_ACCESS_TABLE.loads) {
      assertEquals(l.signed, l.name.endsWith('_s'), l.name);
    }
  });

  it("covers every plain scalar load and store in wabt-ts's opcode set", () => {
    // 0x28..0x3e is the whole plain scalar memory-access range.
    for (let op = 0x28; op <= 0x3e; op++) {
      const name = anyOpcodeName(op);
      const found = name.includes('load') ? loadByName(name) : storeByName(name);
      assert(found !== undefined, `0x${op.toString(16)} (${name}) is missing from the table`);
    }
  });

  it('withSigned moves between the _s and _u of one width, and nowhere else', () => {
    assertEquals(withSigned(Opcode.I32Load8U, true), Opcode.I32Load8S);
    assertEquals(withSigned(Opcode.I64Load32S, false), Opcode.I64Load32U);
    assertEquals(withSigned(Opcode.I32Load16S, true), Opcode.I32Load16S);
    // A full-width load has no signed variant; asking must not silently no-op.
    assertThrows(() => withSigned(Opcode.I32Load, true), Error, 'no signed variant');
  });

  it('a non-load opcode is rejected rather than guessed', () => {
    assertThrows(() => loadShape(Opcode.I32Store), Error, 'not a plain load');
    assertEquals(loadShape(Opcode.F64Load).type, ValType.F64);
  });
});
