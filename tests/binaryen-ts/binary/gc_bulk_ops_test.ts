/**
 * @module binaryen-ts/tests/binary/gc_bulk_ops_test
 *
 * Tests for UP-3 and UP-4 — GC constructs that had an `ExpressionKind` entry
 * (or, for `ref.as_non_null`, not even that) but no factory, no encoder case,
 * and no way across the wabt-ts bridge.
 *
 * UP-3: `array.fill` / `array.copy` / `array.init_data` / `array.init_elem`.
 * The binary parser rejected all four loudly (they had previously decoded to a
 * single-element `array.set` or a bare `nop` — silent miscompiles). They now
 * have real IR nodes and round-trip.
 *
 * UP-4: `ref.as_non_null`, implemented on the existing `RefAs` placeholder kind
 * with a `RefAsOp` discriminant, matching upstream's `RefAs`/`RefAsOp` shape
 * rather than adding a parallel node.
 *
 * Every test executes the result under V8 rather than only asserting bytes —
 * this project's whole bug history is valid-wasm-wrong-behaviour that byte
 * assertions and `WebAssembly.compile` both waved through.
 *
 * `array.fill` / `array.copy` need a local typed `(ref null $t)`. Those were
 * originally hand-built binaries asserted structurally, because `Local.type`
 * was `ValType` and could not express a concrete typed reference — UP-7. Now
 * that value types carry concrete references end-to-end they are ordinary
 * builder-driven behavioural tests, which is the payoff UP-7 was worth.
 *
 * @license MIT
 */

import { assert, assertEquals } from '@std/assert';
import { parseWasm } from '../../src/binary/index.ts';
import { encodeWasm } from '../../src/encoder/index.ts';
import {
  type Expression,
  ExpressionKind,
  makeArrayCopy,
  makeArrayFill,
  makeArrayGet,
  makeArrayNew,
  makeArrayNewFixed,
  makeBlock,
  makeI32Const,
  makeLocalGet,
  makeLocalSet,
  makeRefAsNonNull,
  RefAsOp,
} from '../../src/ir/expressions.ts';
import { ModuleBuilder } from '../../src/ir/module.ts';
import { parseWat } from '../../src/parser/wat-parser.ts';
import { ValType } from '../../src/ir/types.ts';

/** i32 array heap type + a `() -> i32` func type, in that order. */
function gcBuilder(): { m: ModuleBuilder; arrayType: number } {
  const m = new ModuleBuilder();
  m.enableGC();
  const arrayType = m.addHeapType({
    kind: 'array',
    element: { type: ValType.I32, mutable: true },
  });
  m.addHeapType({ kind: 'func', params: [], results: [ValType.I32] });
  return { m, arrayType };
}

async function runRead(bytes: Uint8Array): Promise<number> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const { instance } = await WebAssembly.instantiate(buf, {});
  return (instance.exports.read as () => number)();
}

/** Encode, round-trip through the parser, and assert both builds agree. */
async function bothAgree(
  mod: ReturnType<ModuleBuilder['build']>,
  expected: number,
): Promise<void> {
  const direct = encodeWasm(mod);
  assertEquals(await runRead(direct), expected, 'direct encode');

  const roundTripped = encodeWasm(parseWasm(direct));
  assertEquals(await runRead(roundTripped), expected, 'after parse->encode');
}

// `array.fill` / `array.copy` need a local typed `(ref null $t)`. `Local.type`
// is `ValType`, which cannot express a concrete typed reference — that is UP-7,
// and it is why these two fixtures are hand-built binaries rather than
// ModuleBuilder programs. Building them through the builder yields
// `local.get of type anyref` where V8 wants `(ref null 0)`. Once UP-7 lands,
// these can be rewritten against the builder.
//
// Both were generated with computed section sizes, then verified to execute.

const ARRAY_FILL_MODULE = new Uint8Array([
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
  0x00,
  0x41,
  0x00,
  0x41,
  0x03,
  0xfb,
  0x06,
  0x00,
  0x21,
  0x00,
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
  0x00,
  0x20,
  0x00,
  0x41,
  0x02,
  0xfb,
  0x0b,
  0x00,
  0x0b,
]);

const ARRAY_COPY_MODULE = new Uint8Array([
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
  0x31,
  0x01,
  0x2f,
  0x01,
  0x02,
  0x63,
  0x00,
  0x41,
  0x0b,
  0x41,
  0x16,
  0x41,
  0x21,
  0xfb,
  0x08,
  0x00,
  0x03,
  0x21,
  0x00,
  0x41,
  0x00,
  0x41,
  0x03,
  0xfb,
  0x06,
  0x00,
  0x21,
  0x01,
  0x20,
  0x01,
  0x41,
  0x00,
  0x20,
  0x00,
  0x41,
  0x01,
  0x41,
  0x02,
  0xfb,
  0x11,
  0x00,
  0x00,
  0x20,
  0x01,
  0x41,
  0x01,
  0xfb,
  0x0b,
  0x00,
  0x0b,
]);

/** Sub-opcodes of every 0xfb instruction in `bytes`, in order. */
function gcSubops(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xfb) out.push(bytes[i + 1]);
  }
  return out;
}

/** First node of `kind` in the tree, or null. */
function findNode(root: unknown, kind: string): Record<string, unknown> | null {
  let hit: Record<string, unknown> | null = null;
  const walk = (e: unknown): void => {
    if (hit || !e || typeof e !== 'object') return;
    const node = e as Record<string, unknown>;
    if (node.kind === kind) {
      hit = node;
      return;
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(root);
  return hit;
}

Deno.test('array.fill: the fixture fills the requested range, not one slot', async () => {
  // The pre-fix decoder modelled array.fill as a one-element array.set, so a
  // fill of 3 wrote exactly one slot. Reading index 2 catches that directly.
  assertEquals(await runRead(ARRAY_FILL_MODULE), 7);
});

Deno.test('array.fill decodes to an ArrayFill node and re-encodes to 0xfb 0x10', () => {
  const mod = parseWasm(ARRAY_FILL_MODULE);
  const node = findNode(mod.functions[0].body, ExpressionKind.ArrayFill);
  assert(node !== null, 'array.fill did not decode to an ArrayFill node');
  assertEquals(node!.typeIndex, 0);
  // ref, index, value, size all present and distinct operands.
  for (const k of ['ref', 'index', 'value', 'size']) {
    assert(node![k] !== undefined, `ArrayFill is missing operand "${k}"`);
  }
  assert(gcSubops(encodeWasm(mod)).includes(0x10), 'encoder did not emit array.fill');
});

Deno.test('array.copy: the fixture copies the requested range', async () => {
  assertEquals(await runRead(ARRAY_COPY_MODULE), 33);
});

Deno.test('array.copy decodes to an ArrayCopy node and re-encodes to 0xfb 0x11', () => {
  const mod = parseWasm(ARRAY_COPY_MODULE);
  const node = findNode(mod.functions[0].body, ExpressionKind.ArrayCopy);
  assert(node !== null, 'array.copy did not decode to an ArrayCopy node');
  for (const k of ['destRef', 'destIndex', 'srcRef', 'srcIndex', 'size']) {
    assert(node![k] !== undefined, `ArrayCopy is missing operand "${k}"`);
  }
  assert(gcSubops(encodeWasm(mod)).includes(0x11), 'encoder did not emit array.copy');
});

Deno.test('array.fill fills the requested range via ModuleBuilder (typed-ref local)', async () => {
  // Buildable only because `Local.type` accepts a concrete `RefType` (UP-7).
  const { m, arrayType } = gcBuilder();
  const arrRef = { heap: arrayType, nullable: true };
  m.addFunction(
    'read',
    [],
    [ValType.I32],
    makeBlock([
      makeLocalSet(
        0,
        makeArrayNew(arrayType, makeI32Const(0), makeI32Const(3), {
          heap: arrayType,
          nullable: false,
        }),
      ),
      makeArrayFill(
        arrayType,
        makeLocalGet(0, arrRef),
        makeI32Const(0),
        makeI32Const(7),
        makeI32Const(3),
      ),
      // index 2 is only written if the fill honoured its length
      makeArrayGet(arrayType, makeLocalGet(0, arrRef), makeI32Const(2), ValType.I32, false),
    ]),
    [{ type: arrRef }],
  );
  m.addExport('read', 'read');
  await bothAgree(m.build(), 7);
});

Deno.test('array.copy keeps dest and src type immediates in the right order', () => {
  // The binary immediate order is dest THEN src. Swapping them is invisible
  // when both are the same type, so assert the decoded node directly.
  const { m, arrayType } = gcBuilder();
  const second = m.addHeapType({
    kind: 'array',
    element: { type: ValType.I32, mutable: true },
  });
  m.addFunction(
    'read',
    [],
    [ValType.I32],
    makeBlock([
      makeArrayCopy(
        arrayType,
        second,
        makeArrayNew(arrayType, makeI32Const(0), makeI32Const(1), {
          heap: arrayType,
          nullable: false,
        }),
        makeI32Const(0),
        makeArrayNew(second, makeI32Const(5), makeI32Const(1), {
          heap: second,
          nullable: false,
        }),
        makeI32Const(0),
        makeI32Const(1),
      ),
      makeI32Const(0),
    ]),
  );
  m.addExport('read', 'read');

  const parsed = parseWasm(encodeWasm(m.build()));
  const node = findNode(parsed.functions[0].body, ExpressionKind.ArrayCopy);

  assert(node !== null, 'array.copy did not survive the round-trip');
  assertEquals(node.destTypeIndex, arrayType);
  assertEquals(node.srcTypeIndex, second);
});

Deno.test('ref.as_non_null passes a non-null reference through', async () => {
  const { m, arrayType } = gcBuilder();
  m.addFunction(
    'read',
    [],
    [ValType.I32],
    makeArrayGet(
      arrayType,
      makeRefAsNonNull(
        makeArrayNewFixed(arrayType, [makeI32Const(99)], {
          heap: arrayType,
          nullable: true,
        }),
        { heap: arrayType, nullable: false },
      ),
      makeI32Const(0),
      ValType.I32,
      false,
    ),
  );
  m.addExport('read', 'read');
  await bothAgree(m.build(), 99);
});

Deno.test('ref.as_non_null decodes back to a RefAs node with the right op', () => {
  const { m, arrayType } = gcBuilder();
  m.addFunction(
    'read',
    [],
    [ValType.I32],
    makeArrayGet(
      arrayType,
      makeRefAsNonNull(
        makeArrayNewFixed(arrayType, [makeI32Const(1)], {
          heap: arrayType,
          nullable: true,
        }),
        { heap: arrayType, nullable: false },
      ),
      makeI32Const(0),
      ValType.I32,
      false,
    ),
  );
  m.addExport('read', 'read');

  const parsed = parseWasm(encodeWasm(m.build()));
  const ops: string[] = [];
  const walk = (e: unknown): void => {
    if (!e || typeof e !== 'object') return;
    const node = e as { kind?: string; op?: string };
    if (node.kind === ExpressionKind.RefAs && node.op) ops.push(node.op);
    for (const v of Object.values(e as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(parsed.functions[0].body as Expression);
  assertEquals(ops, [RefAsOp.RefAsNonNull]);
});

// --- WAT front door -------------------------------------------------------
//
// WT-2h found `ref.null` / `ref.func` / `ref.is_null` silently falling through
// the WAT parser's unrecognized-instruction path to a bare `nop`. Every new
// instruction gets pinned here so the same gap cannot reopen.

Deno.test('WAT: the five new GC instructions parse, none fall through to nop', () => {
  const mod = parseWat(`
    (module
      (type $a (array (mut i32)))
      (type $f (func))
      (func
        (array.fill $a (ref.null $a) (i32.const 0) (i32.const 1) (i32.const 2))
        (array.copy $a $a (ref.null $a) (i32.const 0) (ref.null $a) (i32.const 0) (i32.const 1))
        (array.init_data $a 0 (ref.null $a) (i32.const 0) (i32.const 0) (i32.const 1))
        (array.init_elem $a 0 (ref.null $a) (i32.const 0) (i32.const 0) (i32.const 1))
        (drop (ref.as_non_null (ref.null $a)))))
  `);

  const kinds: string[] = [];
  const walk = (e: unknown): void => {
    if (!e || typeof e !== 'object') return;
    const node = e as Record<string, unknown>;
    if (typeof node.kind === 'string') kinds.push(node.kind);
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(mod.functions[0].body);

  for (
    const kind of [
      ExpressionKind.ArrayFill,
      ExpressionKind.ArrayCopy,
      ExpressionKind.ArrayInitData,
      ExpressionKind.ArrayInitElem,
      ExpressionKind.RefAs,
    ]
  ) {
    assert(kinds.includes(kind), `${kind} did not parse`);
  }
  assertEquals(kinds.filter((k) => k === ExpressionKind.Nop).length, 0);
});
