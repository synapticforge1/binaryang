// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.7 - a NAMED reference in every position the grammar allows.
//
// This is the class that shipped broken in v1.3.5 and blocked wasmtk's
// exception-handling migration: the PARSER accepted
// `(try_table (catch $e $h) ...)`, `resolveNames` never resolved the catch
// clause's tag or target, and the binary writer's fail-loud `writeVar` threw
// `unresolved name-var`. Front half accepts, back half cannot encode.
//
// **Not one of the seven conformance metrics can see this**, which is why it
// survived a whole campaign:
//
//   - parse-clean stops at the parser, which is the half that works;
//   - round-trip is `binary -> wasm2wat -> wat2wasm`, and `wasm2wat` emits
//     NUMERIC vars - so a round trip never puts a `$name` through the writer at
//     ALL;
//   - V8-valid, agreement, execution and both `assert_malformed` halves start
//     from bytes, which is downstream of the failure.
//
// The spec testsuite does exercise names, which is what eventually caught it -
// but only for constructs the testsuite happens to write, and it has no
// multi-memory `$m` operands and no named `try_table` catches.
//
// Sensitivity, measured rather than assumed (invert the guard before trusting
// it): against the **v1.3.5 tag in a clean worktree, 21 of these 64 fail** -
// named memory operands do not parse, `table.grow` / `table.fill` throw on
// "funcref", `ref.null $t` and `br_on_cast` fail, and both `try_table` catch
// forms throw. All 64 pass on the code under test.
//
// Adding a case here is cheap and the coverage is the point: if a construct can
// take a `$name`, it belongs in the list.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

const CASES: [string, string][] = [
  ['call $f', '(module (func $f) (func (call $f)))'],
  ['ref.func $f', '(module (func $f) (elem declare func $f) (func (drop (ref.func $f))))'],
  ['start $f', '(module (func $f) (start $f))'],
  ['export (func $f)', '(module (func $f) (export "a" (func $f)))'],
  ['return_call $f', '(module (func $f) (func (return_call $f)))'],
  ['elem funcidx $f', '(module (func $f) (table 1 funcref) (elem (i32.const 0) $f))'],
  [
    'elem expr ref.func $f',
    '(module (func $f) (table 1 funcref) (elem (i32.const 0) funcref (ref.func $f)))',
  ],
  [
    'table init ref.func $f',
    '(module (func $f) (elem declare func $f) (table $t 1 (ref func) (ref.func $f)))',
  ],
  ['global.get $g', '(module (global $g i32 (i32.const 0)) (func (drop (global.get $g))))'],
  [
    'global.set $g',
    '(module (global $g (mut i32) (i32.const 0)) (func (global.set $g (i32.const 1))))',
  ],
  ['export (global $g)', '(module (global $g i32 (i32.const 0)) (export "g" (global $g)))'],
  [
    'global init global.get',
    '(module (import "m" "g" (global $g i32)) (global $h i32 (global.get $g)))',
  ],
  ['table.get $t', '(module (table $t 1 funcref) (func (drop (table.get $t (i32.const 0)))))'],
  [
    'table.set $t',
    '(module (table $t 1 funcref) (func (table.set $t (i32.const 0) (ref.null func))))',
  ],
  ['table.size $t', '(module (table $t 1 funcref) (func (drop (table.size $t))))'],
  [
    'table.grow $t',
    '(module (table $t 1 funcref) (func (drop (table.grow $t (ref.null func) (i32.const 1)))))',
  ],
  [
    'table.fill $t',
    '(module (table $t 1 funcref) (func (table.fill $t (i32.const 0) (ref.null func) (i32.const 0))))',
  ],
  [
    'table.copy $a $b',
    '(module (table $a 1 funcref) (table $b 1 funcref) (func (table.copy $a $b (i32.const 0) (i32.const 0) (i32.const 0))))',
  ],
  [
    'table.init $t $e',
    '(module (func $f) (table $t 1 funcref) (elem $e func $f) (func (table.init $t $e (i32.const 0) (i32.const 0) (i32.const 0))))',
  ],
  ['elem.drop $e', '(module (func $f) (elem $e func $f) (func (elem.drop $e)))'],
  [
    'call_indirect $t',
    '(module (type $s (func)) (table $t 1 funcref) (func (call_indirect $t (type $s) (i32.const 0))))',
  ],
  [
    'return_call_indirect $t',
    '(module (type $s (func)) (table $t 1 funcref) (func (return_call_indirect $t (type $s) (i32.const 0))))',
  ],
  ['export (table $t)', '(module (table $t 1 funcref) (export "t" (table $t)))'],
  [
    'elem (table $t)',
    '(module (func $f) (table $t 1 funcref) (elem (table $t) (i32.const 0) func $f))',
  ],
  ['i32.load $m', '(module (memory $m 1) (func (drop (i32.load $m (i32.const 0)))))'],
  ['i32.store $m', '(module (memory $m 1) (func (i32.store $m (i32.const 0) (i32.const 0))))'],
  ['memory.size $m', '(module (memory $m 1) (func (drop (memory.size $m))))'],
  ['memory.grow $m', '(module (memory $m 1) (func (drop (memory.grow $m (i32.const 1)))))'],
  [
    'memory.fill $m',
    '(module (memory $m 1) (func (memory.fill $m (i32.const 0) (i32.const 0) (i32.const 0))))',
  ],
  [
    'memory.copy $a $b',
    '(module (memory $a 1) (memory $b 1) (func (memory.copy $a $b (i32.const 0) (i32.const 0) (i32.const 0))))',
  ],
  [
    'memory.init $m $d',
    '(module (memory $m 1) (data $d "x") (func (memory.init $m $d (i32.const 0) (i32.const 0) (i32.const 0))))',
  ],
  ['data.drop $d', '(module (memory 1) (data $d "x") (func (data.drop $d)))'],
  ['data (memory $m)', '(module (memory $m 1) (data (memory $m) (i32.const 0) "x"))'],
  ['export (memory $m)', '(module (memory $m 1) (export "m" (memory $m)))'],
  [
    'atomic.load $m',
    '(module (memory $m 1 1 shared) (func (drop (i32.atomic.load $m (i32.const 0)))))',
  ],
  [
    'atomic.rmw.cmpxchg $m',
    '(module (memory $m 1 1 shared) (func (drop (i32.atomic.rmw.cmpxchg $m (i32.const 0) (i32.const 0) (i32.const 0)))))',
  ],
  [
    'memory.atomic.wait32 $m',
    '(module (memory $m 1 1 shared) (func (drop (memory.atomic.wait32 $m (i32.const 0) (i32.const 0) (i64.const 0)))))',
  ],
  [
    'memory.atomic.notify $m',
    '(module (memory $m 1 1 shared) (func (drop (memory.atomic.notify $m (i32.const 0) (i32.const 0)))))',
  ],
  ['throw $e', '(module (tag $e) (func (throw $e)))'],
  ['legacy catch $e', '(module (tag $e) (func (try (do) (catch $e (nop)))))'],
  ['legacy delegate $l', '(module (func (block $l (try (do) (delegate $l)))))'],
  ['legacy rethrow $l', '(module (tag $e) (func (try $l (do) (catch $e (rethrow $l)))))'],
  ['try_table catch $e $h', '(module (tag $e) (func (block $h (try_table (catch $e $h) (nop)))))'],
  [
    'try_table catch_all $h',
    '(module (tag $e) (func (block $h (try_table (catch_all $h) (nop)))))',
  ],
  ['export (tag $e)', '(module (tag $e) (export "e" (tag $e)))'],
  ['tag import + throw', '(module (import "m" "e" (tag $e)) (func (throw $e)))'],
  ['func (type $s)', '(module (type $s (func)) (func (type $s)))'],
  ['block (type $s)', '(module (type $s (func)) (func (block (type $s))))'],
  [
    'struct.new $t',
    '(module (type $t (struct (field i32))) (func (drop (struct.new $t (i32.const 1)))))',
  ],
  [
    'struct.get $t $f',
    '(module (type $t (struct (field $f i32))) (func (param (ref $t)) (drop (struct.get $t $f (local.get 0)))))',
  ],
  [
    'array.new $t',
    '(module (type $t (array i32)) (func (drop (array.new $t (i32.const 1) (i32.const 2)))))',
  ],
  [
    'array.new_data $t $d',
    '(module (type $t (array i8)) (data $d "x") (func (drop (array.new_data $t $d (i32.const 0) (i32.const 1)))))',
  ],
  [
    'array.new_elem $t $e',
    '(module (type $ft (func)) (func $f) (type $t (array (ref null $ft))) (elem $e func $f) (func (drop (array.new_elem $t $e (i32.const 0) (i32.const 1)))))',
  ],
  ['ref.null $t', '(module (type $t (struct)) (func (drop (ref.null $t))))'],
  [
    'ref.test (ref $t)',
    '(module (type $t (struct)) (func (param anyref) (drop (ref.test (ref $t) (local.get 0)))))',
  ],
  [
    'ref.cast (ref $t)',
    '(module (type $t (struct)) (func (param anyref) (drop (ref.cast (ref $t) (local.get 0)))))',
  ],
  [
    'br_on_cast $l (ref $t)',
    '(module (type $t (struct)) (func (param anyref) (block $l (drop (br_on_cast $l anyref (ref $t) (local.get 0))))))',
  ],
  [
    'call_ref $s',
    '(module (type $s (func)) (func (param (ref $s)) (call_ref $s (local.get 0))))',
  ],
  [
    '(ref $t) in a signature',
    '(module (type $t (struct)) (func (param (ref null $t)) (drop (local.get 0))))',
  ],
  ['br $l', '(module (func (block $l (br $l))))'],
  ['br_if $l', '(module (func (block $l (br_if $l (i32.const 0)))))'],
  ['br_table $a $b', '(module (func (block $a (block $b (br_table $a $b $a (i32.const 0))))))'],
  ['local.get $x', '(module (func (param $x i32) (drop (local.get $x))))'],
  ['local.set $x', '(module (func (local $x i32) (local.set $x (i32.const 1))))'],
];

describe('T13.7 - every named reference encodes', () => {
  for (const [name, src] of CASES) {
    it(`encodes ${name}`, () => {
      let binary: Uint8Array | undefined;
      try {
        const r = wat2wasm(src);
        assert(!hasErrors(r.errors), `rejected:\n${src}\n${formatErrors(r.errors)}`);
        binary = r.binary;
      } catch (x) {
        // A THROW here is the signature of the shipped bug: the writer's
        // fail-loud path on an unresolved name-var.
        throw new Error(`threw while encoding ${name}: ${String((x as Error).message)}\n${src}`);
      }
      assert(binary && binary.length > 8, `empty binary for ${name}`);
    });
  }
});

describe('T13.7 - and survives a round trip back through the numeric form', () => {
  it('re-encodes byte-identically from its own disassembly', () => {
    // The second parse exercises the NUMERIC var path, so the pair covers both
    // directions: names in, indices out, indices back in.
    const differ: string[] = [];
    for (const [name, src] of CASES) {
      const first = wat2wasm(src);
      if (hasErrors(first.errors) || !first.binary) continue;
      const text = wasm2wat(first.binary).text;
      if (!text) {
        differ.push(`${name}: wasm2wat produced nothing`);
        continue;
      }
      let again;
      try {
        again = wat2wasm(text);
      } catch (x) {
        differ.push(`${name}: re-parse threw ${String((x as Error).message).slice(0, 60)}`);
        continue;
      }
      if (hasErrors(again.errors) || !again.binary) {
        differ.push(`${name}: re-parse rejected`);
        continue;
      }
      const a = again.binary, b = first.binary;
      if (a.length !== b.length || !a.every((x, i) => x === b[i])) {
        differ.push(`${name}: bytes differ`);
      }
    }
    assert(differ.length === 0, `round trip broke:\n  ${differ.join('\n  ')}`);
  });
});
