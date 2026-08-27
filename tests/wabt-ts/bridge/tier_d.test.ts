// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Phase 7 Tier D coverage — module-level surface that does not require any
 * new expression-kind support: memory + table exports, data segments
 * (active and passive), and round-trip of a module that combines them with
 * the previously-supported func/global pieces.
 *
 * Out of scope for this tier:
 *   - Element segments (no binaryen-ts addElement factory in v1.0.9)
 *   - Start function (no setStart)
 *   - Tag exports (no "tag" WasmExport.kind)
 *   - Multi-memory data segments
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';

import { bridgeToBinaryen } from '../../../src/wabt-ts/bridge/bridge.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';

function bridge(wat: string): Uint8Array {
  const ls = new LexerSource(wat, '<tier-d>');
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
  const r = validateModule(decoded, errs);
  if (hasErrors(errs)) throw new Error(`Validate:\n${formatErrors(errs)}`);
  assertEquals(r, Result.Ok);
  return wasm;
}

describe('Phase 7 Tier D: memory + table exports', () => {
  it('exports a named memory', () => {
    const wasm = bridgeAndValidate(`
      (module
        (memory $mem 1 4)
        (export "memory" (memory $mem)))
    `);
    const errs = makeErrorList();
    const decoded = readBinaryIr(wasm, errs);
    assertEquals(decoded.exports.length, 1);
    assertEquals(decoded.exports[0]!.name, 'memory');
  });

  it('exports an anonymous memory (synthesized $M0)', () => {
    bridgeAndValidate(`
      (module
        (memory 1)
        (export "mem" (memory 0)))
    `);
  });

  it('exports a named table', () => {
    const wasm = bridgeAndValidate(`
      (module
        (table $t 4 funcref)
        (export "t" (table $t)))
    `);
    const errs = makeErrorList();
    const decoded = readBinaryIr(wasm, errs);
    assertEquals(decoded.exports.length, 1);
    assertEquals(decoded.exports[0]!.name, 't');
  });

  it('exports an anonymous table (synthesized $T0)', () => {
    bridgeAndValidate(`
      (module
        (table 2 funcref)
        (export "t" (table 0)))
    `);
  });

  it('exports memory and table together', () => {
    bridgeAndValidate(`
      (module
        (memory $m 1)
        (table $t 1 funcref)
        (export "mem" (memory $m))
        (export "tbl" (table $t)))
    `);
  });
});

describe('Phase 7 Tier D: data segments', () => {
  it('active data segment with i32.const offset', () => {
    const wasm = bridgeAndValidate(`
      (module
        (memory 1)
        (data (i32.const 0) "\\01\\02\\03\\04"))
    `);
    const errs = makeErrorList();
    const decoded = readBinaryIr(wasm, errs);
    assertEquals(decoded.dataSegments.length, 1);
    assertEquals(decoded.dataSegments[0]!.kind, 'active');
    assertEquals(decoded.dataSegments[0]!.data.length, 4);
  });

  it('passive data segment', () => {
    const wasm = bridgeAndValidate(`
      (module
        (memory 1)
        (data "hello"))
    `);
    const errs = makeErrorList();
    const decoded = readBinaryIr(wasm, errs);
    assertEquals(decoded.dataSegments.length, 1);
    assertEquals(decoded.dataSegments[0]!.kind, 'passive');
  });

  it('multiple data segments in one module', () => {
    const wasm = bridgeAndValidate(`
      (module
        (memory 1)
        (data (i32.const 0) "\\aa\\bb")
        (data (i32.const 16) "\\cc\\dd"))
    `);
    const errs = makeErrorList();
    const decoded = readBinaryIr(wasm, errs);
    assertEquals(decoded.dataSegments.length, 2);
  });

  it('data segment offset references an imported global', () => {
    bridgeAndValidate(`
      (module
        (import "env" "base" (global $base i32))
        (memory 1)
        (data (offset (global.get $base)) "\\01\\02"))
    `);
  });
});

describe('Phase 7 Tier D: combined module-level features', () => {
  it('memory export + data segment + func that loads from it', () => {
    const wasm = bridgeAndValidate(`
      (module
        (memory $m 1)
        (export "mem" (memory $m))
        (data (i32.const 0) "\\2a\\00\\00\\00")
        (func (export "read") (result i32)
          i32.const 0
          i32.load))
    `);
    const errs = makeErrorList();
    const decoded = readBinaryIr(wasm, errs);
    assertEquals(decoded.exports.length, 2);
    assertEquals(decoded.dataSegments.length, 1);
  });
});
