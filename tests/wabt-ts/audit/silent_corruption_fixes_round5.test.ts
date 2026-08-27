// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Round-5 regression tests for the 2026-06-09 silent-corruption audit — the
 * fifth-sweep finding: generateNames emitted synthetic names without the
 * leading `$`, producing invalid WAT on the wasm2wat path that did not
 * round-trip. See cmem/design-decisions.md.
 */

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { generateNames } from '../../../src/wabt-ts/ir/generate-names.ts';
import { makeModule } from '../../../src/wabt-ts/ir/ir.ts';
import type { Func } from '../../../src/wabt-ts/ir/ir.ts';
import { unknownLocation } from '../../../src/wabt-ts/core/error.ts';

const LOC = unknownLocation();

function emptyFunc(name: string): Func {
  return {
    name,
    loc: LOC,
    typeVar: { kind: 'index', value: 0 },
    sig: { params: [], results: [] },
    localDecls: [],
    body: [{ kind: 'nop', loc: LOC }],
    tailcall: false,
  };
}

describe('generateNames synthetic-name validity', () => {
  it('wasm2wat output of a nameless module round-trips through wat2wasm', () => {
    const { binary } = wat2wasm(
      '(module (func (param i32) (result i32) local.get 0) (global i32 (i32.const 0)))',
    );
    const { text } = wasm2wat(binary);
    // Synthetic identifiers must carry the leading `$`.
    assert(text.includes('$f0'), `expected $f0 in:\n${text}`);
    assert(!/\(func f0\b/.test(text), 'func identifier must not be bare f0');
    // The disassembly must be valid WAT (re-compile it).
    const rt = wat2wasm(text);
    assertEquals(rt.result, 0, `round-trip failed: ${rt.errors.map((e) => e.message).join('; ')}`);
  });

  it('disambiguates a synthetic name against a colliding user name', () => {
    const m = makeModule();
    m.types.push({ kind: 'func', name: '', sig: { params: [], results: [] }, loc: LOC });
    m.funcs.push(emptyFunc('')); // index 0 — unnamed
    m.funcs.push(emptyFunc('$f0')); // index 1 — user named it $f0
    generateNames(m);
    const n0 = m.funcs[0]!.name;
    const n1 = m.funcs[1]!.name;
    assertEquals(n1, '$f0'); // user name preserved
    assert(n0 !== n1, `synthetic name must not collide with user $f0 (got ${n0})`);
    assertEquals(n0, '$f0_1');
  });
});
