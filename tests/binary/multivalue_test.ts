/**
 * @module binaryen-ts/tests/binary/multivalue_test
 *
 * Multi-value support — UP-2's "`tuple.make`, and the multi-value `return` /
 * `br` / `br_if` it blocks".
 *
 * "Multi-value is unsupported" was too coarse. Measured, the four cases split:
 *
 * | case                                | before        | now           |
 * | ----------------------------------- | ------------- | ------------- |
 * | multi-result FUNCTION               | worked        | works         |
 * | multi-result CALL (WT-2i)           | worked        | works         |
 * | multi-result BLOCK (p=0, r>1)       | threw         | **supported** |
 * | block WITH INPUTS (p>=1)            | threw         | still throws  |
 *
 * Blocks with inputs stay rejected on purpose: `BlockExpr` cannot model
 * consuming values from the enclosing operand stack, so accepting one would
 * mean silently dropping its parameters. That is an IR-shape change, not
 * plumbing, and the pipeline's rule is to fail loudly rather than corrupt.
 *
 * The load-bearing part of enabling multi-result blocks was NOT the blocktype
 * itself but the two places that would otherwise lose values silently:
 *
 *  - a multi-result block leaves N values but is ONE IR node, so N-1 typed
 *    `Pop`s are seeded beneath it (the `pushMultiValueCall` shape); and
 *  - `br` / `br_if` / `br_table` to a multi-result target used to do
 *    `arity === 1 ? pop() : null` — for N > 1 it popped NOTHING and emitted a
 *    value-less break, discarding every value the branch carried. Those N
 *    values now travel as one `tuple.make`.
 *
 * @license MIT
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { parseWasm, WasmBinaryError } from "../../src/binary/index.ts";
import { encodeWasm } from "../../src/encoder/index.ts";
import { ExpressionKind } from "../../src/ir/expressions.ts";
import { ValType } from "../../src/ir/types.ts";

// --- byte helpers ---------------------------------------------------------

function uleb(n: number): number[] {
  const o: number[] = [];
  do {
    const b = n & 0x7f;
    n >>>= 7;
    o.push(n ? b | 0x80 : b);
  } while (n);
  return o;
}
const sec = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const fnBody = (body: number[]): number[] => [...uleb(body.length), ...body];
const HDR = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** `vec` over already-flat entries. */
function vecOf(entries: number[][]): number[] {
  return [...uleb(entries.length), ...entries.flat()];
}

async function run(bytes: Uint8Array): Promise<unknown> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const { instance } = await WebAssembly.instantiate(buf, {});
  return (instance.exports.f as () => unknown)();
}

/** Flattened expression kinds, pre-order. */
function kinds(root: unknown, out: string[] = []): string[] {
  if (!root || typeof root !== "object") return out;
  const n = root as Record<string, unknown>;
  if (typeof n.kind === "string") out.push(n.kind);
  for (const [k, v] of Object.entries(n)) {
    if (k === "kind" || k === "type") continue;
    if (Array.isArray(v)) v.forEach((c) => kinds(c, out));
    else kinds(v, out);
  }
  return out;
}

// --- fixtures -------------------------------------------------------------

/** `(func (export "f") (result i32 i32) (block (result i32 i32) i32.const 1; i32.const 2))` */
const MULTI_RESULT_BLOCK = Uint8Array.from([
  ...HDR,
  ...sec(1, vecOf([[0x60, 0x00, 0x02, 0x7f, 0x7f], [0x60, 0x00, 0x02, 0x7f, 0x7f]])),
  ...sec(3, vecOf([[0x00]])),
  ...sec(7, vecOf([[0x01, 0x66, 0x00, 0x00]])),
  ...sec(10, vecOf([fnBody([0x00, 0x02, 0x01, 0x41, 0x01, 0x41, 0x02, 0x0b, 0x0b])])),
]);

/**
 * A multi-value `br`:
 * `(func (result i32 i32) (block $b (result i32 i32) i32.const 7; i32.const 9; br $b))`
 *
 * The branch carries BOTH values. Decoding it as a value-less break — which is
 * what `arity === 1 ? pop() : null` did — silently drops them.
 */
const MULTI_VALUE_BR = Uint8Array.from([
  ...HDR,
  ...sec(1, vecOf([[0x60, 0x00, 0x02, 0x7f, 0x7f], [0x60, 0x00, 0x02, 0x7f, 0x7f]])),
  ...sec(3, vecOf([[0x00]])),
  ...sec(7, vecOf([[0x01, 0x66, 0x00, 0x00]])),
  ...sec(
    10,
    vecOf([fnBody([0x00, 0x02, 0x01, 0x41, 0x07, 0x41, 0x09, 0x0c, 0x00, 0x0b, 0x0b])]),
  ),
]);

/** `i32.const 7; (block (param i32) (result i32))` — a block with an INPUT. */
const BLOCK_WITH_INPUT = Uint8Array.from([
  ...HDR,
  ...sec(1, vecOf([[0x60, 0x00, 0x01, 0x7f], [0x60, 0x01, 0x7f, 0x01, 0x7f]])),
  ...sec(3, vecOf([[0x00]])),
  ...sec(7, vecOf([[0x01, 0x66, 0x00, 0x00]])),
  ...sec(10, vecOf([fnBody([0x00, 0x41, 0x07, 0x02, 0x01, 0x0b, 0x0b])])),
]);

// --- tests ----------------------------------------------------------------

Deno.test("multi-result block: fixture is valid and returns both values", async () => {
  assertEquals(await run(MULTI_RESULT_BLOCK), [1, 2]);
});

Deno.test("multi-result block: survives a bare parse-encode round-trip", async () => {
  const out = encodeWasm(parseWasm(MULTI_RESULT_BLOCK));
  assertEquals(await run(out), [1, 2]);
});

Deno.test("multi-result block: decodes to a tuple-typed block, no nop placeholders", () => {
  const mod = parseWasm(MULTI_RESULT_BLOCK);
  const body = mod.functions[0].body;
  const seen = kinds(body);
  assertEquals(
    seen.filter((k) => k === ExpressionKind.Nop).length,
    0,
    `nop synthesized somewhere: ${seen.join(", ")}`,
  );
  // The block's own type must be the tuple, not a single scalar.
  const blockType = (body as { type: unknown }).type;
  assert(Array.isArray(blockType), `function body typed ${JSON.stringify(blockType)}`);
  assertEquals(blockType, [ValType.I32, ValType.I32]);
});

Deno.test("multi-value br: carries both values, not none", async () => {
  assertEquals(await run(MULTI_VALUE_BR), [7, 9]);
  const out = encodeWasm(parseWasm(MULTI_VALUE_BR));
  assertEquals(await run(out), [7, 9], "values were dropped across the round-trip");
});

Deno.test("multi-value br: the branch value decodes to a tuple.make", () => {
  const mod = parseWasm(MULTI_VALUE_BR);
  const seen = kinds(mod.functions[0].body);
  assert(
    seen.includes(ExpressionKind.TupleMake),
    `expected a tuple.make carrying the branch values, got: ${seen.join(", ")}`,
  );
});

Deno.test("multi-result block: round-trip is a fixed point", () => {
  const first = parseWasm(MULTI_RESULT_BLOCK);
  const second = parseWasm(encodeWasm(first));
  const third = parseWasm(encodeWasm(second));
  assertEquals(kinds(second.functions[0].body), kinds(first.functions[0].body));
  assertEquals(kinds(third.functions[0].body), kinds(second.functions[0].body));
});

Deno.test("block WITH INPUTS is still rejected, loudly and by name", () => {
  assertThrows(
    () => parseWasm(BLOCK_WITH_INPUT),
    WasmBinaryError,
    "blocks with inputs are not supported",
  );
});

/** Same shape as MULTI_RESULT_BLOCK but the block names type index 9. */
const BAD_BLOCK_TYPE_INDEX = Uint8Array.from([
  ...HDR,
  ...sec(1, vecOf([[0x60, 0x00, 0x02, 0x7f, 0x7f], [0x60, 0x00, 0x02, 0x7f, 0x7f]])),
  ...sec(3, vecOf([[0x00]])),
  ...sec(7, vecOf([[0x01, 0x66, 0x00, 0x00]])),
  ...sec(10, vecOf([fnBody([0x00, 0x02, 0x09, 0x41, 0x01, 0x41, 0x02, 0x0b, 0x0b])])),
]);

Deno.test("an out-of-range block type index is rejected", () => {
  // The module declares 2 types; the block names index 9. Silently treating an
  // unresolvable blocktype as void is how the ORIGINAL multi-value defect
  // corrupted modules, so this must stay loud.
  assertThrows(() => parseWasm(BAD_BLOCK_TYPE_INDEX), WasmBinaryError, "out of range");
});
