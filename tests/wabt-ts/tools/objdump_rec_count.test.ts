// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 50, divergence CL8 (2026-10-28): wasm-objdump's Type section `count:` was the number
// of TYPES. The section is a vector of REC GROUPS — `(rec (type) (type))` is one entry, an empty
// `(rec)` one too — so a module whose section says 4 was reported as 5. Upstream wasm-objdump and
// `wasm-tools objdump` count groups.

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmObjdump } from '../../../src/tools/wasm-objdump.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

const typeLine = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false, features: allFeatures() });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const { text } = wasmObjdump(r.binary);
  return text.split('\n').find((l) => l.trim().startsWith('type ')) ?? text;
};

describe('open-work 50 — wasm-objdump counts the type section in rec groups', () => {
  it('a two-type rec group is one entry', () => {
    const line = typeLine(
      '(module (rec (type $s (struct)) (type $a (array i8))) (type (func)) (type (func (param i32))) (type (struct (field i64))))',
    );
    assert(line.endsWith('count: 4'), line);
  });

  it('empty rec groups are entries too', () => {
    assert(typeLine('(module (rec) (type (func)) (rec))').endsWith('count: 3'));
  });

  it('singleton types are unchanged', () => {
    assert(typeLine('(module (type (func)) (type (func (param i32))))').endsWith('count: 2'));
  });
});
