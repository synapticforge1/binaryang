/**
 * @module binaryen-ts/tests/binary/region_body_test
 *
 * The REGION-container matrix.
 *
 * The decoder packs a multi-instruction region body into an anonymous
 * `BlockExpr` — one `Expression` per body is what the IR requires. That
 * container is an artifact of the IR, not something the binary had, so the
 * encoder has to UNPACK it. Emitting it as a real `block` re-wraps the body a
 * level deeper than it was read, and the wrapper carries the type `makeBlock`
 * inferred from its last child rather than the region's declared result type.
 * A body that exits via `br` ends in an `unreachable`-typed child, so the
 * wrapper goes out with a void blocktype, absorbs the unreachability, and
 * yields nothing to a result-typed region.
 *
 * That is one bug, and it was found FOUR separate times, each as a valid module
 * that would not survive its own round trip:
 *
 *   - the inlined-callee wrapper (WT-2f)
 *   - `catch` handlers (WT-2g)
 *   - the `try` body (2026-08-25)
 *   - the `if` arms (2026-08-25)
 *
 * Hence a matrix rather than four more one-off fixtures: every construct that
 * owns a region, with a body that falls through and a body that exits via `br`.
 * Three of these thirteen fail if `encodeRegionBody` is reverted to
 * `encodeExpr` at either site.
 *
 * @license MIT
 */

import { assertEquals } from "@std/assert";
import { parseWasm } from "../../src/binary/index.ts";
import { encodeWasm } from "../../src/encoder/index.ts";

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
const fnBody = (b: number[]): number[] => [...uleb(b.length), ...b];
const vecOf = (e: number[][]): number[] => [...uleb(e.length), ...e.flat()];
const HDR = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

const NOP = 0x01;
const END = 0x0b;
const C7 = [0x41, 0x07];
const C9 = [0x41, 0x09];

/** `(module (func (export "f") (result i32) <body>))` */
function mk(body: number[]): Uint8Array {
  return Uint8Array.from([
    ...HDR,
    ...sec(1, vecOf([[0x60, 0x00, 0x01, 0x7f]])),
    ...sec(3, vecOf([[0x00]])),
    ...sec(7, vecOf([[0x01, 0x66, 0x00, 0x00]])),
    ...sec(10, vecOf([fnBody([0x00, ...body, END])])),
  ]);
}

async function run(bytes: Uint8Array): Promise<unknown> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const { instance } = await WebAssembly.instantiate(buf, {});
  return (instance.exports.f as () => unknown)();
}

/**
 * Every case is a MULTI-instruction region (the leading `nop` is what forces the
 * decoder to build a container at all — a single-expression body is returned
 * bare and never had the problem).
 */
const CASES: [name: string, body: number[], want: number][] = [
  ["block i32, falls through", [0x02, 0x7f, NOP, ...C7, END], 7],
  ["block i32, exits via br", [0x02, 0x7f, NOP, ...C7, 0x0c, 0x00, END], 7],
  ["loop i32, falls through", [0x03, 0x7f, NOP, ...C7, END], 7],
  [
    "if i32, then-arm exits via br",
    [0x41, 0x01, 0x04, 0x7f, NOP, ...C7, 0x0c, 0x00, 0x05, ...C9, END],
    7,
  ],
  [
    "if i32, both arms fall through",
    [0x41, 0x01, 0x04, 0x7f, NOP, ...C7, 0x05, NOP, ...C9, END],
    7,
  ],
  [
    "if i32, else-arm exits via br",
    [0x41, 0x00, 0x04, 0x7f, ...C7, 0x05, NOP, ...C9, 0x0c, 0x00, END],
    9,
  ],
  ["if void, multi-instruction arm", [0x41, 0x01, 0x04, 0x40, NOP, NOP, END, ...C7], 7],
  ["try i32, body exits via br", [0x06, 0x7f, NOP, ...C7, 0x0c, 0x00, 0x19, ...C9, END], 7],
  [
    "try i32, body and handler fall through",
    [0x06, 0x7f, NOP, ...C7, 0x19, NOP, ...C9, END],
    7,
  ],
  ["try void, multi-instruction handler", [0x06, 0x40, NOP, NOP, 0x19, NOP, END, ...C7], 7],
  ["try_table i32, body exits via br", [0x1f, 0x7f, 0x00, NOP, ...C7, 0x0c, 0x00, END], 7],
  ["try_table i32, falls through", [0x1f, 0x7f, 0x00, NOP, ...C7, END], 7],
  [
    "nested: block i32 containing an if that brs to the block",
    [0x02, 0x7f, NOP, 0x41, 0x01, 0x04, 0x7f, NOP, ...C7, 0x0c, 0x01, 0x05, ...C9, END, END],
    7,
  ],
];

for (const [name, body, want] of CASES) {
  Deno.test(`region: ${name}`, async () => {
    const input = mk(body);

    // The fixture itself must be valid and produce `want` — otherwise the
    // round-trip assertion below would be measuring nothing.
    assertEquals(await run(input), want, "fixture does not behave as expected");

    assertEquals(await run(encodeWasm(parseWasm(input))), want);
  });
}
