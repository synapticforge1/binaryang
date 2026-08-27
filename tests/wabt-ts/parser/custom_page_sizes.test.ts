// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.4 — custom page sizes, end to end.
//
// The proposal was half-wired: `customPageSizes` was in `feature.ts`,
// `Limits.pageSize` was in the IR, and the reader and writer both touched the
// flag bit — but nothing agreed on what the field MEANT and no rule was
// enforced anywhere.
//
//   - `Limits.pageSize` was documented as BYTES while the reader and writer
//     passed the raw wire value through, and the wire field is the LOG2. So a
//     decoded 64 KiB memory carried 16 and the WAT writer printed
//     `(pagesize 16)`.
//   - The parser had no syntax at all: `(memory 1 (pagesize 1))` failed with
//     "expected ), got (".
//   - Nothing validated the size. The proposal admits exactly 1 and 65536 —
//     **not every power of two**, which is the trap: the field is already a
//     log2, so every value looks like a power of two by construction, and
//     `(pagesize 2)` through `(pagesize 32768)` are all invalid.
//   - The memory ceiling was the constant 65536 — that is 2^32/65536 with the
//     division already done, right only for the standard page size. With
//     1-byte pages a 32-bit memory may legitimately declare 2^32 pages' worth,
//     and the constant rejected the proposal's own valid modules.
//   - The reader accepted the flag bit on a TABLE, which has no page size.
//
// The design follows wazmrt, the Zig runtime, which shipped this in 2026-08
// and runs the four spec files clean. Its hard-won lesson is the one this test
// exists to keep: a trailing `(pagesize …)` that is silently DROPPED assembles
// a module the source did not write — theirs built, ran, and answered a
// `memory.grow` wrong because the memory was never the one the text asked for.
//
// Two rules that are ours rather than theirs:
//
//   - The layer split. A non-power-of-two has no log2 and cannot be encoded at
//     all, so it is MALFORMED at parse; an encodable-but-illegal size like
//     `(pagesize 2)` is a well-formed module that is INVALID. Answering both in
//     one place would answer one of them for the wrong reason (T12.3).
//   - The flag is keyed on PRESENCE, not on `!== 16`. wazmrt collapses an
//     explicit `pagesize 65536` into the default, which a runtime can afford
//     because the memory type is identical — but it changes the bytes, and
//     round-trip fidelity is a metric here. Wasmtime accepts the explicit
//     encoding, so preserving it is not merely conservative.
//
// The three-engine panel: Wasmtime (the authority) ACCEPTS all of these. V8
// rejects them with "invalid memory limits flags 0x8" and Wasmer with "the
// custom page sizes proposal must be enabled" — proposal gates, not rulings.
//
// No metric covers this: the proposal is not in our testsuite snapshot, which
// is why it sat half-built. All seven are unmoved by the change.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { allFeatures, defaultFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';

function encode(src: string): Uint8Array {
  const { binary, errors } = wat2wasm(src);
  assert(!hasErrors(errors), `rejected a LEGAL module:\n${src}\n${formatErrors(errors)}`);
  assert(binary);
  return binary;
}
function malformed(src: string): string {
  const { errors } = wat2wasm(src);
  assert(hasErrors(errors), `accepted malformed text: ${src}`);
  return formatErrors(errors);
}
function validity(src: string) {
  return wasmValidate(encode(src), { features: allFeatures() });
}

describe('T13.4 — the page size is parsed, and it is a log2 on the wire', () => {
  it('parses `(pagesize N)` and stores its LOG2', () => {
    const { module, errors } = parseWatModule(
      new LexerSource('(module (memory 1 (pagesize 1)))', '<t>'),
    );
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(module.memories[0]?.limits.pageSizeLog2, 0);
  });

  it('encodes the LOG2, not the byte count', () => {
    // count 1, flags 0x08, min 1, then the log2 — 0 for a 1-byte page. Writing
    // 65536 there, which the old byte-valued field would have, is a different
    // memory type and three bytes longer.
    //
    // Taken from the END: the writer pads every section size to a fixed 5-byte
    // LEB, so the payload does not start at a fixed offset.
    assertEquals([...encode('(module (memory 1 (pagesize 1)))').slice(-4)], [1, 0x08, 1, 0]);
  });

  it('puts the field AFTER min and max, where the format does', () => {
    // flags 0x09 (max + page size), min 2, max 3, then the log2.
    assertEquals([...encode('(module (memory 2 3 (pagesize 1)))').slice(-5)], [1, 0x09, 2, 3, 0]);
  });

  it('round-trips byte-identically, keeping an explicit 65536', () => {
    const src = '(module (memory 1 (pagesize 1)) (memory 2 (pagesize 65536)) (memory 3))';
    const first = encode(src);
    const text = wasm2wat(first).text!;
    assert(text.includes('(pagesize 1)'), text);
    assert(text.includes('(pagesize 65536)'), text);
    // The third memory declared none and must not acquire one.
    assertEquals((text.match(/pagesize/g) ?? []).length, 2, text);
    const again = encode(text);
    assertEquals([...again], [...first], 'round trip changed the bytes');
  });

  it('accepts the position after `shared`', () => {
    const text = wasm2wat(encode('(module (memory 1 2 shared (pagesize 1)))')).text!;
    assert(/shared\s*\(pagesize 1\)/.test(text), text);
  });
});

describe('T13.4 — malformed vs invalid, in the right layers', () => {
  it('rejects a non-power-of-two at PARSE — it has no log2', () => {
    for (const n of ['0', '3', '5', '100', '65535']) {
      const e = malformed(`(module (memory 1 (pagesize ${n})))`);
      assert(/page size must be a power of two/.test(e), `${n}: ${e}`);
    }
  });

  it('lets an encodable-but-illegal size PARSE and fail validation', () => {
    // The trap: these all ARE powers of two. Only 1 and 65536 are legal, so a
    // power-of-two test in the parser would accept fourteen invalid sizes and
    // report the other rejections in the wrong layer.
    for (const n of ['2', '4', '256', '32768']) {
      const src = `(module (memory 1 (pagesize ${n})))`;
      const { errors } = wat2wasm(src);
      assert(!hasErrors(errors), `parse should accept ${n}:\n${formatErrors(errors)}`);
      const v = validity(src);
      assertEquals(v.result, Result.Error, `${n} validated`);
      assert(/invalid page size/.test(formatErrors(v.errors)), formatErrors(v.errors));
    }
  });

  it('accepts the two sizes the proposal admits', () => {
    assertEquals(validity('(module (memory 1 (pagesize 1)))').result, Result.Ok);
    assertEquals(validity('(module (memory 1 (pagesize 65536)))').result, Result.Ok);
  });
});

describe('T13.4 — the page ceiling divides by the page size', () => {
  it('accepts a 32-bit memory of 2^32-1 ONE-BYTE pages', () => {
    // 4 GiB of address space, which is exactly what a 32-bit memory holds. The
    // old constant 65536 — the quotient for 64 KiB pages — rejected it.
    assertEquals(validity('(module (memory 0xffff_ffff (pagesize 1)))').result, Result.Ok);
    assertEquals(validity('(module (memory 0 0xffff_ffff (pagesize 1)))').result, Result.Ok);
  });

  it('still holds a 64 KiB-page memory to 65536 pages', () => {
    assertEquals(validity('(module (memory 65536 (pagesize 65536)))').result, Result.Ok);
    assertEquals(validity('(module (memory 65537 (pagesize 65536)))').result, Result.Error);
    assertEquals(validity('(module (memory 65537))').result, Result.Error);
  });

  it('scales the 64-bit ceiling the same way', () => {
    assertEquals(
      validity('(module (memory i64 0x1_0000_0000_0000 (pagesize 65536)))').result,
      Result.Ok,
    );
    assertEquals(
      validity('(module (memory i64 0x1_0000_0000_0001 (pagesize 65536)))').result,
      Result.Error,
    );
    // With 1-byte pages every u64 page count is inside a 64-bit address space.
    assertEquals(
      validity('(module (memory i64 0xffff_ffff_ffff_ffff (pagesize 1)))').result,
      Result.Ok,
    );
  });
});

describe('T13.4 — the proposal is gated, and tables have no page size', () => {
  it('rejects a custom page size under default features', () => {
    const { errors, result } = wasmValidate(encode('(module (memory 1 (pagesize 1)))'), {
      features: defaultFeatures(),
    });
    assertEquals(result, Result.Error);
    assert(/custom page sizes not allowed/.test(formatErrors(errors)), formatErrors(errors));
  });

  it('gates an explicit 65536 too — the flag bit is the proposal', () => {
    assertEquals(
      wasmValidate(encode('(module (memory 1 (pagesize 65536)))'), { features: defaultFeatures() })
        .result,
      Result.Error,
    );
    // …while a memory that declared nothing is unaffected.
    assertEquals(
      wasmValidate(encode('(module (memory 1))'), { features: defaultFeatures() }).result,
      Result.Ok,
    );
  });

  it('rejects the flag bit on a TABLE, rather than ignoring it', () => {
    // A table is counted in elements. The bit's PRESENCE is only knowable in
    // the decoder — after the fact an explicit log2 of 16 is indistinguishable
    // from no flag at all.
    const errs = makeErrorList();
    readBinaryIr(
      new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 4, 5, 1, 0x70, 0x08, 0, 16]),
      errs,
    );
    assert(hasErrors(errs), 'a table carrying the page-size flag was accepted');
    assert(/a table has no page size/.test(formatErrors(errs)), formatErrors(errs));
  });

  it('rejects a log2 too large for the field', () => {
    // Unbounded, this reached the WAT writer's `2 ** log2` and printed
    // `(pagesize Infinity)`.
    const errs = makeErrorList();
    readBinaryIr(
      new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 5, 6, 1, 0x08, 1, 0xff, 0xff, 0x03]),
      errs,
    );
    assert(hasErrors(errs), 'an absurd page-size log2 was accepted');
  });
});
