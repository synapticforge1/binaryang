// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 50 (2026-10-28): every export diagnostic — "mutable globals cannot be exported",
// a duplicate export name, an index out of range — had NO location: the IR's `Export` carried
// none, and the validator passed a module-wide one. Exports now record where they were written
// (the `(export …)` in text, inline or as a field; the entry's offset in a binary), and the
// validator reports there.

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { defaultFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

const noMutableGlobals = { ...defaultFeatures(), mutableGlobals: false };

const textError = (wat: string) => {
  const r = wat2wasm(wat, { validate: true, features: noMutableGlobals, filename: 'm.wat' });
  assert(hasErrors(r.errors), 'accepted');
  return formatErrors(r.errors);
};

describe('open-work 50 — an export error has the export’s location', () => {
  it('an export field, in text', () => {
    const text = textError(
      '(module\n  (global $g (mut i32) (i32.const 0))\n  (export "g" (global $g)))',
    );
    assert(text.includes('m.wat:3:3: error: mutable globals cannot be exported'), text);
  });

  it('an inline export, in text', () => {
    const text = textError('(module\n  (global (export "g") (mut i32) (i32.const 0)))');
    assert(text.includes('m.wat:2:11: error: mutable globals cannot be exported'), text);
  });

  it('a duplicate export name, at the second export', () => {
    const r = wat2wasm('(module (func) (export "a" (func 0))\n (export "a" (func 0)))', {
      validate: true,
      filename: 'd.wat',
    });
    assert(formatErrors(r.errors).includes('d.wat:2:2:'), formatErrors(r.errors));
  });

  it('in a binary, the entry offset', () => {
    const bytes = wat2wasm('(module (global $g (mut i32) (i32.const 0)) (export "g" (global $g)))')
      .binary;
    const v = wasmValidate(bytes, { filename: 'm.wasm', features: noMutableGlobals });
    const text = formatErrors(v.errors);
    assert(/m\.wasm:0000013: error: mutable globals cannot be exported/.test(text), text);
  });
});
