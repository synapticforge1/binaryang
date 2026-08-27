// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T5 — GC recursive type groups `(rec ...)` and subtyping `(sub ...)`.
//
// The type section is a vector of REC GROUPS, not of types:
//
//   rectype  ::= 0x4e vec(subtype) | subtype
//   subtype  ::= 0x50 vec(typeidx) comptype   (sub, non-final)
//              | 0x4f vec(typeidx) comptype   (sub final)
//              | comptype                     (shorthand for sub final, no supers)
//
// An explicit `(rec ...)` spanning N types occupies ONE vector slot while
// consuming N type INDICES, so the old `m.types.length` count was correct only
// while every type was its own singleton group -- and the reader's matching
// count read desynced on the first explicit group.
//
// A BARE comptype is the spec's shorthand for `sub final` with no supertypes,
// so `TypeEntry.sub` being absent is NOT the same as
// `{ final: true, supertypes: [] }`: they encode differently. That is why the
// field is optional rather than defaulted.
//
// Testsuite: parse-clean 233 -> 240, fully V8-valid 216 -> 221.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { recGroups } from '../../src/ir/ir.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(wat: string): boolean {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

/** Encode, decode to text, re-encode; asserts the bytes are IDENTICAL. */
function roundTripsExactly(wat: string): boolean {
  const first = compile(wat);
  const { text, errors } = wasm2wat(first);
  if (hasErrors(errors) || !text) return false;
  const second = compile(text);
  return first.length === second.length && first.every((b, i) => b === second[i]);
}

describe('(rec …) recursive type groups', () => {
  it('mutually recursive struct types', () => {
    const wat = `(module (rec
      (type $a (struct (field (ref null $b))))
      (type $b (struct (field (ref null $a))))))`;
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat), 'rec group must survive wasm2wat byte-identically');
  });

  it('members occupy consecutive TYPE INDICES, the group one section slot', () => {
    const { module, errors } = parseWatModule(`(module (rec
      (type $a (struct (field i32)))
      (type $b (struct (field i64)))))`);
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(module.types.length, 2, 'two type indices');
    const groups = recGroups(module.types);
    assertEquals(groups.length, 1, 'one section slot');
    assertEquals(groups[0]!.count, 2);
    assert(groups[0]!.explicit);
  });

  it('a single-member group still encodes as an explicit rec', () => {
    const wat = '(module (rec (type $a (struct (field i32)))))';
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('a plain type is a singleton group, not an explicit rec', () => {
    const { module } = parseWatModule('(module (type $a (struct (field i32))))');
    const groups = recGroups(module.types);
    assertEquals(groups.length, 1);
    assert(!groups[0]!.explicit, 'must NOT emit a 0x4e wrapper');
  });
});

describe('(sub …) subtyping', () => {
  it('non-final supertype', () => {
    const wat = `(module
      (type $s (sub (struct (field i32))))
      (type $t (sub $s (struct (field i32) (field i64)))))`;
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('sub final parses and encodes', () => {
    const wat = '(module (type $s (sub (struct))) (type $t (sub final $s (struct))))';
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('final actually BLOCKS subtyping — V8 rejects extending it', () => {
    // Proves `final` reaches the encoding rather than being silently dropped:
    // if the flag were lost, this module would validate.
    const binary = compile(`(module
      (type $a (sub final (struct (field i32))))
      (type $b (sub $a (struct (field i32) (field i64)))))`);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    assert(!WebAssembly.validate(buf), 'extending a final type must be rejected');
  });

  it('a bare comptype emits NO sub wrapper', () => {
    const { module } = parseWatModule('(module (type $a (struct (field i32))))');
    assertEquals(module.types[0]!.sub, undefined);
  });

  it('subtyping across two separate rec groups', () => {
    const wat = `(module
      (rec (type $a (sub (struct (field i32)))))
      (rec (type $b (sub $a (struct (field i32) (field f64))))))`;
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('rec and sub combined', () => {
    const wat = `(module (rec
      (type $a (sub (struct (field i32))))
      (type $b (sub $a (struct (field i32) (field i64))))))`;
    assert(v8Accepts(wat));
    assert(roundTripsExactly(wat));
  });

  it('a named supertype resolves to its index', () => {
    // $s is type 0; an unresolved name-var would hit the writer's guard.
    const { module, errors } = parseWatModule(`(module
      (type $s (sub (struct (field i32))))
      (type $t (sub $s (struct (field i32) (field i64)))))`);
    assert(!hasErrors(errors), formatErrors(errors));
    compile(`(module
      (type $s (sub (struct (field i32))))
      (type $t (sub $s (struct (field i32) (field i64)))))`);
    assertEquals(module.types.length, 2);
  });
});

describe('plain type declarations still work', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['func', '(module (type $f (func (param i32) (result i32))))'],
    ['struct', '(module (type $s (struct (field (mut i32)))))'],
    ['array', '(module (type $a (array (mut i8))))'],
    ['several', '(module (type $f (func)) (type $s (struct)) (type $a (array i32)))'],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      assert(v8Accepts(wat), `V8 rejected ${wat}`);
      assert(roundTripsExactly(wat), `round-trip changed bytes for ${wat}`);
    });
  }
});
