// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): an unknown local NAME (`local.set $nope …`) was refused with a
// library's internals — "local "$nope" cannot be resolved at IR level — wabt-ts's IR has no slot
// for param/local names…" — where upstream wabt 1.0.41 says `undefined local variable "$nope"`,
// as ours already said for every other kind of name. The verdict was right; the words are now
// upstream's. (The column stays ours — the instruction, where upstream points at the name: DG6.)

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

describe('code lens 3 — an unknown local name, in upstream wabt words', () => {
  for (
    const body of [
      '(local.set $nope (i32.const 0))',
      '(drop (local.get $nope))',
      '(drop (local.tee $nope (i32.const 0)))',
    ]
  ) {
    it(body, () => {
      const r = wat2wasm(`(module (func ${body}))`);
      assert(hasErrors(r.errors), 'an unknown local was accepted');
      const text = formatErrors(r.errors);
      assert(text.includes('undefined local variable "$nope"'), text);
      assert(!text.includes('IR level'), text);
    });
  }
});
