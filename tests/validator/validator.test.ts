// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { Type } from '../../src/core/types.ts';
import { Opcode } from '../../src/core/opcode.ts';
import { ExternalKind } from '../../src/core/binary.ts';
import { hasErrors, makeErrorList, unknownLocation } from '../../src/core/error.ts';
import type { ErrorList } from '../../src/core/error.ts';

import {
  BLOCK_TYPE_VOID,
  blockTypeValue,
  constF32,
  constI32,
  makeModule,
  varIndex,
} from '../../src/ir/ir.ts';
import type {
  BinaryExpr,
  BlockExpr,
  ConstExpr,
  Expr,
  Func,
  LocalGetExpr,
  LocalSetExpr,
  Module,
  ReturnExpr,
} from '../../src/ir/ir.ts';

import { validateModule } from '../../src/validator/validator.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOC = unknownLocation();

function makeConst32(v: number): ConstExpr {
  return { kind: 'const', value: constI32(v), loc: LOC };
}

function _makeAdd(left: Expr, right: Expr): BinaryExpr {
  return { kind: 'binary', opcode: Opcode.I32Add, left, right, loc: LOC };
}

function makeI32Add(a: Expr, b: Expr): Expr {
  return { kind: 'binary', opcode: Opcode.I32Add, left: a, right: b, loc: LOC };
}

function makeLocalGet(idx: number): LocalGetExpr {
  return { kind: 'local.get', var: varIndex(idx), loc: LOC };
}

function makeLocalSet(idx: number, value: Expr): LocalSetExpr {
  return { kind: 'local.set', var: varIndex(idx), value, loc: LOC };
}

function _makeReturn(value?: Expr): ReturnExpr {
  return value ? { kind: 'return', value, loc: LOC } : { kind: 'return', loc: LOC };
}

function makeFunc(
  params: Type[],
  results: Type[],
  body: Expr[],
  locals: { type: Type; count: number }[] = [],
): Func {
  return {
    name: '',
    loc: LOC,
    typeVar: varIndex(0),
    sig: { params, results },
    localDecls: locals,
    body,
    tailcall: false,
  };
}

/** Builds a minimal module with one func type and one defined function. */
function singleFuncModule(
  params: Type[],
  results: Type[],
  body: Expr[],
  locals: { type: Type; count: number }[] = [],
): Module {
  const m = makeModule();
  m.types.push({ kind: 'func', name: '', sig: { params, results }, loc: LOC });
  m.funcs.push(makeFunc(params, results, body, locals));
  return m;
}

function validate(m: Module): ErrorList {
  const errors = makeErrorList();
  validateModule(m, errors);
  return errors;
}

function isValid(m: Module): boolean {
  return !hasErrors(validate(m));
}
function isInvalid(m: Module): boolean {
  return hasErrors(validate(m));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateModule', () => {
  describe('empty module', () => {
    it('accepts an empty module', () => {
      assertEquals(isValid(makeModule()), true);
    });
  });

  describe('simple arithmetic', () => {
    it('accepts (func (result i32) i32.const 1 i32.const 2 i32.add)', () => {
      const body: Expr[] = [
        makeI32Add(makeConst32(1), makeConst32(2)),
      ];
      assertEquals(isValid(singleFuncModule([], [Type.I32], body)), true);
    });

    it('rejects result type mismatch (func (result i64) i32.const 1)', () => {
      const body: Expr[] = [makeConst32(1)];
      assertEquals(isInvalid(singleFuncModule([], [Type.I64], body)), true);
    });

    it('accepts void function with no return value', () => {
      assertEquals(isValid(singleFuncModule([], [], [])), true);
    });
  });

  describe('local variables', () => {
    it('accepts local.get for a parameter', () => {
      // (func (param i32) (result i32) local.get 0)
      const body: Expr[] = [makeLocalGet(0)];
      assertEquals(isValid(singleFuncModule([Type.I32], [Type.I32], body)), true);
    });

    it('rejects local.get out of range', () => {
      // No locals or params, but we do local.get 0
      const body: Expr[] = [makeLocalGet(0)];
      assertEquals(isInvalid(singleFuncModule([], [Type.I32], body)), true);
    });

    it('accepts local.set with matching type', () => {
      // (func (param i32) local.set 0 (i32.const 42))
      const body: Expr[] = [makeLocalSet(0, makeConst32(42))];
      assertEquals(isValid(singleFuncModule([Type.I32], [], body)), true);
    });

    it('accepts additional local declarations', () => {
      // (func (result i32) (local i32) (local.set 0 (i32.const 5)) (local.get 0))
      const body: Expr[] = [
        makeLocalSet(0, makeConst32(5)),
        makeLocalGet(0),
      ];
      assertEquals(
        isValid(singleFuncModule([], [Type.I32], body, [{ type: Type.I32, count: 1 }])),
        true,
      );
    });
  });

  describe('globals', () => {
    it('accepts global.get for an immutable global', () => {
      const m = makeModule();
      m.types.push({ kind: 'func', name: '', sig: { params: [], results: [Type.I32] }, loc: LOC });
      m.globals.push({
        name: '',
        loc: LOC,
        type: Type.I32,
        mutable: false,
        init: [makeConst32(0)],
      });
      m.funcs.push(makeFunc([], [Type.I32], [
        { kind: 'global.get', var: varIndex(0), loc: LOC },
      ]));
      assertEquals(isValid(m), true);
    });

    it('rejects global.set on immutable global', () => {
      const m = makeModule();
      m.types.push({ kind: 'func', name: '', sig: { params: [], results: [] }, loc: LOC });
      m.globals.push({
        name: '',
        loc: LOC,
        type: Type.I32,
        mutable: false,
        init: [makeConst32(0)],
      });
      m.funcs.push(makeFunc([], [], [
        { kind: 'global.set', var: varIndex(0), value: makeConst32(1), loc: LOC },
      ]));
      assertEquals(isInvalid(m), true);
    });
  });

  describe('exports', () => {
    it('accepts a valid function export', () => {
      const m = singleFuncModule([], [], []);
      m.exports.push({ name: 'main', kind: ExternalKind.Func, var: varIndex(0) });
      assertEquals(isValid(m), true);
    });

    it('rejects duplicate export names', () => {
      const m = singleFuncModule([], [], []);
      m.exports.push({ name: 'main', kind: ExternalKind.Func, var: varIndex(0) });
      m.exports.push({ name: 'main', kind: ExternalKind.Func, var: varIndex(0) });
      assertEquals(isInvalid(m), true);
    });

    it('rejects export with invalid function index', () => {
      const m = singleFuncModule([], [], []);
      m.exports.push({ name: 'bad', kind: ExternalKind.Func, var: varIndex(999) });
      assertEquals(isInvalid(m), true);
    });
  });

  describe('start function', () => {
    it('accepts a valid start function (no params, no results)', () => {
      const m = singleFuncModule([], [], []);
      m.start = varIndex(0);
      assertEquals(isValid(m), true);
    });

    it('rejects start function with params', () => {
      const m = singleFuncModule([Type.I32], [], []);
      m.start = varIndex(0);
      assertEquals(isInvalid(m), true);
    });

    it('rejects start function with results', () => {
      const m = singleFuncModule([], [Type.I32], [makeConst32(0)]);
      m.start = varIndex(0);
      assertEquals(isInvalid(m), true);
    });
  });

  describe('control flow', () => {
    it('accepts a block returning i32', () => {
      const blockBody: Expr[] = [makeConst32(42)];
      const block: BlockExpr = {
        kind: 'block',
        label: '',
        blockType: blockTypeValue(Type.I32),
        body: blockBody,
        loc: LOC,
      };
      assertEquals(isValid(singleFuncModule([], [Type.I32], [block])), true);
    });

    it('accepts unreachable inside block', () => {
      const block: BlockExpr = {
        kind: 'block',
        label: '',
        blockType: BLOCK_TYPE_VOID,
        body: [{ kind: 'unreachable', loc: LOC }],
        loc: LOC,
      };
      assertEquals(isValid(singleFuncModule([], [], [block])), true);
    });

    it('accepts if/else returning i32', () => {
      const ifExpr: Expr = {
        kind: 'if',
        label: '',
        blockType: blockTypeValue(Type.I32),
        cond: makeConst32(1),
        then_: [makeConst32(10)],
        else_: [makeConst32(20)],
        loc: LOC,
      };
      assertEquals(isValid(singleFuncModule([], [Type.I32], [ifExpr])), true);
    });
  });

  describe('br / br_if', () => {
    it('accepts br targeting outer block', () => {
      // block (result i32) br 0 ... end
      const inner: Expr = { kind: 'br', target: varIndex(0), value: makeConst32(5), loc: LOC };
      const block: BlockExpr = {
        kind: 'block',
        label: '',
        blockType: blockTypeValue(Type.I32),
        body: [inner],
        loc: LOC,
      };
      assertEquals(isValid(singleFuncModule([], [Type.I32], [block])), true);
    });
  });

  describe('call instructions', () => {
    it('accepts direct call to a defined function', () => {
      // Two funcs: func0 (result i32) = i32.const 1, func1 () = call func0; drop
      const m = makeModule();
      m.types.push({ kind: 'func', name: '', sig: { params: [], results: [Type.I32] }, loc: LOC });
      m.types.push({ kind: 'func', name: '', sig: { params: [], results: [] }, loc: LOC });
      m.funcs.push({
        name: '',
        loc: LOC,
        typeVar: varIndex(0),
        sig: { params: [], results: [Type.I32] },
        localDecls: [],
        body: [makeConst32(1)],
        tailcall: false,
      });
      m.funcs.push({
        name: '',
        loc: LOC,
        typeVar: varIndex(1),
        sig: { params: [], results: [] },
        localDecls: [],
        body: [
          {
            kind: 'drop',
            value: { kind: 'call', func: varIndex(0), args: [], loc: LOC },
            loc: LOC,
          },
        ],
        tailcall: false,
      });
      assertEquals(isValid(m), true);
    });

    it('rejects call with invalid function index', () => {
      // call 999 — no such function
      const body: Expr[] = [
        {
          kind: 'drop',
          value: { kind: 'call', func: varIndex(999), args: [], loc: LOC },
          loc: LOC,
        },
      ];
      assertEquals(isInvalid(singleFuncModule([], [], body)), true);
    });
  });

  describe('type mismatch errors', () => {
    it('rejects binary op with wrong operand type', () => {
      // i32.const 1.0 (f32) + i32.const 1 → type mismatch for i32.add
      const body: Expr[] = [
        {
          kind: 'binary',
          opcode: Opcode.I32Add,
          left: { kind: 'const', value: constF32(0x3f800000), loc: LOC },
          right: makeConst32(1),
          loc: LOC,
        },
      ];
      assertEquals(isInvalid(singleFuncModule([], [Type.I32], body)), true);
    });
  });

  describe('multiple errors', () => {
    it('collects multiple errors in a single pass', () => {
      const m = singleFuncModule([], [], []);
      m.exports.push({ name: 'dup', kind: ExternalKind.Func, var: varIndex(0) });
      m.exports.push({ name: 'dup', kind: ExternalKind.Func, var: varIndex(0) });
      m.exports.push({ name: 'bad', kind: ExternalKind.Func, var: varIndex(999) });
      const errors = validate(m);
      assertEquals(errors.length >= 2, true);
    });
  });
});
