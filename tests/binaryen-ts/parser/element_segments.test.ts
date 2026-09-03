// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Element segments, and the numeric references that reach into them.
//
// ⚠️ `parseElem` was a STUB — *"Element segments are complex; skip for MVP"* —
// and the consequence was not a missing feature but SILENT WRONG BEHAVIOUR.
// Every element segment was dropped, so a module with a function table
// re-encoded with that table EMPTY. It still validated, because an empty table
// is valid; every `call_indirect` through it then trapped at run time. 45 corpus
// modules lost their element section and nothing reported it.
//
// **So every test here executes the module.** Byte equality alone would not have
// caught the original defect the way it matters, and validity would not have
// caught it at all — the broken output was valid.
//
// Two neighbours, both the same defect in different clothing:
//
//   - an ANONYMOUS table was added to the module as `$table0` but never entered
//     `tableNames`, so `call_indirect` with no explicit table fell through to a
//     `'$0'` sentinel that matches nothing;
//   - a numeric function reference is an INDEX, and the resolver rebuilt the
//     name a nameless function would have had (`$f{n}`). Right only when that
//     function is anonymous. This is the third time this codebase has
//     reconstructed a name instead of resolving an index — see the branch labels
//     and the tag references.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** Build with both toolchains, run both, and require them to agree with `want`. */
function bothAgree(wat: string, want: number): void {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must assemble the fixture');
  const run = (bytes: Uint8Array) =>
    (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
      .exports.f as () => number)();
  assertEquals(run(ref.binary), want, 'wabt-ts');
  assertEquals(run(encodeWasm(parseWat(wat))), want, 'binaryen-ts');
}

/** Two functions returning distinguishable values, and a table with room for both. */
const TWO = `(table 2 funcref)
  (type $t (func (result i32)))
  (func $a (result i32) (i32.const 42))
  (func $b (result i32) (i32.const 7))`;

const callSlot = (n: number) =>
  `(func (export "f") (result i32) (call_indirect (type $t) (i32.const ${n})))`;

describe('WAT parser — element segments initialise the table', () => {
  it('an active segment with an implicit table', () => {
    bothAgree(`(module ${TWO} (elem (i32.const 0) $a) ${callSlot(0)})`, 42);
  });

  // Two entries, and the SECOND is the one called — a segment that wrote only
  // its first entry, or wrote them in the wrong order, would still pass a
  // one-entry test.
  it('a segment with several entries keeps their order', () => {
    bothAgree(`(module ${TWO} (elem (i32.const 0) $a $b) ${callSlot(1)})`, 7);
    bothAgree(`(module ${TWO} (elem (i32.const 0) $a $b) ${callSlot(0)})`, 42);
  });

  // A non-zero offset: an implementation ignoring the offset would put $b in
  // slot 0 and this would return 42 from the wrong slot, or trap.
  it('a non-zero offset places entries where it says', () => {
    bothAgree(`(module ${TWO} (elem (i32.const 1) $b) ${callSlot(1)})`, 7);
  });

  it('the (offset ...) form and the `func` keyword', () => {
    bothAgree(`(module ${TWO} (elem (offset (i32.const 0)) func $b) ${callSlot(0)})`, 7);
  });

  it('a named segment with an explicit (table $t)', () => {
    const wat = `(module (table $tt 2 funcref)
      (type $t (func (result i32)))
      (func $a (result i32) (i32.const 42))
      (elem $seg (table $tt) (offset (i32.const 0)) func $a)
      ${callSlot(0)})`;
    bothAgree(wat, 42);
  });

  it('element EXPRESSIONS, bare and inside (item ...)', () => {
    bothAgree(`(module ${TWO} (elem (i32.const 0) funcref (ref.func $b)) ${callSlot(0)})`, 7);
    bothAgree(
      `(module ${TWO} (elem (i32.const 0) funcref (item (ref.func $b))) ${callSlot(0)})`,
      7,
    );
  });

  // `ref.null` is a legitimate hole, and the IR's `data` is a list of function
  // names with no way to spell "empty" — so dropping it would shift every later
  // entry down one and silently rewire the table. Refusing is the contract.
  it('a ref.null hole is REFUSED rather than silently closed up', () => {
    let threw = false;
    try {
      parseWat(`(module ${TWO} (elem (i32.const 0) funcref (ref.null func) (ref.func $b)))`);
    } catch {
      threw = true;
    }
    assert(threw, 'a table hole must not be silently dropped');
  });
});

describe('WAT parser — numeric references resolve by INDEX', () => {
  it('a numeric function index in an element segment', () => {
    // Index 1 is `$b`. Reconstructing `$f1` would not resolve, because the
    // function at index 1 has a name.
    bothAgree(`(module ${TWO} (elem (offset (i32.const 0)) func 1) ${callSlot(0)})`, 7);
  });

  it('a numeric call to a NAMED function', () => {
    bothAgree(
      `(module (func $x (result i32) (i32.const 111)) (func $y (result i32) (i32.const 222))
        (func (export "f") (result i32) (call 1)))`,
      222,
    );
  });

  it('a numeric call still works when the target is anonymous', () => {
    // The case the old `$f{n}` reconstruction got right, kept as the control.
    bothAgree(
      `(module (func (result i32) (i32.const 111)) (func (result i32) (i32.const 222))
        (func (export "f") (result i32) (call 1)))`,
      222,
    );
  });

  it('call_indirect through an ANONYMOUS table resolves', () => {
    // The table has no `$name`, so it is registered under the synthesized one.
    bothAgree(`(module ${TWO} (elem (i32.const 0) $a) ${callSlot(0)})`, 42);
  });
});
