// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28), divergence CL23: an EMPTY `(rec)` group is legal and occupies a
// type-section slot while defining no type. The IR records a group on its first member, so an
// empty one had nowhere to go and was DROPPED — by the parser and by the binary reader:
// `(rec) (type $t (func)) (rec)` gave a section of one group (`01 04 01 60 00 00`) where
// wasm-tools writes three. It is kept now in the module's fidelity table (as-written data beside
// the tree) and written back in place, as text and as bytes; optimization resets that table, so
// optimized output still drops it (an empty group means nothing). Upstream wabt has no `rec`.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

const assemble = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false, features: allFeatures(), validate: true });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  return r.binary;
};

/** The type section's bytes: id, size, then its vector. */
function typeSection(bytes: Uint8Array): number[] {
  assertEquals(bytes[8], 0x01, 'the first section is the type section');
  return [...bytes.subarray(8, 10 + bytes[9]!)];
}

const WAT = `(module
  (rec)
  (type $t (func))
  (rec)
  (rec (type $a (struct)) (type $b (array i8)))
  (rec)
  (func (type $t)))`;

describe('code lens 3 — empty rec groups are kept, in place', () => {
  it('text → binary: every empty group is a slot, as wasm-tools writes it', () => {
    // 5 slots: (rec), $t, (rec), (rec $a $b), (rec).
    assertEquals(typeSection(assemble(WAT)), [
      0x01,
      0x11, // 17 bytes: the count, then 2 + 3 + 2 + 7 + 2
      0x05,
      0x4e,
      0x00,
      0x60,
      0x00,
      0x00,
      0x4e,
      0x00,
      0x4e,
      0x02,
      0x5f,
      0x00,
      0x5e,
      0x78,
      0x00,
      0x4e,
      0x00,
    ]);
  });

  it('binary → text → binary gives the same bytes', () => {
    const first = assemble(WAT);
    const text = wasm2wat(first).text;
    assertEquals(text.match(/\(rec\)/g)?.length, 3, text);
    assertEquals([...assemble(text)], [...first]);
  });

  it('a module of nothing but (rec) still has its type section', () => {
    assertEquals(typeSection(assemble('(module (rec) (rec))')), [
      0x01,
      0x05,
      0x02,
      0x4e,
      0x00,
      0x4e,
      0x00,
    ]);
  });

  it('optimization drops them', () => {
    const mod = readForPasses(assemble(WAT));
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).add('Vacuum').run();
    const out = writeWasm(mod);
    assert(
      !typeSection(out).some((b, i, a) => b === 0x4e && a[i + 1] === 0x00),
      'an empty group survived',
    );
  });
});
