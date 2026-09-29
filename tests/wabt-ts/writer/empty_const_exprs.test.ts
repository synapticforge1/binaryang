// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M2a — an EMPTY constant expression must print as something that reads back
// to the same module.
//
// A binary may carry an empty offset or element item (just `end`): invalid,
// but well-formed, and `wasm2wat` must not change what it is. It printed
// nothing, as upstream wabt's `wasm2wat` does, and so:
//   - an ACTIVE data or element segment with an empty offset read back as a
//     PASSIVE one (flag 0 → 1) — a different module;
//   - an element segment's empty item read back as no item at all (count
//     1 → 0).
// wasm-tools prints `(offset )` and `(item )`, and our parser already read
// both. A global's empty init needed nothing: `(global i32)` reads back as the
// same empty init. Closed 2026-09-29.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertStringIncludes } from '@std/assert';

import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const sec = (id: number, body: number[]): number[] => [id, body.length, ...body];

/** Every known section except `name`, as `id: hex` — our wat2wasm always writes names (N1 P2). */
function sections(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let i = 8;
  while (i < bytes.length) {
    const id = bytes[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const b = bytes[i++]!;
      size += (b & 0x7f) * 2 ** s;
      if ((b & 0x80) === 0) break;
    }
    const body = bytes.subarray(i, i + size);
    i += size;
    if (id === 0) continue; // custom sections (the name section)
    out.push(`${id}: ${[...body].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
  }
  return out;
}

const CASES: { name: string; bytes: number[]; prints: string }[] = [
  {
    name: 'an active data segment with an empty offset stays ACTIVE',
    bytes: [...HEADER, ...sec(5, [1, 0, 1]), ...sec(11, [1, 0x00, 0x0b, 2, 0x61, 0x62])],
    prints: '(data (;0;) (offset) "ab")',
  },
  {
    name: 'an active element segment with an empty offset stays ACTIVE',
    bytes: [...HEADER, ...sec(4, [1, 0x70, 0, 1]), ...sec(9, [1, 0x00, 0x0b, 0])],
    prints: '(elem (;0;) (offset) func)',
  },
  {
    name: 'an empty element item stays an item',
    bytes: [...HEADER, ...sec(4, [1, 0x70, 0, 1]), ...sec(9, [1, 0x05, 0x70, 1, 0x0b])],
    prints: '(elem (;0;) funcref (item))',
  },
  {
    name: "a global's empty init prints nothing and reads back empty",
    bytes: [...HEADER, ...sec(6, [1, 0x7f, 0x00, 0x0b])],
    prints: '(global (;0;) i32)',
  },
];

describe('M2a — an empty constant expression round-trips through wasm2wat', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const original = new Uint8Array(c.bytes);
      for (const fold of [false, true]) {
        const text = wasm2wat(original, { fold }).text;
        assert(text, 'wasm2wat produced no text');
        assertStringIncludes(text, c.prints, `fold: ${fold}`);
        const back = wat2wasm(text, { textForm: false });
        assertEquals(back.errors.length, 0, formatErrors(back.errors));
        assertEquals(sections(back.binary), sections(original), `fold: ${fold}\n${text}`);
      }
    });
  }

  it('a non-empty offset and item still print as before', () => {
    const text = wat2wasm(
      '(module (memory 1) (table 1 funcref) (func $f) ' +
        '(data (i32.const 8) "x") (elem funcref (item ref.func $f)))',
      { textForm: false },
    );
    const printed = wasm2wat(text.binary).text!;
    assertStringIncludes(printed, '(i32.const 8)');
    assert(!printed.includes('(offset)'), printed);
    assert(!printed.includes('(item)'), printed);
  });
});
