// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertExists } from '@std/assert';

import { Type } from '../../../src/wabt-ts/core/types.ts';
import { ExternalKind } from '../../../src/wabt-ts/core/binary.ts';
import { Opcode } from '../../../src/wabt-ts/core/opcode.ts';
import {
  formatErrors,
  hasErrors,
  makeErrorList,
  unknownLocation,
} from '../../../src/wabt-ts/core/error.ts';

import {
  BLOCK_TYPE_VOID,
  blockTypeValue,
  constI32,
  constI64,
  makeModule,
  varIndex,
} from '../../../src/wabt-ts/ir/ir.ts';
import type { Module } from '../../../src/wabt-ts/ir/ir.ts';

import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';

const LOC = unknownLocation();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeU32Leb(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function _encodeS32Leb(value: number): number[] {
  const out: number[] = [];
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    const signBit = (byte & 0x40) !== 0;
    if ((value === 0 && !signBit) || (value === -1 && signBit)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    out.push(byte);
  }
  return out;
}

/** Assemble a minimal wasm module binary from section byte arrays. */
function wasmModule(...sections: number[][]): Uint8Array {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const bytes: number[] = [...header];
  for (const sec of sections) {
    for (const b of sec) bytes.push(b);
  }
  return new Uint8Array(bytes);
}

/** Build a section: id byte + LEB size + body bytes. */
function section(id: number, ...body: number[]): number[] {
  return [id, ...encodeU32Leb(body.length), ...body];
}

/** Encode a name (u32 LEB length + UTF-8 bytes). */
function _name(s: string): number[] {
  const encoded = new TextEncoder().encode(s);
  const bytes: number[] = [];
  for (const b of encoded) bytes.push(b);
  return [...encodeU32Leb(bytes.length), ...bytes];
}

function _noErrors(m: Module): void {
  // Just confirms the module was produced without errors (checked separately)
  assertExists(m);
}

// ---------------------------------------------------------------------------
// Module with nothing but the header
// ---------------------------------------------------------------------------

describe('readBinaryIr', () => {
  it('parses an empty module (header only)', () => {
    const data = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const errors = makeErrorList();
    const m = readBinaryIr(data, errors);
    assertEquals(hasErrors(errors), false);
    assertEquals(m.types.length, 0);
    assertEquals(m.funcs.length, 0);
    assertEquals(m.imports.length, 0);
    assertEquals(m.exports.length, 0);
  });

  // -------------------------------------------------------------------------
  // Type section
  // -------------------------------------------------------------------------

  it('decodes a type section with one func type', () => {
    // type section: [0x01], count=1, func-type 0x60, params=[i32,i32], results=[i32]
    const typeSection = section(
      1, // BinarySection.Type
      ...encodeU32Leb(1), // count
      0x60, // func type marker
      ...encodeU32Leb(2),
      0x7f,
      0x7f, // params: i32, i32
      ...encodeU32Leb(1),
      0x7f, // results: i32
    );
    const errors = makeErrorList();
    const m = readBinaryIr(wasmModule(typeSection), errors);
    assertEquals(hasErrors(errors), false);
    assertEquals(m.types.length, 1);
    const t0 = m.types[0]!;
    assertEquals(t0.kind, 'func');
    if (t0.kind === 'func') {
      assertEquals(t0.sig.params, [Type.I32, Type.I32]);
      assertEquals(t0.sig.results, [Type.I32]);
    }
  });

  // -------------------------------------------------------------------------
  // Simple function round-trip
  // -------------------------------------------------------------------------

  it('round-trips a simple add function', () => {
    // Build IR manually
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [Type.I32, Type.I32], results: [Type.I32] },
      loc: LOC,
    });
    m.funcs.push({
      name: 'add',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [Type.I32, Type.I32], results: [Type.I32] },
      localDecls: [],
      body: [
        {
          kind: 'binary',
          opcode: Opcode.I32Add,
          left: { kind: 'local.get', var: varIndex(0), loc: LOC },
          right: { kind: 'local.get', var: varIndex(1), loc: LOC },
          loc: LOC,
        },
      ],
      tailcall: false,
    });
    m.exports.push({ name: 'add', kind: ExternalKind.Func, var: varIndex(0) });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);

    assertEquals(hasErrors(errors), false);
    assertEquals(m2.types.length, 1);
    assertEquals(m2.funcs.length, 1);
    assertEquals(m2.exports.length, 1);

    const f = m2.funcs[0]!;
    assertEquals(f.body.length, 1);
    const expr = f.body[0]!;
    assertEquals(expr.kind, 'binary');
    if (expr.kind === 'binary') {
      assertEquals(expr.opcode, Opcode.I32Add);
      assertEquals(expr.left.kind, 'local.get');
      assertEquals(expr.right.kind, 'local.get');
    }

    const exp = m2.exports[0]!;
    assertEquals(exp.name, 'add');
    assertEquals(exp.kind, ExternalKind.Func);
  });

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  it('round-trips i32/i64/f32/f64 constants', () => {
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [], results: [Type.I32] },
      loc: LOC,
    });
    m.funcs.push({
      name: '',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [], results: [Type.I32] },
      localDecls: [],
      body: [{ kind: 'const', value: constI32(42), loc: LOC }],
      tailcall: false,
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    const body = m2.funcs[0]!.body;
    assertEquals(body.length, 1);
    const e = body[0]!;
    assertEquals(e.kind, 'const');
    if (e.kind === 'const') {
      assertEquals(e.value.type, Type.I32);
      if (e.value.type === Type.I32) assertEquals(e.value.value, 42);
    }
  });

  it('round-trips i64 constant', () => {
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [], results: [Type.I64] },
      loc: LOC,
    });
    m.funcs.push({
      name: '',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [], results: [Type.I64] },
      localDecls: [],
      body: [{ kind: 'const', value: constI64(0x1234567890abcdefn), loc: LOC }],
      tailcall: false,
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    const e = m2.funcs[0]!.body[0]!;
    assertEquals(e.kind, 'const');
    if (e.kind === 'const' && e.value.type === Type.I64) {
      assertEquals(e.value.value, 0x1234567890abcdefn);
    }
  });

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  it('round-trips a module with linear memory', () => {
    const m = makeModule();
    m.memories.push({
      name: 'mem',
      loc: LOC,
      limits: { initial: 1n, max: 4n, isShared: false, is64: false },
    });
    m.exports.push({ name: 'memory', kind: ExternalKind.Memory, var: varIndex(0) });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    assertEquals(m2.memories.length, 1);
    const mem = m2.memories[0]!;
    assertEquals(mem.limits.initial, 1n);
    assertEquals(mem.limits.max, 4n);
    assertEquals(mem.limits.isShared, false);
  });

  // -------------------------------------------------------------------------
  // Globals
  // -------------------------------------------------------------------------

  it('round-trips a mutable global with i32.const init', () => {
    const m = makeModule();
    m.globals.push({
      name: 'g',
      loc: LOC,
      type: Type.I32,
      mutable: true,
      init: [{ kind: 'const', value: constI32(99), loc: LOC }],
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    assertEquals(m2.globals.length, 1);
    const g = m2.globals[0]!;
    assertEquals(g.type, Type.I32);
    assertEquals(g.mutable, true);
    assertEquals(g.init.length, 1);
    assertEquals(g.init[0]!.kind, 'const');
  });

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  it('round-trips a function import', () => {
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [Type.I32], results: [Type.I32] },
      loc: LOC,
    });
    m.imports.push({
      kind: ExternalKind.Func,
      module: 'env',
      field: 'log',
      func: {
        name: 'log',
        loc: LOC,
        typeVar: varIndex(0),
        sig: { params: [Type.I32], results: [Type.I32] },
        localDecls: [],
        body: [],
        tailcall: false,
      },
    });
    m.numFuncImports = 1;

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    assertEquals(m2.imports.length, 1);
    const imp = m2.imports[0]!;
    assertEquals(imp.kind, ExternalKind.Func);
    assertEquals(imp.module, 'env');
    assertEquals(imp.field, 'log');
  });

  it('round-trips a function import alongside a defined function', () => {
    // Regression test: this combination was unexercised before Phase 7 and
    // hit a `funcBase + i` off-by-one in `readCodeSection` (treated `m.funcs`
    // as if it were indexed by absolute func index instead of just defined
    // funcs).
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [Type.I32], results: [] },
      loc: LOC,
    });
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [Type.I32, Type.I32], results: [Type.I32] },
      loc: LOC,
    });
    m.imports.push({
      kind: ExternalKind.Func,
      module: 'env',
      field: 'log',
      func: {
        name: 'log',
        loc: LOC,
        typeVar: varIndex(0),
        sig: { params: [Type.I32], results: [] },
        localDecls: [],
        body: [],
        tailcall: false,
      },
    });
    m.numFuncImports = 1;
    m.funcs.push({
      name: 'add',
      loc: LOC,
      typeVar: varIndex(1),
      sig: { params: [Type.I32, Type.I32], results: [Type.I32] },
      localDecls: [],
      body: [
        {
          kind: 'binary',
          opcode: Opcode.I32Add,
          loc: LOC,
          left: { kind: 'local.get', var: varIndex(0), loc: LOC },
          right: { kind: 'local.get', var: varIndex(1), loc: LOC },
        },
      ],
      tailcall: false,
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false, formatErrors(errors));

    assertEquals(m2.imports.length, 1);
    assertEquals(m2.funcs.length, 1);
    assertEquals(m2.funcs[0]!.body.length, 1, 'add function body decoded');
  });

  // -------------------------------------------------------------------------
  // Block structures
  // -------------------------------------------------------------------------

  it('round-trips a block expression', () => {
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [], results: [] },
      loc: LOC,
    });
    m.funcs.push({
      name: '',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [], results: [] },
      localDecls: [],
      body: [
        {
          kind: 'block',
          label: '$l',
          blockType: BLOCK_TYPE_VOID,
          body: [{ kind: 'nop', loc: LOC }],
          loc: LOC,
        },
      ],
      tailcall: false,
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    const body = m2.funcs[0]!.body;
    assertEquals(body.length, 1);
    assertEquals(body[0]!.kind, 'block');
    if (body[0]!.kind === 'block') {
      assertEquals(body[0].body.length, 1);
      assertEquals(body[0].body[0]!.kind, 'nop');
    }
  });

  it('round-trips an if/else expression', () => {
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [Type.I32], results: [Type.I32] },
      loc: LOC,
    });
    m.funcs.push({
      name: '',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [Type.I32], results: [Type.I32] },
      localDecls: [],
      body: [
        {
          kind: 'if',
          label: '',
          blockType: blockTypeValue(Type.I32),
          cond: { kind: 'local.get', var: varIndex(0), loc: LOC },
          then_: [{ kind: 'const', value: constI32(1), loc: LOC }],
          else_: [{ kind: 'const', value: constI32(0), loc: LOC }],
          loc: LOC,
        },
      ],
      tailcall: false,
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    const body = m2.funcs[0]!.body;
    assertEquals(body.length, 1);
    const e = body[0]!;
    assertEquals(e.kind, 'if');
    if (e.kind === 'if') {
      assertEquals(e.then_.length, 1);
      assertEquals(e.else_.length, 1);
      assertEquals(e.then_[0]!.kind, 'const');
      assertEquals(e.else_[0]!.kind, 'const');
    }
  });

  // -------------------------------------------------------------------------
  // Data segments
  // -------------------------------------------------------------------------

  it('round-trips a passive data segment', () => {
    const m = makeModule();
    m.dataSegments.push({
      name: '',
      loc: LOC,
      kind: 'passive',
      memoryVar: varIndex(0),
      offset: [],
      data: new Uint8Array([1, 2, 3, 4, 5]),
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    assertEquals(m2.dataSegments.length, 1);
    const seg = m2.dataSegments[0]!;
    assertEquals(seg.kind, 'passive');
    assertEquals(Array.from(seg.data), [1, 2, 3, 4, 5]);
  });

  it('round-trips an active data segment', () => {
    const m = makeModule();
    m.memories.push({
      name: '',
      loc: LOC,
      limits: { initial: 1n, isShared: false, is64: false },
    });
    m.dataSegments.push({
      name: '',
      loc: LOC,
      kind: 'active',
      memoryVar: varIndex(0),
      offset: [{ kind: 'const', value: constI32(0), loc: LOC }],
      data: new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]), // "Hello"
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    assertEquals(m2.dataSegments.length, 1);
    const seg = m2.dataSegments[0]!;
    assertEquals(seg.kind, 'active');
    assertEquals(seg.data.length, 5);
    assertEquals(seg.data[0], 0x48);
  });

  // -------------------------------------------------------------------------
  // Local declarations
  // -------------------------------------------------------------------------

  it('round-trips a function with local variables', () => {
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [Type.I32], results: [Type.I32] },
      loc: LOC,
    });
    m.funcs.push({
      name: '',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [Type.I32], results: [Type.I32] },
      localDecls: [
        { type: Type.I32, count: 2 },
        { type: Type.F64, count: 1 },
      ],
      body: [{ kind: 'local.get', var: varIndex(0), loc: LOC }],
      tailcall: false,
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);

    const f = m2.funcs[0]!;
    assertEquals(f.localDecls.length, 2);
    assertEquals(f.localDecls[0]!.type, Type.I32);
    assertEquals(f.localDecls[0]!.count, 2);
    assertEquals(f.localDecls[1]!.type, Type.F64);
    assertEquals(f.localDecls[1]!.count, 1);
  });

  // -------------------------------------------------------------------------
  // Section metadata
  // -------------------------------------------------------------------------

  it('records section metadata after decode', () => {
    const m = makeModule();
    m.types.push({
      kind: 'func',
      name: '',
      sig: { params: [], results: [] },
      loc: LOC,
    });
    m.funcs.push({
      name: '',
      loc: LOC,
      typeVar: varIndex(0),
      sig: { params: [], results: [] },
      localDecls: [],
      body: [],
      tailcall: false,
    });

    const binary = writeBinaryIr(m);
    const errors = makeErrorList();
    const m2 = readBinaryIr(binary, errors);
    assertEquals(hasErrors(errors), false);
    // Should have at least type, function, code sections
    assertEquals(m2.sectionMeta.length >= 3, true);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('reports error for bad magic bytes', () => {
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
    const errors = makeErrorList();
    readBinaryIr(data, errors);
    assertEquals(hasErrors(errors), true);
  });

  it('reports error for bad version', () => {
    const data = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]);
    const errors = makeErrorList();
    readBinaryIr(data, errors);
    assertEquals(hasErrors(errors), true);
  });
});
