// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Folded `wasm2wat` folds EVERY instruction (divergence W11).
//
// The owner rule (cmem/best-practices.md, 2026-09-10): "anything written
// linearly can be written folded by putting parentheses around the
// instruction" — "this has no folded form" is never a reason. The writer's
// fold table (`foldSpec`) had no case for ~30 kinds — atomics, most SIMD, GC
// arrays, bulk table ops, `br_on`, `call_ref`, `throw_ref` — and `try_table`
// never folded; one of them sent its whole expression, and every block in it,
// to the linear writer. Over the corpora that was 3,174 linear lines in folded
// output where upstream `wasm2wat --fold-exprs` has none.
//
// Now: every plain kind nests its operands (the visitor gives them in
// evaluation order, the folded order), `try_table` folds as a block, and a
// `pop` — a value already on the stack — writes nothing. Where placeholders are
// SCATTERED through an instruction's operands, nesting cannot say it, so the
// operands fold as siblings before `(op)`, which unfolds to the same sequence.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { writeWatModule } from '../../../src/wabt-ts/writer/wat-writer.ts';
import type { Expr } from '../../../src/wabt-ts/ir/ir.ts';

const KINDS = `(module
  (type $f (func (result i32)))
  (type $arr (array (mut i32)))
  (tag $e)
  (memory 1 1 shared)
  (table $t 1 funcref)
  (data $d "hello")
  (elem $el func $one)
  (func $one (type $f) (i32.const 1))
  (func (export "atomics") (result i32)
    (i32.atomic.rmw.add (i32.const 0) (i32.const 5)))
  (func (export "simd") (result i32)
    (i32x4.extract_lane 1
      (i32x4.replace_lane 1 (v128.const i32x4 0 0 0 0) (i32.const 7))))
  (func (export "bulk")
    (memory.init $d (i32.const 0) (i32.const 0) (i32.const 5))
    (table.init $t $el (i32.const 0) (i32.const 0) (i32.const 1))
    (drop (table.grow $t (ref.null func) (i32.const 1))))
  (func (export "gc") (result i32)
    (local $a (ref null $arr))
    (local.set $a (array.new $arr (i32.const 3) (i32.const 2)))
    (array.set $arr (local.get $a) (i32.const 1) (i32.const 9))
    (array.get $arr (local.get $a) (i32.const 1)))
  (func (export "calls") (result i32)
    (call_ref $f (ref.func $one)))
  (func (export "br_on_null") (param externref) (result i32)
    (block $l
      (drop (br_on_null $l (local.get 0)))
      (return (i32.const 1)))
    (i32.const 0))
  (func (export "try_table") (result i32)
    (block $h (result exnref)
      (try_table (catch_all_ref $h) (throw $e))
      (return (i32.const 0)))
    (drop)
    (i32.const 2)))`;

/** Lines inside a function that start with a bare instruction, not `(`. */
function linearLines(text: string): string[] {
  let inFunc = false;
  return text.split('\n').filter((raw) => {
    const l = raw.trim();
    if (l.startsWith('(func')) inFunc = true;
    else if (/^\((type|table|memory|global|export|import|elem|data|tag)\b/.test(l)) inFunc = false;
    return inFunc && /^[a-z]/.test(l);
  });
}

describe('folded wasm2wat folds every instruction kind', () => {
  const bytes = wat2wasm(KINDS).binary;

  it('the fixture is valid', () => {
    assert(bytes !== undefined && WebAssembly.validate(bytes as BufferSource));
  });

  it('no instruction is written linearly', () => {
    const text = wasm2wat(bytes!).text;
    assertEquals(linearLines(text), [], text);
  });

  it('each nests its operands, as upstream folds them', () => {
    const text = wasm2wat(bytes!).text.replace(/\s+/g, ' ');
    for (
      const want of [
        '(i32.atomic.rmw.add (i32.const 0) (i32.const 5))',
        '(i32x4.extract_lane 1 (i32x4.replace_lane 1 (v128.const',
        // References print their target's name where it has one (2026-09-29).
        '(memory.init $d (i32.const 0) (i32.const 0) (i32.const 5))',
        '(call_ref $f (ref.func $one))',
        '(br_on_null $l (local.get 0))',
        // An unnamed carrier's `;; label = @N`, folded as linear (2026-09-29).
        '(try_table ;; label = @2 (catch_all_ref $h) (throw $e))',
      ]
    ) assert(text.includes(want), `${want}\n${text}`);
  });

  it('both text forms re-assemble to the same bytes', () => {
    const code = wat2wasm(KINDS, { textForm: false }).binary;
    for (const fold of [true, false]) {
      // The same CODE: forcing a form changes the S7 text-form record, and
      // only that — so both sides are assembled without it.
      const text = wasm2wat(bytes!, { fold, asWritten: false }).text;
      assertEquals(wat2wasm(text, { textForm: false }).binary, code, `fold: ${fold}`);
    }
  });

  it('a pop writes nothing: an if condition from the stack, `(if (then …))`', () => {
    // A module is invalid without a condition; the WRITER must still spell the
    // tree it is given, and `()` does not parse.
    const p = parseWatModule('(module (func if (then) end))');
    assert(p.module);
    // Written linearly; this is about the FOLDED writer, so S7's record is set aside.
    const text = writeWatModule(p.module, { fold: true, asWritten: false });
    assert(!text.includes('()'), text);
    // An unnamed `if` carries its `;; label = @N` folded too (2026-09-29).
    assert(/\(if\s+;; label = @\d+\s+\(then\)\)/.test(text), text);
    assert(!/\n\s*\n/.test(text.trim()), `no blank line: ${JSON.stringify(text)}`);
  });

  it('scattered placeholders: the operands fold as siblings before the head', () => {
    // `(i32.add (i32.const 1) pop)` cannot nest positionally — a pop below a
    // written operand. Built by hand: our readers never produce it.
    const p = parseWatModule('(module (func (result i32) (i32.add (i32.const 1) (i32.const 2))))');
    assert(p.module);
    resolveNames(p.module);
    const add = p.module.functions[0]!.body.children[0] as Expr & { right: Expr };
    add.right = { kind: 'pop', loc: add.loc } as Expr;
    const text = writeWatModule(p.module, { fold: true }).replace(/\s+/g, ' ');
    assert(text.includes('(i32.const 1) (i32.add)'), text);
  });
});
