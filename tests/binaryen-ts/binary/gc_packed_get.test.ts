/**
 * @module binaryen-ts/tests/binary/gc_packed_get_test
 *
 * Regression tests for UP-1 — `struct.get_u` / `array.get_u` were unencodable,
 * and the non-packed `get` was emitted for packed fields.
 *
 * The GC spec has THREE sub-opcodes per family (`get` / `get_s` / `get_u`), but
 * the encoder chose between two with `signed ? get_s : get`. Two consequences:
 *
 *  1. `signed = false` on a PACKED field emitted the non-packed `get`, which
 *     every engine rejects ("Field 0 of type 0 has type i8. Use struct.get_s or
 *     struct.get_u instead.").
 *  2. Because the binary parser decodes `get_u` to `signed = false`, a VALID
 *     input module using `struct.get_u` came back INVALID from a bare
 *     `parseWasm` to `encodeWasm` round-trip — no passes involved. That is the
 *     WT-2g bare-round-trip-corruption class.
 *
 * The fix derives packedness from the field's declared `StorageType` at encode
 * time, which makes `signed: boolean` sufficient: a packed field admits only
 * `get_s`/`get_u` (selected by `signed`), a non-packed field only `get` (where
 * `signed` is meaningless). No IR or API change.
 *
 * @license MIT
 */

import { assert, assertEquals, assertThrows } from '@std/assert';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm, WasmEncodeError } from '../../../src/binaryen-ts/encoder/index.ts';
import {
  makeArrayGet,
  makeArrayNewFixed,
  makeI32Const,
  makeStructGet,
  makeStructNew,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import type { StorageType } from '../../../src/binaryen-ts/ir/gc-types.ts';
import { parseWat, WatParseError } from '../../../src/binaryen-ts/parser/wat-parser.ts';

/** A one-field mutable struct holding `value`, read back via struct.get. */
function structModule(storage: StorageType, value: number, signed: boolean): Uint8Array {
  const m = new ModuleBuilder();
  m.enableGC();
  const t = m.addHeapType({ kind: 'struct', fields: [{ type: storage, mutable: true }] });
  m.addHeapType({ kind: 'func', params: [], results: [ValType.I32] });
  m.addFunction(
    'read',
    [],
    [ValType.I32],
    makeStructGet(
      t,
      0,
      makeStructNew(t, [makeI32Const(value)], { heap: t, nullable: false }),
      ValType.I32,
      signed,
    ),
  );
  m.addExport('read', 'read');
  return encodeWasm(m.build());
}

/** A one-element mutable array holding `value`, read back via array.get. */
function arrayModule(storage: StorageType, value: number, signed: boolean): Uint8Array {
  const m = new ModuleBuilder();
  m.enableGC();
  const t = m.addHeapType({ kind: 'array', element: { type: storage, mutable: true } });
  m.addHeapType({ kind: 'func', params: [], results: [ValType.I32] });
  m.addFunction(
    'read',
    [],
    [ValType.I32],
    makeArrayGet(
      t,
      makeArrayNewFixed(t, [makeI32Const(value)], { heap: t, nullable: false }),
      makeI32Const(0),
      ValType.I32,
      signed,
    ),
  );
  m.addExport('read', 'read');
  return encodeWasm(m.build());
}

async function runRead(bytes: Uint8Array): Promise<number> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const { instance } = await WebAssembly.instantiate(buf, {});
  return (instance.exports.read as () => number)();
}

/** Sub-opcode of the first 0xfb instruction matching one of `candidates`. */
function firstSubop(bytes: Uint8Array, candidates: number[]): number {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xfb && candidates.includes(bytes[i + 1])) return bytes[i + 1];
  }
  return -1;
}

const STRUCT_GETS = [0x02, 0x03, 0x04];
const ARRAY_GETS = [0x0b, 0x0c, 0x0d];

Deno.test('packed struct field: signed=false encodes struct.get_u and zero-extends', async () => {
  const bytes = structModule('i8', 200, false);
  assertEquals(firstSubop(bytes, STRUCT_GETS), 0x04);
  assertEquals(await runRead(bytes), 200);
});

Deno.test('packed struct field: signed=true encodes struct.get_s and sign-extends', async () => {
  const bytes = structModule('i8', 200, true);
  assertEquals(firstSubop(bytes, STRUCT_GETS), 0x03);
  assertEquals(await runRead(bytes), -56);
});

Deno.test('non-packed struct field encodes the plain struct.get', async () => {
  const bytes = structModule(ValType.I32, 200, false);
  assertEquals(firstSubop(bytes, STRUCT_GETS), 0x02);
  assertEquals(await runRead(bytes), 200);
});

Deno.test('packed array element: signed=false encodes array.get_u and zero-extends', async () => {
  const bytes = arrayModule('i8', 200, false);
  assertEquals(firstSubop(bytes, ARRAY_GETS), 0x0d);
  assertEquals(await runRead(bytes), 200);
});

Deno.test('packed array element: signed=true encodes array.get_s and sign-extends', async () => {
  const bytes = arrayModule('i8', 200, true);
  assertEquals(firstSubop(bytes, ARRAY_GETS), 0x0c);
  assertEquals(await runRead(bytes), -56);
});

Deno.test('non-packed array element encodes the plain array.get', async () => {
  const bytes = arrayModule(ValType.I32, 200, false);
  assertEquals(firstSubop(bytes, ARRAY_GETS), 0x0b);
  assertEquals(await runRead(bytes), 200);
});

Deno.test('struct.get_u survives a bare parse-encode round-trip', async () => {
  // Build the get_s form, then patch 0x03 -> 0x04 to obtain a VALID module
  // using get_u, which is what an external producer would emit.
  const input = Uint8Array.from(structModule('i8', 200, true));
  let patched = false;
  for (let i = 0; i < input.length - 1; i++) {
    if (input[i] === 0xfb && input[i + 1] === 0x03) {
      input[i + 1] = 0x04;
      patched = true;
      break;
    }
  }
  assert(patched, 'failed to construct the struct.get_u fixture');
  assertEquals(await runRead(input), 200);

  const out = encodeWasm(parseWasm(input));
  assertEquals(firstSubop(out, STRUCT_GETS), 0x04);
  assertEquals(await runRead(out), 200);
});

Deno.test('array.get_u survives a bare parse-encode round-trip', async () => {
  const input = Uint8Array.from(arrayModule('i8', 200, true));
  let patched = false;
  for (let i = 0; i < input.length - 1; i++) {
    if (input[i] === 0xfb && input[i + 1] === 0x0c) {
      input[i + 1] = 0x0d;
      patched = true;
      break;
    }
  }
  assert(patched, 'failed to construct the array.get_u fixture');
  assertEquals(await runRead(input), 200);

  const out = encodeWasm(parseWasm(input));
  assertEquals(firstSubop(out, ARRAY_GETS), 0x0d);
  assertEquals(await runRead(out), 200);
});

Deno.test('encoder throws on an out-of-range struct.get type index', () => {
  const m = new ModuleBuilder();
  m.enableGC();
  const t = m.addHeapType({ kind: 'struct', fields: [{ type: 'i8', mutable: true }] });
  m.addHeapType({ kind: 'func', params: [], results: [ValType.I32] });
  m.addFunction(
    'read',
    [],
    [ValType.I32],
    makeStructGet(
      99,
      0,
      makeStructNew(t, [makeI32Const(1)], { heap: t, nullable: false }),
      ValType.I32,
      false,
    ),
  );
  m.addExport('read', 'read');
  assertThrows(() => encodeWasm(m.build()), WasmEncodeError, 'out of range');
});

Deno.test('encoder throws on an out-of-range struct.get field index', () => {
  const m = new ModuleBuilder();
  m.enableGC();
  const t = m.addHeapType({ kind: 'struct', fields: [{ type: 'i8', mutable: true }] });
  m.addHeapType({ kind: 'func', params: [], results: [ValType.I32] });
  m.addFunction(
    'read',
    [],
    [ValType.I32],
    makeStructGet(
      t,
      7,
      makeStructNew(t, [makeI32Const(1)], { heap: t, nullable: false }),
      ValType.I32,
      false,
    ),
  );
  m.addExport('read', 'read');
  assertThrows(() => encodeWasm(m.build()), WasmEncodeError, 'field index 7 is out of range');
});

// --- WAT front door -------------------------------------------------------
//
// The encoder derives the sub-opcode from the storage type, which would let it
// silently REPAIR an invalid instruction (a `struct.get` of an i8 field would
// come out as `struct.get_u`). The parser rejects the mismatch instead, so the
// front door keeps its accept-or-throw contract.

// Note the explicit `(type $f (func (result i32)))`: with GC enabled the
// function's own signature must exist as a heap type, or the encoder throws
// `unresolved GC function type`. See the note on `enableGC` / `addHeapType`.
function packedWat(op: string): string {
  return `
    (module
      (type $s (struct (field (mut i8))))
      (type $f (func (result i32)))
      (func (export "read") (result i32)
        (${op} $s 0 (struct.new $s (i32.const 200)))))
  `;
}

Deno.test('WAT: struct.get on a packed field is rejected', () => {
  assertThrows(
    () => parseWat(packedWat('struct.get')),
    WatParseError,
    'use struct.get_s or struct.get_u',
  );
});

Deno.test('WAT: struct.get_u on a packed field is accepted', () => {
  const mod = parseWat(packedWat('struct.get_u'));
  assertEquals(firstSubop(encodeWasm(mod), STRUCT_GETS), 0x04);
});

Deno.test('WAT: struct.get_s on a non-packed field is rejected', () => {
  assertThrows(
    () =>
      parseWat(`
        (module
          (type $s (struct (field (mut i32))))
          (type $f (func (result i32)))
          (func (export "read") (result i32)
            (struct.get_s $s 0 (struct.new $s (i32.const 200)))))
      `),
    WatParseError,
    'use struct.get',
  );
});
