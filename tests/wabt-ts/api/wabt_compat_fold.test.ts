// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): the wabt.js facade's `toText({ foldExprs })` ignored the option,
// and its doc said the output was linear "regardless" — it was folded. `foldExprs: false` now
// writes linear WAT; the default stays folded, as before (libwabt.js's default is linear: a
// recorded divergence, the owner's to change).

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import wabt from '../../../src/compat/wabt-compat.ts';

const WAT =
  '(module (func (export "f") (param i32) (result i32) (i32.add (local.get 0) (i32.const 1))))';

describe('code lens 3 — wabt compat toText honours foldExprs', () => {
  it('foldExprs: false is linear, the default and true are folded', async () => {
    const w = await wabt();
    const m = w.parseWat('f.wat', WAT);
    const linear = m.toText({ foldExprs: false });
    const folded = m.toText({ foldExprs: true });
    const byDefault = m.toText();
    assert(/\n\s*local\.get 0\n\s*i32\.const 1\n\s*i32\.add/.test(linear), linear);
    assert(folded.includes('(i32.add'), folded);
    assert(byDefault.includes('(i32.add'), byDefault);
    m.destroy();
  });
});
