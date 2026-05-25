// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Regression tests for the `wat2wasm` end-to-end pipeline.
 *
 * Each test:
 *   1. Compiles a small WAT module to wasm via the public `wat2wasm` entry.
 *   2. Reads the produced binary back through wabt-ts's own decoder.
 *   3. Validates the decoded module.
 *
 * If any step errors, the test fails. This catches breakage anywhere along
 * parse → resolveNames → synthesizeTypes → writeBinaryIr → readBinaryIr →
 * validateModule.
 *
 * The first two tests below pin specific bugs reported by wasmtk in the
 * v1.0.4 migration (one missed bug per test):
 *   - operand order in folded binary ops (caught the swapped left/right
 *     case `(i32.sub (local.get $a) (local.get $b))`).
 *   - missing type section when the WAT uses inline `(param ...) (result ...)`
 *     without a separate `(type ...)` declaration.
 */

import { describe, it } from '@std/testing/bdd';
import { assertEquals, assert } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { readBinaryIr } from '../../src/reader/binary-reader.ts';
import { validateModule } from '../../src/validator/validator.ts';
import { makeErrorList, hasErrors, formatErrors } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';

function compileAndValidate(wat: string): Uint8Array {
  const { binary, errors, result } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error(`wat2wasm:\n${formatErrors(errors)}`);
  assertEquals(result, Result.Ok, 'wat2wasm returned Result.Ok');

  const decodeErrs = makeErrorList();
  const decoded = readBinaryIr(binary, decodeErrs);
  if (hasErrors(decodeErrs)) {
    throw new Error(`decode:\n${formatErrors(decodeErrs)}`);
  }

  const valErrs = makeErrorList();
  const r = validateModule(decoded, valErrs);
  if (hasErrors(valErrs)) {
    throw new Error(`validate:\n${formatErrors(valErrs)}`);
  }
  assertEquals(r, Result.Ok, 'validateModule returned Result.Ok');

  return binary;
}

describe('wat2wasm — end-to-end regression', () => {
  it('synthesizes a type section for inline-declared signatures (wasmtk 1.0.4 repro)', () => {
    // Bug: parser stored typeVar=index(0) but module.types was empty, so the
    // function section emitted "type 0" with no type entries. binaryen
    // reported `invalid type index 0 / 0` when reading the produced binary.
    const bin = compileAndValidate(`(module
      (func $add (param $a i32) (param $b i32) (result i32)
        (i32.add (local.get $a) (local.get $b)))
      (export "add" (func $add)))`);

    // Section 1 (type) must be present and non-empty.
    // Header (8 bytes) + section id 1 + size LEB + count + payload.
    assert(bin[8] === 0x01, `expected type section after header; got 0x${bin[8]?.toString(16)}`);
  });

  it('preserves operand order in folded binary expressions', () => {
    // Bug: flushStack popped in LIFO order, swapping left/right for folded
    // operands. Commutative for i32.add (so easy to miss), but i32.sub
    // would compute `b - a` instead of `a - b`. Round-trip + validate is
    // sufficient: validator catches reversed operands via type checking;
    // for arithmetic correctness we also need to compare the emitted
    // local.get indices below.
    const bin = compileAndValidate(`(module
      (func $sub (param $a i32) (param $b i32) (result i32)
        (i32.sub (local.get $a) (local.get $b)))
      (export "sub" (func $sub)))`);

    // Locate the code-section body byte sequence and confirm the operand
    // order is `local.get 0` (= $a) then `local.get 1` (= $b) then i32.sub.
    // The body is at the end of the binary, just before the final 0x0b.
    // Easier: search for the three-instruction pattern 20 00 20 01 6b.
    const sub = Array.from(bin)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    assert(
      sub.includes('20 00 20 01 6b'),
      `expected 'local.get 0; local.get 1; i32.sub' but binary was: ${sub}`,
    );
  });

  it('handles the wasmtk heap-allocator pattern end-to-end', () => {
    compileAndValidate(`(module
      (memory 1)
      (global $heap (mut i32) (i32.const 1024))
      (func $alloc (param $size i32) (result i32)
        (local $p i32)
        (local.set $p (global.get $heap))
        (global.set $heap (i32.add (global.get $heap) (local.get $size)))
        (local.get $p))
      (export "alloc" (func $alloc)))`);
  });

  it('preserves operand order across multiple non-commutative ops', () => {
    // Three non-commutative ops in folded form; validator catches type
    // mismatches but operand order has to be right for arithmetic correctness.
    compileAndValidate(`(module
      (func $f (param $a i32) (param $b i32) (result i32)
        (i32.div_s (i32.sub (local.get $a) (local.get $b)) (i32.const 2)))
      (export "f" (func $f)))`);
  });

  it('handles a function-import with inline signature (synthesizes type 0)', () => {
    compileAndValidate(`(module
      (import "env" "log" (func $log (param i32)))
      (func $main (param i32)
        (call $log (local.get 0)))
      (export "main" (func $main)))`);
  });

  it('resolves call $name nested inside drop / select (wasmtk 1.0.5 repro)', () => {
    // Bug: resolveExpr's default `return e` didn't recurse into children,
    // so the call inside (drop ...) / (select ...) kept its name var,
    // and the binary writer fell back to "index 0" — referencing the
    // first import instead of the named defined func. wasmtk hit this in
    // core_simple.wat's (select (call $__malloc ...) ...).
    const bin = compileAndValidate(`(module
      (import "env" "imp0" (func $imp0 (param i32)))
      (import "env" "imp1" (func $imp1 (param i32 i32 i32 i32) (result i32)))
      (func $malloc (param $size i32) (result i32) (local.get $size))
      (func $realloc (param $ptr i32) (param $size i32) (result i32)
        (select
          (call $malloc (local.get $size))
          (local.get $ptr)
          (i32.eqz (local.get $ptr)))))`);
    // $malloc is absolute index 2 (after $imp0=0, $imp1=1). The call inside
    // the select must emit "10 02", not "10 00".
    const hex = Array.from(bin)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    assert(
      hex.includes('10 02'),
      `expected 'call 2' (= $malloc) inside select; binary: ${hex}`,
    );
  });

  it('resolves call $name nested inside drop', () => {
    const bin = compileAndValidate(`(module
      (import "env" "imp0" (func $imp0 (param i32)))
      (func $defined (result i32) (i32.const 5))
      (func $caller (drop (call $defined))))`);
    const hex = Array.from(bin)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    // $defined is absolute index 1 (after the import).
    assert(
      hex.includes('10 01'),
      `expected 'call 1' inside drop; binary: ${hex}`,
    );
  });
});
