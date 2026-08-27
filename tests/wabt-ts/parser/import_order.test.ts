// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T12.2 — an import after a definition was accepted, and silently RENUMBERED
// the module.
//
// Imports occupy the low indices of every index space, so the spec forbids one
// from following a definition of a function, table, memory, global or tag
// (`assert_malformed`, "import after function" / "…global" / "…table").
//
// We accepted them and emitted the import FIRST, which shifts every index the
// module already referred to. Demonstrated, and it is not a theoretical
// renumbering — the module runs and returns a different answer:
//
//     (module
//       (func $defined  (result i32) (i32.const 111))
//       (import "host" "imported" (func $imported (result i32)))
//       (func (export "which") (result i32) (call 0)))
//
//     source order says `call 0` is $defined  -> 111
//     what we produced  says `call 0` is the import -> 999
//
// V8 accepts the result, so nothing downstream catches it. Same class as the
// T12.1 constants: valid wasm, wrong program, no diagnostic.
//
// assert_malformed (quoted): 698 -> 714 / 1229. Other six metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function accepts(src: string): boolean {
  return !hasErrors(wat2wasm(src).errors);
}

describe('T12.2 — an import may not follow a definition', () => {
  const MALFORMED: [string, string][] = [
    ['function', '(module (func) (import "" "" (func)))'],
    ['global', '(module (global i64 (i64.const 0)) (import "" "" (func)))'],
    ['table', '(module (table 0 funcref) (import "" "" (func)))'],
    ['memory', '(module (memory 1) (import "" "" (func)))'],
    ['tag', '(module (tag) (import "" "" (func)))'],
  ];
  for (const [kind, src] of MALFORMED) {
    it(`rejects an import after a ${kind} definition`, () => {
      assert(!accepts(src), `accepted: ${src}`);
    });
  }

  it('also rejects the INLINE import abbreviation', () => {
    // `(func $g (import "m" "g"))` is an import too, so the rule applies to it
    // just the same — checking the `import` KEYWORD alone would have missed it.
    assert(!accepts('(module (func) (func $g (import "m" "g")))'));
  });

  it('names the kind that came first', () => {
    const { errors } = wat2wasm('(module (global i64 (i64.const 0)) (import "" "" (func)))');
    assert(/import after global/.test(formatErrors(errors)), formatErrors(errors));
  });
});

describe('T12.2 — legal orderings still parse', () => {
  const LEGAL: [string, string][] = [
    [
      'imports then definitions',
      '(module (import "m" "f" (func)) (func) (global i32 (i32.const 0)))',
    ],
    [
      'a type between imports',
      '(module (import "m" "a" (func)) (type $t (func)) (import "m" "b" (func)))',
    ],
    [
      'an export after definitions',
      '(module (import "m" "a" (func)) (func) (export "x" (func 0)))',
    ],
    ['the inline import abbreviation first', '(module (func $f (import "m" "f")) (func))'],
    ['imports only', '(module (import "m" "a" (func)) (import "m" "b" (memory 1)))'],
    [
      'elem and data after definitions',
      '(module (table 1 funcref) (memory 1) (func) (elem (i32.const 0) func 0) (data (i32.const 0) "x"))',
    ],
    ['a start after definitions', '(module (func $s) (start $s))'],
  ];
  for (const [name, src] of LEGAL) {
    it(`accepts ${name}`, () => {
      const { errors } = wat2wasm(src);
      assert(!hasErrors(errors), `rejected a LEGAL module:\n${formatErrors(errors)}`);
    });
  }
});

describe('T12.2 — the renumbering this prevents', () => {
  it('keeps call 0 meaning what source order says', async () => {
    // The legal spelling of the same program: with the import first, `call 1`
    // is the defined function and must stay that way through the pipeline.
    const { binary, errors } = wat2wasm(`(module
      (import "host" "imported" (func $imported (result i32)))
      (func $defined (result i32) (i32.const 111))
      (func (export "which") (result i32) (call 1)))`);
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf, {
      host: { imported: () => 999 },
    });
    assertEquals((instance.exports.which as () => number)(), 111);
  });
});
