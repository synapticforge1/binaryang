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

import { assertEquals } from '@std/assert';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/pass.ts';
import '../../../src/binaryen-ts/passes/index.ts'; // side-effect: register all built-in passes

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
const I32 = 0x7f;
const VOID = 0x40;

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
  ['block i32, falls through', [0x02, 0x7f, NOP, ...C7, END], 7],
  ['block i32, exits via br', [0x02, 0x7f, NOP, ...C7, 0x0c, 0x00, END], 7],
  ['loop i32, falls through', [0x03, 0x7f, NOP, ...C7, END], 7],
  [
    'if i32, then-arm exits via br',
    [0x41, 0x01, 0x04, 0x7f, NOP, ...C7, 0x0c, 0x00, 0x05, ...C9, END],
    7,
  ],
  [
    'if i32, both arms fall through',
    [0x41, 0x01, 0x04, 0x7f, NOP, ...C7, 0x05, NOP, ...C9, END],
    7,
  ],
  [
    'if i32, else-arm exits via br',
    [0x41, 0x00, 0x04, 0x7f, ...C7, 0x05, NOP, ...C9, 0x0c, 0x00, END],
    9,
  ],
  ['if void, multi-instruction arm', [0x41, 0x01, 0x04, 0x40, NOP, NOP, END, ...C7], 7],
  ['try i32, body exits via br', [0x06, 0x7f, NOP, ...C7, 0x0c, 0x00, 0x19, ...C9, END], 7],
  [
    'try i32, body and handler fall through',
    [0x06, 0x7f, NOP, ...C7, 0x19, NOP, ...C9, END],
    7,
  ],
  ['try void, multi-instruction handler', [0x06, 0x40, NOP, NOP, 0x19, NOP, END, ...C7], 7],
  ['try_table i32, body exits via br', [0x1f, 0x7f, 0x00, NOP, ...C7, 0x0c, 0x00, END], 7],
  ['try_table i32, falls through', [0x1f, 0x7f, 0x00, NOP, ...C7, END], 7],
  [
    'nested: block i32 containing an if that brs to the block',
    [0x02, 0x7f, NOP, 0x41, 0x01, 0x04, 0x7f, NOP, ...C7, 0x0c, 0x01, 0x05, ...C9, END, END],
    7,
  ],

  // A region whose SOLE child is a real, named block. `RemoveUnusedNames`
  // strips the name when nothing branches to it, which hands the encoder an
  // anonymous block that is NOT a decoder container — and `encodeRegionBody`
  // unpacks it anyway. That is sound (a block yields its declared type, and so
  // do its children emitted directly), but it is the one way the unpacking can
  // meet a block it did not create, so it is pinned rather than argued.
  [
    'if arm is an inner named block',
    [0x41, 0x01, 0x04, I32, 0x02, I32, NOP, ...C7, END, 0x05, ...C9, END],
    7,
  ],
  [
    'if arm is an inner block that brs past it',
    [0x41, 0x01, 0x04, I32, 0x02, I32, NOP, ...C7, 0x0c, 0x01, END, 0x05, ...C9, END],
    7,
  ],
  [
    'try body is an inner named block',
    [0x06, I32, 0x02, I32, NOP, ...C7, END, 0x19, ...C9, END],
    7,
  ],
  [
    'try body is an inner block that brs past it',
    [0x06, I32, 0x02, I32, NOP, ...C7, 0x0c, 0x01, END, 0x19, ...C9, END],
    7,
  ],
  [
    'catch handler is an inner named block',
    [0x06, I32, ...C7, 0x19, 0x02, I32, NOP, ...C9, END, END],
    7,
  ],

  // `loop` and `try_table` containers are STAMPED with the declared result type
  // by `sealFrame`, so they encode as correctly-typed blocks and are
  // deliberately not unpacked. Pinned so that stays true.
  [
    'loop i32, multi-instruction, brs to the enclosing block',
    [0x02, I32, 0x03, I32, NOP, ...C7, 0x0c, 0x01, END, END],
    7,
  ],
  [
    'try_table i32, multi-instruction, brs out',
    [0x02, I32, 0x1f, I32, 0x00, NOP, ...C7, 0x0c, 0x01, END, END],
    7,
  ],

  // Regions nested inside regions of a different kind.
  [
    'try inside if inside block',
    [
      0x02,
      I32,
      0x41,
      0x01,
      0x04,
      I32,
      0x06,
      I32,
      NOP,
      ...C7,
      0x0c,
      0x02,
      0x19,
      ...C9,
      END,
      0x05,
      ...C9,
      END,
      END,
    ],
    7,
  ],
  [
    'if inside a try body',
    [0x06, I32, NOP, 0x41, 0x01, 0x04, I32, NOP, ...C7, 0x05, ...C9, END, 0x19, ...C9, END],
    7,
  ],
  [
    'if inside a catch handler',
    [0x06, I32, ...C7, 0x19, 0x41, 0x01, 0x04, I32, NOP, ...C9, 0x05, ...C7, END, END],
    7,
  ],

  // Void regions carrying only side effects — no value to lose, so a failure
  // here would mean the unpacking broke something other than the result type.
  [
    'if void, both arms multi-instruction',
    [0x41, 0x01, 0x04, VOID, NOP, NOP, 0x05, NOP, NOP, END, ...C7],
    7,
  ],
  [
    'try void, body and handler multi-instruction',
    [0x06, VOID, NOP, NOP, 0x19, NOP, NOP, END, ...C7],
    7,
  ],
];

for (const [name, body, want] of CASES) {
  Deno.test(`region: ${name}`, async () => {
    const input = mk(body);

    // The fixture itself must be valid and produce `want` — otherwise the
    // round-trip assertion below would be measuring nothing.
    assertEquals(await run(input), want, 'fixture does not behave as expected');

    assertEquals(await run(encodeWasm(parseWasm(input))), want, 'bare round-trip');

    // The full pipeline too: `RemoveUnusedNames` is what can turn a real block
    // into an anonymous one, and Vacuum is what collapses containers — both
    // change what the encoder is handed.
    const opt = parseWasm(input);
    new PassRunner(opt, { optimizeLevel: 2, shrinkLevel: 2 })
      .addDefaultOptimizationPasses()
      .run();
    assertEquals(await run(encodeWasm(opt)), want, 'full -Oz');
  });
}
