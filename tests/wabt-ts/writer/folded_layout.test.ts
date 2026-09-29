// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Folded `wasm2wat` layout: every sibling expression and every operand of a
// folded instruction starts its own line, and `(then` / `(else` / `(do` /
// `(catch` are followed by one — the layout upstream `wasm2wat --fold-exprs`
// and `wasm-tools print --fold-instructions` both print (measured
// 2026-09-29). Ours closed each folded expression with a SPACE, so siblings
// ran on: `(i32.const 0) (i32.const 1)) (i32.store`. Text only, never bytes.
// A constant expression in a declaration stays on one line, as wasm-tools
// prints it (upstream wabt breaks it; W18 (b)). An unnamed carrier carries
// `;; label = @N` folded, as linear (since 2026-09-29).

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertStringIncludes } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';

const SRC = `(module
  (memory 1)
  (global $g i32 (i32.const 7))
  (func $f (param $x i32) (result i32)
    (i32.store (i32.const 0) (i32.const 1))
    (i32.store (i32.const 4) (local.get $x))
    (if (local.get $x) (then (drop (i32.const 1)) (drop (i32.const 2))))
    (block $b
      (br_if $b (local.get $x))
      (i32.store (i32.const 8) (i32.const 3)))
    (i32.load (i32.const 0))))`;

/** Upstream `wasm2wat --fold-exprs`' layout of the body, exactly (wasm-tools: one space before `;;`). */
const BODY = `  (func $f (type 0) (param $x i32) (result i32)
    (i32.store
      (i32.const 0)
      (i32.const 1))
    (i32.store
      (i32.const 4)
      (local.get $x))
    (if  ;; label = @1
      (local.get $x)
      (then
        (drop
          (i32.const 1))
        (drop
          (i32.const 2))))
    (block $b
      (br_if $b
        (local.get $x))
      (i32.store
        (i32.const 8)
        (i32.const 3)))
    (i32.load
      (i32.const 0)))`;

describe('folded wasm2wat puts each sibling on its own line', () => {
  const bytes = wat2wasm(SRC, { textForm: false }).binary;

  it('lays the body out as upstream and wasm-tools do', () => {
    assertStringIncludes(wasm2wat(bytes, { fold: true }).text, BODY);
  });

  it('an unnamed carrier says its label, folded: the @N a branch names', () => {
    // Folded wrote no `;; label = @N`, so `br 1 (;@2;)` pointed at an `@2`
    // the text never showed. Now every unnamed block / loop / if / try_table
    // carries it, as linear always did, with the SAME number a branch prints.
    const text = wasm2wat(
      wat2wasm(
        `(module (func (param i32) (result i32)
        (block (result i32)
          (loop
            (drop (br_if 1 (i32.const 5) (local.get 0)))
            (if (local.get 0) (then (br 1))))
          (i32.const 9))
        (block (try_table (catch_all 0) (nop)))))`,
        { textForm: false },
      ).binary,
      { fold: true },
    ).text;
    for (
      const want of [
        '(block (result i32)  ;; label = @1',
        '(loop  ;; label = @2',
        '(br_if 1 (;@1;)',
        '(if  ;; label = @3',
        '(br 1 (;@2;)',
        '(try_table  ;; label = @2',
        '(catch_all 0 (;@1;))',
      ]
    ) assertStringIncludes(text, want);
  });

  it('keeps a constant expression in a declaration on one line, both modes', () => {
    // MULTI-instruction ones — a single `(i32.const 7)` fits one line whatever
    // the writer does, so it tested nothing (its mutant survived). Every
    // declaration writer is reached: a global's init, a segment offset, an
    // element item, a table initializer. Expected = `wasm-tools print`'s
    // lines (it writes the item form bare; we keep `(item …)`).
    const decls = wat2wasm(
      `(module
      (type $s (struct (field i32)))
      (import "m" "g" (global $base i32))
      (global $sum i32 (i32.add (global.get $base) (i32.const 8)))
      (table $t 1 (ref null $s) (struct.new $s (i32.add (i32.const 1) (i32.const 2))))
      (memory 1)
      (data (offset (i32.add (global.get $base) (i32.const 4))) "x")
      (func $f)
      (elem funcref (item (ref.func $f))))`,
      { textForm: false },
    ).binary;
    const folded = wasm2wat(decls, { fold: true }).text;
    for (
      const line of [
        '(global $sum i32 (i32.add (global.get $base) (i32.const 8)))',
        '(table $t 1 (ref null $s) (struct.new $s (i32.add (i32.const 1) (i32.const 2))))',
        '(data (;0;) (offset (i32.add (global.get $base) (i32.const 4))) "x")',
        '(elem (;0;) funcref (item (ref.func $f)))',
      ]
    ) assertStringIncludes(folded, line);
    const linear = wasm2wat(decls, { fold: false }).text;
    for (
      const line of [
        '(global $sum i32 global.get $base i32.const 8 i32.add)',
        '(data (;0;) (offset global.get $base i32.const 4 i32.add) "x")',
      ]
    ) assertStringIncludes(linear, line);
    assertEquals(wat2wasm(folded, { textForm: false }).binary, decls);
    assertEquals(wat2wasm(linear, { textForm: false }).binary, decls);
  });

  it('re-assembles to the same bytes', () => {
    assertEquals(wat2wasm(wasm2wat(bytes, { fold: true }).text, { textForm: false }).binary, bytes);
  });

  it('writes else, do and catch clauses the same way', () => {
    const text = wasm2wat(
      wat2wasm(`(module (tag $e) (func (param i32)
        (if (local.get 0) (then (nop)) (else (nop)))
        (try (do (nop)) (catch $e (nop)) (catch_all (nop)))))`).binary,
      { fold: true },
    ).text;
    for (const clause of ['(then\n', '(else\n', '(do\n', '(catch $e\n', '(catch_all\n']) {
      assertStringIncludes(text, clause);
    }
  });
});
