// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.8 — the binary reader resynchronised instead of reporting.
//
// The decoder was written to keep going: an unknown section id fell into
// `default` and was skipped, `if (this.pos !== sectionEnd) this.pos =
// sectionEnd` silently realigned whenever a section's contents disagreed with
// its declared size, and every entry loop was guarded by `this.pos < end`, so
// a section claiming more entries than it held simply produced fewer. None of
// that reports; all of it DECODES A DIFFERENT MODULE.
//
// The shapes, and what each one used to decode to:
//
//   two code sections            the SECOND one's bodies
//   sections out of order        accepted in any order at all
//   unknown section id           skipped
//   size larger than contents    the difference dropped, no word said
//   count > entries present      a module with fewer items than declared
//   body with no `end`           as though it had had one
//   mutability byte 0x02/0xff    MUTABLE
//   limits flags 0x10            a plain `(memory 0)`
//   memarg flags 0x80            alignment exponent 0 (`& 0x3f` threw the
//                                high bits away) — a different instruction,
//                                and one V8 runs
//   elem element type i32        a table of i32
//   data-count section           read and discarded, so `memory.init` was
//                                accepted without one and a disagreeing count
//                                was never noticed
//
// Two of those are T12.7's bug one layer down: `& 0x3f` and `readU8() !== 0`
// are "we consume it and ignore it" spelled arithmetically.
//
// The ORDER check is the one detail worth stating: the required order is NOT
// numeric id order. The tag section is id 13 but sits between memory and
// global, and the data-count section is id 12 but sits between elem and code.
// Comparing ids numerically would accept an order no producer may emit and
// reject a legal one, so `sectionOrderRank` in `src/core/binary.ts` holds the
// one order — the same one `writeBinaryIr` emits.
//
// assert_malformed (binary): 638 -> 711 / 711. Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { hasErrors, makeErrorList } from '../../src/core/error.ts';

/** Space-separated hex bytes -> array, so a module reads as a hex dump. */
function b(hex: string): number[] {
  return hex.trim().split(/\s+/).map((h) => parseInt(h, 16));
}
function mod(...parts: (number[] | string)[]): Uint8Array {
  const body = parts.flatMap((p) => typeof p === 'string' ? b(p) : p);
  return new Uint8Array([...b('00 61 73 6d 01 00 00 00'), ...body]);
}

const TYPE_SEC = b('01 04 01 60 00 00'); // (type (func))
const FUNC_SEC = b('03 02 01 00'); // one function, type 0
const CODE_SEC = b('0a 04 01 02 00 0b'); // its (empty) body
const IMPORT_GLOBAL = '02 08 01 01 6d 01 67 03 7f'; // (import "m" "g" (global i32 …

function rejects(bytes: Uint8Array): boolean {
  const errs = makeErrorList();
  try {
    readBinaryIr(bytes, errs);
  } catch {
    return true;
  }
  return hasErrors(errs);
}
function accepts(bytes: Uint8Array): boolean {
  return !rejects(bytes);
}

describe('T12.8 — a section appears at most once, in one order', () => {
  it('rejects a duplicated section', () => {
    assert(
      rejects(mod(TYPE_SEC, FUNC_SEC, FUNC_SEC, '0a 07 02 02 00 0b 02 00 0b')),
      'accepted two function sections',
    );
    assert(
      rejects(mod(TYPE_SEC, '03 03 02 00 00', CODE_SEC, CODE_SEC)),
      'accepted two code sections',
    );
    assert(rejects(mod(TYPE_SEC, TYPE_SEC)), 'accepted two type sections');
  });

  it('rejects sections out of order', () => {
    assert(rejects(mod(FUNC_SEC, TYPE_SEC, CODE_SEC)), 'accepted function before type');
  });

  it('rejects an id that is not a section', () => {
    for (const id of ['0e', '7f', '80']) {
      assert(rejects(mod(`${id} 01 00`)), `accepted section id 0x${id}`);
    }
  });

  it('accepts the ORDER the spec actually requires, which is not numeric', () => {
    // tag (13) before global (6): a numeric comparison would reject this.
    assert(
      accepts(mod(
        TYPE_SEC,
        '05 03 01 00 01', // memory
        '0d 03 01 00 00', // tag
        '06 06 01 7f 00 41 00 0b', // global
      )),
      'rejected a tag section before a global section',
    );
    // data count (12) before code (10) and data (11): likewise.
    assert(
      accepts(mod(
        TYPE_SEC,
        FUNC_SEC,
        '05 03 01 00 01',
        '0c 01 01', // data count = 1
        CODE_SEC,
        '0b 06 01 00 41 00 0b 00', // one data segment
      )),
      'rejected a data-count section before the code section',
    );
  });

  it('accepts custom sections anywhere, and repeated', () => {
    const custom = '00 03 02 68 69'; // name "hi", empty payload
    assert(accepts(mod(custom, TYPE_SEC, custom, FUNC_SEC, CODE_SEC, custom)));
  });
});

describe('T12.8 — a section is exactly as long as it says', () => {
  it('rejects a section whose contents fall short of its size', () => {
    assert(rejects(mod('01 07 01 60 00 00 60 00 00')), 'accepted a 7-byte size over 5 bytes');
  });

  it('rejects a size that runs past the end of the module', () => {
    assert(rejects(mod('01 40 01 60 00 00')));
  });

  it('rejects a custom section too small to hold its own name', () => {
    assert(rejects(mod('00 00')), 'accepted a nameless custom section');
  });
});

describe('T12.8 — a count is part of the encoding, not a hint', () => {
  it('rejects a section declaring more entries than it holds', () => {
    assert(rejects(mod('04 01 01')), 'accepted a table section with no table');
    assert(rejects(mod('05 01 01')), 'accepted a memory section with no memory');
    assert(
      rejects(mod(
        TYPE_SEC,
        '03 03 02 00 00',
        '07 06 02 02 66 31 00 00', // two exports declared, one present
        '0a 07 02 02 00 0b 02 00 0b',
      )),
      'accepted an export section declaring two exports and holding one',
    );
  });

  it('rejects a function section with no code section at all', () => {
    assert(rejects(mod(TYPE_SEC, '03 03 02 00 00')));
  });

  it('rejects a code section whose entry count disagrees with the function section', () => {
    assert(rejects(mod(TYPE_SEC, '03 03 02 00 00', CODE_SEC)));
  });
});

describe('T12.8 — a body ends with an explicit `end`', () => {
  it('rejects a function body that just stops', () => {
    // `i32.const 1 / drop` with no 0x0b.
    assert(rejects(mod(TYPE_SEC, FUNC_SEC, '0a 06 01 04 00 41 01 1a')));
  });

  it('rejects a constant expression that just stops', () => {
    assert(rejects(mod(
      TYPE_SEC,
      FUNC_SEC,
      '04 04 01 70 00 01', // table
      '09 07 02 00 41 00 0b 01 00', // two elems declared, one present
    )));
  });

  it('still accepts a well-formed body', () => {
    assert(accepts(mod(TYPE_SEC, FUNC_SEC, CODE_SEC)));
  });
});

describe('T12.8 — flag bytes with no defined meaning', () => {
  it('rejects a mutability byte that is not 0 or 1', () => {
    for (const m of ['02', '04', 'ff']) {
      assert(rejects(mod(`${IMPORT_GLOBAL} ${m}`)), `accepted mutability 0x${m}`);
    }
  });

  it('accepts both mutabilities that ARE defined', () => {
    for (const m of ['00', '01']) {
      assert(accepts(mod(`${IMPORT_GLOBAL} ${m}`)), `rejected mutability 0x${m}`);
    }
  });

  it('rejects undefined limits flags', () => {
    assert(rejects(mod('05 03 01 10 00')), 'accepted limits flags 0x10');
    assert(accepts(mod('05 03 01 00 01')), 'rejected a plain (memory 1)');
    assert(accepts(mod('05 04 01 01 01 02')), 'rejected (memory 1 2)');
  });

  it('rejects memarg flags above bit 6', () => {
    // (memory 1) (func (drop (i32.load align=<flags> (i32.const 0))))
    const withFlags = (...flags: number[]) =>
      mod(
        TYPE_SEC,
        FUNC_SEC,
        '05 03 01 00 01',
        [0x0a, 9 + flags.length, 0x01, 7 + flags.length],
        [0x00, 0x41, 0x00, 0x28, ...flags, 0x00, 0x1a, 0x0b],
      );
    assert(accepts(withFlags(0x02)), 'rejected a legal alignment exponent');
    assert(rejects(withFlags(0x80, 0x01)), 'accepted memop flags 0x80');
    assert(rejects(withFlags(0x80, 0x02)), 'accepted memop flags 0x100');
  });

  it('rejects an element type that is not a reference type', () => {
    assert(rejects(mod(
      TYPE_SEC,
      FUNC_SEC,
      '04 04 01 70 00 00',
      '05 03 01 00 00',
      '09 07 01 05 7f 01 d2 00 0b', // elem type i32
      CODE_SEC,
    )));
  });
});

describe('T12.8 — the data-count section is load-bearing', () => {
  it('rejects a count that disagrees with the data section', () => {
    assert(
      rejects(mod('0c 01 03', '0b 05 02 01 00 01 00')),
      'accepted count 3 against two segments',
    );
    assert(
      rejects(mod('0c 01 01', '0b 05 02 01 00 01 00')),
      'accepted count 1 against two segments',
    );
    assert(
      rejects(mod('05 03 01 00 01', '0c 01 01')),
      'accepted count 1 against no data section',
    );
  });

  it('rejects memory.init and data.drop without one', () => {
    assert(
      rejects(mod(
        TYPE_SEC,
        FUNC_SEC,
        '05 03 01 00 00',
        '0a 0e 01 0c 00 41 00 41 00 41 00 fc 08 00 00 0b',
        '0b 03 01 01 00',
      )),
      'accepted memory.init with no data-count section',
    );
    assert(
      rejects(mod(
        TYPE_SEC,
        FUNC_SEC,
        '05 03 01 00 00',
        '0a 07 01 05 00 fc 09 00 0b',
        '0b 03 01 01 00',
      )),
      'accepted data.drop with no data-count section',
    );
  });

  it('accepts a module whose count agrees', () => {
    assert(accepts(mod('05 03 01 00 01', '0c 01 01', '0b 06 01 00 41 00 0b 00')));
  });
});
