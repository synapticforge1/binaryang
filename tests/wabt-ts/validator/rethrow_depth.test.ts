// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.17 — `rethrow` ignored its depth entirely.
//
// `SharedValidator.onRethrow(loc, _depth)` declared the depth and dropped it,
// and `TypeChecker.onRethrow()` did not take one at all — it just went
// unreachable. So `(func (rethrow 0))`, a rethrow in a function with no `try`
// anywhere, validated clean, and so did a rethrow naming an ordinary `block`.
//
// The depth is not decoration: `rethrow N` re-raises the exception caught by
// the Nth enclosing CATCH, so the label it names has to BE a catch handler —
// that is where the caught exception lives. `onCatch` already sets
// `labelType = LabelType.Catch` on the frame, so the check is a lookup plus a
// comparison; the machinery existed and was simply never called, the same shape
// as T13.14's `isSubtype`.
//
// **Oracle note.** Legacy EH is the one family where the standing three-engine
// rule cannot be applied: Wasmtime 47.0.3 and Wasmer both refuse `try` outright
// (`legacy_exceptions feature required`), and `wasmtime -W` has no switch for
// it. V8 is therefore the ONLY engine that can rule on these modules, and the
// assertions below say so rather than pretending to a cross-check that is not
// available. The rule itself is unambiguous in the legacy EH proposal
// independently of any engine.
//
// Severity is low precisely because of that: these modules do not run on the
// primary WASI host at all. It is recorded and fixed as a soundness hole, not
// as something reachable from the wasmtk pipeline.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

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

const INVALID: [string, string][] = [
  [
    'rethrow in a function with no try at all',
    '(module (func (rethrow 0)))',
  ],
  [
    'rethrow naming an ordinary block',
    '(module (func (block (rethrow 0))))',
  ],
  [
    'rethrow naming a loop',
    '(module (func (loop (rethrow 0))))',
  ],
  [
    'rethrow from the try body rather than a catch handler',
    // Depth 0 inside `do` is the try frame itself, which is not a catch.
    '(module (tag $e) (func (try (do (rethrow 0)) (catch $e))))',
  ],
];

describe('T13.17 — rethrow must name an enclosing catch', () => {
  for (const [name, wat] of INVALID) {
    it(`rejects ${name}`, () => {
      const binary = compile(wat);
      // V8 is the only engine that runs legacy EH — see the header note.
      assertEquals(v8Accepts(binary), false, `V8 accepts "${name}" — check the fixture`);
      const { result, errors } = wasmValidate(binary, { features: allFeatures() });
      assertEquals(result, Result.Error, `we accepted "${name}"`);
      assert(hasErrors(errors), `"${name}" was rejected with no diagnostic`);
    });
  }

  it('still accepts a rethrow inside the catch handler that owns it', () => {
    // The guard against over-correcting into a blanket rejection: this is the
    // shape wasic emits for a re-raised TypeScript exception.
    const wat = '(module (tag $e) (func (try (do (nop)) (catch $e (rethrow 0)))))';
    const binary = compile(wat);
    assertEquals(v8Accepts(binary), true, 'V8 rejects the valid fixture — check it');
    const { result, errors } = wasmValidate(binary, { features: allFeatures() });
    assertEquals(result, Result.Ok, `we rejected a valid rethrow:\n${formatErrors(errors)}`);
  });

  it('still accepts a rethrow reaching an OUTER catch through a block', () => {
    // Depth counts label frames, so an intervening block shifts the target.
    // A fix that only ever checked depth 0 would pass the case above and fail
    // this one.
    const wat = `(module (tag $e)
      (func (try (do (nop)) (catch $e (block (rethrow 1))))))`;
    const binary = compile(wat);
    assertEquals(v8Accepts(binary), true, 'V8 rejects the valid fixture — check it');
    const { result, errors } = wasmValidate(binary, { features: allFeatures() });
    assertEquals(result, Result.Ok, `we rejected a valid rethrow:\n${formatErrors(errors)}`);
  });
});
