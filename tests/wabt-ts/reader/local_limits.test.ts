// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A function's locals are declared in RUN-LENGTH groups: five bytes can say
// "2^32 locals of type i32". S6 step 5 item 6 (M6c) made `Func.locals` a slot
// per local, so what a group DECLARES and what the reader must ALLOCATE stopped
// being the same thing.
//
// 🔧 Reading the groups straight into slots ran the decoder out of memory on
// `binary.41`–`binary.44` (spec fixtures that declare 2^30–2^32 locals on
// purpose) — before the "too many locals" check, which is on their SUM, could
// call the module malformed. The groups are read first now, and a legal-but-
// hostile count is REFUSED rather than materialized.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';

/** Unsigned LEB128. */
function leb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

/** A one-function module whose body declares `count` locals of type i32. */
function moduleDeclaring(count: number): Uint8Array {
  const body = [...leb(1), ...leb(count), 0x7f, 0x0b]; // 1 group, count × i32, end
  const code = [...leb(1), ...leb(body.length), ...body];
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x04,
    0x01,
    0x60,
    0x00,
    0x00, // type: () -> ()
    0x03,
    0x02,
    0x01,
    0x00, // func: one, type 0
    0x0a,
    ...leb(code.length),
    ...code,
  ]);
}

function read(bytes: Uint8Array) {
  const errors = makeErrorList();
  const m = readBinaryIr(bytes, errors, {});
  return { m, errors };
}

describe("a function's declared locals", () => {
  it('a modest count is materialized, one slot per local', () => {
    const { m, errors } = read(moduleDeclaring(3));
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(m.funcs[0]!.locals.length, 3);
  });

  it("a count past the decoder's limit is refused, not allocated", () => {
    const { errors } = read(moduleDeclaring(2_000_000));
    assert(hasErrors(errors), 'a 2,000,000-local function must be refused');
    assert(
      formatErrors(errors).includes('too many locals'),
      formatErrors(errors),
    );
  });

  it('the spec\'s own cap (the SUM past 2^32-1) still reports "too many locals"', () => {
    // Four groups of 2^30: no single group overflows, their sum does.
    const g = [...leb(0x4000_0000), 0x7f];
    const body = [...leb(4), ...g, ...g, ...g, ...g, 0x0b];
    const code = [...leb(1), ...leb(body.length), ...body];
    const bytes = new Uint8Array([
      0x00,
      0x61,
      0x73,
      0x6d,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x04,
      0x01,
      0x60,
      0x00,
      0x00,
      0x03,
      0x02,
      0x01,
      0x00,
      0x0a,
      ...leb(code.length),
      ...code,
    ]);
    const { errors } = read(bytes);
    assert(hasErrors(errors), 'the sum overflows and must be refused');
    assert(formatErrors(errors).includes('too many locals'), formatErrors(errors));
  });
});
