// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8b5 (cmem/ir-convergence.md, item 6 M8): the one module carries wabt-ts's
// AS-WRITTEN metadata — the text-form side table (`fidelity`) and each section's
// byte range (`sectionMeta`). An optimized module has no original for them to
// describe, so a pass run with at least one pass clears both, as `fidelity.ts`
// has always said binaryen-ts's passes would; a run with none is a plain read
// and write, and keeps them.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';

/** A module whose as-written metadata is non-empty. */
function withMetadata(): WasmModule {
  const m = readWat('(module (func (export "f") (result i32) (i32.const 1)))');
  m.fidelity.record({ typeUse: 'inline' });
  m.sectionMeta.push({ id: 1, name: 'type', offset: 8, size: 4, contentOffset: 10 } as never);
  return m;
}

describe('M8b5 — the one module carries as-written metadata; optimizing clears it', () => {
  it('a module built by the API starts with none', () => {
    const m = new ModuleBuilder().build();
    assertEquals(m.sectionMeta, []);
    assertEquals(m.customSections, []);
    assertEquals(m.filename, '');
  });

  it('a run with no pass keeps it', () => {
    const m = withMetadata();
    const table = m.fidelity;
    // 🔧 This asserted exactly 1 entry — the one pushed above — because `readWat`
    // went through binaryen-ts's decoder, which records no sections. Since One
    // front end stage 3 it takes the wabt-ts reader, which records its own; what
    // the test is about is that a plain run KEEPS them.
    const before = [...m.sectionMeta];
    assert(before.length > 1, 'the reader recorded sections, and the pushed one is there');
    new PassRunner(m).run();
    assert(m.fidelity === table, 'the side table must survive a plain read and write');
    assertEquals(m.sectionMeta, before);
  });

  it('a run with a pass clears it', () => {
    const m = withMetadata();
    const table = m.fidelity;
    new PassRunner(m).add('Vacuum').run();
    assert(m.fidelity !== table, 'the side table describes an original that is gone');
    assertEquals(m.sectionMeta, []);
  });
});
