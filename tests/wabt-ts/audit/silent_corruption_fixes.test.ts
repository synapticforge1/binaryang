// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Regression tests for the 2026-06-09 silent-corruption audit (Critical + High
 * findings). Each `describe` block pins one root-cause fix so the bug can't
 * silently return. See cmem/design-decisions.md for the narrative.
 */

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { Opcode, PREFIX_SIMD } from '../../src/core/opcode.ts';
import { WastLexer } from '../../src/parser/wast-lexer.ts';
import type { OpcodeToken } from '../../src/parser/token.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { synthesizeTypes } from '../../src/ir/synthesize-types.ts';
import { validateModule } from '../../src/validator/validator.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { writeBinaryIr } from '../../src/writer/binary-writer.ts';
import { ModuleContext } from '../../src/ir/ir-util.ts';
import { applyNames, makeModuleNames } from '../../src/ir/apply-names.ts';
import { makeModule, varIndex, varName } from '../../src/ir/ir.ts';
import type { CallRefExpr, Func, Module, SimdLaneOpExpr, Table } from '../../src/ir/ir.ts';
import { Type } from '../../src/core/types.ts';
import { ExternalKind } from '../../src/core/binary.ts';
import { hasErrors, makeErrorList, unknownLocation } from '../../src/core/error.ts';

const LOC = unknownLocation();

/** Compile WAT → wasm, then decode it back to IR. Throws on any pipeline error. */
function roundTrip(wat: string): Module {
  const { binary, errors, result } = wat2wasm(wat);
  if (result !== 0 || errors.length > 0) {
    throw new Error(`wat2wasm failed: ${errors.map((e) => e.message).join('; ')}`);
  }
  const errs = makeErrorList();
  const module = readBinaryIr(binary, errs, { readDebugNames: true });
  if (hasErrors(errs)) throw new Error('readBinaryIr failed');
  return module;
}

/** Parse + resolve + synthesize + validate; return whether validation found errors. */
function validateWat(wat: string): boolean {
  const { module, errors } = parseWatModule(wat);
  if (errors.length > 0) throw new Error(`parse failed: ${errors[0]?.message}`);
  resolveNames(module);
  synthesizeTypes(module);
  const errs = makeErrorList();
  validateModule(module, errs);
  return hasErrors(errs);
}

function firstFuncBody(m: Module): Func['body'] {
  const f = m.funcs[0];
  assert(f !== undefined, 'expected a defined function');
  return f.body;
}

// ---------------------------------------------------------------------------
// #1 — SIMD float opcodes in the lexer must match the canonical opcode table
// ---------------------------------------------------------------------------

describe('#1 SIMD float lexer opcodes', () => {
  const cases: Array<[string, number]> = [
    ['f32x4.div', 0xe7],
    ['f32x4.min', 0xe8],
    ['f32x4.pmin', 0xea],
    ['f32x4.ceil', 0x67],
    ['f32x4.nearest', 0x6a],
    ['f64x2.add', 0xf0],
    ['f64x2.pmin', 0xf6],
    ['f64x2.ceil', 0x74],
    ['f64x2.nearest', 0x94],
    ['f64x2.convert_low_i32x4_s', 0xfe],
  ];
  for (const [name, sub] of cases) {
    it(`${name} lexes to 0xfd 0x${sub.toString(16)}`, () => {
      const tok = new WastLexer(name).tokenize()[0] as OpcodeToken;
      assertEquals(tok.opcode as number, (PREFIX_SIMD << 16) | sub);
    });
  }

  it('pmin/pmax no longer collide with the convert opcodes', () => {
    const lex = (s: string) => (new WastLexer(s).tokenize()[0] as OpcodeToken).opcode as number;
    assert(lex('f64x2.pmin') !== lex('f64x2.convert_low_i32x4_s'));
    assert(lex('f64x2.pmax') !== lex('f64x2.convert_low_i32x4_u'));
  });
});

// ---------------------------------------------------------------------------
// #2 — Tag import type index resolved from the signature, not hardcoded to 0
// ---------------------------------------------------------------------------

describe('#2 tag-import type index', () => {
  it('imported tag with a non-first signature round-trips its params', () => {
    // type 0 = (func (param i32)); the imported tag uses (param i64) = type 1.
    const wat = `(module
      (type $a (func (param i32)))
      (import "m" "t" (tag $e (param i64))))`;
    const m = roundTrip(wat);
    const tagImport = m.imports.find((i) => i.kind === ExternalKind.Tag);
    assert(tagImport !== undefined && tagImport.kind === ExternalKind.Tag);
    // If the writer had emitted index 0, the reader would report params [i32].
    assertEquals(tagImport.tag.sig.params, [Type.I64]);
  });
});

// ---------------------------------------------------------------------------
// #3 — v128.store decodes to a store (not load_zero); loadN_splat to load_splat
// ---------------------------------------------------------------------------

describe('#3 SIMD memory-op decode', () => {
  it('v128.store decodes to a store statement (2 operands, void)', () => {
    const m = roundTrip(`(module (memory 1)
      (func (param $p i32) (param $v v128)
        local.get $p local.get $v v128.store))`);
    const body = firstFuncBody(m);
    const store = body.find((e) => e.kind === 'store');
    assert(store !== undefined, 'expected a store, not a load_zero');
  });

  it('v128.load64_splat decodes to load_splat', () => {
    const m = roundTrip(`(module (memory 1)
      (func (result v128) i32.const 0 v128.load64_splat))`);
    const body = firstFuncBody(m);
    assert(
      body.some((e) => e.kind === 'load_splat'),
      'expected a load_splat node',
    );
  });
});

// ---------------------------------------------------------------------------
// #4 — resolveNames resolves call_ref / return_call_ref sigType
// ---------------------------------------------------------------------------

describe('#4 call_ref sigType resolution', () => {
  it('resolves a named, non-first function-type immediate', () => {
    const module = makeModule();
    module.types.push({
      kind: 'func',
      name: 'a',
      sig: { params: [Type.I32], results: [] },
      loc: LOC,
    });
    module.types.push({
      kind: 'func',
      name: 'b',
      sig: { params: [], results: [Type.I32] },
      loc: LOC,
    });
    const callRef: CallRefExpr = {
      kind: 'call_ref',
      sigType: varName('b'),
      args: [],
      callee: { kind: 'nop', loc: LOC },
      loc: LOC,
    };
    const func: Func = {
      name: 'f',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [], results: [Type.I32] },
      localDecls: [],
      body: [callRef],
      tailcall: false,
    };
    module.funcs.push(func);

    resolveNames(module);

    const resolved = module.funcs[0]!.body[0] as CallRefExpr;
    assertEquals(resolved.sigType.kind, 'index');
    assertEquals((resolved.sigType as { value: number }).value, 1);
  });
});

// ---------------------------------------------------------------------------
// #5 — trunc_sat conversions are type-validated (not treated as v128)
// ---------------------------------------------------------------------------

describe('#5 trunc_sat validation', () => {
  it('rejects i32.trunc_sat_f64_s applied to an i32 operand', () => {
    assert(
      validateWat(`(module (func (result i32) i32.const 0 i32.trunc_sat_f64_s))`),
      'wrong operand type should fail validation',
    );
  });
  it('accepts i32.trunc_sat_f64_s applied to an f64 operand', () => {
    assert(
      !validateWat(`(module (func (result i32) f64.const 0 i32.trunc_sat_f64_s))`),
      'correct operand type should validate',
    );
  });
});

// ---------------------------------------------------------------------------
// #6 — multi-catch legacy try preserves every handler body
// ---------------------------------------------------------------------------

describe('#6 multi-catch body decode', () => {
  it('keeps both catch handler bodies on round-trip', () => {
    const m = roundTrip(`(module
      (tag $e1 (param i32))
      (tag $e2 (param i64))
      (func
        try
          nop
        catch $e1
          drop
        catch $e2
          drop
        end))`);
    const body = firstFuncBody(m);
    const tryExpr = body.find((e) => e.kind === 'try');
    assert(tryExpr !== undefined && tryExpr.kind === 'try');
    assertEquals(tryExpr.catches.length, 2);
    // Each catch handler is `drop` (1 instr); the bug left all but the last empty.
    assert(tryExpr.catches[0]!.body.length > 0, 'first catch body lost');
    assert(tryExpr.catches[1]!.body.length > 0, 'second catch body lost');
  });
});

// ---------------------------------------------------------------------------
// #7 — SIMD lane op: arity + validation
// ---------------------------------------------------------------------------

describe('#7 SIMD lane ops', () => {
  it('getExprArity reports 2 for replace_lane, 1 for extract_lane', () => {
    const ctx = new ModuleContext(makeModule());
    const extract: SimdLaneOpExpr = {
      kind: 'simd_lane_op',
      opcode: ((PREFIX_SIMD << 16) | 0x1b) as Opcode, // i32x4.extract_lane
      lane: 0,
      operand: { kind: 'nop', loc: LOC },
      loc: LOC,
    };
    const replace: SimdLaneOpExpr = {
      kind: 'simd_lane_op',
      opcode: ((PREFIX_SIMD << 16) | 0x1c) as Opcode, // i32x4.replace_lane
      lane: 0,
      operand: { kind: 'nop', loc: LOC },
      value: { kind: 'nop', loc: LOC },
      loc: LOC,
    };
    assertEquals(ctx.getExprArity(extract).nargs, 1);
    assertEquals(ctx.getExprArity(replace).nargs, 2);
  });

  it('rejects an out-of-range lane index', () => {
    assert(
      validateWat(
        `(module (func (param v128) (result v128) local.get 0 i32.const 7 i32x4.replace_lane 9))`,
      ),
      'lane 9 is out of range for i32x4 (0..3)',
    );
  });

  it('accepts a valid replace_lane', () => {
    assert(
      !validateWat(
        `(module (func (param v128) (result v128) local.get 0 i32.const 7 i32x4.replace_lane 2))`,
      ),
      'valid replace_lane should validate',
    );
  });
});

// ---------------------------------------------------------------------------
// #8 — wasm2wat uses the central natural-alignment table for SIMD memargs
// ---------------------------------------------------------------------------

describe('#8 SIMD memarg natural alignment', () => {
  it('omits align= when a SIMD load uses its natural alignment', () => {
    const { binary } = wat2wasm(`(module (memory 1)
      (func (result v128) i32.const 0 v128.load64_splat))`);
    const { text } = wasm2wat(binary);
    assert(text.includes('v128.load64_splat'), 'op should round-trip');
    assert(
      !/load64_splat[^\n]*align=/.test(text),
      `natural-aligned SIMD load must not print align=:\n${text}`,
    );
  });
});

// ---------------------------------------------------------------------------
// #9 — applyNames must not rewrite a local index through the function-name map
// ---------------------------------------------------------------------------

describe('#9 applyNames local.get', () => {
  it('leaves local.get index untouched even when a func shares that index', () => {
    const module = makeModule();
    const func: Func = {
      name: 'f',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [Type.I32], results: [Type.I32] },
      localDecls: [],
      body: [
        { kind: 'local.get', var: varIndex(0), loc: LOC },
      ],
      tailcall: false,
    };
    module.funcs.push(func);
    module.types.push({
      kind: 'func',
      name: '',
      sig: { params: [Type.I32], results: [Type.I32] },
      loc: LOC,
    });

    const names = makeModuleNames();
    names.funcNames.set(0, 'f'); // function index 0 is named — must NOT capture local 0

    applyNames(module, names);

    const lg = module.funcs[0]!.body[0] as { var: { kind: string; value?: number } };
    assertEquals(lg.var.kind, 'index');
    assertEquals(lg.var.value, 0);
  });
});

// ---------------------------------------------------------------------------
// #10 — Table initializer expressions survive a binary round-trip
// ---------------------------------------------------------------------------

describe('#10 table init round-trip', () => {
  it('preserves a table (init …) expression through write→read', () => {
    const module = makeModule();
    const func: Func = {
      name: 'f',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [], results: [] },
      localDecls: [],
      body: [{ kind: 'nop', loc: LOC }],
      tailcall: false,
    };
    module.funcs.push(func);
    module.types.push({ kind: 'func', name: '', sig: { params: [], results: [] }, loc: LOC });
    const table: Table = {
      name: '',
      loc: LOC,
      elemType: Type.FuncRef,
      limits: { initial: 1n, max: 1n, isShared: false, is64: false },
      init: [{ kind: 'ref.func', func: varIndex(0), loc: LOC }],
    };
    module.tables.push(table);

    const binary = writeBinaryIr(module);
    const readErrs = makeErrorList();
    const back = readBinaryIr(binary, readErrs);
    assert(!hasErrors(readErrs), 'read should succeed');
    assertEquals(back.tables[0]!.init.length, 1, 'table init expr was dropped');
  });
});
