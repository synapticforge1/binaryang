// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Phase 7 Tier C coverage — proposal-gated patterns: reference types and
 * the basic SIMD ops (v128.const, lane-wise arithmetic via the existing
 * unary/binary cases, lane extract, shuffle).
 *
 * Out of scope for this tier:
 *   - `ref.as_non_null` (binaryen-ts v1.0.9 has no makeRefAsNonNull factory)
 *   - SIMD `replace_lane` (wabt-ts parser drops the second operand)
 *   - SIMD memory ops (load_splat, load_zero, simd_load_lane, simd_store_lane)
 *   - GC instructions (struct.*, array.*, ref.eq, ref.i31)
 *   - EH instructions (throw, try_table)
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../src/parser/lexer-source.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { validateModule } from '../../src/validator/validator.ts';
import { makeErrorList, hasErrors, formatErrors } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';

import { bridgeToBinaryen } from '../../src/bridge/binaryen-bridge.ts';
import { encodeWasm } from '@jrmarcum/binaryen-ts/encoder';

function bridge(wat: string): Uint8Array {
  const ls = new LexerSource(wat, '<tier-c>');
  const { module, errors } = parseWatModule(ls);
  if (hasErrors(errors)) throw new Error(`Parse:\n${formatErrors(errors)}`);
  const rerrs = makeErrorList();
  resolveNames(module, rerrs);
  if (hasErrors(rerrs)) throw new Error(`Resolve:\n${formatErrors(rerrs)}`);
  return encodeWasm(bridgeToBinaryen(module));
}

function bridgeAndValidate(wat: string): void {
  const wasm = bridge(wat);
  const errs = makeErrorList();
  const decoded = readBinaryIr(wasm, errs);
  if (hasErrors(errs)) throw new Error(`Decode:\n${formatErrors(errs)}`);
  const r = validateModule(decoded, errs);
  if (hasErrors(errs)) throw new Error(`Validate:\n${formatErrors(errs)}`);
  assertEquals(r, Result.Ok);
}

/**
 * Compile + validate via V8's native WebAssembly engine. Used for tests where
 * wabt-ts's own validator has known gaps (notably SIMD opcode type info),
 * so we still want a strict validation check but not the one wabt-ts ships.
 */
async function bridgeAndCompile(wat: string): Promise<void> {
  const wasm = bridge(wat);
  // Copy into a fresh ArrayBuffer-backed Uint8Array so WebAssembly.compile's
  // BufferSource type accepts it across Deno's strict TS lib defs.
  const buf = new ArrayBuffer(wasm.byteLength);
  new Uint8Array(buf).set(wasm);
  await WebAssembly.compile(buf);
}

describe('Phase 7 Tier C: reference types', () => {
  it('ref.null funcref / ref.is_null', () => {
    bridgeAndValidate(`(module
      (func $f (result i32) (ref.is_null (ref.null func)))
      (export "f" (func $f)))`);
  });

  it('ref.null externref', () => {
    bridgeAndValidate(`(module
      (func $f (result i32) (ref.is_null (ref.null extern)))
      (export "f" (func $f)))`);
  });

  it('ref.func referring to a named function (target must be export-declared)', () => {
    // wasm spec: ref.func only accepts functions that are externally
    // declared via an export, an element segment, or the start function.
    // Exporting $target makes it reference-eligible.
    bridgeAndValidate(`(module
      (func $target (result i32) (i32.const 42))
      (func $get_ref (result funcref) (ref.func $target))
      (export "target" (func $target))
      (export "get_ref" (func $get_ref)))`);
  });

  it('funcref param + ref.is_null', () => {
    bridgeAndValidate(`(module
      (func $is_null (param funcref) (result i32)
        (ref.is_null (local.get 0)))
      (export "is_null" (func $is_null)))`);
  });
});

describe('Phase 7 Tier C: SIMD', () => {
  // Note: wabt-ts's own validator has no opcode-info entries for SIMD
  // (defaults to v128→v128, which mis-types splat / extract / etc.). These
  // tests compile through V8's native WebAssembly engine instead — that's
  // the same validator wasmtk's downstream consumers will use.

  it('i8x16.splat (UnaryExpr in wabt IR; flows through existing unary case)', async () => {
    await bridgeAndCompile(`(module
      (func $broadcast (param i32) (result v128) (i8x16.splat (local.get 0)))
      (export "broadcast" (func $broadcast)))`);
  });

  it('lane-wise i8x16.add (BinaryExpr; flows through existing binary case)', async () => {
    await bridgeAndCompile(`(module
      (func $add (param v128 v128) (result v128)
        (i8x16.add (local.get 0) (local.get 1)))
      (export "add" (func $add)))`);
  });

  it('i32x4.extract_lane (simd_lane_op → makeSIMDExtract)', async () => {
    await bridgeAndCompile(`(module
      (func $get_lane (param v128) (result i32)
        (i32x4.extract_lane 2 (local.get 0)))
      (export "get_lane" (func $get_lane)))`);
  });

  it('i8x16.extract_lane_u (extract with unsigned semantics)', async () => {
    await bridgeAndCompile(`(module
      (func $byte_at (param v128) (result i32)
        (i8x16.extract_lane_u 7 (local.get 0)))
      (export "byte_at" (func $byte_at)))`);
  });

  it('i8x16.shuffle with explicit lane indices', async () => {
    await bridgeAndCompile(`(module
      (func $reverse (param v128 v128) (result v128)
        (i8x16.shuffle 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0
          (local.get 0) (local.get 1)))
      (export "reverse" (func $reverse)))`);
  });

  // v128.const literal form `(v128.const i32x4 0x... 0x... 0x... 0x...)`
  // is not yet supported by the wabt-ts WAT parser — separate parser-side
  // work. The bridge's bridgeConst v128 case will pick it up automatically
  // once the parser produces v128 ConstExpr nodes.
});
