// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `resolveNames` never recursed into `table.get`'s `index` sub-expression.
//
// `table.get` was grouped with `table.size` — a genuine leaf — so it inherited
// the leaf treatment: resolve the table var, spread `...e`, done. But
// `table.get` is NOT a leaf; it carries the element index as a sub-expression:
//
//     case 'table.get':
//     case 'table.size':
//       return [Result.Ok, { ...e, table: ... }];        // index never walked
//     case 'table.set': {
//       const [rI, index] = this.resolveExpr(e.index);   // sibling: correct
//       const [rV, value] = this.resolveExpr(e.value);
//       ...
//     }
//
// So any name-var inside the index survived into the binary writer, which is
// fail-loud for a plain `Var` — the whole module failed to encode:
//
//     (table.get $t (global.get $g))
//       -> "unresolved name-var \"$g\" for var — run resolveNames before encoding"
//
// Valid WAT that `wat2wasm` refused outright. That makes it louder than the
// atomic `memidx` gap (which silently hit the wrong memory), but it is the
// same shape: a `case` that resolves SOME of its children, with a correct
// sibling sitting immediately below it in the same switch.
//
// Invisible to all seven conformance metrics, structurally: `table.get` does
// not appear anywhere in the wasmtk corpus, and no spec-testsuite module pairs
// it with a named operand. Found by auditing every sub-expression field on
// every Expr interface against the `resolveNames` case that handles it —
// the same audit that found the atomic `memidx` gap, widened from `Var` fields
// to `Expr` fields.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';

/** Collects every `Var` still in name form, at any depth. */
// deno-lint-ignore no-explicit-any
function nameVars(x: any, out: string[] = []): string[] {
  if (!x || typeof x !== 'object') return out;
  if (x.kind === 'name' && typeof x.name === 'string') out.push(x.name);
  for (const k of Object.keys(x)) {
    if (k === 'loc') continue;
    const v = x[k];
    if (Array.isArray(v)) v.forEach((el) => nameVars(el, out));
    else nameVars(v, out);
  }
  return out;
}

function unresolvedAfterResolve(body: string): string[] {
  const { module, errors } = parseWatModule(`(module
    (table $t 4 funcref)
    (global $unused i32 (i32.const 0))
    (global $g i32 (i32.const 1))
    (func $unused_fn (result i32) (i32.const 0))
    (func $f (result i32) (i32.const 1))
    (func (export "run") ${body}))`);
  assert(!hasErrors(errors), formatErrors(errors));
  const errs = makeErrorList();
  resolveNames(module, errs);
  // The exported function is the last one defined.
  return nameVars(module.funcs[module.funcs.length - 1]!.body);
}

const NAMED_OPERAND: [string, string][] = [
  ['global.get in the index', '(drop (table.get $t (global.get $g)))'],
  ['call in the index', '(drop (table.get $t (call $f)))'],
  // The sibling that was already correct — it must stay correct. Its value
  // operand is `ref.func`, not `ref.null func`: an abstract heap-type keyword
  // is DELIBERATELY left as a name-var for the writer to encode as a single
  // negative byte, so it would trip the name-var sweep below for a legitimate
  // reason.
  ['table.set (sibling)', '(table.set $t (global.get $g) (ref.func $f))'],
];

describe('resolveNames walks table.get’s index sub-expression', () => {
  for (const [label, body] of NAMED_OPERAND) {
    it(`leaves no name-var for ${label}`, () => {
      const left = unresolvedAfterResolve(body);
      assertEquals(left, [], `unresolved name-vars survived: ${left.join(', ')}`);
    });
  }
});

describe('a table.get with a named operand encodes', () => {
  for (const [label, body] of NAMED_OPERAND) {
    it(`wat2wasm accepts ${label}`, () => {
      const { binary, errors, result } = wat2wasm(`(module
        (table $t 4 funcref)
        (global $unused i32 (i32.const 0))
        (global $g i32 (i32.const 1))
        (func $unused_fn (result i32) (i32.const 0))
        (func $f (result i32) (i32.const 1))
        (func (export "run") ${body}))`);
      assertEquals(result, 0, formatErrors(errors));
      assert(binary, 'no binary emitted');
    });
  }

  it('reads the element the source named, not element 0', async () => {
    // The behavioural half, and it has to go through `table.get` itself — a
    // fixture built on `call_indirect` passes with the bug still in place,
    // because `call_indirect` has its own (correct) resolve case.
    //
    // Only table slot 3 is populated, and only global 1 holds 3. So a resolve
    // that fell back to global 0 (which holds 0) reads the EMPTY slot and the
    // null check flips.
    const { binary, errors } = wat2wasm(`(module
      (table $t 4 funcref)
      (func $f)
      (elem (i32.const 3) $f)
      (global $unused i32 (i32.const 0))
      (global $g i32 (i32.const 3))
      (func (export "run") (result i32)
        (ref.is_null (table.get $t (global.get $g)))))`);
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);

    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    assertEquals(WebAssembly.validate(buf), true, 'fixture must be valid');

    const { instance } = await WebAssembly.instantiate(buf, {});
    assertEquals(
      (instance.exports.run as () => number)(),
      0,
      'table.get read a slot other than the one $g names',
    );
  });
});
