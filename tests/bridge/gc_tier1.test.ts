// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Phase 7 GC Tier 1 — i31 + ref.eq.
 *
 * Covers the 3 GC instructions that don't need user-defined heap types:
 * - `ref.eq` (single-byte 0xd3)
 * - `ref.i31` (0xfb 0x1c)
 * - `i31.get_s` / `i31.get_u` (0xfb 0x1d / 0x1e)
 *
 * Uses the abstract heap types i31ref / eqref directly. Struct/array
 * heap-type infrastructure lands in Tier 2 / Tier 3.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../src/parser/lexer-source.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { validateModule } from '../../src/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';

import { bridgeToBinaryen } from '../../src/bridge/binaryen-bridge.ts';
import { encodeWasm } from '@jrmarcum/binaryen-ts/encoder';

function bridge(wat: string): Uint8Array {
  const ls = new LexerSource(wat, '<gc-tier1>');
  const { module, errors } = parseWatModule(ls);
  if (hasErrors(errors)) throw new Error(`Parse:\n${formatErrors(errors)}`);
  const rerrs = makeErrorList();
  resolveNames(module, rerrs);
  if (hasErrors(rerrs)) throw new Error(`Resolve:\n${formatErrors(rerrs)}`);
  return encodeWasm(bridgeToBinaryen(module));
}

function bridgeAndValidate(wat: string): Uint8Array {
  const wasm = bridge(wat);
  const errs = makeErrorList();
  const decoded = readBinaryIr(wasm, errs);
  if (hasErrors(errs)) throw new Error(`Decode:\n${formatErrors(errs)}`);
  const r = validateModule(decoded, errs, { features: allFeatures() });
  if (hasErrors(errs)) throw new Error(`Validate:\n${formatErrors(errs)}`);
  assertEquals(r, Result.Ok);
  return wasm;
}

// V8 compile is the ultimate spec test — the binary must satisfy V8's
// GC-aware validator. (Most tests use that as the source of truth.)
async function bridgeAndCompile(wat: string): Promise<void> {
  const wasm = bridge(wat);
  const buf = new ArrayBuffer(wasm.byteLength);
  new Uint8Array(buf).set(wasm);
  await WebAssembly.compile(buf);
}

describe('GC Tier 1: i31', () => {
  it('ref.i31 + i31.get_s round-trips a positive i32', async () => {
    await bridgeAndCompile(`(module
      (func $f (param i32) (result i32)
        (i31.get_s (ref.i31 (local.get 0))))
      (export "f" (func $f)))`);
  });

  it('i31.get_u (zero-extended) emits opcode 0x1e', () => {
    const wasm = bridgeAndValidate(`(module
      (func $f (param i32) (result i32)
        (i31.get_u (ref.i31 (local.get 0))))
      (export "f" (func $f)))`);
    // 0xfb 0x1e somewhere in the code section.
    let found = false;
    for (let i = 0; i + 1 < wasm.length; i++) {
      if (wasm[i] === 0xfb && wasm[i + 1] === 0x1e) {
        found = true;
        break;
      }
    }
    assertEquals(found, true, 'expected i31.get_u (0xfb 0x1e) byte sequence');
  });

  it('i31.get_s emits opcode 0x1d', () => {
    const wasm = bridgeAndValidate(`(module
      (func $f (param i32) (result i32)
        (i31.get_s (ref.i31 (local.get 0))))
      (export "f" (func $f)))`);
    let found = false;
    for (let i = 0; i + 1 < wasm.length; i++) {
      if (wasm[i] === 0xfb && wasm[i + 1] === 0x1d) {
        found = true;
        break;
      }
    }
    assertEquals(found, true, 'expected i31.get_s (0xfb 0x1d) byte sequence');
  });

  it('ref.i31 used as i31ref value (param + result types)', async () => {
    await bridgeAndCompile(`(module
      (func $box (param i32) (result i31ref)
        (ref.i31 (local.get 0)))
      (export "box" (func $box)))`);
  });
});

describe('GC Tier 1: ref.eq', () => {
  it('ref.eq on two i31refs', async () => {
    await bridgeAndCompile(`(module
      (func $eq (param i31ref i31ref) (result i32)
        (ref.eq (local.get 0) (local.get 1)))
      (export "eq" (func $eq)))`);
  });

  it('ref.eq emits single-byte opcode 0xd3 (not 0xfb-prefixed)', () => {
    const wasm = bridgeAndValidate(`(module
      (func $eq (param i31ref i31ref) (result i32)
        (ref.eq (local.get 0) (local.get 1)))
      (export "eq" (func $eq)))`);
    // 0xd3 should appear in the code section as the ref.eq opcode.
    assertEquals(wasm.includes(0xd3), true, 'expected ref.eq opcode 0xd3');
  });

  it('ref.eq on eqref operands', async () => {
    await bridgeAndCompile(`(module
      (func $eq (param eqref eqref) (result i32)
        (ref.eq (local.get 0) (local.get 1)))
      (export "eq" (func $eq)))`);
  });
});

describe('GC Tier 1: abstract heap types parse', () => {
  it('anyref / eqref / i31ref / structref / arrayref / nullref parse as value types', () => {
    bridgeAndValidate(`(module
      (func $f (param anyref) (param eqref) (param i31ref)
                (param structref) (param arrayref) (param nullref)
                (result i32)
        (i32.const 0))
      (export "f" (func $f)))`);
  });
});
