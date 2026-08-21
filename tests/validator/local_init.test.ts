// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.9 — non-defaultable locals must be initialised before they are read.
//
// I deferred this at the end of T9.8, saying it needed "the
// function-references init-tracking algorithm — an init set per control frame,
// intersected at an `if` join" and that a conservative approximation would
// reject valid code. That was wrong, and local_init.wast's own assert_invalid
// cases are what showed it:
//
//   (block (local.set $x …)) (drop (local.get $x))          INVALID
//   (if … (then (local.set $x …)) (else (local.set $x …)))  INVALID
//     (drop (local.get $x))
//
// The second one settles it. If the rule intersected at a join, setting the
// local in BOTH arms would leave it initialised — and it does not. The actual
// rule is plain frame-scoped rollback: an initialisation inside a control
// frame is undone at `end`, with no joins and no intersection. That is far
// simpler than what I had assumed, and it is not an approximation, so it costs
// nothing in false rejections. Reading the spec test's own expectations
// settled in minutes what reasoning from memory had mis-scoped.
//
// The rule in full:
//   * params are initialised on entry;
//   * a DEFAULTABLE local is initialised on entry, a `(ref $t)` is not;
//   * `local.set` / `local.tee` initialise;
//   * an initialisation inside a frame is rolled back at `end`, and an `else`
//     arm does not see what the `then` arm initialised.
//
// assert_invalid 2654 -> 2658 of 2737 — the whole category — with agreement on
// valid modules unchanged at 2120/2120.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toBuf(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return buf;
}

function rejects(wat: string): void {
  const bin = compile(wat);
  assert(!WebAssembly.validate(toBuf(bin)), `V8 ACCEPTED this — bad test input:\n${wat}`);
  const v = wasmValidate(bin, { features: allFeatures() });
  assertEquals(v.result, Result.Error, `we accepted a module V8 rejects:\n${wat}`);
  assert(hasErrors(v.errors), `rejected but reported nothing:\n${wat}`);
}

function accepts(wat: string): void {
  const bin = compile(wat);
  assert(WebAssembly.validate(toBuf(bin)), `V8 rejected — bad test input:\n${wat}`);
  assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Ok);
}

describe('T9.9 — reading an uninitialised local', () => {
  it('a bare read is rejected', () => {
    rejects('(module (func (local $x (ref extern)) (drop (local.get $x))))');
  });

  it('a set inside a block does NOT survive the block', () => {
    rejects(`(module (func (param $p (ref extern))
      (local $x (ref extern))
      (block (local.set $x (local.get $p)) (drop (local.tee $x (local.get $p))))
      (drop (local.get $x))))`);
  });

  it('the else arm does not see what the then arm set', () => {
    rejects(`(module (func (param $p (ref extern))
      (local $x (ref extern))
      (if (i32.const 0)
        (then (local.set $x (local.get $p)))
        (else (drop (local.get $x))))))`);
  });

  it('setting in BOTH arms still does not carry past the if', () => {
    // The case that decides the design: with a join-and-intersect rule this
    // would be valid. It is not.
    rejects(`(module (func (param $p (ref extern))
      (local $x (ref extern))
      (if (i32.const 0)
        (then (local.set $x (local.get $p)))
        (else (local.set $x (local.get $p))))
      (drop (local.get $x))))`);
  });
});

describe('T9.9 — what stays valid', () => {
  it('a read after a set at the same level', () => {
    accepts(`(module (func (export "f") (param $p (ref extern)) (result (ref extern))
      (local $x (ref extern))
      (local.set $x (local.get $p))
      (local.get $x)))`);
  });

  it('local.tee counts as initialising', () => {
    accepts(`(module (func (export "f") (param $p (ref extern)) (result (ref extern))
      (local $x (ref extern))
      (drop (local.tee $x (local.get $p)))
      (local.get $x)))`);
  });

  it('a read INSIDE a block of something set outside it', () => {
    accepts(`(module (func (export "f") (param $p (ref extern)) (result (ref extern))
      (local $x (ref extern))
      (local.set $x (local.get $p))
      (block (result (ref extern)) (local.get $x))))`);
  });

  it('a DEFAULTABLE local needs no set at all', () => {
    accepts('(module (func (result i32) (local $x i32) (local.get $x)))');
    accepts('(module (func (result funcref) (local $x funcref) (local.get $x)))');
  });

  it('and params are initialised on entry', () => {
    accepts(`(module (func (export "f") (param $p (ref extern)) (result (ref extern))
      (local.get $p)))`);
  });
});
