// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Round-2 regression tests for the 2026-06-09 silent-corruption audit — the
 * findings surfaced by the second sweep. See cmem/design-decisions.md.
 */

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { makeModule, varIndex, varName } from '../../../src/wabt-ts/ir/ir.ts';
import type { Func, Module } from '../../../src/wabt-ts/ir/ir.ts';
import {
  formatErrors,
  hasErrors,
  makeErrorList,
  unknownLocation,
} from '../../../src/wabt-ts/core/error.ts';

const LOC = unknownLocation();

function roundTrip(wat: string): Module {
  const { binary, errors, result } = wat2wasm(wat);
  if (result !== 0 || errors.length > 0) {
    throw new Error(`wat2wasm failed: ${errors.map((e) => e.message).join('; ')}`);
  }
  const errs = makeErrorList();
  const m = readBinaryIr(binary, errs, { readDebugNames: true });
  if (hasErrors(errs)) throw new Error('readBinaryIr failed');
  return m;
}

function body(m: Module): readonly { kind: string }[] {
  const f = m.funcs[0];
  assert(f !== undefined, 'expected a function');
  return f.body;
}

// ---------------------------------------------------------------------------
// SIMD reader arity — unary ops decode as unary, not binary
// ---------------------------------------------------------------------------

describe('SIMD reader operand arity', () => {
  for (const op of ['f32x4.abs', 'i32x4.abs', 'f64x2.sqrt', 'i8x16.popcnt', 'v128.not']) {
    it(`${op} decodes as a unary node`, () => {
      const m = roundTrip(`(module (func (param v128) (result v128) local.get 0 ${op}))`);
      assert(body(m).some((e) => e.kind === 'unary'), `${op} should decode unary, not binary`);
    });
  }

  it('v128.bitselect decodes as a ternary node', () => {
    const m = roundTrip(`(module (func (param v128 v128 v128) (result v128)
      local.get 0 local.get 1 local.get 2 v128.bitselect))`);
    assert(body(m).some((e) => e.kind === 'ternary'), 'bitselect should decode ternary');
  });

  it('v128.store8_lane decodes as a store_lane (not load_lane)', () => {
    const m = roundTrip(`(module (memory 1) (func (param $p i32) (param $v v128)
      local.get $p local.get $v v128.store8_lane 0))`);
    assert(
      body(m).some((e) => e.kind === 'simd_store_lane'),
      'store8_lane (0x58) must not decode as load_lane',
    );
  });

  it('v128.load8_lane still decodes as a load_lane', () => {
    const m = roundTrip(`(module (memory 1) (func (param $p i32) (param $v v128) (result v128)
      local.get $p local.get $v v128.load8_lane 0))`);
    assert(body(m).some((e) => e.kind === 'simd_load_lane'), 'load8_lane should stay load_lane');
  });
});

// ---------------------------------------------------------------------------
// writeVar is fail-loud on an unresolved name-var
// ---------------------------------------------------------------------------

describe('writeVar fail-loud', () => {
  it('throws when a name-var reaches the binary writer (resolveNames skipped)', () => {
    const module = makeModule();
    module.types.push({ kind: 'func', name: '', sig: { params: [], results: [] }, loc: LOC });
    const f: Func = {
      name: 'f',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [], results: [] },
      localDecls: [],
      // call to a NAME var that was never resolved to an index
      body: [{ kind: 'call', func: varName('ghost'), args: [], loc: LOC }],
      tailcall: false,
    };
    module.funcs.push(f);
    assertThrows(() => writeBinaryIr(module), Error, 'ghost');
  });
});

// ---------------------------------------------------------------------------
// resolveNames closes the simd_lane_op.value + segment-var gaps
// (with writeVar now fail-loud, an unresolved name-var would THROW, so a clean
//  round-trip proves the name was resolved)
// ---------------------------------------------------------------------------

describe('resolveNames completeness (round-trip would throw if a name leaked)', () => {
  it('resolves a global inside a replace_lane scalar value', () => {
    const m = roundTrip(`(module
      (global $g i32 (i32.const 5))
      (func (param v128) (result v128)
        local.get 0 global.get $g i32x4.replace_lane 0))`);
    assert(body(m).some((e) => e.kind === 'simd_lane_op'));
  });

  it('resolves a named, non-zero table on an active elem segment', () => {
    const m = roundTrip(`(module
      (table $t0 1 funcref)
      (table $t1 2 funcref)
      (func)
      (elem (table $t1) (i32.const 0) func 0))`);
    assertEquals(m.elemSegments.length, 1);
  });

  it('resolves a named, non-zero memory on an active data segment', () => {
    const m = roundTrip(`(module
      (memory $m0 1)
      (memory $m1 1)
      (data (memory $m1) (i32.const 0) "hi"))`);
    assertEquals(m.dataSegments.length, 1);
  });
});

// ---------------------------------------------------------------------------
// parseLimits detects the i64 index type (memory64)
// ---------------------------------------------------------------------------

describe('parseLimits memory64 index type', () => {
  it('sets is64 for (memory i64 …)', () => {
    const { module, errors } = parseWatModule('(module (memory i64 1))');
    assertEquals(errors.length, 0);
    assertEquals(module.memories[0]?.limits.is64, true);
  });
  it('leaves is64 false for a plain (memory …)', () => {
    const { module } = parseWatModule('(module (memory 1))');
    assertEquals(module.memories[0]?.limits.is64, false);
  });
});

// ---------------------------------------------------------------------------
// try_table fails loud on an unknown catch-kind byte (no silent stream desync)
// ---------------------------------------------------------------------------

describe('try_table unknown catch kind', () => {
  it('reports an error instead of silently desyncing', () => {
    // try_table blocktype=void(0x40), 1 catch, kind byte 0x07 (invalid), then a target.
    // Wrap in a minimal valid module so the code section is reached.
    // 0x1f = try_table opcode.
    const codeExpr = new Uint8Array([0x1f, 0x40, 0x01, 0x07, 0x00, 0x0b]); // try_table … end
    // Build: magic+version, type section (1 empty func type), func section,
    // code section with the bad body.
    const mod = new Uint8Array([
      0x00,
      0x61,
      0x73,
      0x6d,
      0x01,
      0x00,
      0x00,
      0x00, // header
      0x01,
      0x04,
      0x01,
      0x60,
      0x00,
      0x00, // type: () -> ()
      0x03,
      0x02,
      0x01,
      0x00, // func: [type 0]
      0x0a, // code section id
      codeExpr.length + 3, // section size: count(1) + bodysize(1) + body
      0x01, // 1 body
      codeExpr.length + 1, // body size: locals(1) + codeExpr
      0x00, // 0 locals
      ...codeExpr,
    ]);
    const errs = makeErrorList();
    readBinaryIr(mod, errs);
    assert(hasErrors(errs), 'unknown try_table catch kind must produce an error');
    assert(
      formatErrors(errs).includes('catch kind'),
      `expected a "catch kind" error, got: ${formatErrors(errs)}`,
    );
  });
});
