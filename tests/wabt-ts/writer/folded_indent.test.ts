// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Folded WAT is indented by its nesting: a line starts 2 columns in for every
// paren open at its start.
//
// The folded writer's block, loop, if and try each subtracted 2 from the indent
// by hand before `close()` subtracted it again — so every block, clause and
// `if` drifted the output two columns LEFT, and nested code ran into the
// margin (`(func (;3;)` at column 0 after one function with a folded `if`).
// Bytes were never affected. It was hidden while wasm2wat gave every block a
// generated label, which wrapped the line differently; once it stopped
// inventing names (N1 P3) it showed everywhere.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';

/** Lines whose indentation is not 2 × the parens open at their start. */
function misindented(text: string): string[] {
  const bad: string[] = [];
  let depth = 0;
  for (const line of text.split('\n')) {
    const indent = line.length - line.trimStart().length;
    if (line.trim() !== '' && indent !== 2 * depth) {
      bad.push(`depth ${depth}, indent ${indent}: ${line}`);
    }
    // Block comments `(;…;)` and strings hold parens that open nothing.
    const code = line.replace(/\(;.*?;\)/g, '').replace(/"(?:[^"\\]|\\.)*"/g, '');
    for (const c of code) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
  }
  return bad;
}

const WAT = `(module
  (tag $e)
  (func $f (param i32) (result i32)
    (block $a
      (loop $l
        (br_if $a (local.get 0))
        (br $l)))
    (if (result i32) (block (result i32) (i32.const 1))
      (then (block (nop)) (i32.const 2))
      (else (i32.const 3))))
  (func $t
    (try (do (throw $e)) (catch $e (nop)) (catch_all (nop))))
  (func $d
    (try $outer (do (try (do (nop)) (delegate $outer)))))
  (func))`;

describe('folded WAT is indented by its nesting', () => {
  it('block, loop, if with then/else, and a block as an if condition', () => {
    const text = wasm2wat(wat2wasm(WAT).binary).text;
    assertEquals(misindented(text), [], text);
  });

  it('try with catch clauses, and try … delegate', () => {
    const text = wasm2wat(wat2wasm(WAT).binary, { generateNames: true }).text;
    assertEquals(misindented(text), [], text);
  });
});
