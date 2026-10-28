// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 52 (d), 2026-10-28: the spec's string characters exclude U+00–U+1F and U+7F, so a
// raw tab, carriage return or other control character inside a string must be written as an
// escape. wasm-tools refuses it ("invalid character in string"); upstream wabt 1.0.41 accepts it,
// and so did this. Escapes are unaffected.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

const data = (s: string) => wat2wasm(`(module (memory 1) (data (i32.const 0) "${s}"))`);

describe('open-work 52 — a raw control character in a string is refused', () => {
  for (
    const [name, c] of [['tab', '\t'], ['CR', '\r'], ['NUL', '\0'], ['DEL', '\x7f'], [
      'ESC',
      '\x1b',
    ]]
  ) {
    it(`refuses a raw ${name}`, () => {
      const r = data(`a${c}b`);
      assert(hasErrors(r.errors), `a raw ${name} was accepted`);
      assert(
        formatErrors(r.errors).includes('invalid character in string'),
        formatErrors(r.errors),
      );
    });
  }

  it('accepts the same bytes written as escapes', () => {
    const r = data('a\\tb\\u{d}\\00\\7f');
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    // The data's six bytes, wherever the segment sits (a name section follows it).
    const hex = [...r.binary].map((b) => b.toString(16).padStart(2, '0')).join('');
    assertEquals(hex.includes('610962' + '0d' + '00' + '7f'), true, hex);
  });
});
