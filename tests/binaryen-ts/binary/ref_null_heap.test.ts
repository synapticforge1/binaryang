/**
 * @module binaryen-ts/tests/binary/ref_null_heap_test
 *
 * Regression tests for the last two corpus round-trip defects, both found by
 * `scripts/binaryen-ts/verify_roundtrip.ts` over the upstream test tree.
 *
 * 1. **`ref.null` collapsed every heap type to `externref`.** Both decode sites
 *    did `r.readU8()` then `ht === 0x70 ? FuncRef : ExternRef`. Wrong twice: a
 *    heap type is a signed LEB (`s33`), not one byte; and every non-`func` heap
 *    type — `none`, `noextern`, `eq`, a concrete `$T` — became `extern`. On
 *    `WebAssembly/binaryen/test/unit/input/gc_target_feature.wasm` that turned a valid
 *    `(global (mut eqref) (ref.null none))` into a module V8 rejects:
 *    "type error in constant expression[0] (expected eqref, got externref)".
 *
 *    The encoder had the mirror defect: `writeHeapType` wrote a concrete index
 *    with `writeU32`, but `readHeapType` reads it back signed — so an index
 *    ≥ 64 round-tripped to a negative value and resolved to an abstract heap
 *    type instead. Below 64 the two encodings coincide, which is why every
 *    existing fixture hid it.
 *
 * 2. **`pop()` on an empty operand stack returned a `nop`.** An empty stack at
 *    a value pop is legal only in STACK-POLYMORPHIC code (after `unreachable` /
 *    `br` / `return` / `throw`), where the phantom value popped is of the
 *    bottom type. `unreachable` is that value; a `none`-typed `nop` is not a
 *    value at all — the same defect class as the catch-param and tuple-call
 *    `nop`s of WT-2h / WT-2i. It also round-tripped unstably, growing an
 *    expression on every trip.
 *
 * @license MIT
 */

import { assert, assertEquals, assertThrows } from '@std/assert';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import {
  type Expression,
  ExpressionKind,
  makeRefNull,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { AbstractHeapType, isRefType, type RefType } from '../../../src/binaryen-ts/ir/gc-types.ts';
import { heapAbstract, varIndex } from '../../../src/wabt-ts/ir/ir.ts';

/**
 * `WebAssembly/binaryen/test/unit/input/gc_target_feature.wasm`, minus its custom sections:
 *
 * ```wat
 * (global (mut externref) (ref.null noextern))   ;; heap type 0x72
 * (global (mut eqref)     (ref.null none))       ;; heap type 0x71
 * ```
 *
 * Both init expressions name a heap type that is NOT `func` and NOT `extern`,
 * so both are rewritten by the collapse — and the second one becomes invalid,
 * since `externref` is not a subtype of the declared `eqref`.
 */
const REF_NULL_HEAP_MODULE = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  0x06,
  0x0b,
  0x02,
  0x6f,
  0x01,
  0xd0,
  0x72,
  0x0b, // (mut externref) = ref.null noextern
  0x6d,
  0x01,
  0xd0,
  0x71,
  0x0b, // (mut eqref)     = ref.null none
]);

/**
 * `block (result i32); unreachable; i32.add; end` — `i32.add` pops two values
 * with only one `unreachable` beneath it, so one operand is a phantom pop from
 * the polymorphic stack. Upstream decodes this as
 * `(i32.add (unreachable) (unreachable))`.
 */
const UNREACHABLE_POPS_MODULE = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x05,
  0x01,
  0x60,
  0x00,
  0x01,
  0x7f,
  0x03,
  0x02,
  0x01,
  0x00,
  0x0a,
  0x09,
  0x01,
  0x07,
  0x00,
  0x02,
  0x7f,
  0x00,
  0x6a,
  0x0b,
  0x0b,
]);

/** Bytes of section `id`, including the id and size prefix. */
function section(bytes: Uint8Array, id: number): Uint8Array {
  let i = 8;
  while (i < bytes.length) {
    const start = i;
    const secId = bytes[i++];
    let size = 0, shift = 0, b: number;
    do {
      b = bytes[i++];
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (secId === id) return bytes.slice(start, i + size);
    i += size;
  }
  return new Uint8Array();
}

/** Flattened `kind` list of an expression tree, pre-order. */
function kinds(root: unknown, out: string[] = []): string[] {
  if (!root || typeof root !== 'object') return out;
  const node = root as Record<string, unknown>;
  if (typeof node.kind === 'string') out.push(node.kind);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'kind' || k === 'type') continue;
    if (Array.isArray(v)) v.forEach((c) => kinds(c, out));
    else kinds(v, out);
  }
  return out;
}

Deno.test('ref.null preserves non-func, non-extern heap types byte-for-byte', async () => {
  const out = encodeWasm(parseWasm(REF_NULL_HEAP_MODULE));
  assertEquals(
    Array.from(section(out, 6)),
    Array.from(section(REF_NULL_HEAP_MODULE, 6)),
    'global section changed: a ref.null heap type was rewritten',
  );
  // The whole point: the collapsed form does not validate.
  const buf = new ArrayBuffer(out.byteLength);
  new Uint8Array(buf).set(out);
  await WebAssembly.compile(buf);
});

Deno.test('ref.null of `none` decodes to nullref, not externref', () => {
  const mod = parseWasm(REF_NULL_HEAP_MODULE);
  assertEquals(mod.globals.length, 2);
  assertEquals(mod.globals[0].init!.type, ValType.NullExternRef); // ref.null noextern
  assertEquals(mod.globals[1].init!.type, ValType.NullRef); //       ref.null none
});

Deno.test('ref.null of a concrete heap type index >= 64 survives (signed LEB)', () => {
  // `writeU32` and `writeI32` agree below 64. At 64 the unsigned form (0x40)
  // reads back as -64 under the signed `s33` decode and resolves to an abstract
  // heap type, silently retargeting the null.
  const m = new ModuleBuilder();
  m.enableGC();
  let target = -1;
  for (let i = 0; i < 70; i++) {
    const idx = m.addType({
      name: '',
      kind: 'array',
      field: { name: '', type: ValType.I32, mutable: true },
    });
    if (i === 64) target = idx;
  }
  assert(target >= 64, `expected a heap type index >= 64, got ${target}`);

  const refT: RefType = { heapType: varIndex(target), nullable: true };
  m.addGlobal('$g', refT, true, makeRefNull(refT));

  const parsed = parseWasm(encodeWasm(m.build()));
  const initType = parsed.globals[0].init!.type;
  assert(isRefType(initType), `ref.null decoded as ${JSON.stringify(initType)}`);
  assertEquals((initType as RefType).heapType, varIndex(target));
});

Deno.test('a phantom pop in stack-polymorphic code yields unreachable, not nop', () => {
  const mod = parseWasm(UNREACHABLE_POPS_MODULE);
  const seen = kinds(mod.functions[0].body);
  assertEquals(
    seen.filter((k) => k === ExpressionKind.Nop).length,
    0,
    `a nop was synthesized as an operand: ${seen.join(', ')}`,
  );
  // Matches upstream's own decode: (i32.add (unreachable) (unreachable)).
  assertEquals(
    seen.filter((k) => k === ExpressionKind.Unreachable).length,
    2,
    `expected two unreachable operands, got: ${seen.join(', ')}`,
  );
});

Deno.test('stack-polymorphic decode is a round-trip fixed point', () => {
  // Previously each trip added a spurious `nop` opcode, so the expression
  // count grew without bound.
  const first = parseWasm(UNREACHABLE_POPS_MODULE);
  const second = parseWasm(encodeWasm(first));
  const third = parseWasm(encodeWasm(second));

  const a = kinds(first.functions[0].body);
  const b = kinds(second.functions[0].body);
  const c = kinds(third.functions[0].body);
  assertEquals(b, a, 'IR changed on the first round-trip');
  assertEquals(c, b, 'IR changed on the second round-trip');
});

// ---------------------------------------------------------------------------
// S6 step 5, item 5 (6b): `ref.null`'s heap type is a FIELD — wabt-ts's `refType`
// — and is what the encoder writes. It was read back out of the node's type.
// ---------------------------------------------------------------------------

/** Each shorthand reference type, the abstract heap `ref.null` names, and its byte. */
const SHORTHANDS: [ValType, AbstractHeapType, number][] = [
  [ValType.FuncRef, AbstractHeapType.Func, 0x70],
  [ValType.ExternRef, AbstractHeapType.Ext, 0x6f],
  [ValType.AnyRef, AbstractHeapType.Any, 0x6e],
  [ValType.EqRef, AbstractHeapType.Eq, 0x6d],
  [ValType.I31Ref, AbstractHeapType.I31, 0x6c],
  [ValType.StructRef, AbstractHeapType.Struct, 0x6b],
  [ValType.ArrayRef, AbstractHeapType.Array, 0x6a],
  [ValType.NullRef, AbstractHeapType.None, 0x71],
  [ValType.NullFuncRef, AbstractHeapType.NoFunc, 0x73],
  [ValType.NullExternRef, AbstractHeapType.NoExt, 0x72],
  [ValType.ExnRef, AbstractHeapType.Exn, 0x69],
  [ValType.NullExnRef, AbstractHeapType.NoExn, 0x74],
];

/** The global section of a module whose one global is `ref.null` built by `node`. */
function globalSection(type: ValType, node: Expression): number[] {
  const m = new ModuleBuilder();
  m.enableGC();
  m.addGlobal('$g', type, true, node);
  return Array.from(section(encodeWasm(m.build()), 6));
}

Deno.test('makeRefNull sets refType, and the heap byte written is that heap type', () => {
  for (const [vt, heap, byte] of SHORTHANDS) {
    const node = makeRefNull(vt);
    assertEquals(node.refType, heapAbstract(heap), `ref.null of ${vt}`);
    const g = globalSection(vt, node);
    // … 0xd0 <heap byte> 0x0b — the init expression ends the section.
    assertEquals(g.slice(-3), [0xd0, byte, 0x0b], `ref.null of ${vt}`);
  }
  const refT: RefType = { heapType: varIndex(3), nullable: true };
  assertEquals(makeRefNull(refT).refType, varIndex(3));
});

Deno.test('the encoder writes refType — the immediate — not a heap derived from type', () => {
  // Disagreeing on purpose: the instruction names `func`; the type says anyref.
  const node = { ...makeRefNull(ValType.AnyRef), refType: heapAbstract(AbstractHeapType.Func) };
  assertEquals(globalSection(ValType.AnyRef, node).slice(-3), [0xd0, 0x70, 0x0b]);
});

Deno.test('ref.null of a non-reference type is refused', () => {
  assertThrows(() => makeRefNull(ValType.I32), Error, 'non-reference type');
});
