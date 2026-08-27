// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Four abbreviation forms that all failed the same way — "expected ), got (" —
// because a parser stopped after the FIRST thing it recognised and left the
// rest of a repeatable construct unconsumed.
//
//   T8.1  `(block (type $sig) (result i32) …)` — the grammar is
//         `(type $t)? (param …)* (result …)*` and BOTH halves may appear; the
//         inline signature restates what $sig already says. parseBlockType
//         returned as soon as it had the type index.
//   T8.2  `select (result i32) (result)` — several result GROUPS, any of them
//         empty. Only one group was matched.
//   T8.4  `(tag (export "e") (type $t))` — a tag may name its signature with a
//         type-use instead of spelling it inline, exactly as a function can.
//   T8.5  `(if (i32.const 1) (i32.eqz) (then …))` — a folded `if` condition
//         can span SEVERAL folded instructions, each consuming the previous
//         one's result. Only one was parsed.
//
// Testsuite: parse-clean 249 -> 254, fully V8-valid 237 -> 242.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(wat: string): boolean {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

async function run(wat: string, arg?: number): Promise<unknown> {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  const { instance } = await WebAssembly.instantiate(buf);
  return (instance.exports.f as (a?: number) => unknown)(arg);
}

describe('T8.1 — block type-use plus an inline signature', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    [
      'block',
      '(module (type $s (func (result i32))) (func (result i32) (block (type $s) (result i32) (i32.const 0))))',
    ],
    [
      'loop',
      '(module (type $s (func (result i32))) (func (result i32) (loop (type $s) (result i32) (i32.const 0))))',
    ],
    [
      'if',
      '(module (type $s (func (result i32))) (func (result i32) (if (type $s) (result i32) (i32.const 1) (then (i32.const 2)) (else (i32.const 3)))))',
    ],
    [
      'type-use alone still works',
      '(module (type $s (func (result i32))) (func (result i32) (block (type $s) (i32.const 0))))',
    ],
    [
      'inline alone still works',
      '(module (func (result i32) (block (result i32) (i32.const 0))))',
    ],
    [
      'params too',
      '(module (type $s (func (param i32) (result i32))) (func (result i32) (i32.const 7) (block (type $s) (param i32) (result i32))))',
    ],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      assert(v8Accepts(wat), `V8 rejected: ${name}`);
    });
  }

  it('the type index wins, and the block really carries that signature', async () => {
    assertEquals(
      await run(`(module
        (type $s (func (result i32)))
        (func (export "f") (result i32) (block (type $s) (result i32) (i32.const 42))))`),
      42,
    );
  });
});

describe('T8.2 — select with several result groups', () => {
  it('an empty trailing group is accepted', () => {
    assert(v8Accepts('(module (func (result i32) unreachable select (result i32) (result)))'));
  });
  it('a single group still works', () => {
    assert(v8Accepts('(module (func (result i32) unreachable select (result i32)))'));
  });
  it('a bare select still works', () => {
    assert(v8Accepts(
      '(module (func (param i32 i32 i32) (result i32) (select (local.get 0) (local.get 1) (local.get 2))))',
    ));
  });
});

describe('T8.4 — tag declared with a type-use', () => {
  it('adopts the referenced signature', () => {
    assert(v8Accepts('(module (type $t (func (param i32))) (tag (export "e") (type $t)))'));
  });
  it('an inline tag signature still works', () => {
    assert(v8Accepts('(module (tag $e (param i32)))'));
  });
  it('the adopted signature is the referenced one, not empty', () => {
    // A tag whose params were dropped would encode as `() -> ()` and the
    // throw below would not type-check.
    assert(v8Accepts(`(module
      (type $t (func (param i32)))
      (tag $e (type $t))
      (func (throw $e (i32.const 1))))`));
  });
});

describe('T8.5 — folded if condition spanning several instructions', () => {
  it('two folded instructions form the condition', async () => {
    // (i32.const 0) (i32.eqz) => 1, so the then-branch runs.
    assertEquals(
      await run(`(module (func (export "f") (result i32)
        (if (result i32) (i32.const 0) (i32.eqz) (then (i32.const 10)) (else (i32.const 20)))))`),
      10,
    );
  });

  it('and the inverse case takes the else-branch', async () => {
    assertEquals(
      await run(`(module (func (export "f") (result i32)
        (if (result i32) (i32.const 1) (i32.eqz) (then (i32.const 10)) (else (i32.const 20)))))`),
      20,
    );
  });

  it('a single-instruction condition still works', async () => {
    assertEquals(
      await run(
        `(module (func (export "f") (param i32) (result i32)
        (if (result i32) (local.get 0) (then (i32.const 1)) (else (i32.const 2)))))`,
        1,
      ),
      1,
    );
  });

  it('a condition already on the stack still works', async () => {
    assertEquals(
      await run(`(module (func (export "f") (result i32)
        (i32.const 1) (if (result i32) (then (i32.const 5)) (else (i32.const 6)))))`),
      5,
    );
  });

  it('empty then/else branches parse', () => {
    assert(v8Accepts('(module (func (param i32) (if (local.get 0) (then) (else))))'));
  });
});
