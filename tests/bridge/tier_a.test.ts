// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Phase 7 Tier A coverage.
 *
 * Each test below feeds the bridge a small WAT module exercising one family
 * of expression kinds, encodes the bridged binaryen-ts module to wasm, and
 * validates the result through wabt-ts's own decoder + validator. A green
 * test proves the bridge produces a structurally + semantically valid wasm
 * binary for that family.
 *
 * Tier A scope: locals, globals, unary, compare, convert, return, drop,
 * nop, unreachable, block, loop, if/else, br, br_if, br_table.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

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

function bridgeAndValidate(wat: string): void {
  const ls = new LexerSource(wat, '<tier-a>');
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

describe('Phase 7 Tier A: locals, globals, control flow', () => {
  it('local.set / local.tee / local.get sequence', () => {
    bridgeAndValidate(`
      (module
        (func $f (param i32) (result i32)
          (local i32)
          local.get 0
          local.set 1
          local.get 1
          local.get 1
          i32.add
          local.tee 1)
        (export "f" (func $f)))
    `);
  });

  it('global.get / global.set round-trip', () => {
    bridgeAndValidate(`
      (module
        (global $g (mut i32) (i32.const 0))
        (func $bump (param i32) (result i32)
          local.get 0
          global.get $g
          i32.add
          global.set $g
          global.get $g)
        (export "bump" (func $bump)))
    `);
  });

  it('unary, compare, convert mapped through binary/unary constructors', () => {
    bridgeAndValidate(`
      (module
        (func $f (param i32) (result i64)
          local.get 0
          i32.clz                    ;; unary
          drop
          local.get 0
          i32.eqz                    ;; "compare-ish" (unary i32 → i32 in WAT)
          drop
          local.get 0
          local.get 0
          i32.lt_s                   ;; compare
          drop
          local.get 0
          i64.extend_i32_s)          ;; convert (returns the function result)
        (export "f" (func $f)))
    `);
  });

  it('block + br with carried value', () => {
    bridgeAndValidate(`
      (module
        (func $f (result i32)
          (block $b (result i32)
            i32.const 42
            br $b))
        (export "f" (func $f)))
    `);
  });

  it('loop + br_if back-edge', () => {
    // Decrement a local until it hits 0; classic loop pattern.
    bridgeAndValidate(`
      (module
        (func $countdown (param i32) (result i32)
          (loop $L
            local.get 0
            i32.const 1
            i32.sub
            local.set 0
            local.get 0
            br_if $L)
          local.get 0)
        (export "countdown" (func $countdown)))
    `);
  });

  it('if / else with both arms returning a value', () => {
    bridgeAndValidate(`
      (module
        (func $abs (param i32) (result i32)
          local.get 0
          i32.const 0
          i32.lt_s
          (if (result i32)
            (then
              i32.const 0
              local.get 0
              i32.sub)
            (else
              local.get 0)))
        (export "abs" (func $abs)))
    `);
  });

  it('br_table dispatches to one of several block labels', () => {
    bridgeAndValidate(`
      (module
        (func $sel (param i32) (result i32)
          (block $default
            (block $b1
              (block $b0
                local.get 0
                br_table $b0 $b1 $default)
              i32.const 10
              return)
            i32.const 20
            return)
          i32.const 30)
        (export "sel" (func $sel)))
    `);
  });

  it('return without value and explicit unreachable', () => {
    bridgeAndValidate(`
      (module
        (func $f
          (block
            return)
          unreachable)
        (export "f" (func $f)))
    `);
  });

  it('nop and drop are no-ops at the binary level', () => {
    bridgeAndValidate(`
      (module
        (func $f (param i32)
          nop
          local.get 0
          drop)
        (export "f" (func $f)))
    `);
  });
});
