// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `any.convert_extern` / `extern.convert_any` survive binaryen-ts.
//
// The binary decoder read both as `push(pop())` — "identity conversion in IR".
// The value survived and the TYPE did not, so the opcode vanished on re-encode:
// V8 rejected the module wherever the conversion was load-bearing for typing
// (`toAny` below returns `anyref` only because of it), and it was silently
// absent where it was not.
//
// ⚠️ ORACLE GAP (cmem/divergences.md G1/G3): upstream wat2wasm 1.0.41 has no GC
// heap-type text, so it cannot assemble this module. Input comes from wabt-ts;
// the independent authority is V8 — validation AND a run.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

// wabt-ts's bytes without the name section until N1 P5 -- see ../wabt_reference.ts.
import { wabtReference } from '../wabt_reference.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';

const WAT = `(module
  (func (export "roundTrip") (param externref) (result externref)
    (extern.convert_any (any.convert_extern (local.get 0))))
  (func (export "toAny") (param externref) (result anyref)
    (any.convert_extern (local.get 0))))`;

async function instance(bytes: Uint8Array): Promise<Record<string, (x: unknown) => unknown>> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
  return instance.exports as Record<string, (x: unknown) => unknown>;
}

describe('the extern conversions', () => {
  const input = wabtReference(WAT, { filename: 'convert.wat' }).binary;

  it('the input is a valid module (V8)', () => {
    assert(input.length > 0, 'wabt-ts assembled nothing');
    assertEquals(WebAssembly.validate(input as BufferSource), true);
  });

  it('decode → encode keeps both opcodes: byte-identical, valid, and runs', async () => {
    const out = encodeWasm(parseWasm(input));
    assertEquals(out, input);
    const token = { tag: 'host object' };
    const exports = await instance(out);
    assertEquals(exports.roundTrip!(token), token);
    assertEquals(exports.toAny!(null), null);
  });

  it('the binaryen-ts WAT path writes the same module', async () => {
    const out = encodeWasm(parseWat(WAT));
    assertEquals(WebAssembly.validate(out as BufferSource), true);
    const token = { tag: 'host object' };
    assertEquals((await instance(out)).roundTrip!(token), token);
  });
});
