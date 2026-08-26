/**
 * @module binaryen-ts/tests/binary/typed_ref_test
 *
 * Regression tests for UP-7 — concrete typed references (`(ref $T)` /
 * `(ref null $T)`) through the whole pipeline.
 *
 * Every value-type position used to be `ValType`, a flat string enum with no
 * room for a heap type. `RefType` existed, but only inside `FuncTypeDef` and on
 * expression `type` fields, so anything declared — a local, a global, a table
 * element, a function parameter or result, a tag payload — was widened to
 * `ValType.AnyRef` on the way in.
 *
 * That was reported as a missing-feature gap ("widen five `ModuleBuilder`
 * signatures"). It was actually a third wrong-bytes bug: a local declared
 * `(ref null 0)` decoded to `anyref`, so re-encoding a GC module produced one
 * engines reject —
 * "array.fill[0] expected type (ref null 0), found local.get of type anyref".
 * A bare `parseWasm` → `encodeWasm`, no passes involved.
 *
 * It also forced a second, quieter failure: two func heap types differing ONLY
 * in their concrete heap types were indistinguishable after the collapse, so
 * `gcFuncTypeIndex` could not pick between them and threw "ambiguous GC
 * function type". Fixing UP-7 deleted that error path — the match is exact now.
 *
 * @license MIT
 */

import { assert, assertEquals } from '@std/assert';
import { parseWasm } from '../../src/binary/index.ts';
import { encodeWasm } from '../../src/encoder/index.ts';
import { makeI32Const, makeRefNull } from '../../src/ir/expressions.ts';
import { ModuleBuilder } from '../../src/ir/module.ts';
import { ValType } from '../../src/ir/types.ts';
import { isRefType, type RefType } from '../../src/ir/gc-types.ts';
import { parseWat } from '../../src/parser/wat-parser.ts';

/**
 * Hand-built GC module with a `(ref null 0)` LOCAL:
 *
 * ```wat
 * (type $a (array (mut i32)))  (type $f (func (result i32)))
 * (func (export "read") (result i32) (local (ref null $a))
 *   (local.set 0 (array.new $a (i32.const 0) (i32.const 3)))
 *   (array.fill $a (local.get 0) (i32.const 0) (i32.const 7) (i32.const 3))
 *   (array.get $a (local.get 0) (i32.const 2)))
 * ```
 *
 * `array.fill` requires `(ref null 0)` exactly — `anyref` is a supertype and is
 * rejected — so this fixture fails the moment the local's type is widened.
 */
const TYPED_REF_LOCAL_MODULE = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x08,
  0x02,
  0x5e,
  0x7f,
  0x01,
  0x60,
  0x00,
  0x01,
  0x7f,
  0x03,
  0x02,
  0x01,
  0x01,
  0x07,
  0x08,
  0x01,
  0x04,
  0x72,
  0x65,
  0x61,
  0x64,
  0x00,
  0x00,
  0x0a,
  0x22,
  0x01,
  0x20,
  0x01,
  0x01,
  0x63,
  0x00, //                       locals: 1 x (ref null 0)
  0x41,
  0x00,
  0x41,
  0x03,
  0xfb,
  0x06,
  0x00, //     array.new 0
  0x21,
  0x00, //                                   local.set 0
  0x20,
  0x00,
  0x41,
  0x00,
  0x41,
  0x07,
  0x41,
  0x03,
  0xfb,
  0x10,
  0x00, // array.fill 0
  0x20,
  0x00,
  0x41,
  0x02,
  0xfb,
  0x0b,
  0x00, //     array.get 0
  0x0b,
]);

async function runRead(bytes: Uint8Array): Promise<number> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const { instance } = await WebAssembly.instantiate(buf, {});
  return (instance.exports.read as () => number)();
}

/** The local-declaration type bytes of the single function body. */
function localDeclBytes(bytes: Uint8Array): number[] {
  let i = 8;
  while (i < bytes.length) {
    const id = bytes[i++];
    let size = 0, shift = 0, b: number;
    do {
      b = bytes[i++];
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (id === 10) {
      // code section: vec count, body size, then the local groups
      let j = i;
      j++; // vec count (1)
      while (bytes[j] & 0x80) j++;
      j++; // body size
      while (bytes[j] & 0x80) j++;
      j++; // group count
      const count = bytes[j++];
      // one group: count, then the value type
      return [count, bytes[j], bytes[j + 1]];
    }
    i += size;
  }
  return [];
}

Deno.test('typed-ref local: the fixture runs', async () => {
  assertEquals(await runRead(TYPED_REF_LOCAL_MODULE), 7);
});

Deno.test('typed-ref local: survives a bare parse-encode round-trip', async () => {
  const out = encodeWasm(parseWasm(TYPED_REF_LOCAL_MODULE));
  // 0x63 = (ref null ht), 0x00 = heap type index 0. Widening it to anyref
  // (0x6e) is the UP-7 bug and makes the module invalid.
  assertEquals(localDeclBytes(out), [1, 0x63, 0x00]);
  assertEquals(await runRead(out), 7);
});

Deno.test('typed-ref local: the parser records a RefType, not AnyRef', () => {
  const mod = parseWasm(TYPED_REF_LOCAL_MODULE);
  const local = mod.functions[0].locals[0];
  assert(
    isRefType(local.type),
    `local decoded as ${JSON.stringify(local.type)}, expected a RefType`,
  );
  const rt = local.type as RefType;
  assertEquals(rt.heap, 0);
  assertEquals(rt.nullable, true);
});

Deno.test('typed-ref: ModuleBuilder accepts a concrete ref for a local and a global', async () => {
  const m = new ModuleBuilder();
  m.enableGC();
  const t = m.addHeapType({ kind: 'array', element: { type: ValType.I32, mutable: true } });
  m.addHeapType({ kind: 'func', params: [], results: [ValType.I32] });
  const arrRef: RefType = { heap: t, nullable: true };

  m.addGlobal('$g', arrRef, true, makeRefNull(arrRef));
  m.addFunction('read', [], [ValType.I32], makeI32Const(5), [{ type: arrRef }]);
  m.addExport('read', 'read');

  const bytes = encodeWasm(m.build());
  assertEquals(await runRead(bytes), 5);

  const parsed = parseWasm(bytes);
  assert(isRefType(parsed.globals[0].type), 'global lost its concrete ref type');
  assert(isRefType(parsed.functions[0].locals[0].type), 'local lost its concrete ref type');
});

Deno.test('typed-ref: two func types differing only in heap type are no longer ambiguous', () => {
  // Before UP-7 both signatures collapsed to `(anyref) -> ()`, so
  // `gcFuncTypeIndex` found two matches and threw "ambiguous GC function type".
  const m = new ModuleBuilder();
  m.enableGC();
  const a = m.addHeapType({ kind: 'array', element: { type: ValType.I32, mutable: true } });
  const b = m.addHeapType({ kind: 'array', element: { type: ValType.I64, mutable: true } });
  const refA: RefType = { heap: a, nullable: true };
  const refB: RefType = { heap: b, nullable: true };

  const fa = m.addHeapType({ kind: 'func', params: [refA], results: [] });
  const fb = m.addHeapType({ kind: 'func', params: [refB], results: [] });
  assert(fa !== fb);

  m.addFunction('takesA', [refA], [], makeI32Const(0));
  m.addFunction('takesB', [refB], [], makeI32Const(0));

  // Encoding resolves each function against its OWN heap type; no throw, and
  // the two must land on different type indices.
  const bytes = encodeWasm(m.build());
  const parsed = parseWasm(bytes);
  assertEquals(parsed.functions.length, 2);

  const p0 = parsed.functions[0].params[0];
  const p1 = parsed.functions[1].params[0];
  assert(isRefType(p0) && isRefType(p1), 'params lost their concrete ref types');
  assertEquals((p0 as RefType).heap, a);
  assertEquals((p1 as RefType).heap, b);
});

Deno.test('WAT: (ref null $t) parses to a real RefType, not anyref', () => {
  const mod = parseWat(`
    (module
      (type $a (array (mut i32)))
      (type $f (func (result i32)))
      (func (export "read") (result i32) (local $r (ref null $a))
        (i32.const 5)))
  `);
  const local = mod.functions[0].locals[0];
  assert(isRefType(local.type), `WAT local decoded as ${JSON.stringify(local.type)}`);
  assertEquals((local.type as RefType).heap, 0);
  assertEquals((local.type as RefType).nullable, true);
});

Deno.test('WAT: (ref $t) is non-nullable', () => {
  const mod = parseWat(`
    (module
      (type $a (array (mut i32)))
      (type $f (func (param (ref $a))))
      (func (export "f") (param (ref $a)) (nop)))
  `);
  const p = mod.functions[0].params[0];
  assert(isRefType(p), `WAT param decoded as ${JSON.stringify(p)}`);
  assertEquals((p as RefType).nullable, false);
});

Deno.test('typed-ref local.get carries the concrete type into the IR', () => {
  const mod = parseWasm(TYPED_REF_LOCAL_MODULE);
  let seen: unknown = null;
  const walk = (e: unknown): void => {
    if (seen || !e || typeof e !== 'object') return;
    const node = e as Record<string, unknown>;
    if (node.kind === 'local.get') {
      seen = node.type;
      return;
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(mod.functions[0].body);
  assert(seen !== null, 'no local.get found');
  assert(isRefType(seen), `local.get typed ${JSON.stringify(seen)}, expected a RefType`);
});

Deno.test('makeLocalGet on an out-of-range local index fails loudly', () => {
  // Previously `locals[idx]?.type ?? ValType.I32` silently typed it i32.
  const bad = Uint8Array.from(TYPED_REF_LOCAL_MODULE);
  // rewrite the first `local.get 0` operand (0x20 0x00) to index 9
  for (let i = 0; i < bad.length - 1; i++) {
    if (bad[i] === 0x20 && bad[i + 1] === 0x00) {
      bad[i + 1] = 0x09;
      break;
    }
  }
  let threw = false;
  try {
    parseWasm(bad);
  } catch (e) {
    threw = true;
    assert(
      (e as Error).message.includes('out of range'),
      `unexpected error: ${(e as Error).message}`,
    );
  }
  assert(threw, 'an out-of-range local index was accepted');
});
