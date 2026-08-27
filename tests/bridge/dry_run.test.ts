// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Phase 7 — bridge round-trip smoke test.
 *
 * Parses a small WAT module via wabt-ts, bridges it to binaryen-ts via
 * `bridgeToBinaryen`, encodes the result to wasm via binaryen-ts's encoder,
 * then validates the binary back through wabt-ts's decoder + validator.
 *
 * If this test goes green the bridge's expression / import / export support
 * covers the dry-run starter module. Expanding the bridge to more expression
 * kinds means: add a `case` in `bridgeExpr` (or a helper), then add a test
 * here that exercises the new kind.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertExists } from '@std/assert';

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../src/wabt-ts/reader/binary-reader.ts';
import { validateModule } from '../../src/wabt-ts/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { Result } from '../../src/wabt-ts/core/result.ts';
import type { Module as WabtModule } from '../../src/wabt-ts/ir/ir.ts';

import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';

function parseAndResolve(src: string): WabtModule {
  const ls = new LexerSource(src, '<bridge-test>');
  const { module, errors } = parseWatModule(ls);
  if (hasErrors(errors)) throw new Error(`Parse errors:\n${formatErrors(errors)}`);
  const resolveErrs = makeErrorList();
  resolveNames(module, resolveErrs);
  if (hasErrors(resolveErrs)) {
    throw new Error(`Name-resolution errors:\n${formatErrors(resolveErrs)}`);
  }
  return module;
}

describe('Phase 7 bridge: wabt IR → binaryen-ts → wasm', () => {
  it('round-trips the Phase 7 starter module through the bridge', () => {
    const wat = `
      (module
        (import "env" "log" (func $log (param i32)))
        (global $g (mut i32) (i32.const 0))
        (memory 1)
        (func $add (param i32 i32) (result i32)
          local.get 0
          local.get 1
          i32.add)
        (export "add" (func $add)))
    `;

    const wabtMod = parseAndResolve(wat);

    // Sanity-check the parsed IR shape so a failure here points at the
    // parser, not the bridge.
    assertEquals(wabtMod.imports.length, 1);
    assertEquals(wabtMod.globals.length, 1);
    assertEquals(wabtMod.memories.length, 1);
    assertEquals(wabtMod.funcs.length, 1);
    assertEquals(wabtMod.exports.length, 1);

    const binaryenMod = bridgeToBinaryen(wabtMod);
    const wasm = encodeWasm(binaryenMod);
    assertExists(wasm);
    assertEquals(wasm.subarray(0, 4), new Uint8Array([0x00, 0x61, 0x73, 0x6d]), 'wasm magic');

    // Round-trip proof: decode the bridged binary back through wabt-ts and
    // validate it. If both succeed, the bridge produced a structurally and
    // semantically valid wasm module.
    const errs = makeErrorList();
    const decoded = readBinaryIr(wasm, errs);
    if (hasErrors(errs)) {
      throw new Error(`Bridged binary failed to decode:\n${formatErrors(errs)}`);
    }
    const valResult = validateModule(decoded, errs);
    if (hasErrors(errs)) {
      throw new Error(`Bridged binary failed validation:\n${formatErrors(errs)}`);
    }
    assertEquals(valResult, Result.Ok, 'validator returned Result.Ok');
  });
});
