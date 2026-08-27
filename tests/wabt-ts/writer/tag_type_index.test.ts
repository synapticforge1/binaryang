// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T10.7 — a tag with a typed-reference param made the whole encode THROW.
//
//     binary writer: no (type (func (param [object Object]))) in the type
//     section matches the tag signature
//
// `tagTypeIndex` finds the type-section entry whose signature matches a tag's,
// and compared the params with `===`. A `ValueType` is an abstract `Type` — a
// number, where identity IS equality — OR a typed reference, which is an
// OBJECT. So two structurally identical `(ref $t)` params compared unequal,
// nothing matched, and the writer took its fail-loud branch on a module that
// was perfectly well formed. `valueTypeEquals` has existed in `ir.ts` all
// along; this was one more site the T7.4 ValueType refactor did not reach, the
// same family as the `select` result annotation that was still being cast to a
// byte.
//
// The `[object Object]` in the message is the second half of the bug, and the
// reason it stayed a mystery: the diagnostic rendered each param with
// `(p as number).toString(16)`, so the one output that could have named the
// cause named nothing. It uses `valueTypeName` now.
//
// Round-trip fidelity: spec testsuite 2111 -> 2112 / 2120 and hard failures
// 1 -> 0 — the last throw in the round-trip metric. Campaign metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

// A tag whose param is a CONCRETE typed reference, which is the object-valued
// half of ValueType. try_table.wast#4 is the spec module this comes from.
const TYPED_REF_TAG = `(module
  (type $t (func))
  (tag $e (param (ref $t)))
  (func $f (export "f") (param (ref $t))
    (throw $e (local.get 0))))`;

describe('T10.7 — a tag type is matched structurally, not by identity', () => {
  it('encodes a tag whose param is a typed reference', () => {
    // This threw outright before: no type matched, so the fail-loud branch
    // fired on a well-formed module.
    const binary = compile(TYPED_REF_TAG);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    assertEquals(WebAssembly.validate(buf), true);
  });

  it('round-trips it byte-identically', () => {
    const first = compile(TYPED_REF_TAG);
    assertEquals(compile(wasm2wat(first).text!), first);
  });

  it('still encodes an abstract-typed tag, where identity and equality agree', () => {
    const first = compile(`(module
      (tag $e (param i32 f64))
      (func $f (export "f") (throw $e (i32.const 1) (f64.const 2))))`);
    assertEquals(compile(wasm2wat(first).text!), first);
  });

  it('still fails loudly when no type really matches, and names the type', () => {
    // The fail-loud branch is load-bearing — emitting index 0 would corrupt
    // the binary, because a decoder would read the wrong signature. Strip the
    // type section to reach it, and check the message is legible now: it used
    // to render every typed reference as "[object Object]".
    const { module, errors } = parseWatModule(TYPED_REF_TAG);
    assert(!hasErrors(errors), formatErrors(errors));
    const stripped = { ...module, types: [] } as typeof module;
    const err = assertThrows(
      () => writeBinaryIr(stripped),
      Error,
      'matches the tag signature',
    ) as Error;
    assert(!err.message.includes('[object Object]'), err.message);
    assert(/\(ref /.test(err.message), err.message);
  });
});
