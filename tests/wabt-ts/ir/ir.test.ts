import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertExists } from '@std/assert';

import { Type } from '../../src/core/types.ts';
import { Result } from '../../src/core/result.ts';
import { Opcode } from '../../src/core/opcode.ts';
import { unknownLocation } from '../../src/core/error.ts';
import { hasErrors, makeErrorList } from '../../src/core/error.ts';

import {
  BLOCK_TYPE_VOID,
  blockTypeFuncType,
  blockTypeValue,
  constF32,
  constF64,
  constI32,
  constI64,
  isVarIndex,
  isVarName,
  makeModule,
  sigEquals,
  totalFuncs,
  totalGlobals,
  varIndex,
  varName,
} from '../../src/ir/ir.ts';
import type { BinaryExpr, ConstExpr, Expr, Func } from '../../src/ir/ir.ts';

import { ExprVisitor, NopDelegate } from '../../src/ir/expr-visitor.ts';
import type { ExprVisitorDelegate } from '../../src/ir/expr-visitor.ts';

import { generateNames, indexToAlphaName, NameOpts } from '../../src/ir/generate-names.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOC = unknownLocation();

function makeConst(value: number): ConstExpr {
  return { kind: 'const', value: constI32(value), loc: LOC };
}

function makeAdd(left: Expr, right: Expr): BinaryExpr {
  return { kind: 'binary', opcode: Opcode.I32Add, left, right, loc: LOC };
}

function makeFuncBody(body: Expr[]): Func {
  return {
    name: '',
    loc: LOC,
    typeVar: varIndex(0),
    sig: { params: [Type.I32, Type.I32], results: [Type.I32] },
    localDecls: [],
    body,
    tailcall: false,
  };
}

// ---------------------------------------------------------------------------
// Var
// ---------------------------------------------------------------------------

describe('Var', () => {
  it('varIndex creates index var', () => {
    const v = varIndex(42);
    assertEquals(v.kind, 'index');
    assertEquals(isVarIndex(v), true);
    if (v.kind === 'index') assertEquals(v.value, 42);
  });

  it('varName creates name var', () => {
    const v = varName('foo');
    assertEquals(v.kind, 'name');
    assertEquals(isVarName(v), true);
    if (v.kind === 'name') assertEquals(v.name, 'foo');
  });

  it('isVarIndex is false for name var', () => {
    assertEquals(isVarIndex(varName('x')), false);
  });

  it('isVarName is false for index var', () => {
    assertEquals(isVarName(varIndex(0)), false);
  });
});

// ---------------------------------------------------------------------------
// BlockType
// ---------------------------------------------------------------------------

describe('BlockType', () => {
  it('BLOCK_TYPE_VOID has kind void', () => assertEquals(BLOCK_TYPE_VOID.kind, 'void'));
  it('blockTypeValue wraps a value type', () => {
    const bt = blockTypeValue(Type.I32);
    assertEquals(bt.kind, 'value');
    if (bt.kind === 'value') assertEquals(bt.type, Type.I32);
  });
  it('blockTypeFuncType wraps a type index', () => {
    const bt = blockTypeFuncType(3);
    assertEquals(bt.kind, 'func_type');
    if (bt.kind === 'func_type') assertEquals(bt.typeIdx, 3);
  });
});

// ---------------------------------------------------------------------------
// Const factories
// ---------------------------------------------------------------------------

describe('Const', () => {
  it('constI32', () => {
    const c = constI32(7);
    assertEquals(c.type, Type.I32);
    if (c.type === Type.I32) assertEquals(c.value, 7);
  });
  it('constI64', () => {
    const c = constI64(9999999999n);
    assertEquals(c.type, Type.I64);
    if (c.type === Type.I64) assertEquals(c.value, 9999999999n);
  });
  it('constF32 stores raw bits', () => {
    const c = constF32(0x3f800000);
    assertEquals(c.type, Type.F32);
    if (c.type === Type.F32) assertEquals(c.bits, 0x3f800000);
  });
  it('constF64 stores raw bits as bigint', () => {
    const c = constF64(0x3ff0000000000000n);
    assertEquals(c.type, Type.F64);
    if (c.type === Type.F64) assertEquals(c.bits, 0x3ff0000000000000n);
  });
});

// ---------------------------------------------------------------------------
// FuncSignature equality
// ---------------------------------------------------------------------------

describe('sigEquals', () => {
  it('equal sigs', () =>
    assertEquals(
      sigEquals({ params: [Type.I32], results: [Type.I64] }, {
        params: [Type.I32],
        results: [Type.I64],
      }),
      true,
    ));
  it('different params', () =>
    assertEquals(
      sigEquals({ params: [Type.I32], results: [] }, { params: [Type.I64], results: [] }),
      false,
    ));
  it('different param count', () =>
    assertEquals(
      sigEquals({ params: [Type.I32, Type.I32], results: [] }, { params: [Type.I32], results: [] }),
      false,
    ));
  it('different results', () =>
    assertEquals(
      sigEquals({ params: [], results: [Type.F32] }, { params: [], results: [Type.F64] }),
      false,
    ));
});

// ---------------------------------------------------------------------------
// makeModule
// ---------------------------------------------------------------------------

describe('makeModule', () => {
  it('produces a zero-filled module', () => {
    const m = makeModule();
    assertEquals(m.types.length, 0);
    assertEquals(m.funcs.length, 0);
    assertEquals(m.imports.length, 0);
    assertEquals(m.exports.length, 0);
    assertEquals(m.numFuncImports, 0);
    assertEquals(m.featuresUsed.simd, false);
    assertEquals(m.start, undefined);
  });

  it('totalFuncs = imports + defined', () => {
    const m = makeModule();
    m.numFuncImports = 2;
    m.funcs.push(makeFuncBody([]));
    assertEquals(totalFuncs(m), 3);
  });

  it('totalGlobals = imports + defined', () => {
    const m = makeModule();
    m.numGlobalImports = 1;
    m.globals.push({ name: 'g', loc: LOC, type: Type.I32, mutable: false, init: [] });
    assertEquals(totalGlobals(m), 2);
  });
});

// ---------------------------------------------------------------------------
// ExprVisitor — visitor traversal order
// ---------------------------------------------------------------------------

describe('ExprVisitor', () => {
  it('visits const leaf', () => {
    const visited: string[] = [];
    const delegate: ExprVisitorDelegate = {
      onConstExpr(_e) {
        visited.push('const');
        return Result.Ok;
      },
    };
    const v = new ExprVisitor(delegate);
    v.visitExpr(makeConst(1));
    assertEquals(visited, ['const']);
  });

  it('visits binary in post-order (children before parent)', () => {
    const visited: string[] = [];
    const delegate: ExprVisitorDelegate = {
      onConstExpr(e) {
        const val = e.value.type === Type.I32 ? e.value.value : '?';
        visited.push(`const:${val}`);
        return Result.Ok;
      },
      onBinaryExpr(_e) {
        visited.push('binary');
        return Result.Ok;
      },
    };
    const v = new ExprVisitor(delegate);
    v.visitExpr(makeAdd(makeConst(1), makeConst(2)));
    assertEquals(visited, ['const:1', 'const:2', 'binary']);
  });

  it('visits block body between Begin/End', () => {
    const visited: string[] = [];
    const delegate: ExprVisitorDelegate = {
      beginBlockExpr(_e) {
        visited.push('begin_block');
        return Result.Ok;
      },
      onConstExpr(_e) {
        visited.push('const');
        return Result.Ok;
      },
      endBlockExpr(_e) {
        visited.push('end_block');
        return Result.Ok;
      },
    };
    const block: Expr = {
      kind: 'block',
      label: '',
      blockType: BLOCK_TYPE_VOID,
      body: [makeConst(42)],
      loc: LOC,
    };
    const v = new ExprVisitor(delegate);
    v.visitExpr(block);
    assertEquals(visited, ['begin_block', 'const', 'end_block']);
  });

  it('if: visits cond, beginIf, then body, afterIfTrue, else body, endIf', () => {
    const visited: string[] = [];
    const delegate: ExprVisitorDelegate = {
      onConstExpr(e) {
        const val = e.value.type === Type.I32 ? e.value.value : '?';
        visited.push(`const:${val}`);
        return Result.Ok;
      },
      beginIfExpr(_e) {
        visited.push('beginIf');
        return Result.Ok;
      },
      afterIfTrueExpr(_e) {
        visited.push('afterIfTrue');
        return Result.Ok;
      },
      endIfExpr(_e) {
        visited.push('endIf');
        return Result.Ok;
      },
    };
    const ifExpr: Expr = {
      kind: 'if',
      label: '',
      blockType: BLOCK_TYPE_VOID,
      cond: makeConst(0),
      then_: [makeConst(1)],
      else_: [makeConst(2)],
      loc: LOC,
    };
    const v = new ExprVisitor(delegate);
    v.visitExpr(ifExpr);
    assertEquals(visited, ['const:0', 'beginIf', 'const:1', 'afterIfTrue', 'const:2', 'endIf']);
  });

  it('abort: delegate returning Error stops traversal', () => {
    let count = 0;
    const delegate: ExprVisitorDelegate = {
      onConstExpr(_e) {
        count++;
        return Result.Error;
      },
    };
    const v = new ExprVisitor(delegate);
    const r = v.visitExprList([makeConst(1), makeConst(2), makeConst(3)]);
    assertEquals(r, Result.Error);
    assertEquals(count, 1);
  });

  it('visitFunc visits function body', () => {
    const visited: string[] = [];
    const delegate: ExprVisitorDelegate = {
      onConstExpr(_e) {
        visited.push('const');
        return Result.Ok;
      },
    };
    const func = makeFuncBody([makeConst(5), makeConst(6)]);
    const v = new ExprVisitor(delegate);
    v.visitFunc(func);
    assertEquals(visited, ['const', 'const']);
  });

  it('NopDelegate completes without error', () => {
    const v = new ExprVisitor(new NopDelegate());
    const r = v.visitExpr(makeAdd(makeConst(1), makeConst(2)));
    assertEquals(r, Result.Ok);
  });
});

// ---------------------------------------------------------------------------
// generateNames
// ---------------------------------------------------------------------------

describe('generateNames', () => {
  it('generates numeric names by default (with leading $)', () => {
    const m = makeModule();
    m.funcs.push(makeFuncBody([]));
    m.funcs.push(makeFuncBody([]));
    generateNames(m);
    assertEquals(m.funcs[0]?.name, '$f0');
    assertEquals(m.funcs[1]?.name, '$f1');
  });

  it('leaves pre-existing names unchanged', () => {
    const m = makeModule();
    const f = makeFuncBody([]);
    f.name = 'my_func';
    m.funcs.push(f);
    generateNames(m);
    assertEquals(m.funcs[0]?.name, 'my_func');
  });

  it('generates global names', () => {
    const m = makeModule();
    m.globals.push({ name: '', loc: LOC, type: Type.I32, mutable: false, init: [] });
    generateNames(m);
    assertEquals(m.globals[0]?.name, '$g0');
  });

  it('alpha names: indexToAlphaName base cases', () => {
    assertEquals(indexToAlphaName(0), 'a');
    assertEquals(indexToAlphaName(25), 'z');
    assertEquals(indexToAlphaName(26), 'aa');
    assertEquals(indexToAlphaName(27), 'ba');
  });

  it('AlphaNames option uses alpha scheme (with $ + namespace prefix)', () => {
    const m = makeModule();
    m.funcs.push(makeFuncBody([]));
    generateNames(m, NameOpts.AlphaNames);
    assertEquals(m.funcs[0]?.name, '$fa');
  });
});

// ---------------------------------------------------------------------------
// resolveNames
// ---------------------------------------------------------------------------

describe('resolveNames', () => {
  it('resolves named func var in call', () => {
    const m = makeModule();
    const callee = makeFuncBody([]);
    callee.name = 'add';
    m.funcs.push(callee);

    const callExpr: Expr = {
      kind: 'call',
      func: varName('add'),
      args: [],
      loc: LOC,
    };
    const caller = makeFuncBody([callExpr]);
    m.funcs.push(caller);

    const errors = makeErrorList();
    const r = resolveNames(m, errors);
    assertEquals(r, Result.Ok);
    assertEquals(hasErrors(errors), false);

    const resolved = m.funcs[1]?.body[0];
    assertExists(resolved);
    if (resolved.kind === 'call') {
      assertEquals(resolved.func.kind, 'index');
      if (resolved.func.kind === 'index') assertEquals(resolved.func.value, 0);
    }
  });

  it('reports error for undefined name', () => {
    const m = makeModule();
    const callExpr: Expr = {
      kind: 'call',
      func: varName('nonexistent'),
      args: [],
      loc: LOC,
    };
    m.funcs.push(makeFuncBody([callExpr]));

    const errors = makeErrorList();
    const r = resolveNames(m, errors);
    assertEquals(r, Result.Error);
    assertEquals(hasErrors(errors), true);
    assertEquals(errors[0]?.message.includes('nonexistent'), true);
  });

  it('index vars pass through unchanged', () => {
    const m = makeModule();
    m.funcs.push(makeFuncBody([]));
    const callExpr: Expr = {
      kind: 'call',
      func: varIndex(0),
      args: [],
      loc: LOC,
    };
    m.funcs.push(makeFuncBody([callExpr]));

    const errors = makeErrorList();
    const r = resolveNames(m, errors);
    assertEquals(r, Result.Ok);
    const resolved = m.funcs[1]?.body[0];
    assertExists(resolved);
    if (resolved.kind === 'call' && resolved.func.kind === 'index') {
      assertEquals(resolved.func.value, 0);
    }
  });
});
