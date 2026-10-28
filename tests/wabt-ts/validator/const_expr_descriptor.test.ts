// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 2 (2026-10-28): a constant expression's `struct.new_desc` /
// `struct.new_default_desc` was checked for constness on its FIELD operands only. The descriptor
// is the node's `desc`, not one of its `operands`, so any instruction producing the right type
// got through as a descriptor — `(global (ref $t) (struct.new_desc $t (i64.const 1) (call $mk)))`
// validated, a global initialised by a CALL. wasm-tools 1.262 refuses it: "constant expression
// required: non-constant operator: visit_call". (Upstream wabt 1.0.41 cannot parse descriptors, so
// it is no oracle here; V8 does not have the proposal.) The fix checks `desc` too; a descriptor
// that is itself a constant expression stays valid.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { Result } from '../../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat, { features: allFeatures() });
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}
const TYPES =
  '(rec (type $t (descriptor $dt) (struct (field i64))) (type $dt (describes $t) (struct)))';
const MK = '(func $mk (result (ref (exact $dt))) (struct.new $dt))';

describe('code lens 2 — a constant expression checks a struct.new_desc descriptor too', () => {
  it('refuses a call as the descriptor of struct.new_desc', () => {
    const r = wasmValidate(
      compile(`(module ${TYPES} ${MK}
      (global $g (ref $t) (struct.new_desc $t (i64.const 1) (call $mk))))`),
      { features: allFeatures() },
    );
    assertEquals(r.result, Result.Error, 'a non-constant descriptor was accepted');
    assert(hasErrors(r.errors));
  });

  it('refuses a call as the descriptor of struct.new_default_desc', () => {
    const r = wasmValidate(
      compile(`(module ${TYPES} ${MK}
      (global $g (ref $t) (struct.new_default_desc $t (call $mk))))`),
      { features: allFeatures() },
    );
    assertEquals(r.result, Result.Error, 'a non-constant descriptor was accepted');
  });

  it('still accepts a descriptor that is itself a constant expression', () => {
    const r = wasmValidate(
      compile(`(module ${TYPES}
      (global $g (ref $t) (struct.new_desc $t (i64.const 1) (struct.new $dt)))
      (global $h (ref $t) (struct.new_default_desc $t (struct.new $dt))))`),
      { features: allFeatures() },
    );
    assertEquals(
      r.result,
      Result.Ok,
      `a constant descriptor was refused:\n${formatErrors(r.errors)}`,
    );
  });
});
