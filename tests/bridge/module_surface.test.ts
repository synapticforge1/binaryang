// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The bridge's MODULE surface: element segments and the start function.
//
// Both were silently dropped — `module.elemSegments` and `module.start` were
// never read, while the module doc claimed element segments and the start
// function "will throw". A bridged module's tables were therefore empty, so
// every `call_indirect` through one trapped with "null function", and a start
// function never ran. `deno task bridge` could not see either: it COMPILES what
// the bridge builds and never runs it, and an empty table is perfectly valid.
//
// Exactly the defect binaryen-ts's own WAT parser had ("Element segments are
// complex; skip for MVP"), which cost 45 corpus modules their tables —
// `wat-parser.ts`'s `(elem …)` comment keeps that history.
//
// These tests RUN the bridged module, which is the only way to see it.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';
import { parseWasm } from '../../src/binaryen-ts/binary/index.ts';

function bridged(wat: string): Uint8Array {
  const { module, errors } = parseWatModule(new LexerSource(wat, '<surface>'));
  assert(!hasErrors(errors), formatErrors(errors));
  const errs = makeErrorList();
  resolveNames(module, errs);
  assert(!hasErrors(errs), formatErrors(errs));
  return encodeWasm(bridgeToBinaryen(module));
}

function instantiate(bytes: Uint8Array): WebAssembly.Exports {
  return new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports;
}

describe('bridge — module surface', () => {
  it('carries an active element segment, so call_indirect reaches its function', () => {
    const e = instantiate(bridged(`(module
      (type $unary (func (param i32) (result i32)))
      (table 2 funcref)
      (func $double (type $unary) (i32.mul (local.get 0) (i32.const 2)))
      (func $negate (type $unary) (i32.sub (i32.const 0) (local.get 0)))
      (elem (i32.const 0) $double $negate)
      (func (export "f") (param i32) (result i32)
        (call_indirect (type $unary) (i32.const 21) (local.get 0))))`));
    const f = e.f as (x: number) => number;
    assertEquals([f(0), f(1)], [42, -21]);
  });

  it('carries the segment offset, not just its contents', () => {
    const e = instantiate(bridged(`(module
      (type $u (func (result i32)))
      (table 4 funcref)
      (func $seven (type $u) (i32.const 7))
      (elem (i32.const 3) $seven)
      (func (export "f") (param i32) (result i32) (call_indirect (type $u) (local.get 0))))`));
    const f = e.f as (x: number) => number;
    assertEquals(f(3), 7);
  });

  it('runs the start function', () => {
    const e = instantiate(bridged(`(module
      (global $g (mut i32) (i32.const 0))
      (func $init (global.set $g (i32.const 99)))
      (start $init)
      (func (export "f") (result i32) (global.get $g)))`));
    assertEquals((e.f as () => number)(), 99);
  });

  // `table.init` is not bridged (it throws, loudly), so this reads the segment
  // back out of the bytes instead: it must survive as PASSIVE, leaving the table
  // empty at instantiation rather than being written in as active.
  it('carries a passive segment, and keeps it passive', () => {
    const bytes = bridged(`(module
      (type $u (func (result i32)))
      (table 2 funcref)
      (func $five (type $u) (i32.const 5))
      (elem $late func $five)
      (func (export "f") (param i32) (result i32) (call_indirect (type $u) (local.get 0))))`);
    const segs = parseWasm(bytes).elements;
    assertEquals(segs.length, 1);
    assertEquals(segs[0]!.mode, 'passive');
    assertEquals(segs[0]!.data.length, 1);
    // Passive means the table is still empty: the call traps rather than running $five.
    const f = instantiate(bytes).f as (x: number) => number;
    let trapped = false;
    try {
      f(0);
    } catch (err) {
      trapped = err instanceof WebAssembly.RuntimeError;
    }
    assert(trapped, 'a passive segment must not populate the table');
  });

  // binaryen-ts's ElementSegment holds function NAMES, so an entry that is not
  // a `ref.func` has no representation. Refuse it rather than drop it.
  it('refuses an element entry it cannot represent', () => {
    let threw = '';
    try {
      bridged(`(module
        (table 2 funcref)
        (func $f0)
        (elem (i32.const 0) funcref (item (ref.null func)) (item (ref.func $f0))))`);
    } catch (err) {
      threw = (err as Error).message;
    }
    assert(
      /element/i.test(threw),
      `expected a refusal naming the element, got: ${threw || 'no throw'}`,
    );
  });
});
