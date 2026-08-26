// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Phase 7 GC Tier 3 — array.*
 *
 * Covers the 9 array instructions plus the `(type $name (array …))` type
 * section form, including packed element types and segment-based init.
 *
 * Same scope note as Tier 2: wabt-ts's flat `Type[]` IR coarsens typed
 * refs `(ref $T)` / `(ref null $T)` to `Type.StructRef`, so binaries
 * emitted through the bridge don't currently V8-validate when typed
 * refs appear in param/result/local slots. Tests therefore verify
 * binary encoding (type section, opcode bytes, segment-index resolution)
 * rather than V8 round-trip.
 *
 * Tier 4 (ref.test / ref.cast / br_on_cast) still pending.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../src/parser/lexer-source.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';

import { bridgeToBinaryen } from '../../src/bridge/binaryen-bridge.ts';
import { encodeWasm } from '@jrmarcum/binaryen-ts/encoder';

function bridge(wat: string): Uint8Array {
  const ls = new LexerSource(wat, '<gc-tier3>');
  const { module, errors } = parseWatModule(ls);
  if (hasErrors(errors)) throw new Error(`Parse:\n${formatErrors(errors)}`);
  const rerrs = makeErrorList();
  resolveNames(module, rerrs);
  if (hasErrors(rerrs)) throw new Error(`Resolve:\n${formatErrors(rerrs)}`);
  return encodeWasm(bridgeToBinaryen(module));
}

function findBytes(buf: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= buf.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe('GC Tier 3: type-section array encoding', () => {
  it('encodes (array (mut i32)) with the 0x5e marker', () => {
    const wasm = bridge(`(module
      (type $Ints (array (mut i32))))`);
    // Array marker 0x5e, then (storage-type, mut) — i32 = 0x7f, mut = 0x01.
    assertEquals(findBytes(wasm, [0x5e, 0x7f, 0x01]) >= 0, true);
  });

  it('encodes packed i8 element type with binary byte 0x78', () => {
    const wasm = bridge(`(module
      (type $Bytes (array i8)))`);
    // 0x5e, then i8 = 0x78 (spec-correct), mut = 0x00.
    assertEquals(findBytes(wasm, [0x5e, 0x78, 0x00]) >= 0, true);
  });

  it('struct + array types in the same module', () => {
    const wasm = bridge(`(module
      (type $Pt (struct (field i32) (field i32)))
      (type $Arr (array (mut i32))))`);
    assertEquals(findBytes(wasm, [0x5f, 0x02]) >= 0, true, 'expected struct marker');
    assertEquals(findBytes(wasm, [0x5e]) >= 0, true, 'expected array marker');
  });
});

describe('GC Tier 3: array.new family opcode encoding', () => {
  it('array.new emits 0xfb 0x06 + type-index', () => {
    const wasm = bridge(`(module
      (type $A (array (mut i32)))
      (func $f (param i32 i32) (result (ref $A))
        (array.new $A (local.get 0) (local.get 1))))`);
    // array.new = 0xfb 0x06, type-index 0 → 0xfb 0x06 0x00.
    assertEquals(findBytes(wasm, [0xfb, 0x06, 0x00]) >= 0, true);
  });

  it('array.new_default emits 0xfb 0x07 + type-index', () => {
    const wasm = bridge(`(module
      (type $A (array (mut i32)))
      (func $f (param i32) (result (ref $A))
        (array.new_default $A (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x07, 0x00]) >= 0, true);
  });

  it('array.new_fixed emits 0xfb 0x08 + type-index + count', () => {
    const wasm = bridge(`(module
      (type $A (array (mut i32)))
      (func $f (result (ref $A))
        (array.new_fixed $A 3 (i32.const 1) (i32.const 2) (i32.const 3))))`);
    // array.new_fixed = 0xfb 0x08, type=0, count=3.
    assertEquals(findBytes(wasm, [0xfb, 0x08, 0x00, 0x03]) >= 0, true);
  });

  it('array.new_data emits 0xfb 0x09 + type-index + data-segment-index', () => {
    const wasm = bridge(`(module
      (memory 1)
      (data $D "\\01\\02\\03\\04")
      (type $A (array (mut i32)))
      (func $f (param i32 i32) (result (ref $A))
        (array.new_data $A $D (local.get 0) (local.get 1))))`);
    // array.new_data = 0xfb 0x09, type-index, data-segment-index.
    // type 0, data segment 0.
    assertEquals(findBytes(wasm, [0xfb, 0x09, 0x00, 0x00]) >= 0, true);
  });
});

describe('GC Tier 3: array.get / set / len opcode encoding', () => {
  it('array.get emits 0xfb 0x0b + type-index', () => {
    const wasm = bridge(`(module
      (type $A (array (mut i32)))
      (func $f (param (ref $A) i32) (result i32)
        (array.get $A (local.get 0) (local.get 1))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x0b, 0x00]) >= 0, true);
  });

  it('array.get_s on packed i8 emits 0xfb 0x0c', () => {
    const wasm = bridge(`(module
      (type $A (array i8))
      (func $f (param (ref $A) i32) (result i32)
        (array.get_s $A (local.get 0) (local.get 1))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x0c, 0x00]) >= 0, true);
  });

  it('array.set emits 0xfb 0x0e + type-index', () => {
    const wasm = bridge(`(module
      (type $A (array (mut i32)))
      (func $f (param (ref $A) i32 i32)
        (array.set $A (local.get 0) (local.get 1) (local.get 2))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x0e, 0x00]) >= 0, true);
  });

  it('array.len emits 0xfb 0x0f (no type immediate)', () => {
    const wasm = bridge(`(module
      (type $A (array (mut i32)))
      (func $f (param (ref $A)) (result i32)
        (array.len (local.get 0))))`);
    // array.len = 0xfb 0x0f, no type immediate.
    assertEquals(findBytes(wasm, [0xfb, 0x0f]) >= 0, true);
  });
});

describe('GC Tier 3: data/elem segment-index resolution', () => {
  it('array.new_data resolves $D to the right segment index', () => {
    const wasm = bridge(`(module
      (memory 1)
      (data $D0 "\\aa")
      (data $D1 "\\bb\\cc")
      (type $A (array (mut i32)))
      (func $f (param i32 i32) (result (ref $A))
        (array.new_data $A $D1 (local.get 0) (local.get 1))))`);
    // $D1 should resolve to segment index 1, not 0.
    assertEquals(findBytes(wasm, [0xfb, 0x09, 0x00, 0x01]) >= 0, true);
  });
});

describe('GC Tier 3: array.get_u emits its own opcode', () => {
  it('array.get_u emits 0xfb 0x0d, spec-correct since binaryen-ts 1.5.0', () => {
    // Same story as struct.get_u in Tier 2. binaryen-ts <= 1.4.3 chose the
    // sub-opcode with `signed ? signed : base`, so get_u collapsed onto the
    // base 0x0b. Reported as UP-1, fixed in 1.5.0 by `packedGetSubop`, and
    // this assertion moved from the collapsed byte to the spec-correct one.
    const wasm = bridge(`(module
      (type $A (array i8))
      (func $f (param (ref $A) i32) (result i32)
        (array.get_u $A (local.get 0) (local.get 1))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x0d, 0x00]) >= 0, true);
    assertEquals(findBytes(wasm, [0xfb, 0x0b, 0x00]) >= 0, false);
  });
});
