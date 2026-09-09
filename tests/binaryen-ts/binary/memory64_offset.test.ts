// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A memarg offset is a u64. Under memory64 it legitimately exceeds 2^32, and
// binaryen-ts held it as a `number` while its encoder wrote it with `writeU32`
// — which begins `n >>>= 0` and therefore TRUNCATES. A valid module addressing
// offset 2^32+8 re-encoded as one addressing offset 8: valid wasm, wrong
// address, no diagnostic anywhere.
//
// The bridge had the honest version of the same limitation, throwing
// "memory64 not supported yet" for anything above the u32 range. That guard is
// gone because the limitation is.
//
// ⚠️ This is the S6 Group 2 decision "memarg offset: bigint vs number ->
// wabt-ts", and it is the one where FIDELITY BINDS rather than cost: `number`
// cannot represent a valid module at all, so no amount of convenience on the
// other side could outweigh it.
//
// Three ways the loss could hide, so all three are pinned:
//   - the ENCODER truncating on write (writeU32 vs writeU64)
//   - the READER truncating on read (readU32 vs readU64)
//   - a conversion in between that widens the TYPE while keeping the loss —
//     the mechanical pass first produced `BigInt(bigintOffsetToNumber(off))`,
//     which type-checks and preserves the truncation exactly.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import {
  ExpressionKind,
  makeI32Const,
  makeLoad,
  makeStore,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

/** Offsets that a u32 cannot hold, plus the boundary either side of 2^32. */
const OFFSETS: ReadonlyArray<readonly [string, bigint]> = [
  ['zero', 0n],
  ['just below 2^32', 0xffffffffn],
  ['exactly 2^32', 0x100000000n],
  ['2^32 + 8', 0x100000008n],
  ['a large 64-bit offset', 0x1234_5678_9abcn],
];

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

function moduleWithLoadOffset(offset: bigint): ReturnType<ModuleBuilder['build']> {
  return new ModuleBuilder()
    .addMemory('$m', 1, null)
    .addFunction(
      '$f',
      [],
      [ValType.I32],
      makeLoad(4, false, offset, 2, makeI32Const(0), ValType.I32),
    )
    .build();
}

describe('memarg offsets survive the full 64-bit range', () => {
  for (const [label, offset] of OFFSETS) {
    it(`load: ${label} (${offset}) round-trips`, () => {
      const bytes = encodeWasm(moduleWithLoadOffset(offset));
      const back = parseWasm(bytes);
      const load = findNode(back.functions[0]?.body, ExpressionKind.Load);
      assertEquals(load?.offset, offset, `offset ${offset} did not survive`);
    });
  }

  it('store: an offset above 2^32 round-trips', () => {
    const offset = 0x1_0000_0010n;
    const mod = new ModuleBuilder()
      .addMemory('$m', 1, null)
      .addFunction(
        '$f',
        [],
        [],
        makeStore(4, offset, 2, makeI32Const(0), makeI32Const(7)),
      )
      .build();
    const back = parseWasm(encodeWasm(mod));
    const store = findNode(back.functions[0]?.body, ExpressionKind.Store);
    assertEquals(store?.offset, offset);
  });

  it('the encoded bytes differ between 8 and 2^32 + 8', () => {
    // The teeth. Truncation maps both onto the same LEB, so a round-trip test
    // alone could pass while the bytes were wrong — this compares the encodings
    // directly, which is the property `writeU32` violated.
    const small = encodeWasm(moduleWithLoadOffset(8n));
    const large = encodeWasm(moduleWithLoadOffset(0x100000008n));
    assertEquals(
      small.length === large.length && small.every((b, i) => b === large[i]),
      false,
      'offset 8 and offset 2^32+8 encoded identically — the offset was truncated',
    );
  });
});
