// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Folded `wasm2wat` layout: every sibling expression and every operand of a
// folded instruction starts its own line, and `(then` / `(else` / `(do` /
// `(catch` are followed by one — the layout upstream `wasm2wat --fold-exprs`
// and `wasm-tools print --fold-instructions` both print (measured
// 2026-09-29). Ours closed each folded expression with a SPACE, so siblings
// ran on: `(i32.const 0) (i32.const 1)) (i32.store`. Text only, never bytes.
// A constant expression in a declaration stays on one line, as upstream's
// does: `(global i32 (i32.const 7))`.

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

/** Upstream's and wasm-tools' folded layout of the body (they add a label comment on the unnamed `if`). */
const BODY = `  (func $f (type 0) (param $x i32) (result i32)
    (i32.store
      (i32.const 0)
      (i32.const 1))
    (i32.store
      (i32.const 4)
      (local.get $x))
    (if
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

  it('keeps a constant expression in a declaration on one line', () => {
    assertStringIncludes(wasm2wat(bytes, { fold: true }).text, '(global $g i32 (i32.const 7))');
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
