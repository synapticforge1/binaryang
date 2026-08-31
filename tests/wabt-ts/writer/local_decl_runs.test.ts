// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Local declarations are `vec(count, valtype)`, so N consecutive locals of one
// type may be written as a single `(N, type)` group. The binary writer's comment
// said "run-length encoded" while the loop emitted `func.localDecls` verbatim —
// and the decoder produces one entry per local, so three i32 locals went out as
// `3 | (1,i32) (1,i32) (1,i32)`, 7 bytes where 3 would do.
//
// Found by chasing a 0.90% size gap against binaryen-ts rather than by review.
// Coalescing recovered 42,437 bytes (2.7%) across the 421-file corpus, which is
// considerably more than the gap that led to it — binaryen-ts only coalesces
// partially, so both writers were carrying redundancy and this measured the
// difference rather than the total.
//
// ⚠️ This changed the emitted-byte baseline on 398 files, which is why it came
// with a deliberate re-baseline in the same commit. The baseline is not a test:
// it pins bytes, so a genuine encoder improvement is SUPPOSED to move it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';

/** The code section's payload, which begins with the local declarations. */
function codeSection(b: Uint8Array): Uint8Array {
  let p = 8;
  const leb = () => {
    let r = 0, s = 0, x = 0;
    do {
      x = b[p++]!;
      r |= (x & 0x7f) << s;
      s += 7;
    } while (x & 0x80);
    return r >>> 0;
  };
  while (p < b.length) {
    const id = b[p++]!;
    const size = leb();
    if (id === 10) return b.slice(p, p + size);
    p += size;
  }
  throw new Error('no code section');
}

/** Decl-group count for the first function body: byte after its size LEB. */
function declGroups(wat: string): number {
  const code = codeSection(wat2wasm(wat, { filename: 't.wat' }).binary);
  // code = vec(func); [0] = func count, [1] = body size, [2] = decl group count
  return code[2]!;
}

const RUN = '(module (func (export "f") (local i32) (local i32) (local i32) (nop)))';

describe('binary writer — local declarations are run-length encoded', () => {
  it('three consecutive i32 locals become ONE group', () => {
    assertEquals(declGroups(RUN), 1);
  });

  it('the grouped spelling produces the same encoding as the separate one', () => {
    const grouped = wat2wasm('(module (func (export "f") (local i32 i32 i32) (nop)))', {
      filename: 'a.wat',
    }).binary;
    const separate = wat2wasm(RUN, { filename: 'b.wat' }).binary;
    assertEquals([...grouped], [...separate], 'source spelling must not change the bytes');
  });

  // Coalescing must never merge across a type boundary. This shape already
  // agreed with binaryen-ts before the change, which is what identified runs
  // rather than locals in general as the difference.
  it('different types are NOT merged', () => {
    assertEquals(
      declGroups('(module (func (export "f") (local i32) (local i64) (local i32) (nop)))'),
      3,
    );
  });

  it('a run is merged only up to the type boundary', () => {
    // i32 i32 | i64 | i32  ->  3 groups, not 4 and not 1
    assertEquals(
      declGroups(
        '(module (func (export "f") (local i32) (local i32) (local i64) (local i32) (nop)))',
      ),
      3,
    );
  });

  it('no locals at all stays zero groups', () => {
    assertEquals(declGroups('(module (func (export "f") (nop)))'), 0);
  });

  // The property that matters more than the byte count: coalescing changes how
  // the locals are SPELLED, so it must not change which local an index names.
  it('local indices still address the right slots after coalescing', () => {
    const wat = `(module (func (export "f") (result i32)
      (local i32) (local i32) (local i64) (local i32)
      (local.set 0 (i32.const 10))
      (local.set 1 (i32.const 20))
      (local.set 2 (i64.const 30))
      (local.set 3 (i32.const 40))
      (i32.add
        (i32.add (local.get 0) (local.get 1))
        (i32.add (local.get 3) (i32.wrap_i64 (local.get 2))))))`;
    const bin = wat2wasm(wat, { filename: 'i.wat' }).binary;
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bin as BufferSource));
    assertEquals((inst.exports.f as () => number)(), 100, '10 + 20 + 40 + 30');
  });

  it('output still round-trips byte-identically through wasm2wat', () => {
    const first = wat2wasm(RUN, { filename: 'r.wat' }).binary;
    const text = wasm2wat(first, {}).text;
    const second = wat2wasm(text, { filename: 'r2.wat' }).binary;
    assertEquals([...second], [...first]);
    assert(WebAssembly.validate(first as BufferSource));
  });
});
