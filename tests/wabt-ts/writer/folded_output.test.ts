// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Folded WAT output — `wasm2wat --fold`.
//
// Folding is a TEXT-layer choice: the binary format has no notion of it, so both
// spellings must assemble to identical bytes. That makes this the shape
// testing.md calls out as needing NO ORACLE — a differential between two
// spellings of the same thing, which agree by construction, so any disagreement
// is a bug and no expected-output fixtures are needed.
//
// The renderer declines rather than guesses. A node it cannot fold falls back to
// the linear writer individually, so output is MIXED and always correct; adding
// kinds widens the folding without ever risking the fallback.
//
// ⚠️ Two kinds of node can never fold, and both are properties of the IR rather
// than gaps in the renderer:
//   - a `placeholder` operand means "the value is already on the stack", which
//     linear spells by writing nothing and folded cannot spell at all;
//   - some expressions carry NO operand field (`i31.get` is `{kind, signed}`),
//     so the operand is not reachable from the node to fold into it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** Assemble WAT, or fail loudly with the first diagnostic. */
function asm(wat: string, name: string): Uint8Array {
  const r = wat2wasm(wat, { filename: name });
  assert(r.binary !== undefined && !hasErrors(r.errors), `${name} failed to assemble`);
  return r.binary;
}

/**
 * The invariant: for any module, the folded and linear disassemblies must
 * assemble to the SAME bytes. Asserting bytes rather than text is deliberate —
 * the two texts are supposed to differ; only the meaning must not.
 */
function assertFormsAgree(source: string) {
  const original = asm(source, 'src.wat');
  const linear = wasm2wat(original, { fold: false }).text;
  const folded = wasm2wat(original, { fold: true }).text;
  assertEquals([...asm(folded, 'folded.wat')], [...asm(linear, 'linear.wat')]);
}

describe('wasm2wat --fold', () => {
  it('folds a nested arithmetic expression', () => {
    const src =
      '(module (func (export "f") (result i32) (i32.add (i32.const 1) (i32.mul (i32.const 2) (i32.const 3)))))';
    const folded = wasm2wat(asm(src, 's.wat'), { fold: true }).text;
    assert(folded.includes('(i32.add'), `expected a folded head, got:\n${folded}`);
    assert(folded.includes('(i32.mul'), 'nested operands must fold too');
  });

  it('linear remains the default', () => {
    const bin = asm(
      '(module (func (export "f") (result i32) (i32.add (i32.const 1) (i32.const 2))))',
      's.wat',
    );
    assertEquals(wasm2wat(bin, {}).text, wasm2wat(bin, { fold: false }).text);
  });

  it('the two forms assemble to identical bytes', () => {
    assertFormsAgree(
      '(module (func (export "f") (param i32) (result i32) (i32.add (local.get 0) (i32.mul (i32.const 2) (i32.const 3)))))',
    );
  });

  it('folded output still executes correctly', () => {
    const src =
      '(module (func (export "f") (param i32) (result i32) (i32.add (local.get 0) (i32.mul (i32.const 2) (i32.const 3)))))';
    const folded = wasm2wat(asm(src, 's.wat'), { fold: true }).text;
    const inst = new WebAssembly.Instance(
      new WebAssembly.Module(asm(folded, 'f.wat') as BufferSource),
    );
    assertEquals((inst.exports.f as (x: number) => number)(10), 16, '10 + 2*3');
  });

  // Control flow is not yet foldable, so these must come out linear and still be
  // correct. This is the fallback doing its job, not a failure.
  it('a construct the renderer declines falls back to linear, still correct', () => {
    assertFormsAgree(`(module (func (export "f") (param i32) (result i32)
      (block $a (result i32)
        (if (result i32) (local.get 0)
          (then (i32.const 1))
          (else (i32.const 2))))))`);
  });

  it('memory operations fold and agree', () => {
    assertFormsAgree(`(module (memory 1)
      (func (export "f") (result i32)
        (i32.store (i32.const 0) (i32.const 42))
        (i32.load (i32.const 0))))`);
  });

  it('calls fold their arguments', () => {
    assertFormsAgree(`(module
      (func $add (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
      (func (export "f") (result i32) (call $add (i32.const 3) (i32.const 4))))`);
  });

  it('globals, locals and drops agree', () => {
    assertFormsAgree(`(module (global $g (mut i32) (i32.const 0))
      (func (export "f") (result i32)
        (local i32)
        (global.set $g (i32.const 5))
        (local.set 0 (global.get $g))
        (drop (i32.const 9))
        (local.get 0)))`);
  });
});
