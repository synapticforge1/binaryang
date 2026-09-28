// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// One front end, stage 4: binaryen-ts modules are written by the ONE binary
// writer (wabt-ts's) through `writeWasm` — `wasm-opt`, `Module.emitBinary`,
// `toBinary`. Before switching, the two writers were compared over 2,919 inputs
// unoptimized and at four levels; each fixture here is one of the differences
// that comparison found, and each was asserted on BOTH writers, since four of
// them were defects — two in each. binaryen-ts's encoder was deleted at 1.6.0
// (stage 4b), so each is now asserted on the one writer: valid unoptimized and
// at -O1, and the plain round trip gives the input back byte for byte:
//
// - wabt-ts's path could not write a branch to the function's own frame label,
//   a block a pass made with several results, or a module whose types sit in
//   rec groups (a function's, a tag's or a `call_indirect`'s type re-interned
//   as a different one); and it wrote `(ref $T)` locals as separate groups;
// - binaryen-ts's encoder wrote every ternary SIMD instruction as
//   `v128.bitselect`, and an empty memory section for an imported memory.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import {
  WasmEncodeError,
  writeWasm,
  writeWat,
} from '../../../src/binaryen-ts/encoder/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors), JSON.stringify(r.errors));
  assert(WebAssembly.validate(r.binary as BufferSource), 'the engine accepts the fixture');
  return r.binary;
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
/** The one writer, unoptimized and at -O1: valid, and unoptimized the input exactly. */
function bothWriters(bytes: Uint8Array, want: Uint8Array = bytes) {
  for (const level of [0, 1] as const) {
    const m = readForPasses(bytes);
    if (level > 0) new PassRunner(m, { optimizeLevel: 1 }).addDefaultOptimizationPasses().run();
    const wab = writeWasm(m);
    assert(WebAssembly.validate(wab as BufferSource), `level ${level}: valid`);
    if (level === 0) assertEquals(hex(wab), hex(want), 'the input, exactly');
  }
}

describe('one writer (One front end stage 4): what the comparison found', () => {
  it('a branch to the function frame', () => {
    // `br 0` at the top of a body leaves the function; prepared for the passes it
    // names the frame's label, which the wabt-ts path did not know.
    bothWriters(asm(`(module (func (export "f") (param i32) (result i32)
      (br_if 0 (i32.const 7) (local.get 0)) (drop) (i32.const 8)))`));
  });

  it('a construct with several results, once optimizing drops its written index', () => {
    // A pass run drops a carrier's written type index as form, so after -O1 a
    // `(result i32 i32)` construct names no type: "block type has no type index
    // yet" until the writer's resolve step interns one.
    bothWriters(asm(`(module (func (export "f") (param i32) (result i32)
      (if (result i32 i32) (local.get 0)
        (then (i32.const 1) (i32.const 2))
        (else (i32.const 3) (i32.const 4)))
      (i32.add)))`));
  });

  it("a function's type inside a rec group is kept, not re-made", () => {
    // `spec/type-rec/type-rec.3.wasm`'s shape: re-interning gave `$f` a new
    // singleton type, and `(ref.func $f)` no longer had its global's type.
    const bytes = asm(`(module
      (rec (type $f1 (func)) (type (struct)))
      (func $f (type $f1))
      (global (ref $f1) (ref.func $f)))`);
    bothWriters(bytes, bytes);
  });

  it("a tag's type inside a rec group adds no type, and stays that type", () => {
    // `spec/tag/tag.6.wasm`'s shape: a two-type rec group and an imported tag
    // naming its SECOND member. It was hand-assembled while our `wat2wasm` got
    // this source wrong (Q9: a spare singleton type, the tag on type 0) and
    // refused the import form (W12); both are fixed, and the bytes are
    // wasm-tools' for the same text.
    const bytes = asm(`(module
      (rec (type $t1 (func)) (type $t2 (func)))
      (import "M" "tag" (tag (type $t2)))
      (tag (type $t2)))`);
    // (rec (func) (func)), "M" "tag" (tag (type 1)), then a defined (tag (type 1)).
    assertEquals(
      hex(bytes.subarray(0, 36)),
      '00 61 73 6d 01 00 00 00 01 09 01 4e 02 60 00 00 60 00 00 ' +
        '02 0a 01 01 4d 03 74 61 67 04 00 01 0d 03 01 00 01',
    );
    bothWriters(bytes, bytes);
  });

  it('a call_indirect whose type is in a rec group keeps that type after -O1', () => {
    // `spec/type-equivalence/type-equivalence.9.wasm`'s shape: the only type with
    // this signature sits in a rec group, so the written index IS form and is
    // dropped — and a NEW singleton type took its place: a different type for
    // the engine's signature check, and a call that must succeed trapped.
    const bytes = asm(`(module
      (rec (type $f (func (param i32))) (type (struct)))
      (table funcref (elem $g))
      (func $g (type $f))
      (func (export "run") (call_indirect (type $f) (i32.const 5) (i32.const 0))))`);
    const m = readForPasses(bytes);
    new PassRunner(m, { optimizeLevel: 1 }).addDefaultOptimizationPasses().run();
    const out = writeWasm(m);
    const run = (b: Uint8Array) => {
      try {
        (new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports.run as () =>
          void)();
        return 'returns';
      } catch (e) {
        return (e as Error).constructor.name;
      }
    };
    assertEquals(run(out), run(bytes));
    assertEquals(run(bytes), 'returns', 'the premise: the exact type, so the call succeeds');
  });

  it('two (ref $T) locals are one group', () => {
    const bytes = asm(
      `(module (type $s (struct)) (func (local (ref null $s)) (local (ref null $s))))`,
    );
    bothWriters(bytes, bytes);
  });

  it('a relaxed ternary SIMD instruction is itself, not v128.bitselect', () => {
    const bytes = asm(`(module (func (export "f") (param v128 v128 v128) (result v128)
      (i32x4.relaxed_dot_i8x16_i7x16_add_s (local.get 0) (local.get 1) (local.get 2))))`);
    bothWriters(bytes, bytes);
    assert(!hex(writeWasm(readForPasses(bytes))).includes('fd 52'), 'no bitselect');
  });

  it('an imported memory writes no memory section', () => {
    const bytes = asm(`(module (import "M" "mem" (memory 1)) (func (export "f") (result i32)
      (i32.load (i32.const 0))))`);
    bothWriters(bytes, bytes);
  });
});

describe('writeWat: text through the one WAT writer (K4)', () => {
  it('branches to made-up labels and to the function frame print as depths', () => {
    // Made ready for the passes, every label has a NAME — the unnamed block's
    // made up — and the WAT writer prints only real labels on their
    // constructs: `br $l0_0` came out beside a block with no `$l0_0`, and the
    // function frame, which text cannot name at all, as `br $l0_frame`.
    const bytes = asm(`(module (func (export "f") (param i32) (result i32)
      (block (result i32)
        (br_if 1 (i32.const 7) (local.get 0))
        (drop)
        (br 0 (i32.const 8)))))`);
    const m = readForPasses(bytes);
    const text = writeWat(m);
    const r = wat2wasm(text, { textForm: false });
    assert(!hasErrors(r.errors), `assembles:\n${text}`);
    assertEquals(hex(r.binary), hex(bytes), 'the same module');
  });

  it('a global with no initializer is refused, not printed as `(global $g i32)`', () => {
    const m = readForPasses(asm(`(module (global $g i32 (i32.const 1)))`));
    delete (m.globals[0] as { init?: unknown }).init;
    assertThrows(() => writeWat(m), WasmEncodeError, 'it has no initializer');
    assertThrows(() => writeWasm(m), WasmEncodeError, 'it has no initializer');
  });
});

describe('writeWasm leaves the module as it was', () => {
  it('a module written, then optimized, then written again', () => {
    // The wabt-ts path resolves names to indices and appends types; the passes
    // need names. It must work on a copy (`Module.emitBinary` is called on a
    // module the caller keeps).
    const m = readForPasses(asm(`(module
      (func $h (param i32) (result i32) (i32.add (local.get 0) (i32.const 1)))
      (func (export "f") (param i32) (result i32) (call $h (local.get 0))))`));
    const types = m.types.length;
    const first = writeWasm(m);
    assertEquals(m.types.length, types, "no type appended to the caller's module");
    new PassRunner(m, { optimizeLevel: 2 }).addDefaultOptimizationPasses().run();
    const second = writeWasm(m);
    assert(
      WebAssembly.validate(first as BufferSource) && WebAssembly.validate(second as BufferSource),
    );
    const call = (b: Uint8Array) =>
      (new WebAssembly.Instance(new WebAssembly.Module(b as BufferSource)).exports.f as (
        x: number,
      ) => number)(41);
    assertEquals([call(first), call(second)], [42, 42]);
  });
});
