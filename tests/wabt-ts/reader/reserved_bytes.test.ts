// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.5 — three more reserved bytes read into nowhere.
//
// Found by grepping for the shape T12.8 named rather than by a metric, because
// **no metric could see these**: binary `assert_malformed` is 711 / 711 and the
// spec suite has no case for either byte. Same lesson as T13.4's half-built
// proposal — a rule no corpus reaches is not covered by a corpus-shaped test,
// however many of them pass.
//
//   tag section    attribute byte      spec says 0x00 (exception)
//   tag IMPORT     attribute byte      the same byte, the other path
//   table 0x40     reserved byte       spec says 0x00
//
// All three were `this.readU8(); // …` with the result discarded, so `0x01`,
// `0xff` and `0x03` decoded to *exactly* the same module as `0x00`. That is a
// malformed module accepted in silence — the class this campaign keeps finding,
// and the third distinct instance of it in the binary reader.
//
// **The producer already knew the rule.** `binary-writer.ts` emits `0x00` at
// both tag sites with the comment "attribute = exception (only valid value)"
// and at the table site as `0x40 0x00`. So this was a one-sided rule: the
// writer enforced it on itself and the reader accepted anything — exactly the
// producer/consumer asymmetry `best-practices.md` §3 is about, and the reason
// a round-trip metric cannot see it either (we never emit the bad byte, so we
// never read it back).
//
// No metric moved: parse-clean 257/257, V8-valid 2119/2120, agreement
// 2119/2119, assert_invalid 2683/2683, round-trip 2119/2119 and 270/270 WASI,
// execution 23,077/23,077, assert_malformed 1229/1229 and 711/711.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';

/** Space-separated hex -> bytes, so each module reads as a dump. */
function mod(hex: string): Uint8Array {
  return new Uint8Array(
    ('00 61 73 6d 01 00 00 00 ' + hex).trim().split(/\s+/).map((h) => parseInt(h, 16)),
  );
}
function read(bytes: Uint8Array): string | null {
  const errs = makeErrorList();
  try {
    readBinaryIr(bytes, errs);
  } catch (e) {
    return String((e as Error).message);
  }
  return hasErrors(errs) ? formatErrors(errs) : null;
}

const TYPE_FUNC = '01 04 01 60 00 00'; // (type (func))

describe('T13.5 — a tag attribute byte is 0x00 and nothing else', () => {
  it('accepts the defined value', () => {
    assertEquals(read(mod(`${TYPE_FUNC} 0d 03 01 00 00`)), null);
  });

  for (const attr of ['01', '02', '7f', 'ff']) {
    it(`rejects attribute 0x${attr} in the tag section`, () => {
      const e = read(mod(`${TYPE_FUNC} 0d 03 01 ${attr} 00`));
      assert(e !== null, `accepted attribute 0x${attr}`);
      assert(/malformed tag attribute/.test(e), e);
    });
  }

  it('rejects it on an IMPORTED tag too — the other path, same byte', () => {
    // `(import "m" "t" (tag …))`: kind 0x04, then the attribute, then typeidx.
    assertEquals(read(mod(`${TYPE_FUNC} 02 08 01 01 6d 01 74 04 00 00`)), null);
    const e = read(mod(`${TYPE_FUNC} 02 08 01 01 6d 01 74 04 07 00`));
    assert(e !== null, 'accepted an imported tag with attribute 0x07');
    assert(/malformed tag attribute/.test(e), e);
  });
});

describe('T13.5 — the table init form has a reserved 0x00', () => {
  // `0x40 0x00 reftype limits expr` — the form a NON-NULLABLE element type
  // requires, since it has no default value (T10.3).
  const withReserved = (b: string) => mod(`04 09 01 40 ${b} 70 00 01 d0 70 0b`);

  it('accepts the defined value', () => {
    assertEquals(read(withReserved('00')), null);
  });

  for (const b of ['01', '03', 'ff']) {
    it(`rejects reserved byte 0x${b}`, () => {
      const e = read(withReserved(b));
      assert(e !== null, `accepted reserved 0x${b}`);
      assert(/malformed table init form/.test(e), e);
    });
  }
});

describe('T13.5 — the legal forms still decode to what they mean', () => {
  it('keeps the tag and its signature', () => {
    const text = wasm2wat(mod(`01 05 01 60 01 7f 00 0d 03 01 00 00`)).text!;
    assert(/\(tag/.test(text), text);
    assert(/i32/.test(text), text);
  });

  it('keeps the table initializer', () => {
    const text = wasm2wat(withInit()).text!;
    assert(/ref\.null func/.test(text), text);
    function withInit() {
      return mod('04 09 01 40 00 70 00 01 d0 70 0b');
    }
  });

  it('round-trips a module carrying both, byte-identically', () => {
    // The writer emits 0x00 for both bytes, so a legal module survives — this
    // is the producer half of the rule the reader now enforces.
    const first = wat2wasm('(module (tag $e (param i32)) (table $t 1 funcref (ref.null func)))');
    assert(!hasErrors(first.errors), formatErrors(first.errors));
    const again = wat2wasm(wasm2wat(first.binary!).text!);
    assert(!hasErrors(again.errors), formatErrors(again.errors));
    assertEquals([...again.binary!], [...first.binary!]);
  });
});
