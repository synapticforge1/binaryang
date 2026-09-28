// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// One front end, stage 3: every entry point that hands BYTES to binaryen-ts —
// `wasm-opt`, `readWat`, the compat API's `readBinary` — reads them with the one
// reader (wabt-ts's) through `readForPasses`, not binaryen-ts's own decoder.
//
// The two readers differed in what they ACCEPT, which is how this was pinned:
// each fixture is one the decoder treated differently. The decoder was deleted
// at 1.6.0 (stage 3b); the fixtures still pin the reader's behaviour.
//
// - relaxed SIMD: the decoder refuses it ("unsupported SIMD opcode"); the reader
//   reads it — and the optimized module behaves as the original.
// - a type section AFTER the function section: the decoder accepts it; the
//   reader refuses it, as the spec does (section order).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { readForPasses, WasmBinaryError } from '../../../src/binaryen-ts/ir/prepare.ts';
import { wasmOpt } from '../../../src/binaryen-ts/tools/wasm-opt.ts';
import { readBinary } from '../../../src/binaryen-ts/api/binaryen-compat.ts';

/** `(func (export "f") (param v128 v128) (result i32) … i8x16.relaxed_swizzle …)` */
const RELAXED = (() => {
  const r = wat2wasm(
    `(module
    (func (export "f") (result i32)
      (i8x16.extract_lane_u 3
        (i8x16.relaxed_swizzle
          (v128.const i8x16 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25)
          (v128.const i8x16 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15)))))`,
    { textForm: false },
  );
  assert(!hasErrors(r.errors), JSON.stringify(r.errors));
  return r.binary;
})();

/** A valid module's sections with the type section moved AFTER the function section. */
const MISORDERED = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  0x03,
  0x02,
  0x01,
  0x00, //             function section: 1 function of type 0
  0x01,
  0x04,
  0x01,
  0x60,
  0x00,
  0x00, // type section: () -> ()
  0x0a,
  0x04,
  0x01,
  0x02,
  0x00,
  0x0b, // code section: an empty body
]);

const run = (bytes: Uint8Array) =>
  (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as () =>
    number)();

async function viaWasmOpt(bytes: Uint8Array, optimizeLevel: 0 | 2): Promise<Uint8Array> {
  const path = await Deno.makeTempFile({ suffix: '.wasm' });
  try {
    await Deno.writeFile(path, bytes);
    return (await wasmOpt(path, { optimizeLevel })) as Uint8Array;
  } finally {
    await Deno.remove(path);
  }
}

describe('the entry points read with the one reader (One front end stage 3)', () => {
  it('the premises: the engine accepts relaxed SIMD and refuses misordered sections', () => {
    // The decoder's half of the premise (it refused the first, accepted the
    // second) went with the decoder at 1.6.0; the engine's half stays.
    assert(WebAssembly.validate(RELAXED as BufferSource), 'the engine accepts relaxed SIMD');
    assert(!WebAssembly.validate(MISORDERED as BufferSource), 'the engine refuses the order');
  });

  it('wasm-opt reads relaxed SIMD, and the result behaves as the original', async () => {
    const want = run(RELAXED);
    for (const level of [0, 2] as const) {
      assertEquals(run(await viaWasmOpt(RELAXED, level)), want, `-O${level}`);
    }
  });

  it('wasm-opt refuses misordered sections, as the spec does', async () => {
    await assertRejects(() => viaWasmOpt(MISORDERED, 2), WasmBinaryError);
  });

  it('the compat readBinary and readForPasses take the same reader', () => {
    readBinary(RELAXED);
    assertThrows(() => readBinary(MISORDERED), WasmBinaryError);
    assertThrows(() => readForPasses(MISORDERED), WasmBinaryError);
  });
});
