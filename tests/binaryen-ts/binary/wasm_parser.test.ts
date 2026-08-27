/**
 * @module binaryen-ts/tests/binary/wasm_parser_test
 *
 * Tests for the Phase 2 WASM binary parser.
 *
 * @license MIT
 */

import { assertEquals, assertThrows } from '@std/assert';
import { parseWasm, WasmBinaryError } from '../../../src/binaryen-ts/binary/index.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid empty WASM module (magic + version only). */
const EMPTY_MODULE = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d, // magic: \0asm
  0x01,
  0x00,
  0x00,
  0x00, // version: 1
]);

/**
 * Module with one function: (func $add (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
 * Exported as "add".
 */
const ADD_MODULE = new Uint8Array([
  // magic + version
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  // type section (id=1, size=7): 1 type: (i32 i32) -> i32
  0x01,
  0x07,
  0x01,
  0x60,
  0x02,
  0x7f,
  0x7f,
  0x01,
  0x7f,
  // function section (id=3, size=2): 1 function, type index 0
  0x03,
  0x02,
  0x01,
  0x00,
  // export section (id=7, size=7): export "add" -> func 0
  0x07,
  0x07,
  0x01,
  0x03,
  0x61,
  0x64,
  0x64,
  0x00,
  0x00,
  // code section (id=10, size=9): 1 body
  0x0a,
  0x09,
  0x01,
  //   body size=7, 0 locals, local.get 0, local.get 1, i32.add, end
  0x07,
  0x00,
  0x20,
  0x00,
  0x20,
  0x01,
  0x6a,
  0x0b,
]);

/**
 * Module with one i32 mutable global (init=42) and a function that reads it.
 * global section: valtype=i32, mutable=1, init=i32.const 42, end
 */
const GLOBAL_MODULE = new Uint8Array([
  // magic + version
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  // type section: 1 type () -> i32
  0x01,
  0x05,
  0x01,
  0x60,
  0x00,
  0x01,
  0x7f,
  // function section: 1 func, type 0
  0x03,
  0x02,
  0x01,
  0x00,
  // global section (id=6): 1 global, i32 mutable, init=i32.const 42 end
  0x06,
  0x06,
  0x01,
  0x7f,
  0x01,
  0x41,
  0x2a,
  0x0b,
  // code section: 1 body: 0 locals, global.get 0, end
  0x0a,
  0x06,
  0x01,
  0x04,
  0x00,
  0x23,
  0x00,
  0x0b,
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('parseWasm rejects bad magic', () => {
  const bad = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
  assertThrows(() => parseWasm(bad), WasmBinaryError, 'invalid WASM magic');
});

Deno.test('parseWasm rejects wrong version', () => {
  const bad = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]);
  assertThrows(() => parseWasm(bad), WasmBinaryError, 'unsupported WASM version');
});

Deno.test('parseWasm rejects truncated input', () => {
  assertThrows(() => parseWasm(new Uint8Array([0x00, 0x61, 0x73])), WasmBinaryError);
});

Deno.test('parseWasm accepts empty module', () => {
  const mod = parseWasm(EMPTY_MODULE);
  assertEquals(mod.functions.length, 0);
  assertEquals(mod.globals.length, 0);
  assertEquals(mod.imports.length, 0);
  assertEquals(mod.exports.length, 0);
});

Deno.test('parseWasm: add function has correct signature', () => {
  const mod = parseWasm(ADD_MODULE);
  assertEquals(mod.functions.length, 1);
  const fn = mod.functions[0];
  assertEquals(fn.params, [ValType.I32, ValType.I32]);
  assertEquals(fn.results, [ValType.I32]);
});

Deno.test("parseWasm: add function is exported as 'add'", () => {
  const mod = parseWasm(ADD_MODULE);
  assertEquals(mod.exports.length, 1);
  assertEquals(mod.exports[0].name, 'add');
  assertEquals(mod.exports[0].kind, 'function');
});

Deno.test('parseWasm: add function body contains binary op', () => {
  const mod = parseWasm(ADD_MODULE);
  const fn = mod.functions[0];
  // Body is a block or direct binary expression
  let found = false;
  const walk = (
    e: { kind: string; left?: unknown; right?: unknown; exprs?: unknown[]; children?: unknown[] },
  ): void => {
    if (e.kind === ExpressionKind.Binary) {
      found = true;
      return;
    }
    if (e.exprs) (e.exprs as typeof e[]).forEach(walk);
    if (e.children) (e.children as typeof e[]).forEach(walk);
  };
  walk(fn.body as Parameters<typeof walk>[0]);
  assertEquals(found, true);
});

Deno.test('parseWasm: global module has one global with init i32.const 42', () => {
  const mod = parseWasm(GLOBAL_MODULE);
  assertEquals(mod.globals.length, 1);
  const g = mod.globals[0];
  assertEquals(g.type, ValType.I32);
  assertEquals(g.mutable, true);
  assertEquals(g.init.kind, ExpressionKind.Const);
  if (g.init.kind === ExpressionKind.Const) {
    assertEquals((g.init.value as { i32: number }).i32, 42);
  }
});

Deno.test('parseWasm: global.get in function body', () => {
  const mod = parseWasm(GLOBAL_MODULE);
  assertEquals(mod.functions.length, 1);
  const fn = mod.functions[0];
  let found = false;
  const walk = (e: { kind: string; children?: unknown[]; exprs?: unknown[] }): void => {
    if (e.kind === ExpressionKind.GlobalGet) {
      found = true;
      return;
    }
    if (e.children) (e.children as typeof e[]).forEach(walk);
    if (e.exprs) (e.exprs as typeof e[]).forEach(walk);
  };
  walk(fn.body as Parameters<typeof walk>[0]);
  assertEquals(found, true);
});

Deno.test('an unknown export kind is rejected, not silently dropped', () => {
  // Export kind 0x07 does not exist. The old `default: break;` discarded the
  // export entirely and carried on — which is precisely how tag exports
  // (kind 0x04) went missing before that case was added: modules round-tripped
  // minus an export, with no diagnostic. The import section already errored on
  // an unknown kind; the export section now matches.
  const bad = new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x04,
    0x01,
    0x60,
    0x00,
    0x00, //           type: () -> ()
    0x03,
    0x02,
    0x01,
    0x00, //                       func 0
    0x07,
    0x05,
    0x01,
    0x01,
    0x66,
    0x07,
    0x00, //     export "f" kind 0x07 idx 0
    0x0a,
    0x04,
    0x01,
    0x02,
    0x00,
    0x0b, //           code
  ]);
  assertThrows(() => parseWasm(bad), WasmBinaryError, 'unknown export kind');
});

// ---------------------------------------------------------------------------
// Fail-loud audit: three silent decodes that produced a DIFFERENT program
// ---------------------------------------------------------------------------

const HDR = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const sec = (id: number, body: number[]): number[] => [id, body.length, ...body];

Deno.test('an unknown section id is rejected, not skipped', () => {
  // Skipping it dropped the section from the re-encoded module with no
  // diagnostic — the same "valid wasm, wrong behaviour" shape the start
  // section had until it was materialized, but for every future section at
  // once. Id 0x40 is not assigned.
  const mod = Uint8Array.from([...HDR, ...sec(0x40, [0x01, 0x02, 0x03])]);
  assertThrows(() => parseWasm(mod), WasmBinaryError, 'unknown section id');
});

Deno.test('a type index naming a struct is rejected where a function type is required', () => {
  // `funcTypes` mirrors the type section index-for-index, and a struct/array
  // entry used to occupy its slot with a placeholder `() -> ()` — indistinguish-
  // able from a real one. A `call_indirect` naming that index therefore popped
  // ZERO operands and built a zero-arity call: the WT-2b "call need N got M"
  // shape, decoded without a diagnostic.
  //
  // Type 0 = (struct (field i32)), type 1 = () -> (), func 0 uses type 1 and
  // does `call_indirect (type 0)`.
  const mod = Uint8Array.from([
    ...HDR,
    ...sec(0x01, [0x02, 0x5f, 0x01, 0x7f, 0x00, 0x60, 0x00, 0x00]),
    ...sec(0x03, [0x01, 0x01]),
    ...sec(0x04, [0x01, 0x70, 0x00, 0x01]),
    ...sec(0x0a, [0x01, 0x07, 0x00, 0x41, 0x00, 0x11, 0x00, 0x00, 0x0b]),
  ]);
  assertThrows(() => parseWasm(mod), WasmBinaryError, 'is not a function type');
});

Deno.test('call_indirect keeps its table index instead of assuming table 0', () => {
  // The table index was read and DISCARDED, so every indirect call decoded
  // against table 0. The element-segment and `table.get`/`table.set` decoders
  // were already index-aware; this one was not, and the encoder's
  // single-table guard is the only reason it never reached bytes.
  //
  // Two tables; func 0 does `call_indirect (type 0) 1`.
  const mod = Uint8Array.from([
    ...HDR,
    ...sec(0x01, [0x01, 0x60, 0x00, 0x00]),
    ...sec(0x03, [0x01, 0x00]),
    ...sec(0x04, [0x02, 0x70, 0x00, 0x01, 0x70, 0x00, 0x01]),
    ...sec(0x0a, [0x01, 0x07, 0x00, 0x41, 0x00, 0x11, 0x00, 0x01, 0x0b]),
  ]);
  const parsed = parseWasm(mod);
  const body = parsed.functions[0].body as { children?: { table?: string }[]; table?: string };
  const ci = body.children ? body.children[0] : body;
  assertEquals((ci as { table?: string }).table, '$table1');
});
