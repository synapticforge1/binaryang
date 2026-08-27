// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Phase 7 GC Tier 4 — ref.test / ref.cast.
 *
 * Covers the two heap-type-immediate instructions:
 *   - ref.test (ref [null] H) val → pops ref, pushes i32 (1 = matches)
 *   - ref.cast (ref [null] H) val → pops ref, pushes ref of H (traps on mismatch)
 *
 * The heap-type immediate H is either an abstract heap type keyword
 * (`any`, `eq`, `i31`, `struct`, `array`, `func`, `extern`, `none`,
 * `nofunc`, `noextern`) or a user-defined `$T`.
 *
 * Same scope note as Tier 2 / Tier 3: typed-ref IR is loose, so tests
 * verify binary encoding rather than V8 round-trip.
 *
 * Out of Tier 4 scope: br_on_cast / br_on_cast_fail (different
 * shape with two heap-type immediates + flag byte).
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';

import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';

function bridge(wat: string): Uint8Array {
  const ls = new LexerSource(wat, '<gc-tier4>');
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

describe('GC Tier 4: ref.test opcode encoding', () => {
  it('ref.test on (ref any) emits 0xfb 0x14 + anyref byte (0x6e)', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result i32)
        (ref.test (ref any) (local.get 0))))`);
    // ref.test (non-null) = 0xfb 0x14, heap type = abstract 'any' = 0x6e.
    assertEquals(
      findBytes(wasm, [0xfb, 0x14, 0x6e]) >= 0,
      true,
      `expected ref.test (ref any) bytes; binary:\n${
        [...wasm].map((b) => b.toString(16).padStart(2, '0')).join(' ')
      }`,
    );
  });

  it('ref.test on (ref null any) emits 0xfb 0x15 (nullable variant)', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result i32)
        (ref.test (ref null any) (local.get 0))))`);
    // ref.test (nullable) = 0xfb 0x15.
    assertEquals(findBytes(wasm, [0xfb, 0x15, 0x6e]) >= 0, true);
  });

  it('ref.test on (ref i31) emits the i31ref byte (0x6c)', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result i32)
        (ref.test (ref i31) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x14, 0x6c]) >= 0, true);
  });

  it('ref.test on (ref struct) emits the structref byte (0x6b)', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result i32)
        (ref.test (ref struct) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x14, 0x6b]) >= 0, true);
  });

  it('ref.test on (ref array) emits the arrayref byte (0x6a)', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result i32)
        (ref.test (ref array) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x14, 0x6a]) >= 0, true);
  });

  it('ref.test on a user-defined struct type encodes the type-index', () => {
    const wasm = bridge(`(module
      (type $T (struct (field $v i32)))
      (func $f (param anyref) (result i32)
        (ref.test (ref $T) (local.get 0))))`);
    // ref.test (non-null) + type-index 0 → 0xfb 0x14 0x00.
    assertEquals(findBytes(wasm, [0xfb, 0x14, 0x00]) >= 0, true);
  });

  it('ref.test on (ref null $T) for a user-defined type uses 0x15', () => {
    const wasm = bridge(`(module
      (type $T (struct (field $v i32)))
      (func $f (param anyref) (result i32)
        (ref.test (ref null $T) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x15, 0x00]) >= 0, true);
  });
});

describe('GC Tier 4: ref.cast opcode encoding', () => {
  it('ref.cast on (ref any) emits 0xfb 0x16 + anyref byte', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result anyref)
        (ref.cast (ref any) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x16, 0x6e]) >= 0, true);
  });

  it('ref.cast on (ref null any) emits 0xfb 0x17 (nullable variant)', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result anyref)
        (ref.cast (ref null any) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x17, 0x6e]) >= 0, true);
  });

  it('ref.cast on a user-defined struct type encodes the type-index', () => {
    const wasm = bridge(`(module
      (type $T (struct (field $v i32)))
      (func $f (param anyref) (result (ref $T))
        (ref.cast (ref $T) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x16, 0x00]) >= 0, true);
  });
});

describe('GC Tier 4: heap-type name resolution', () => {
  it('ref.test (ref func) maps to funcref byte (0x70)', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result i32)
        (ref.test (ref func) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x14, 0x70]) >= 0, true);
  });

  it('ref.test (ref none) maps to nullref byte (0x71)', () => {
    const wasm = bridge(`(module
      (func $f (param anyref) (result i32)
        (ref.test (ref none) (local.get 0))))`);
    assertEquals(findBytes(wasm, [0xfb, 0x14, 0x71]) >= 0, true);
  });
});
