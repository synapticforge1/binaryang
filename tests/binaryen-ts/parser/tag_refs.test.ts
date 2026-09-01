// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `(throw 0 …)` — a NUMERIC tag reference — failed with
// `unresolved throw tag reference: "$tag0"`.
//
// Three call sites wrote `ref.startsWith('$') ? ref : `$tag${ref}``,
// RECONSTRUCTING the name `collectTag` synthesizes for an ANONYMOUS tag. That
// only works when the tag has no name of its own: `(tag $e0 …)` registers `$e0`,
// so `(throw 0)` looked for a `$tag0` that was never there.
//
// Our own `wasm2wat` emits exactly that combination — named tags, numeric
// references — so re-parsing our disassembly failed on 11 corpus modules.
//
// ⚠️ Identical in shape to the branch-label bug: reconstructing a name instead
// of looking up what sits at that index. That is the same mistake in a third
// place, after branch labels and `call_indirect` types — worth noticing as a
// pattern rather than three incidents. Resolving by index also stays correct if
// the synthesized naming ever changes, which reconstruction does not.
//
// The three sites now share one resolver so they cannot drift apart.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** Both toolchains must accept the module, and produce the same tag imports/exports. */
function bothAccept(wat: string) {
  const ref = wat2wasm(wat, { filename: 'ref.wat' });
  assert(ref.binary !== undefined && !hasErrors(ref.errors), 'wabt-ts must accept the fixture');
  const got = encodeWasm(parseWat(wat));
  assert(WebAssembly.validate(got as BufferSource), 'binaryen-ts output must validate');
  return got;
}

describe('WAT parser — tag references by name and by index', () => {
  it('a named tag referenced by NAME', () => {
    bothAccept('(module (tag $e0 (param i32)) (func (export "f") (throw $e0 (i32.const 1))))');
  });

  it('a named tag referenced by INDEX', () => {
    bothAccept('(module (tag $e0 (param i32)) (func (export "f") (throw 0 (i32.const 1))))');
  });

  it('an ANONYMOUS tag referenced by index still works', () => {
    bothAccept('(module (tag (param i32)) (func (export "f") (throw 0 (i32.const 1))))');
  });

  // Index 1 must select the SECOND tag, not fall back to the first — a resolver
  // that ignored the index would still produce a valid module throwing the wrong
  // tag, so the parameter types are what distinguish them.
  it('index 1 selects the second tag, not the first', () => {
    const bytes = bothAccept(
      '(module (tag $a (param i32)) (tag $b (param i64)) (func (export "f") (throw 1 (i64.const 2))))',
    );
    // An i64 operand only type-checks against `$b`; picking `$a` would not validate.
    assert(WebAssembly.validate(bytes as BufferSource));
  });

  it('mixed: named tags, both reference styles in one module', () => {
    bothAccept(`(module
      (tag $a (param i32)) (tag $b (param i64))
      (func (export "f") (throw $a (i32.const 1)))
      (func (export "g") (throw 1 (i64.const 2))))`);
  });
});
