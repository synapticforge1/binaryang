// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Workspace correspondence C12 (wasmtk, 2026-10-26): a legacy `delegate`'s label depth was never
// checked. `TypeChecker.onDelegate(_depth)` took the depth and dropped it, so `delegate 1` in a
// function with no enclosing label validated clean. Found by wasmtk's mirror of its soundness
// guard (spec-INVALID modules the validator ACCEPTS): `legacy/try_delegate.wast`'s
// `(assert_invalid (module (func (try (do) (delegate 1)))) "unknown label")`.
//
// A second defect in the same function, found while fixing the first: after popping the `try`, it
// set the ENCLOSING frame unreachable, so nothing after a `try … delegate` was type-checked —
// `(func (result i32) (try (do) (delegate 0)))` validated, a function ending with an empty stack.
// `delegate` ends the `try` the way `end` does; the code after it is reachable.
//
// The fix is upstream wabt's `TypeChecker::OnDelegate`: the label is looked up at `depth + 1`
// ("Delegate starts counting after the current try, as the delegate instruction is not actually
// in the try block"), and the frame is not made unreachable. The words below are upstream's,
// measured 2026-10-28 with wabt 1.0.41 `wasm-validate --enable-all` on these modules' bytes;
// wasm-tools 1.262 refuses the same three ("unknown label: branch depth too large", "type
// mismatch: expected i32 but nothing on stack") and accepts the valid ones.
//
// Oracle note (as `rethrow_depth.test.ts`): V8 is the one engine here that runs legacy EH, so each
// fixture is also checked against `WebAssembly.validate`.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { Result } from '../../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(binary: Uint8Array): boolean {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

// [name, WAT, upstream wabt's message]. All three are upstream's exactly — the third since DG7
// (2026-10-28) aligned every signature message with wabt's; before it, binaryang worded a short
// function end "type mismatch in function, expected 1 elements on the stack but got 0".
const INVALID: [string, string, string][] = [
  [
    'delegate 1 in a function with no label outside the try',
    '(module (func (try (do) (delegate 1))))',
    'invalid depth: 2 (max 1)',
  ],
  [
    'delegate 2 with one block outside the try',
    '(module (func (block (try (do) (delegate 2)))))',
    'invalid depth: 3 (max 2)',
  ],
  [
    'a function that ends with nothing after a try … delegate',
    '(module (func (result i32) (try (do) (delegate 0))))',
    'type mismatch in implicit return, expected [i32] but got []',
  ],
];

const VALID: [string, string][] = [
  ['delegate 0 to the function', '(module (func (try (do) (delegate 0))))'],
  ['delegate 1 past one block', '(module (func (block (try (do) (delegate 1)))))'],
  [
    'delegate 0 to an outer try',
    '(module (tag $e) (func (try (do (try (do (throw $e)) (delegate 0))) (catch $e))))',
  ],
  [
    'a value after a try … delegate',
    '(module (func (result i32) (try (do) (delegate 0)) (i32.const 1)))',
  ],
  [
    'a try … delegate with a result',
    '(module (func (result i32) (try (result i32) (do (i32.const 7)) (delegate 0))))',
  ],
];

describe('C12 — a delegate names a label outside its own try, and ends it like end', () => {
  for (const [name, wat, upstream] of INVALID) {
    it(`rejects ${name}, in upstream's words`, () => {
      const binary = compile(wat);
      assertEquals(v8Accepts(binary), false, `V8 accepts "${name}" — check the fixture`);
      const { result, errors } = wasmValidate(binary, { features: allFeatures() });
      assertEquals(result, Result.Error, `we accepted "${name}"`);
      const text = formatErrors(errors);
      assert(text.includes(upstream), `"${name}": expected "${upstream}", got:\n${text}`);
    });
  }

  for (const [name, wat] of VALID) {
    it(`still accepts ${name}`, () => {
      const binary = compile(wat);
      assertEquals(v8Accepts(binary), true, `V8 rejects "${name}" — check the fixture`);
      const { result, errors } = wasmValidate(binary, { features: allFeatures() });
      assertEquals(result, Result.Ok, `we rejected "${name}":\n${formatErrors(errors)}`);
    });
  }
});
