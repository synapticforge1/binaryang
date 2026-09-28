// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A legacy `try` is `try … catch* catch_all? end`: nothing follows a
// `catch_all`. 🔧 A `catch`, or a second `catch_all`, after one validated
// clean — as it does in upstream wabt 1.0.41 (`wat2wasm` and `wasm-validate`
// both accept it). V8 refuses it ("catch after catch-all"), and so does
// wasm-tools. V8 is the oracle here for the reason `rethrow_depth.test.ts`
// gives: it is the one engine that runs legacy EH.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertStringIncludes } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  return binary;
}

const v8Accepts = (b: Uint8Array) => WebAssembly.validate(new Uint8Array(b) as BufferSource);

const CATCH_AFTER = '(module (tag $e) (func try nop catch_all nop catch $e nop end))';

/**
 * The text parser refuses a second `catch_all` itself ("multiple catch_all
 * clauses not allowed"), so that one arrives as BYTES: `catch 0; nop`
 * (`07 00 01`) patched to `catch_all; nop; nop` (`19 01 01`), same length.
 */
function secondCatchAll(): Uint8Array {
  const b = compile(CATCH_AFTER).slice();
  const at = b.findIndex((_, i) => b[i] === 0x07 && b[i + 1] === 0x00 && b[i + 2] === 0x01);
  assert(at > 0 && b[at - 2] === 0x19, 'the catch after the catch_all');
  b.set([0x19, 0x01, 0x01], at);
  return b;
}

const INVALID: [string, () => Uint8Array, string][] = [
  ['a catch after catch_all', () => compile(CATCH_AFTER), 'catch after catch_all'],
  ['a second catch_all', secondCatchAll, 'catch_all after catch_all'],
];

describe('nothing follows a catch_all', () => {
  for (const [name, bytes, message] of INVALID) {
    it(`rejects ${name}`, () => {
      const binary = bytes();
      assertEquals(v8Accepts(binary), false, `V8 accepts "${name}" — check the fixture`);
      const { result, errors } = wasmValidate(binary, { features: allFeatures() });
      assertEquals(result, Result.Error, `we accepted "${name}"`);
      assertStringIncludes(formatErrors(errors), message);
    });
  }

  it('still accepts catches, then one catch_all, in two trys in a row', () => {
    // The flag is the TRY's: a catch_all in the first must not refuse the
    // second's catch — nor a nested try's.
    const wat = `(module (tag $e) (tag $f) (func
      try nop catch $e nop catch $f nop catch_all nop end
      try nop catch $e try nop catch_all nop end catch_all nop end))`;
    const binary = compile(wat);
    assert(v8Accepts(binary), 'V8 rejects the valid fixture — check it');
    const { result, errors } = wasmValidate(binary, { features: allFeatures() });
    assertEquals(result, Result.Ok, formatErrors(errors));
  });
});
