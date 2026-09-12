// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The block/label family (S6): a branch whose TARGET LABEL has a name is
// printed by that name — `br $outer`, not `br 1 (;@1;)`.
//
// 🔧 A binary holds only a DEPTH, so every branch read from one is an index.
// N2 gives the target block its name back from the `name` section (subsection
// 3), and we were printing `block $outer` two lines above `br 1` — the name was
// right there and unused. `wasm-tools print` uses it; upstream `wasm2wat` prints
// `br 1 (;@1;)` because it does not read label names at all.
//
// ⚠️ The rule is NOT "always prefer the name": a nearer label with the same name
// captures the reference, so `(block $b (block $b (br 1)))` must keep the depth
// — printing `$b` there would retarget the branch to the inner block.
//
// ⚠️ Consequence, accepted: TEXT that wrote a numeric target at a NAMED block
// (`(block $b (br 0))`) now prints `(br $b)`. The bytes are identical — the
// corpus moved 415 text hashes and 0 byte hashes — and the name reaching the
// text is the point of N2. The as-written numeric spelling is not reproduced.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
/** `wasm2wat` of the assembled text, whitespace flattened. */
function roundTrip(wat: string): string {
  return wasm2wat(assemble(wat)).text.replace(/\s+/g, ' ').trim();
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

describe('a named branch target is printed by name', () => {
  it('br to a named outer block', () => {
    const text = roundTrip('(module (func $f (block $outer (block $inner (br $outer)))))');
    assert(text.includes('(br $outer)'), text);
    assert(!text.includes('br 1'), text);
  });

  it('br_if and br_table too', () => {
    const brIf = roundTrip('(module (func $f (block $b (br_if $b (i32.const 1)))))');
    assert(brIf.includes('(br_if $b'), brIf);
    const brTable = roundTrip(
      '(module (func $f (block $a (block $b (br_table $a $b $a (i32.const 0))))))',
    );
    assert(brTable.includes('$a $b $a') || brTable.includes('$a $b $a)'), brTable);
  });

  it('the text re-assembles to the SAME bytes — the name resolves to that depth', () => {
    const wat = '(module (func $f (block $outer (block $inner (br $outer)))))';
    const first = assemble(wat);
    assert(same(assemble(roundTrip(wat)), first), roundTrip(wat));
  });

  it("and the round trip now reconstitutes the source's own spelling", () => {
    // N1's rule, one hop further: the source said `br $outer`, and so does the
    // output. It said `br 1 (;@1;)` before.
    const text = roundTrip('(module (func $f (block $outer (block $inner (br $outer)))))');
    assert(text.includes('block $outer') && text.includes('(br $outer)'), text);
  });
});

describe('…except where the name would mean a different block', () => {
  it('a nearer label with the SAME name keeps the depth', () => {
    // `$b` here resolves to the INNER block, so the outer one cannot be named.
    const text = roundTrip('(module (func $f (block $b (block $b (br 1)))))');
    assert(text.includes('br 1'), text);
  });

  it('and that text still re-assembles to the same bytes', () => {
    const wat = '(module (func $f (block $b (block $b (br 1)))))';
    assert(same(assemble(roundTrip(wat)), assemble(wat)), roundTrip(wat));
  });

  it('an inner branch to the INNER same-named block prints the name', () => {
    const text = roundTrip('(module (func $f (block $b (block $b (br 0)))))');
    assert(text.includes('(br $b)'), text);
  });

  it('an unnamed target keeps the depth and its `(;@N;)` comment', () => {
    const text = roundTrip('(module (func $f (block (block (br 1)))))');
    assert(text.includes('br 1 (;@1;)'), text);
  });
});

describe('the label a function frame introduces', () => {
  it('a branch to the function frame is still a depth when it has no name', () => {
    const text = roundTrip('(module (func $f (br 0)))');
    assert(text.includes('br 0'), text);
  });

  it('a loop is named like a block', () => {
    const text = roundTrip('(module (func $f (loop $l (br $l))))');
    assert(text.includes('(br $l)'), text);
  });
});
