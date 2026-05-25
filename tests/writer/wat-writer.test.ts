// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertStringIncludes } from '@std/assert';

import { Type } from '../../src/core/types.ts';
import { ExternalKind } from '../../src/core/binary.ts';
import { Opcode } from '../../src/core/opcode.ts';
import { unknownLocation } from '../../src/core/error.ts';
import {
  varIndex, varName,
  BLOCK_TYPE_VOID,
  constI32, constI64, constF32,
  makeModule,
} from '../../src/ir/ir.ts';
import type { Func, Global, Memory, Table, DataSegment, ElemSegment, Expr } from '../../src/ir/ir.ts';
import { writeWatModule } from '../../src/writer/wat-writer.ts';

const LOC = unknownLocation();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFunc(opts: {
  name?: string;
  params?: Type[];
  results?: Type[];
  body?: Expr[];
}): Func {
  return {
    name: opts.name ?? '',
    loc: LOC,
    typeVar: varIndex(0),
    sig: { params: opts.params ?? [], results: opts.results ?? [] },
    localDecls: [],
    body: opts.body ?? [],
    tailcall: false,
  };
}

function makeGlobal(type: Type, mutable: boolean, initValue: number): Global {
  return {
    name: '',
    loc: LOC,
    type,
    mutable,
    init: [{ kind: 'const', value: constI32(initValue), loc: LOC }],
  };
}

function makeMemory(initial: number, max?: number): Memory {
  return {
    name: '',
    loc: LOC,
    limits: max !== undefined
      ? { initial, max, isShared: false, is64: false }
      : { initial, isShared: false, is64: false },
  };
}

function makeTable(initial: number): Table {
  return {
    name: '',
    loc: LOC,
    elemType: Type.FuncRef,
    limits: { initial, isShared: false, is64: false },
    init: [],
  };
}

// ---------------------------------------------------------------------------
// Empty module
// ---------------------------------------------------------------------------

describe('writeWatModule — empty module', () => {
  it('produces (module) for an empty module', () => {
    const m = makeModule();
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(module');
    assertStringIncludes(wat, ')');
  });

  it('includes module name when set', () => {
    const m = makeModule();
    m.name = '$mymod';
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '$mymod');
  });
});

// ---------------------------------------------------------------------------
// Type entries
// ---------------------------------------------------------------------------

describe('writeWatModule — type entries', () => {
  it('writes a func type entry', () => {
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      loc: LOC,
      sig: { params: [Type.I32, Type.I64], results: [Type.F64] },
    });
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(type');
    assertStringIncludes(wat, '(func');
    assertStringIncludes(wat, '(param i32 i64)');
    assertStringIncludes(wat, '(result f64)');
  });
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

describe('writeWatModule — imports', () => {
  it('writes a standalone func import', () => {
    const m = makeModule();
    m.imports.push({
      kind: ExternalKind.Func,
      module: 'env',
      field: 'log',
      func: makeFunc({ params: [Type.I32], results: [] }),
    });
    m.numFuncImports = 1;
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(import "env" "log"');
    assertStringIncludes(wat, '(func');
    assertStringIncludes(wat, '(param i32)');
  });

  it('writes a standalone memory import', () => {
    const m = makeModule();
    m.imports.push({
      kind: ExternalKind.Memory,
      module: 'env',
      field: 'mem',
      memory: makeMemory(1, 10),
    });
    m.numMemoryImports = 1;
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(import "env" "mem"');
    assertStringIncludes(wat, '(memory');
  });
});

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

describe('writeWatModule — functions', () => {
  it('writes an empty void function', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({}));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(func');
    assertStringIncludes(wat, '(;0;)');
  });

  it('writes function with params and result', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({ params: [Type.I32, Type.I32], results: [Type.I32] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(param i32 i32)');
    assertStringIncludes(wat, '(result i32)');
  });

  it('writes a named function', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({ name: '$add' }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '$add');
  });

  it('writes i32.const instruction', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({
      results: [Type.I32],
      body: [{ kind: 'const', value: constI32(42), loc: LOC }],
    }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'i32.const');
    assertStringIncludes(wat, '42');
  });

  it('writes i64.const instruction', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({
      results: [Type.I64],
      body: [{ kind: 'const', value: constI64(0x123456789an), loc: LOC }],
    }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'i64.const');
    assertStringIncludes(wat, '78187493530');
  });

  it('writes f32.const instruction', () => {
    const m = makeModule();
    // bit pattern for 1.0f: 0x3f800000
    m.funcs.push(makeFunc({
      results: [Type.F32],
      body: [{ kind: 'const', value: constF32(0x3f800000), loc: LOC }],
    }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'f32.const');
    assertStringIncludes(wat, '0x1.0p+0');
  });

  it('writes binary expression (local.get + i32.add)', () => {
    const m = makeModule();
    const left: Expr = { kind: 'local.get', var: varIndex(0), loc: LOC };
    const right: Expr = { kind: 'local.get', var: varIndex(1), loc: LOC };
    const add: Expr = { kind: 'binary', opcode: Opcode.I32Add, left, right, loc: LOC };
    m.funcs.push(makeFunc({
      params: [Type.I32, Type.I32],
      results: [Type.I32],
      body: [add],
    }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'local.get 0');
    assertStringIncludes(wat, 'local.get 1');
    assertStringIncludes(wat, 'i32.add');
  });

  it('local.get appears before i32.add (post-order)', () => {
    const m = makeModule();
    const left: Expr = { kind: 'local.get', var: varIndex(0), loc: LOC };
    const right: Expr = { kind: 'local.get', var: varIndex(1), loc: LOC };
    const add: Expr = { kind: 'binary', opcode: Opcode.I32Add, left, right, loc: LOC };
    m.funcs.push(makeFunc({
      params: [Type.I32, Type.I32],
      results: [Type.I32],
      body: [add],
    }));
    const wat = writeWatModule(m);
    const idxGet0 = wat.indexOf('local.get 0');
    const idxGet1 = wat.indexOf('local.get 1');
    const idxAdd = wat.indexOf('i32.add');
    assertEquals(idxGet0 < idxAdd, true);
    assertEquals(idxGet1 < idxAdd, true);
  });

  it('writes nop instruction', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({ body: [{ kind: 'nop', loc: LOC }] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'nop');
  });

  it('writes unreachable instruction', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({ body: [{ kind: 'unreachable', loc: LOC }] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'unreachable');
  });

  it('writes block expression', () => {
    const m = makeModule();
    const block: Expr = {
      kind: 'block',
      label: '$blk',
      blockType: BLOCK_TYPE_VOID,
      body: [{ kind: 'nop', loc: LOC }],
      loc: LOC,
    };
    m.funcs.push(makeFunc({ body: [block] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'block $blk');
    assertStringIncludes(wat, 'nop');
    assertStringIncludes(wat, 'end');
  });

  it('writes if expression', () => {
    const m = makeModule();
    const cond: Expr = { kind: 'const', value: constI32(1), loc: LOC };
    const ifExpr: Expr = {
      kind: 'if',
      label: '',
      blockType: BLOCK_TYPE_VOID,
      cond,
      then_: [{ kind: 'nop', loc: LOC }],
      else_: [],
      loc: LOC,
    };
    m.funcs.push(makeFunc({ body: [ifExpr] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'if');
    assertStringIncludes(wat, 'nop');
    assertStringIncludes(wat, 'end');
  });

  it('writes if/else expression', () => {
    const m = makeModule();
    const cond: Expr = { kind: 'local.get', var: varIndex(0), loc: LOC };
    const nop: Expr = { kind: 'nop', loc: LOC };
    const unr: Expr = { kind: 'unreachable', loc: LOC };
    const ifExpr: Expr = {
      kind: 'if',
      label: '',
      blockType: BLOCK_TYPE_VOID,
      cond,
      then_: [nop],
      else_: [unr],
      loc: LOC,
    };
    m.funcs.push(makeFunc({ params: [Type.I32], body: [ifExpr] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'if');
    assertStringIncludes(wat, 'else');
    assertStringIncludes(wat, 'unreachable');
    assertStringIncludes(wat, 'end');
  });

  it('writes call instruction', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({}));
    m.funcs.push(makeFunc({
      body: [{ kind: 'call', func: varIndex(0), args: [], loc: LOC }],
    }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'call');
  });
});

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

describe('writeWatModule — globals', () => {
  it('writes an immutable global', () => {
    const m = makeModule();
    m.globals.push(makeGlobal(Type.I32, false, 0));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(global');
    assertStringIncludes(wat, 'i32');
    assertStringIncludes(wat, 'i32.const');
  });

  it('writes a mutable global with (mut)', () => {
    const m = makeModule();
    m.globals.push(makeGlobal(Type.I64, true, 100));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(mut i64)');
    assertStringIncludes(wat, '100');
  });
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe('writeWatModule — tables', () => {
  it('writes a table', () => {
    const m = makeModule();
    m.tables.push(makeTable(10));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(table');
    assertStringIncludes(wat, '10');
    assertStringIncludes(wat, 'funcref');
  });
});

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

describe('writeWatModule — memories', () => {
  it('writes a memory with initial pages only', () => {
    const m = makeModule();
    m.memories.push(makeMemory(1));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(memory');
    assertStringIncludes(wat, '1');
  });

  it('writes a memory with max pages', () => {
    const m = makeModule();
    m.memories.push(makeMemory(1, 256));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '256');
  });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

describe('writeWatModule — exports', () => {
  it('writes a standalone export when inlineExport=false', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({}));
    m.exports.push({ name: 'main', kind: ExternalKind.Func, var: varIndex(0) });
    const wat = writeWatModule(m, { inlineExport: false });
    assertStringIncludes(wat, '(export "main"');
    assertStringIncludes(wat, '(func 0)');
  });

  it('writes inline export when inlineExport=true', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({}));
    m.exports.push({ name: 'main', kind: ExternalKind.Func, var: varIndex(0) });
    const wat = writeWatModule(m, { inlineExport: true });
    // inline export appears inside the func declaration
    assertStringIncludes(wat, '(export "main")');
    const funcIdx = wat.indexOf('(func');
    const expIdx = wat.indexOf('(export "main")');
    assertEquals(expIdx > funcIdx, true);
  });

  it('standalone export does not appear when inlined', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({}));
    m.exports.push({ name: 'run', kind: ExternalKind.Func, var: varIndex(0) });
    const wat = writeWatModule(m, { inlineExport: true });
    // The standalone (export "run" (func ...)) form should NOT appear
    const standalonePattern = '(export "run" (func';
    assertEquals(wat.includes(standalonePattern), false);
  });
});

// ---------------------------------------------------------------------------
// Start function
// ---------------------------------------------------------------------------

describe('writeWatModule — start', () => {
  it('writes a start function', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({}));
    m.start = varIndex(0);
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(start');
    assertStringIncludes(wat, '0');
  });
});

// ---------------------------------------------------------------------------
// Data segments
// ---------------------------------------------------------------------------

describe('writeWatModule — data segments', () => {
  it('writes an active data segment', () => {
    const m = makeModule();
    m.memories.push(makeMemory(1));
    const seg: DataSegment = {
      name: '',
      loc: LOC,
      kind: 'active',
      memoryVar: varIndex(0),
      offset: [{ kind: 'const', value: constI32(0), loc: LOC }],
      data: new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]), // "hello"
    };
    m.dataSegments.push(seg);
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(data');
    assertStringIncludes(wat, '"hello"');
  });

  it('writes a passive data segment', () => {
    const m = makeModule();
    const seg: DataSegment = {
      name: '',
      loc: LOC,
      kind: 'passive',
      memoryVar: varIndex(0),
      offset: [],
      data: new Uint8Array([0x61, 0x62, 0x63]), // "abc"
    };
    m.dataSegments.push(seg);
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(data');
    assertStringIncludes(wat, '"abc"');
  });
});

// ---------------------------------------------------------------------------
// Element segments
// ---------------------------------------------------------------------------

describe('writeWatModule — element segments', () => {
  it('writes an active elem segment with func shorthand', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({}));
    m.tables.push(makeTable(1));
    const refExpr: Expr = { kind: 'ref.func', func: varIndex(0), loc: LOC };
    const seg: ElemSegment = {
      name: '',
      loc: LOC,
      kind: 'active',
      tableVar: varIndex(0),
      offset: [{ kind: 'const', value: constI32(0), loc: LOC }],
      elemType: Type.FuncRef,
      elemExprs: [[refExpr]],
    };
    m.elemSegments.push(seg);
    const wat = writeWatModule(m);
    assertStringIncludes(wat, '(elem');
    assertStringIncludes(wat, 'func');
  });
});

// ---------------------------------------------------------------------------
// Memory instructions (load/store alignment)
// ---------------------------------------------------------------------------

describe('writeWatModule — memory instructions', () => {
  it('writes i32.load with natural alignment (no align keyword)', () => {
    const m = makeModule();
    m.memories.push(makeMemory(1));
    const addr: Expr = { kind: 'local.get', var: varIndex(0), loc: LOC };
    const load: Expr = {
      kind: 'load',
      opcode: Opcode.I32Load,
      offset: 0n,
      align: 4,  // natural align for i32.load
      memidx: varIndex(0),
      address: addr,
      loc: LOC,
    };
    m.funcs.push(makeFunc({ params: [Type.I32], results: [Type.I32], body: [load] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'i32.load');
    // natural alignment should not produce an `align=` keyword
    assertEquals(wat.includes('align='), false);
  });

  it('writes i32.load with non-natural alignment', () => {
    const m = makeModule();
    m.memories.push(makeMemory(1));
    const addr: Expr = { kind: 'local.get', var: varIndex(0), loc: LOC };
    const load: Expr = {
      kind: 'load',
      opcode: Opcode.I32Load,
      offset: 0n,
      align: 1,  // non-natural for i32.load (natural is 4)
      memidx: varIndex(0),
      address: addr,
      loc: LOC,
    };
    m.funcs.push(makeFunc({ params: [Type.I32], results: [Type.I32], body: [load] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'i32.load');
    assertStringIncludes(wat, 'align=1');
  });

  it('writes i32.load with offset', () => {
    const m = makeModule();
    m.memories.push(makeMemory(1));
    const addr: Expr = { kind: 'local.get', var: varIndex(0), loc: LOC };
    const load: Expr = {
      kind: 'load',
      opcode: Opcode.I32Load,
      offset: 8n,
      align: 4,
      memidx: varIndex(0),
      address: addr,
      loc: LOC,
    };
    m.funcs.push(makeFunc({ params: [Type.I32], results: [Type.I32], body: [load] }));
    const wat = writeWatModule(m);
    assertStringIncludes(wat, 'offset=8');
  });
});

// ---------------------------------------------------------------------------
// Section ordering
// ---------------------------------------------------------------------------

describe('writeWatModule — section ordering', () => {
  it('emits imports before funcs', () => {
    const m = makeModule();
    m.imports.push({
      kind: ExternalKind.Func,
      module: 'env',
      field: 'log',
      func: makeFunc({}),
    });
    m.numFuncImports = 1;
    m.funcs.push(makeFunc({ name: '$defined' }));
    const wat = writeWatModule(m);
    const importIdx = wat.indexOf('(import');
    const definedIdx = wat.indexOf('$defined');
    assertEquals(importIdx < definedIdx, true);
  });

  it('emits exports after funcs', () => {
    const m = makeModule();
    m.funcs.push(makeFunc({ name: '$f' }));
    m.exports.push({ name: 'f', kind: ExternalKind.Func, var: varName('$f') });
    const wat = writeWatModule(m, { inlineExport: false });
    const funcIdx = wat.indexOf('$f');
    const expIdx = wat.indexOf('(export "f"');
    assertEquals(funcIdx < expIdx, true);
  });
});
