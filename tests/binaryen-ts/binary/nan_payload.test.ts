// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A float constant's BITS survive binaryen-ts -- signalling NaN payloads
// included.
//
// binaryen-ts held `f32.const` / `f64.const` as JS numbers. A NaN's payload is
// observable (`i32.reinterpret_f32` reads it back), and a number does not keep
// it: measured 2026-09-15, a bare `parseWasm` -> `encodeWasm` round trip CHANGED
// all four signalling-NaN constants probed (f32 and f64, positive and negative)
// and kept only the canonical quiet NaN. A module that returned
// `i32.reinterpret_f32(f32.const nan:0x200000)` returned something else after
// it. Upstream binaryen stores float literals as bits.
//
// wabt-ts's `Const` holds the raw IEEE 754 bit pattern, so fidelity binds and
// its form controls (S6 step 5, stage C1).

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';

const CONSTS = [
  'f32.const nan:0x200000', // signalling: quiet bit clear
  'f32.const -nan:0x1', // signalling, negative, smallest payload
  'f32.const nan:0x400000', // canonical quiet
  'f64.const nan:0x4000000000000', // signalling
  'f64.const -nan:0x1',
  'f64.const nan:0x8000000000000', // canonical quiet
  'f32.const -0', // the sign of zero is a bit too
  'f64.const 0x1.fffffffffffffp+1023', // largest finite
];

/** What the constant's bits read as, through `reinterpret` -- by RUNNING it. */
async function bitsAtRuntime(bytes: Uint8Array): Promise<string> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  const v = (instance.exports.f as () => number | bigint)();
  return typeof v === 'bigint' ? BigInt.asUintN(64, v).toString(16) : (v >>> 0).toString(16);
}

describe('binaryen-ts keeps a float constant bit for bit', () => {
  for (const c of CONSTS) {
    const f32 = c.startsWith('f32');
    const wat = `(module (func (export "f") (result ${f32 ? 'i32' : 'i64'})
      (${f32 ? 'i32.reinterpret_f32' : 'i64.reinterpret_f64'} (${c}))))`;

    it(`${c}: decode -> encode is byte-identical`, () => {
      const bytes = wat2wasm(wat).binary;
      assertEquals(encodeWasm(parseWasm(bytes)), bytes);
    });

    it(`${c}: and the round-tripped module still returns the same bits`, async () => {
      const bytes = wat2wasm(wat).binary;
      assertEquals(await bitsAtRuntime(encodeWasm(parseWasm(bytes))), await bitsAtRuntime(bytes));
    });
  }
});
