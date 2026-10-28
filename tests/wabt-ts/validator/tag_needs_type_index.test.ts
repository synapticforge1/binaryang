// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 50 (2026-10-28): a library-built tag with no `typeVar` was checked against a GUESSED
// type — the first function type with its signature, else type 0 — so in a module whose only
// type is `(func (param f64))`, a tag of `(param i32)` was typed f64: a correct `(throw $e (i32))`
// was refused and an f64 throw accepted. A function with no type index is refused ("function: no
// type index (run synthesizeTypes)"); a tag is now refused the same way. Text and binary input
// always give one, so only hand-built IR meets this.

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { readWat } from '../../../src/tools/read-wat.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { validateModule } from '../../../src/validator/validator.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/core/error.ts';
import { ValType } from '../../../src/ir/types.ts';

const verdict = (m: ReturnType<typeof readWat>) => {
  const errors = makeErrorList();
  validateModule(m, errors, { features: allFeatures() });
  return errors;
};

describe('open-work 50 — a tag with no type index is refused, not guessed', () => {
  it('refuses a defined tag built without one', () => {
    const m = readWat('(module (type (func (param f64))) (tag $e (param i32)))');
    const tag = m.tags[0]!;
    // As a hand-built module would have it: a signature, no type index.
    delete (tag as { typeVar?: unknown }).typeVar;
    tag.sig = { params: [ValType.I32], results: [] };
    const errors = verdict(m);
    assert(hasErrors(errors), 'a tag with no type index was accepted');
    assert(formatErrors(errors).includes('tag: no type index'), formatErrors(errors));
  });

  it('still accepts a tag that has one, from text', () => {
    const r = wat2wasm('(module (tag $e (param i32)) (func (throw $e (i32.const 1))))', {
      validate: true,
      features: allFeatures(),
    });
    assert(!hasErrors(r.errors), formatErrors(r.errors));
  });
});
