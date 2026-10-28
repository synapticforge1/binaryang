// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 2 (2026-10-28): the binary writer checked a memarg alignment was a power of two
// but not that its EXPONENT fits the flags field. In a memarg, bit 6 (0x40) of the flags means "a
// memory index follows", so an exponent of 64 or more is not an alignment the format can carry:
// `i32.load offset=5 align=2^64` was written as `28 40 05`, which a reader decodes as memory 5
// with another offset (wasm2wat then failed "END opcode expected"). Upstream wabt 1.0.41 refuses
// the same text ("invalid alignment"), accepting up to 2^63, and wasm-tools refuses the constant.
// The writer is fail-loud (T10.7): it now throws, and wat2wasm reports it.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

const load = (align: string) =>
  `(module (memory 1) (func (result i32) (i32.load align=${align} (i32.const 0))))`;

describe('code lens 2 — a memarg alignment exponent must fit below the memory-index bit', () => {
  it('refuses align=2^64 instead of writing the memory-index flag', () => {
    const r = wat2wasm(load('18446744073709551616'));
    assert(hasErrors(r.errors), 'align=2^64 was written');
    assert(formatErrors(r.errors).includes('alignment'), formatErrors(r.errors));
  });

  it('still writes align=2^63 as exponent 63 (the largest that fits), and it decodes', () => {
    // Upstream wabt accepts this text but writes it as align=1; we write the exponent the text
    // says. (The validator refuses such an alignment anyway, as larger than the access.)
    const r = wat2wasm(load('9223372036854775808'));
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    const bytes = [...r.binary!];
    const at = bytes.indexOf(0x28); // i32.load
    assertEquals(bytes[at + 1], 63, 'the alignment exponent');
    const back = wasm2wat(r.binary!);
    assert(!hasErrors(back.errors), 'it no longer decodes');
    // Printed EXACTLY, and so it round-trips (open-work 50): it was `align=9223372036854776000`,
    // JavaScript's shortest digits for 2^63, not the integer.
    assert(back.text.includes('align=9223372036854775808'), back.text);
    assertEquals([...wat2wasm(back.text).binary!], bytes, 'text → binary → text → binary');
  });

  it('still writes an ordinary alignment exactly', () => {
    const r = wat2wasm(load('4'));
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    const back = wasm2wat(r.binary!);
    assertEquals(back.text.includes('i32.load'), true);
  });
});
