// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Phase 7 Tier B coverage — patterns that show up in any compiled output:
 * direct + indirect calls, select, memory loads / stores, memory.size /
 * memory.grow.
 *
 * Each test feeds a small WAT module through the bridge, encodes the
 * binaryen-ts result to wasm, then decodes + validates that wasm with
 * wabt-ts. A green test = the bridge produces a structurally + semantically
 * valid wasm binary for the family.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../src/wabt-ts/reader/binary-reader.ts';
import { validateModule } from '../../src/wabt-ts/validator/validator.ts';
import {
  formatErrors,
  hasErrors,
  makeErrorList,
  unknownLocation,
} from '../../src/wabt-ts/core/error.ts';
import { Result } from '../../src/wabt-ts/core/result.ts';
import { Type } from '../../src/wabt-ts/core/types.ts';
import { ExternalKind } from '../../src/wabt-ts/core/binary.ts';
import { makeModule, varIndex } from '../../src/wabt-ts/ir/ir.ts';
import type { Module as WabtModule } from '../../src/wabt-ts/ir/ir.ts';

import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';

function bridgeAndValidate(wat: string): void {
  const ls = new LexerSource(wat, '<tier-b>');
  const { module, errors } = parseWatModule(ls);
  if (hasErrors(errors)) throw new Error(`Parse:\n${formatErrors(errors)}`);
  const rerrs = makeErrorList();
  resolveNames(module, rerrs);
  if (hasErrors(rerrs)) throw new Error(`Resolve:\n${formatErrors(rerrs)}`);
  validateThenBridge(module);
}

function validateThenBridge(wabtMod: WabtModule): void {
  const wasm = encodeWasm(bridgeToBinaryen(wabtMod));
  const errs = makeErrorList();
  const decoded = readBinaryIr(wasm, errs);
  if (hasErrors(errs)) throw new Error(`Decode:\n${formatErrors(errs)}`);
  const r = validateModule(decoded, errs);
  if (hasErrors(errs)) throw new Error(`Validate:\n${formatErrors(errs)}`);
  assertEquals(r, Result.Ok);
}

describe('Phase 7 Tier B: calls, select, memory ops', () => {
  it('direct call to an imported function (no result)', () => {
    bridgeAndValidate(`
      (module
        (import "env" "log" (func $log (param i32)))
        (func $f (param i32)
          local.get 0
          call $log)
        (export "f" (func $f)))
    `);
  });

  it('direct call to a defined function with a result', () => {
    bridgeAndValidate(`
      (module
        (func $sq (param i32) (result i32)
          local.get 0
          local.get 0
          i32.mul)
        (func $f (param i32) (result i32)
          local.get 0
          call $sq)
        (export "f" (func $f)))
    `);
  });

  it('call_indirect through a table (IR built directly)', () => {
    // The WAT parser currently doesn't resolve `(call_indirect (type $sig))`
    // to its signature or consume stack operands (the parser leaves
    // `args=[]` and `callee=nop`). That's a parser issue separate from the
    // bridge — to exercise the bridge's call_indirect path we build the
    // module IR directly.
    const LOC = unknownLocation();
    const sigG = { params: [Type.I32], results: [Type.I32] }; // g's signature; also the call_indirect target sig
    const sigF = { params: [Type.I32, Type.I32], results: [Type.I32] }; // f's signature
    const m = makeModule();
    m.types.push({ kind: 'func', name: '', sig: sigG, loc: LOC });
    m.types.push({ kind: 'func', name: '', sig: sigF, loc: LOC });
    m.funcs.push({
      name: 'g',
      loc: LOC,
      typeVar: varIndex(0),
      sig: sigG,
      localDecls: [],
      body: [{ kind: 'local.get', var: varIndex(0), loc: LOC }],
      tailcall: false,
    });
    m.tables.push({
      name: 't',
      loc: LOC,
      elemType: Type.FuncRef,
      limits: { initial: 1n, max: 1n, isShared: false, is64: false },
      init: [],
    });
    m.funcs.push({
      name: 'f',
      loc: LOC,
      typeVar: varIndex(1),
      sig: sigF,
      localDecls: [],
      body: [
        {
          kind: 'call_indirect',
          table: varIndex(0),
          sig: sigG,
          typeVar: varIndex(0),
          args: [{ kind: 'local.get', var: varIndex(0), loc: LOC }],
          callee: { kind: 'local.get', var: varIndex(1), loc: LOC },
          loc: LOC,
        },
      ],
      tailcall: false,
    });
    m.exports.push({ name: 'f', kind: ExternalKind.Func, var: varIndex(1) });

    validateThenBridge(m);
  });

  it('select picks between two i32 values', () => {
    bridgeAndValidate(`
      (module
        (func $f (param i32 i32 i32) (result i32)
          local.get 0
          local.get 1
          local.get 2
          select)
        (export "f" (func $f)))
    `);
  });

  it('i32.load and i32.store round-trip a value through memory', () => {
    bridgeAndValidate(`
      (module
        (memory 1)
        (func $f (param i32 i32) (result i32)
          local.get 0
          local.get 1
          i32.store
          local.get 0
          i32.load)
        (export "f" (func $f)))
    `);
  });

  it('narrow loads and stores (i32.load8_u, i32.store8)', () => {
    bridgeAndValidate(`
      (module
        (memory 1)
        (func $f (param i32 i32)
          local.get 0
          local.get 1
          i32.store8
          local.get 0
          i32.load8_u
          drop)
        (export "f" (func $f)))
    `);
  });

  it('load with explicit offset and align', () => {
    bridgeAndValidate(`
      (module
        (memory 1)
        (func $f (param i32) (result i64)
          local.get 0
          i64.load offset=8 align=4)
        (export "f" (func $f)))
    `);
  });

  it('memory.size and memory.grow', () => {
    bridgeAndValidate(`
      (module
        (memory 1)
        (func $size (result i32) memory.size)
        (func $grow (param i32) (result i32) local.get 0 memory.grow)
        (export "size" (func $size))
        (export "grow" (func $grow)))
    `);
  });
});
