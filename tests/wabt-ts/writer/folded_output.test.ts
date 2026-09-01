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

  // ---------------------------------------------------------------------------
  // Control flow folds around a BODY rather than operands.
  //
  // A folded `(block …)` wraps an instruction SEQUENCE, so its body may itself
  // be linear — which is why block and loop always fold whatever they contain.
  // Only `if` can decline, because its condition is an operand.
  // ---------------------------------------------------------------------------

  it('block and if fold, and the forms still agree', () => {
    const src = `(module (func (export "f") (param i32) (result i32)
      (block $a (result i32)
        (if (result i32) (local.get 0)
          (then (i32.const 1))
          (else (i32.const 2))))))`;
    const folded = wasm2wat(asm(src, 's.wat'), { fold: true }).text;
    assert(
      folded.includes('(block'),
      `expected a folded block, got:
${folded}`,
    );
    assert(folded.includes('(if'), 'if must fold');
    assert(folded.includes('(then'), 'the then-arm is a folded clause');
    // No backslash escapes here on purpose: the shell layer eats them, which
    // has now corrupted three edits in this session.
    const NL = String.fromCharCode(10);
    assert(
      folded.split(NL).every((l) => l.trim() !== 'end'),
      'a folded block has no `end` keyword',
    );
    assertFormsAgree(src);
  });

  // The folded form drops `end`, not the SCOPE it delimited. `br` depths resolve
  // against the label stack, so failing to push it would silently renumber every
  // branch inside the body — valid output, wrong module.
  it('branch depths survive folding', () => {
    // `br_if` KEEPS its value on the stack when the branch is not taken, so the
    // inner block must consume it — the first draft of this fixture left two
    // values where one was declared and was rejected for being wrong WAT, not
    // for anything to do with folding.
    const src = `(module (func (export "f") (param i32) (result i32)
      (block $outer (result i32)
        (block $inner
          (br_if $outer (i32.const 7) (local.get 0))
          (drop))
        (i32.const 1))))`;
    assertFormsAgree(src);
    const folded = wasm2wat(asm(src, 's.wat'), { fold: true }).text;
    const run = (n: number) => {
      const inst = new WebAssembly.Instance(
        new WebAssembly.Module(asm(folded, 'f.wat') as BufferSource),
      );
      return (inst.exports.f as (x: number) => number)(n);
    };
    assertEquals(run(1), 7, 'branch taken must reach $outer');
    assertEquals(run(0), 1, 'fall through');
  });

  it('a loop folds and still terminates correctly', () => {
    assertFormsAgree(`(module (func (export "f") (result i32)
      (local i32)
      (loop $l
        (local.set 0 (i32.add (local.get 0) (i32.const 1)))
        (br_if $l (i32.lt_s (local.get 0) (i32.const 5))))
      (local.get 0)))`);
  });

  it('nested control flow agrees', () => {
    assertFormsAgree(`(module (func (export "f") (param i32) (result i32)
      (block $a (result i32)
        (loop $l (result i32)
          (if (result i32) (local.get 0)
            (then (block $b (result i32) (i32.const 3)))
            (else (i32.const 4)))))))`);
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

  // ---------------------------------------------------------------------------
  // Branch and return.
  //
  // All four carry `values: Expr[]` — the operands pushed before the transfer —
  // and the ones with a condition or index put THAT on top, so the folded order
  // is `values…` then `cond`/`value`.
  //
  // ⚠️ These were once declared unfoldable, on the reading that a branch's value
  // lives on the stack. That was an artefact of reading the interfaces with
  // `grep -A 9`, which stops inside the docstring that precedes `values`. Folding
  // them with an empty operand list emitted the head while the linear writer
  // still rendered the value, producing `(i32.const 1 br 0)`. The fix was the
  // field list, not the concept — the WAT was always legal.
  // ---------------------------------------------------------------------------

  it('br carries its value inside the parens', () => {
    const src =
      '(module (func (export "f") (result i32) (block $l (result i32) (br $l (i32.const 1)))))';
    const folded = wasm2wat(asm(src, 's.wat'), { fold: true }).text;
    assert(
      folded.includes('(br'),
      `expected a folded br, got:
${folded}`,
    );
    assertFormsAgree(src);
  });

  it('return folds its value', () => {
    assertFormsAgree('(module (func (export "f") (result i32) (return (i32.const 5))))');
  });

  it('br_if puts the condition AFTER the carried values', () => {
    assertFormsAgree(`(module (func (export "f") (param i32) (result i32)
      (block $l (result i32)
        (br_if $l (i32.const 7) (local.get 0))
        (i32.const 1))))`);
  });

  it('br_table keeps its index distinct from its carried values', () => {
    assertFormsAgree(`(module (func (export "f") (param i32) (result i32)
      (block $a (result i32)
        (block $b (result i32)
          (br_table $a $b $a (i32.const 3) (local.get 0))))))`);
  });

  // Multi-value is why `values` is a LIST: an earlier single `value?` slot
  // dropped all but the first operand, per BrExpr's own docstring.
  it('a multi-value branch keeps every operand', () => {
    assertFormsAgree(`(module (func (export "f") (result i32 f64)
      (block $l (result i32 f64)
        (br $l (i32.const 79) (f64.const 8)))))`);
  });
});
