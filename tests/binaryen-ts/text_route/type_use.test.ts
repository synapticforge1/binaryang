// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Type uses in the binaryen-ts WAT parser — `(type $t)` on a function or a
// block, and the IMPLICIT types the text format adds for inline signatures.
//
// Three defects, all loud, all on a path neither the corpus (it reaches
// binaryen-ts through wabt-ts's wat2wasm) nor the spec harness (it drives
// wabt-ts) exercises:
//
//   - `(func (type $a))` SKIPPED its type use and got `() -> ()`;
//   - once ANY `(type …)` was declared, the encoder emits declared types
//     verbatim and requires every signature among them — and the parser never
//     added the implicit ones, so a function with an undeclared signature threw
//     `unresolved GC function type`;
//   - `(type $t)` on block / loop / if was parsed as an instruction.
//
// Expected bytes are upstream wat2wasm 1.0.41's for the same text — including
// the ORDER of implicit types (declared first, then text order of use), which
// decides every type index in the module.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import { readWat, WatInputError } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));

const CASES: [string, string, string][] = [
  [
    'implicit types follow the declared ones, in text order of use',
    '(module (type $a (func (param i32))) (import "m" "f" (func (param f32))) (table 1 funcref) (func (result i64) (call_indirect (param f64) (f64.const 0) (i32.const 0)) (i64.const 0)) (func (drop (drop (block (result i32 i32) (i32.const 1) (i32.const 2))))) (func (type $a)))',
    `00 61 73 6d 01 00 00 00 01 19 06 60 01 7f 00 60 01 7d 00 60 00 01 7e 60 01 7c 00 60 00 00 60 00 02
     7f 7f 02 07 01 01 6d 01 66 00 01 03 04 03 02 04 00 04 04 01 70 00 01 0a 23 03 12 00 44 00 00 00 00
     00 00 00 00 41 00 11 03 00 42 00 0b 0b 00 02 05 41 01 41 02 0b 1a 1a 0b 02 00 0b`,
  ],
  [
    '(func (type $a)) takes its signature from the type',
    '(module (type $a (func (param i32) (result i32))) (func (type $a) (local.get 0)))',
    '00 61 73 6d 01 00 00 00 01 06 01 60 01 7f 01 7f 03 02 01 00 0a 06 01 04 00 20 00 0b',
  ],
  // These two are wasm-tools' bytes, not upstream wabt's (divergence W15): a
  // header written `(type $t)` stays the type INDEX (`02 00`), as written;
  // upstream wat2wasm inlines a `[] -> [t]` type as its value type (`02 7f`).
  // binaryen-ts's retired parser gave upstream's; the text route keeps what was
  // written, the same rule as T1.
  [
    '(block (type $t))',
    '(module (type $t (func (result i32))) (func (result i32) (block (type $t) (i32.const 1))))',
    '00 61 73 6d 01 00 00 00 01 05 01 60 00 01 7f 03 02 01 00 0a 09 01 07 00 02 00 41 01 0b 0b',
  ],
  [
    '(if (type $t)) and (loop (type $t))',
    '(module (type $t (func (result i32))) (func (result i32) (if (type $t) (i32.const 1) (then (i32.const 2)) (else (loop (type $t) (i32.const 3))))))',
    '00 61 73 6d 01 00 00 00 01 05 01 60 00 01 7f 03 02 01 00 0a 11 01 0f 00 41 01 04 00 41 02 05 03 00 41 03 0b 0b 0b',
  ],
  [
    'a type declared AFTER a use keeps its index; the implicit one follows',
    '(module (func (param i32)) (type $late (func (result f32))))',
    '00 61 73 6d 01 00 00 00 01 09 02 60 00 01 7d 60 01 7f 00 03 02 01 01 0a 04 01 02 00 0b',
  ],
];

/**
 * `b` without its custom sections. The text route keeps names (and the text
 * form), which upstream's bytes here were assembled without; the type section
 * and every index are what these cases are about.
 */
function known(b: Uint8Array): Uint8Array {
  const out: number[] = [...b.subarray(0, 8)];
  for (let i = 8; i < b.length;) {
    const at = i;
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    i += size;
    if (id !== 0) out.push(...b.subarray(at, i));
  }
  return new Uint8Array(out);
}

describe('type uses, written as upstream wat2wasm writes them', () => {
  for (const [name, src, upstream] of CASES) {
    it(name, () => {
      assertEquals(known(writeWasm(readWat(src))), hex(upstream));
    });
  }
});

describe('type uses that must be refused', () => {
  it('a type use and an inline signature that disagree (upstream rejects too)', () => {
    assertThrows(
      () => readWat('(module (type $a (func (param i32))) (func (type $a) (param f32)))'),
      WatInputError,
      'does not match',
    );
  });
});

describe('type uses the text route reads (One front end stage 5)', () => {
  it('block parameters — read, and the entry value is the parameter', () => {
    // binaryen-ts's retired parser could not read them (divergence W4) and
    // refused them, loudly. The text route reads the whole format: 1 + 2.
    const mod = readWat(
      '(module (func (export "f") (result i32) (i32.const 1) (block (param i32) (result i32) (i32.const 2) (i32.add))))',
    );
    const f = new WebAssembly.Instance(new WebAssembly.Module(writeWasm(mod) as BufferSource))
      .exports.f as () => number;
    assertEquals(f(), 3);
  });
});
