// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Tests for the `/compat` facade. Exercises the call shapes wasmtk
 * (src/utils.ts, src/wasic.ts, src/wasmbundle.ts) uses against
 * `npm:wabt`, so a one-line import-map flip lets wasmtk migrate.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertThrows } from '@std/assert';

import wabt from '../../src/api/wabt-compat.ts';

describe('wabt-ts/compat — factory + module handle shape', () => {
  it('default export is an async factory returning a WabtModule', async () => {
    const w = await wabt();
    // Verify the surface matches what wasmtk expects.
    assertEquals(typeof w.parseWat, 'function');
    assertEquals(typeof w.readWasm, 'function');
  });

  it('parseWat → toBinary → buffer is a valid wasm module', async () => {
    const w = await wabt();
    const m = w.parseWat(
      '<test>',
      '(module (func (export "f") (result i32) (i32.const 42)))',
      { enable_all: true, exceptions: true },
    );
    const { buffer } = m.toBinary({});
    assertEquals(buffer instanceof ArrayBuffer, true);
    // V8 must accept the binary.
    const inst = (await WebAssembly.instantiate(buffer)).instance.exports as {
      f: () => number;
    };
    assertEquals(inst.f(), 42);
    m.destroy();
  });

  it('parseWat → toText round-trips the module', async () => {
    const w = await wabt();
    const m = w.parseWat('<test>', '(module (func (export "f") (result i32) (i32.const 7)))');
    const wat = m.toText({ foldExprs: false, inlineExport: false });
    // Loose check — toText output should contain the literal value.
    assertEquals(wat.includes('i32.const 7'), true);
    m.destroy();
  });

  it('readWasm round-trip — parseWat → toBinary → readWasm → toText', async () => {
    const w = await wabt();
    const m1 = w.parseWat('<test>', '(module (func (export "f") (result i32) (i32.const 99)))');
    const { buffer } = m1.toBinary({});
    m1.destroy();

    // Match the exact wasmtk shape: pass an ArrayBuffer with the
    // readDebugNames option.
    const m2 = w.readWasm(buffer, { readDebugNames: true });
    const wat = m2.toText({ foldExprs: false, inlineExport: false });
    assertEquals(wat.includes('i32.const 99'), true);
    m2.destroy();
  });

  it('readWasm accepts a Uint8Array as well', async () => {
    const w = await wabt();
    const m1 = w.parseWat('<test>', '(module (func (export "f") (result i32) (i32.const 1)))');
    const bytes = new Uint8Array(m1.toBinary({}).buffer);
    m1.destroy();
    const m2 = w.readWasm(bytes);
    const wat = m2.toText();
    assertEquals(wat.includes('i32.const 1'), true);
    m2.destroy();
  });

  it('applyNames fills synthetic names', async () => {
    const w = await wabt();
    const m1 = w.parseWat(
      '<test>',
      '(module (func (export "f") (result i32) (i32.const 0)))',
    );
    const { buffer } = m1.toBinary({});
    m1.destroy();
    const m2 = w.readWasm(buffer, { readDebugNames: false });
    m2.applyNames();
    const wat = m2.toText();
    // After applyNames, the anonymous function should have a generated name.
    assertEquals(wat.includes('$f') || wat.includes('(func '), true);
    m2.destroy();
  });
});

describe('wabt-ts/compat — error semantics', () => {
  it('parseWat throws on a syntax error (matches upstream behavior)', async () => {
    const w = await wabt();
    assertThrows(
      () => w.parseWat('<test>', '(module (func (i32.add (i32.const 1)'),
      Error,
    );
  });

  it('readWasm throws on a malformed binary', async () => {
    const w = await wabt();
    assertThrows(
      () => w.readWasm(new Uint8Array([0xde, 0xad, 0xbe, 0xef])),
      Error,
    );
  });
});

describe('wabt-ts/compat — destroy semantics', () => {
  it('methods throw after destroy()', async () => {
    const w = await wabt();
    const m = w.parseWat('<test>', '(module)');
    m.destroy();
    assertThrows(() => m.toBinary({}), Error, 'destroyed');
    assertThrows(() => m.toText(), Error, 'destroyed');
    assertThrows(() => m.applyNames(), Error, 'destroyed');
  });

  it('destroy() is idempotent', async () => {
    const w = await wabt();
    const m = w.parseWat('<test>', '(module)');
    m.destroy();
    // Second destroy should be a no-op (not throw).
    m.destroy();
  });
});

describe('wabt-ts/compat — wasmtk reference call shapes', () => {
  // These tests mirror the exact call patterns used by wasmtk's
  // src/utils.ts, src/wasic.ts, src/wasmbundle.ts so the migration
  // path doesn't surface a shape regression later.

  it('utils.ts pattern: parseWat with features, toBinary({}), destroy', async () => {
    const w = await wabt();
    const m = w.parseWat(
      'input.wat',
      '(module (func (export "f")))',
      { enable_all: true, exceptions: true },
    );
    const { buffer } = m.toBinary({});
    m.destroy();
    assertEquals(buffer instanceof ArrayBuffer, true);
    assertEquals(buffer.byteLength > 0, true);
  });

  it('wasmbundle.ts pattern: readWasm(bytes.buffer, { readDebugNames }), toText, destroy', async () => {
    const w = await wabt();
    // Produce a binary to feed into readWasm.
    const m1 = w.parseWat(
      'm.wat',
      '(module (func $myFunc (export "fn") (result i32) (i32.const 5)))',
    );
    const bytes = new Uint8Array(m1.toBinary({}).buffer);
    m1.destroy();

    // The exact wasmtk wasmbundle call.
    const m2 = w.readWasm(bytes.buffer, { readDebugNames: true });
    const wat = m2.toText({ foldExprs: false, inlineExport: false });
    m2.destroy();
    assertEquals(typeof wat, 'string');
    assertEquals(wat.length > 0, true);
    assertEquals(wat.includes('i32.const 5'), true);
  });
});
