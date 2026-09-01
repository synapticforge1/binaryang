// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The last three corpus modules binaryen-ts could not re-read from our own
// folded output. Two unrelated defects, both raised by the ENCODER with no
// source position, which is why they read as one mysterious tail rather than
// two ordinary bugs.
//
//   1. An ANONYMOUS `block` registered the synthesized name `$depth{N}` in the
//      parser's label map but stored `name: null` on the node. The encoder
//      pushes `e.name ?? ''`, so the frame went on its stack as `''` — while a
//      numeric branch, which this parser resolves by reverse lookup to whichever
//      name sits at that depth, asked for `$depth3`. Hence `unresolved branch
//      label: "$depth3"` at encode time. `loop` was immune because it already
//      defaulted to `$loop{N}`, and `if` because it already threaded its own
//      label onto the node.
//
//      ⚠️ `try` and `try_table` had the same latent shape and were made
//      consistent in the same change, but NO corpus module demonstrated it —
//      reverting just those two leaves all 421 passing. They are not what these
//      tests cover, and should not be described as fixed defects.
//
//   2. `parseFuncType` skipped an inline `(export ...)` but not a `(type N)`
//      reference, and the reference comes FIRST. So the import descriptor our
//      own writer emits — `(func $f0 (type 0) (param i32 i32))`, naming both —
//      stopped the `(param ...)` loop before it started and yielded `() -> ()`.
//      The encoder then failed to find that signature in the type section:
//      `unresolved GC function type: () -> ()`, from the IMPORT section.
//
// ⚠️ These parse the folded WAT DIRECTLY rather than going through
// `wasm2wat --fold` first. Written as a round trip they all passed with the fix
// reverted — the writer NAMES a block it emits a branch to, so the anonymous
// case never reached the parser. Confirmed by reverting the fix and watching
// these fail; the round-trip spelling of the same fixtures did not.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

const call = (bytes: Uint8Array, arg = 0) =>
  (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
    .exports.f as (x: number) => number)(arg);

/** Parse with binaryen-ts and run; wabt-ts builds the same source as a reference. */
function bothAgree(wat: string, want: number, arg = 0): void {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the source');
  assertEquals(call(ref.binary, arg), want, 'wabt-ts');
  assertEquals(call(encodeWasm(parseWat(wat)), arg), want, 'binaryen-ts');
}

describe('WAT parser — an anonymous block keeps a resolvable label', () => {
  it('a numeric branch targets an ANONYMOUS block', () => {
    bothAgree(
      '(module (func (export "f") (param i32) (result i32) (block (result i32) (br 0 (i32.const 7)))))',
      7,
    );
  });

  // Depth is what separates these, so they must NOT agree — a resolver that
  // collapsed both to the innermost frame would pass either one alone. Both
  // blocks are anonymous, so both sides of the comparison exercise the fix.
  it('nested ANONYMOUS blocks stay distinguishable by depth', () => {
    const inner =
      '(module (func (export "f") (param i32) (result i32) (block (result i32) (block (result i32) (br 0 (i32.const 5))))))';
    const outer =
      '(module (func (export "f") (param i32) (result i32) (block (result i32) (block (result i32) (br 1 (i32.const 9))))))';
    bothAgree(inner, 5);
    bothAgree(outer, 9);
  });

  // The shape from 1_fib-rs-opt.wat: an anonymous frame deep enough that its
  // synthesized name carries a non-zero depth. Each level adds a distinct power
  // of ten, so the result says exactly how many frames the branch escaped —
  // taking `br 3` skips all four and yields 0, while resolving it as depth 0
  // would run the outer three and yield 1110.
  it('a deep ANONYMOUS nest resolves the branch to the RIGHT level', () => {
    const wat = `(module (func (export "f") (param i32) (result i32) (local i32)
      (block (block (block (block
        (br_if 3 (local.get 0))
        (local.set 1 (i32.const 1)))
        (local.set 1 (i32.add (local.get 1) (i32.const 10))))
        (local.set 1 (i32.add (local.get 1) (i32.const 100))))
        (local.set 1 (i32.add (local.get 1) (i32.const 1000))))
      (local.get 1)))`;
    bothAgree(wat, 0, 1); // branch taken: escapes all four frames
    bothAgree(wat, 1111, 0); // not taken: every level runs
  });

  it('a branch past an anonymous block to the function frame still returns', () => {
    // Guards the other direction: naming anonymous frames must not shadow the
    // function frame, which the encoder seeds as the empty name.
    bothAgree(
      '(module (func (export "f") (param i32) (result i32) (block (result i32) (br 1 (i32.const 3)))))',
      3,
    );
  });

  it('the whole shape survives the real folded round trip', () => {
    // The integration spelling. It did NOT catch the defect on its own — the
    // writer renames the block — so it stands as a regression guard on the
    // pipeline, not as the test for the fix.
    const src =
      '(module (func (export "f") (param i32) (result i32) (block (result i32) (br 0 (i32.const 7)))))';
    const first = wat2wasm(src, { filename: 's.wat' });
    assert(first.binary && !hasErrors(first.errors));
    const folded = wasm2wat(first.binary, { fold: true }).text;
    assertEquals(call(encodeWasm(parseWat(folded))), 7);
  });
});

describe('WAT parser — a type use names the signature', () => {
  // `(type N)` FIRST, then explicit params: the exact descriptor our writer
  // emits, and the one that yielded `() -> ()`.
  //
  // ⚠️ Every signature in the module must be DECLARED here, `f`'s included. Any
  // explicit `(type ...)` puts the encoder in GC mode, where a function's type
  // is resolved by lookup rather than appended — so a fixture that declares only
  // the import's type fails on `f` with the same diagnostic, from the FUNCTION
  // section rather than the import section. That is a property of the fixture,
  // not of the defect under test.
  const bothForms = `(module
      (type (func (param i32 i32)))
      (type (func (result i32)))
      (import "env" "print" (func $p (type 0) (param i32 i32)))
      (func (export "f") (result i32) (call $p (i32.const 1) (i32.const 2)) (i32.const 5)))`;

  it('an import naming BOTH (type N) and (param ...) keeps its params', () => {
    const text = wasm2wat(encodeWasm(parseWat(bothForms)), { fold: false }).text;
    const imp = text.split('\n').find((l) => l.includes('"print"')) ?? '';
    assert(/i32 i32/.test(imp), `import lost its signature: ${imp}`);
  });

  it('an import with ONLY (type N) resolves its signature from the type', () => {
    const wat = `(module
      (type (func (param i32) (result i32)))
      (type (func (result i32)))
      (import "env" "id" (func $id (type 0)))
      (func (export "f") (result i32) (call $id (i32.const 4))))`;
    const text = wasm2wat(encodeWasm(parseWat(wat)), { fold: false }).text;
    const imp = text.split('\n').find((l) => l.includes('"id"')) ?? '';
    assert(/i32/.test(imp), `import lost its signature: ${imp}`);
  });

  it('an explicit (param ...) with no type reference is unchanged', () => {
    const wat = `(module
      (import "env" "print" (func $p (param i32)))
      (func (export "f") (result i32) (call $p (i32.const 1)) (i32.const 6)))`;
    const text = wasm2wat(encodeWasm(parseWat(wat)), { fold: false }).text;
    const imp = text.split('\n').find((l) => l.includes('"print"')) ?? '';
    assert(/i32/.test(imp), `import lost its signature: ${imp}`);
  });
});
