// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A heap type immediate is an s33: a type index, or an abstract heap type as a
// 7-bit two's-complement value (-0x40 … -1), however it is padded.
//
// 🔧 Two defects, found by the code lens of open-work 13 (mutants of the spec
// modules, against V8):
// - an unknown single-byte code (0x7f, i32's) was kept as a NAME nothing checked:
//   the validator accepted it and the writer then refused the module;
// - a multi-byte negative was decoded as `(-v) & 0x7f`, so a padded `func` (-16)
//   read as 0x10 and an out-of-range -112 read as `func` and was accepted.

import { test } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { allFeatures, wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { Result } from '../../../src/core/result.ts';

const hex = (...groups: string[]) =>
  new Uint8Array(groups.join(' ').split(/\s+/).filter(Boolean).map((b) => parseInt(b, 16)));

/** One function with one local of type `(ref null <heapType>)`. */
const withLocalHeapType = (heapType: string) => {
  const body = `01 01 63 ${heapType} 0b`; // one local group: 1 × (ref null ht); end
  const size = body.split(' ').length;
  return hex(
    '00 61 73 6d 01 00 00 00',
    '01 04 01 60 00 00', // (func)
    '03 02 01 00',
    `0a ${(size + 2).toString(16)} 01 ${size.toString(16)} ${body}`,
  );
};

const verdicts = (bytes: Uint8Array) => ({
  ours: wasmValidate(bytes, { features: allFeatures() }).result === Result.Ok,
  v8: WebAssembly.validate(bytes as BufferSource),
});

test('control: `func` in one byte (0x70) is valid to both', () => {
  assertEquals(verdicts(withLocalHeapType('70')), { ours: true, v8: true });
});

test('0x7f is not a heap type: refused, as V8 refuses it', () => {
  const bytes = withLocalHeapType('7f');
  assertEquals(verdicts(bytes), { ours: false, v8: false });
  const { errors } = wasmValidate(bytes, { features: allFeatures() });
  assert(errors.some((e) => e.message.includes('expected valid heap type (got 0x7f)')));
});

test('`func` padded to two bytes (-16 as f0 7f) is still `func`', () => {
  assertEquals(verdicts(withLocalHeapType('f0 7f')), { ours: true, v8: true });
});

test('-112 (90 7f) is out of the abstract range: refused, not read as `func`', () => {
  assertEquals(verdicts(withLocalHeapType('90 7f')), { ours: false, v8: false });
});
