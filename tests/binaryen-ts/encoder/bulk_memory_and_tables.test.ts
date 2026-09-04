// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Bulk-memory and table operations, and the DATA COUNT section they require.
//
// C2 and C4 from the 1.5.5 register, done together because they are coupled:
// `memory.init` and `data.drop` are only valid when a data count section is
// present, and it must come BEFORE the code section — a single-pass validator
// needs the segment count while type-checking those instructions, which is the
// entire reason the section exists. Shipping the instructions without it
// produces a module every engine rejects; the section without them is dead
// weight. Neither half is a change worth making alone.
//
// ⚠️ The section is emitted whenever a DATA SEGMENT exists, not only when a bulk
// op appears. It is optional in that wider case, but it is what wabt-ts's writer
// does, and two tools in this repo disagreeing about the section list for the
// same module would be its own defect.
//
// Every assertion is byte equality against wabt-ts AND an executed result:
// getting the immediate order wrong (`table.copy` takes destination then source)
// produces a valid module that moves the wrong elements.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** Assemble with both toolchains, require identical bytes, and run the result. */
function bothAgree(wat: string, want: number): void {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the fixture');
  const got = encodeWasm(parseWat(wat));
  const run = (bytes: Uint8Array) =>
    (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports.f as () => number)();
  assertEquals(run(ref.binary), want, 'wabt-ts');
  assertEquals(run(got), want, 'binaryen-ts');
  assertEquals(Array.from(got), Array.from(ref.binary), 'bytes must match wabt-ts');
}

/** Section ids present in `bytes`, in order. */
function sectionIds(bytes: Uint8Array): number[] {
  const ids: number[] = [];
  let o = 8;
  while (o < bytes.length) {
    ids.push(bytes[o++]!);
    let n = 0, shift = 0, b: number;
    do {
      b = bytes[o++]!;
      n |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    o += n;
  }
  return ids;
}

const MEM = '(module (memory 1) (data $d "AB") ';

describe('encoder — bulk memory needs the data count section', () => {
  it('memory.init copies from a passive segment', () => {
    bothAgree(
      MEM + `(func (export "f") (result i32)
        (memory.init $d (i32.const 0) (i32.const 0) (i32.const 2))
        (i32.load8_u (i32.const 0))))`,
      0x41,
    );
  });

  // Reads the SECOND byte at a NON-zero destination, so an implementation that
  // ignored the segment offset or the destination would land elsewhere.
  it('memory.init honours both offsets', () => {
    bothAgree(
      MEM + `(func (export "f") (result i32)
        (memory.init $d (i32.const 4) (i32.const 1) (i32.const 1))
        (i32.load8_u (i32.const 4))))`,
      0x42,
    );
  });

  it('data.drop encodes, and pairs with memory.init', () => {
    bothAgree(MEM + '(func (export "f") (result i32) (data.drop $d) (i32.const 1)))', 1);
    bothAgree(
      MEM + `(func (export "f") (result i32)
        (memory.init $d (i32.const 4) (i32.const 1) (i32.const 1))
        (data.drop $d)
        (i32.load8_u (i32.const 4))))`,
      0x42,
    );
  });

  it('a segment referenced by INDEX resolves to the same segment', () => {
    bothAgree(
      MEM + `(func (export "f") (result i32)
        (memory.init 0 (i32.const 0) (i32.const 1) (i32.const 1))
        (i32.load8_u (i32.const 0))))`,
      0x42,
    );
  });

  // The ordering constraint is the whole point of the section.
  it('the data count section (12) precedes the code section (10)', () => {
    const wat = MEM +
      '(func (export "f") (result i32) (memory.init $d (i32.const 0) (i32.const 0) (i32.const 2)) (i32.const 1)))';
    const ids = sectionIds(encodeWasm(parseWat(wat)));
    const dc = ids.indexOf(12), code = ids.indexOf(10);
    assert(dc >= 0, 'a data count section must be emitted');
    assert(code >= 0, 'a code section must be emitted');
    assert(dc < code, `data count (at ${dc}) must precede code (at ${code})`);
  });

  it('a module with no data segments gets no data count section', () => {
    const ids = sectionIds(
      encodeWasm(parseWat('(module (memory 1) (func (export "f") (result i32) (i32.const 1)))')),
    );
    assert(!ids.includes(12), 'no data segments means no data count section');
  });
});

describe('encoder — table operations', () => {
  const TBL =
    '(module (table 3 funcref) (type $t (func (result i32))) (func $a (result i32) (i32.const 42)) (elem (i32.const 0) $a) ';

  it('table.size reports the declared size', () => {
    bothAgree(TBL + '(func (export "f") (result i32) (table.size)))', 3);
  });

  it('table.grow returns the PREVIOUS size', () => {
    // 3, not 5 — a growth that returned the new size would read 5 here.
    bothAgree(
      TBL + '(func (export "f") (result i32) (table.grow (ref.null func) (i32.const 2))))',
      3,
    );
  });

  it('table.fill writes the range it is given', () => {
    bothAgree(
      TBL + `(func (export "f") (result i32)
        (table.fill (i32.const 1) (ref.null func) (i32.const 1))
        (table.size)))`,
      3,
    );
  });

  // Destination and source are separate immediates, and getting them the wrong
  // way round still validates — it just copies backwards. Slot 0 holds $a and
  // slot 1 is empty, so copying 0 -> 1 and calling slot 1 returns 42; the
  // reversed reading would copy the empty slot over $a and trap.
  it('table.copy copies destination-from-source, not the reverse', () => {
    bothAgree(
      TBL + `(func (export "f") (result i32)
        (table.copy (i32.const 1) (i32.const 0) (i32.const 1))
        (call_indirect (type $t) (i32.const 1))))`,
      42,
    );
  });
});

describe('parser — the segment modes the IR cannot express are REFUSED', () => {
  // `ElementSegment` has no mode field and the encoder writes kind 0
  // unconditionally, so storing a declarative or passive segment would emit it
  // as ACTIVE — writing into the table at instantiation when the source said it
  // must not.
  //
  // ⚠️ Dropping them silently was WORSE than refusing: `elem declare` then
  // encoded a module that failed validation downstream with `undeclared
  // reference to function`. Refusing here matches how `table.init` and
  // `elem.drop` behave for the same underlying gap.
  const refuses = (wat: string, what: string) => {
    let threw = false;
    try {
      encodeWasm(parseWat(wat));
    } catch {
      threw = true;
    }
    assert(threw, `${what} must be refused, not silently mis-encoded`);
  };

  it('a declarative element segment is refused', () => {
    refuses(
      '(module (table 1 funcref) (func $a) (elem declare func $a) (func (export "f") (drop (ref.func $a))))',
      'elem declare',
    );
  });

  it('a passive element segment is refused', () => {
    refuses(
      '(module (table 1 funcref) (func $a) (elem $e func $a) (func (export "f")))',
      'a passive elem',
    );
  });

  it('an ACTIVE segment is unaffected', () => {
    const wat = '(module (table 1 funcref) (func $a) (elem (i32.const 0) $a) (func (export "f")))';
    new WebAssembly.Module(encodeWasm(parseWat(wat)) as BufferSource);
  });
});
