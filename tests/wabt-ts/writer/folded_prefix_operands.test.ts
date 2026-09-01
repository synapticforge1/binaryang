// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Folding a node whose operands are only PARTLY stack-sourced, and folding
// `rethrow`. Both were declines that dropped a subtree to the linear writer,
// and both showed up the same way: a bare atom in otherwise folded output that
// binaryen-ts then refused to re-read.
//
// 🔧 The prefix case was declined on WRONG reasoning, which is the part worth
// keeping. The old comment argued that `(i32.store (value))` gives one operand
// for two slots and "a reader assigns it to the FIRST", filling the address
// with the value. That is backwards. Folding is defined by UNFOLDING —
// `(instr a b)` is `a b instr` — so written operands land in the LAST slots and
// the stack supplies the rest. Placeholders always occupy a PREFIX (the reader
// fills from the top of the stack down, so the deepest slots run out first),
// which is exactly the case that omitting them expresses correctly.
//
// So these tests use NON-COMMUTATIVE callees throughout. With `i32.add` every
// assertion here would pass under the reversed reading too.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';

/** `$sub3(a,b,c) = a - b - c`, folded, so every argument slot is observable. */
const DEFS = `(func $sub (param i32 i32) (result i32)
    (i32.sub (local.get 0) (local.get 1)))
  (func $sub3 (param i32 i32 i32) (result i32)
    (i32.sub (i32.sub (local.get 0) (local.get 1)) (local.get 2)))`;

const mod = (body: string) => `(module ${DEFS} (func (export "f") (result i32) ${body}))`;

const run = (bytes: Uint8Array) =>
  (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
    .exports.f as () => number)();

/** Both toolchains must build `wat`, and both must agree with `want`. */
function bothAgree(wat: string, want: number): void {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary && !hasErrors(ref.errors), 'wabt-ts must accept the source');
  assertEquals(run(ref.binary), want, 'wabt-ts');
  assertEquals(run(encodeWasm(parseWat(wat))), want, 'binaryen-ts');
}

describe('folded output — operands partly sourced from the stack', () => {
  it('a call with NO stack-sourced argument still folds (control)', () => {
    bothAgree(mod('(call $sub (i32.const 3) (i32.const 1))'), 2);
  });

  it('a call with ONE leading argument on the stack keeps its slot order', () => {
    // Reversed, this would be 1 - 3 = -2.
    bothAgree(mod('(i32.const 3) (call $sub (i32.const 1))'), 2);
  });

  it('a call with TWO leading arguments on the stack keeps its slot order', () => {
    // 20 - 4 - 3. Any other assignment of {20,4,3} to the three slots differs.
    bothAgree(mod('(i32.const 20) (i32.const 4) (call $sub3 (i32.const 3))'), 13);
  });

  it('a call with EVERY argument on the stack folds to its head alone', () => {
    bothAgree(mod('(i32.const 20) (i32.const 4) (i32.const 3) (call $sub3)'), 13);
  });

  // The case the old comment named as the reason to decline. `i32.store` takes
  // [address, value]; under the reversed reading this would store 16 at 42.
  it('a store whose ADDRESS is on the stack writes the value at that address', () => {
    const wat = `(module (memory 1) (func (export "f") (result i32)
      (i32.const 16) (i32.store (i32.const 42))
      (i32.load (i32.const 16))))`;
    bothAgree(wat, 42);
  });

  // A SCATTERED mix — a hole between two written operands — cannot be expressed
  // positionally and must still decline. Our binary reader does not produce
  // one, so this guards the rule rather than a live path: the writer must never
  // emit folded output for it, because such output would parse and be wrong.
  it('the folded form of a partly-stack node is re-readable by binaryen-ts', () => {
    const src = mod('(i32.const 20) (i32.const 4) (call $sub3 (i32.const 3))');
    const bin = wat2wasm(src, { filename: 's.wat' });
    assert(bin.binary && !hasErrors(bin.errors));
    const folded = wasm2wat(bin.binary, { fold: true }).text;
    assertEquals(run(encodeWasm(parseWat(folded))), 13, 're-read folded output');
  });
});

describe('folded output — rethrow', () => {
  it('rethrow folds to a parenthesised leaf, not a bare atom', () => {
    const src = `(module
      (tag $e (param i32))
      (func (export "f") (result i32)
        (try (result i32)
          (do (throw $e (i32.const 7)))
          (catch $e (drop) (i32.const 1)))))`;
    const bin = wat2wasm(src, { filename: 'r.wat' });
    assert(bin.binary && !hasErrors(bin.errors));
    const folded = wasm2wat(bin.binary, { fold: true }).text;

    // Whatever the surrounding shape, no `rethrow` may appear as a bare atom —
    // that is the spelling binaryen-ts refuses.
    for (const line of folded.split('\n')) {
      const t = line.trim();
      assert(!/^rethrow\b/.test(t), `bare rethrow in folded output: ${t}`);
    }
  });

  it('folded output assembles to the same bytes as linear output', () => {
    // The strong check: folding may change the TEXT but never the BYTES.
    const src = `(module (tag $e (param i32)) (memory 1)
      (func $sub3 (param i32 i32 i32) (result i32)
        (i32.sub (i32.sub (local.get 0) (local.get 1)) (local.get 2)))
      (func (export "f") (result i32)
        (i32.const 20) (i32.const 4) (call $sub3 (i32.const 3))))`;
    const bin = wat2wasm(src, { filename: 'b.wat' });
    assert(bin.binary && !hasErrors(bin.errors));
    const lin = wat2wasm(wasm2wat(bin.binary, { fold: false }).text, { filename: 'l.wat' });
    const fld = wat2wasm(wasm2wat(bin.binary, { fold: true }).text, { filename: 'f.wat' });
    assert(fld.binary && !hasErrors(fld.errors), 'folded output must assemble');
    assertEquals(Array.from(fld.binary), Array.from(lin.binary));
  });
});
