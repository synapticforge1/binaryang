// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Round-3 regression tests for the 2026-06-09 silent-corruption audit — the
 * third-sweep findings (core encoding utilities + more writer/parser fail-loud).
 * See cmem/design-decisions.md.
 */

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { decodeS32Leb128, decodeS64Leb128, decodeU64Leb128 } from '../../src/core/leb128.ts';
import {
  parseF32Literal,
  parseF64Literal,
  printF32Literal,
  printF64Literal,
} from '../../src/core/literal.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { writeBinaryIr } from '../../src/writer/binary-writer.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { makeModule, varIndex, varName } from '../../src/ir/ir.ts';
import type { DataSegment, ElemSegment } from '../../src/ir/ir.ts';
import { Type } from '../../src/core/types.ts';
import { Result } from '../../src/core/result.ts';
import { hasErrors, makeErrorList, unknownLocation } from '../../src/core/error.ts';

const LOC = unknownLocation();

// ---------------------------------------------------------------------------
// parseNatText strips ALL digit-group separators
// ---------------------------------------------------------------------------

describe('parseNatText underscores', () => {
  it('parses a limit with multiple underscores (1_000_001)', () => {
    const { module, errors } = parseWatModule('(module (memory 1_000_001))');
    assertEquals(errors.length, 0);
    assertEquals(module.memories[0]?.limits.initial, 1_000_001);
  });
  it('parses a grouped hex literal (0xFF_FF)', () => {
    const { module, errors } = parseWatModule('(module (memory 0xFF_FF))');
    assertEquals(errors.length, 0);
    assertEquals(module.memories[0]?.limits.initial, 0xffff);
  });
});

// ---------------------------------------------------------------------------
// LEB128 decoders reject out-of-range encodings (fail-loud, not truncate)
// ---------------------------------------------------------------------------

describe('LEB128 overflow rejection', () => {
  it('decodeU64Leb128 throws on a 10th byte with bits 1-6 set', () => {
    const bytes = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x02]);
    assertThrows(() => decodeU64Leb128(bytes), RangeError);
  });
  it('decodeS32Leb128 throws on a non-sign-extended 5th byte', () => {
    // 5th byte 0x10: bit 4 set, bit 3 (sign) clear → not a valid sign-extension.
    const bytes = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x10]);
    assertThrows(() => decodeS32Leb128(bytes), RangeError);
  });
  it('decodeS64Leb128 throws on a non-sign-extended 10th byte', () => {
    const bytes = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10]);
    assertThrows(() => decodeS64Leb128(bytes), RangeError);
  });
  it('still decodes a valid 5-byte s32 (-2^31)', () => {
    const bytes = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x78]);
    assertEquals(decodeS32Leb128(bytes)[0], -2147483648);
  });
  it('still decodes a valid max u64', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    assertEquals(decodeU64Leb128(bytes)[0], 0xffffffffffffffffn);
  });
});

// ---------------------------------------------------------------------------
// Canonical quiet NaN prints as bare `nan` and round-trips
// ---------------------------------------------------------------------------

describe('NaN literal round-trip', () => {
  it('f32 canonical quiet NaN prints bare nan and round-trips', () => {
    assertEquals(printF32Literal(0x7fc00000), 'nan');
    const [r, bits] = parseF32Literal('nan');
    assertEquals(r, Result.Ok);
    assertEquals(bits >>> 0, 0x7fc00000);
  });
  it('f32 NaN with payload round-trips bit-exactly', () => {
    const printed = printF32Literal(0x7fc00001); // quiet + payload 1
    const [r, bits] = parseF32Literal(printed);
    assertEquals(r, Result.Ok);
    assertEquals(bits >>> 0, 0x7fc00001);
  });
  it('f64 canonical quiet NaN prints bare nan and round-trips', () => {
    assertEquals(printF64Literal(0x7ff8000000000000n), 'nan');
    const [r, bits] = parseF64Literal('nan');
    assertEquals(r, Result.Ok);
    assertEquals(bits, 0x7ff8000000000000n);
  });
});

// ---------------------------------------------------------------------------
// Binary-writer segment fail-loud + flags-4 reftype preservation
// ---------------------------------------------------------------------------

describe('binary-writer segment encoding', () => {
  it('throws on a name-var elem segment table (resolveNames skipped)', () => {
    const module = makeModule();
    module.tables.push({
      name: '',
      loc: LOC,
      elemType: Type.FuncRef,
      limits: { initial: 1, isShared: false, is64: false },
      init: [],
    });
    const seg: ElemSegment = {
      name: '',
      kind: 'active',
      tableVar: varName('t'), // unresolved name-var
      offset: [{ kind: 'const', value: { type: Type.I32, value: 0 }, loc: LOC }],
      elemType: Type.FuncRef,
      elemExprs: [],
      loc: LOC,
    };
    module.elemSegments.push(seg);
    assertThrows(() => writeBinaryIr(module), Error, 'elem segment table');
  });

  it('throws on a "declared" data segment kind', () => {
    const module = makeModule();
    module.memories.push({
      name: '',
      loc: LOC,
      limits: { initial: 1, isShared: false, is64: false },
    });
    const seg = {
      name: '',
      kind: 'declared',
      memoryVar: varIndex(0),
      offset: [],
      data: new Uint8Array([1, 2, 3]),
      loc: LOC,
    } as unknown as DataSegment;
    module.dataSegments.push(seg);
    assertThrows(() => writeBinaryIr(module), Error, 'data segment kind');
  });

  it('preserves a non-funcref (externref) element type on an active table-0 segment', () => {
    const module = makeModule();
    module.tables.push({
      name: '',
      loc: LOC,
      elemType: Type.ExternRef,
      limits: { initial: 1, isShared: false, is64: false },
      init: [],
    });
    const seg: ElemSegment = {
      name: '',
      kind: 'active',
      tableVar: varIndex(0),
      offset: [{ kind: 'const', value: { type: Type.I32, value: 0 }, loc: LOC }],
      elemType: Type.ExternRef,
      elemExprs: [],
      loc: LOC,
    };
    module.elemSegments.push(seg);

    const binary = writeBinaryIr(module);
    const errs = makeErrorList();
    const back = readBinaryIr(binary, errs);
    assert(!hasErrors(errs), 'round-trip decode should succeed');
    // The old flags-4 path dropped the reftype, decoding it back as funcref.
    assertEquals(back.elemSegments[0]?.elemType, Type.ExternRef);
  });
});
