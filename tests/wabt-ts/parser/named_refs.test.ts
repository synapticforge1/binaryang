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

/**
 * Assert an engine accepts the bytes, not merely that the encoder produced some.
 *
 * Without this, a fixture that is itself invalid wasm still "passes" — the
 * encoder happily encodes it and the assertion only ever asked for a non-empty
 * buffer. Two of the original 64 were in exactly that state
 * (`array.new_elem`, `br_on_cast`), so the suite was asserting less than it
 * read as asserting. Both are corrected above.
 */
function assertV8Accepts(binary: Uint8Array, label: string, src: string): void {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  if (WebAssembly.validate(buf)) return;
  let detail = '';
  try {
    new WebAssembly.Module(buf);
  } catch (e) {
    detail = String((e as Error).message);
  }
  throw new Error(`V8 rejected the encoding of ${label}:\n${src}\n  ${detail}`);
}

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
    // The elem segment's type has to be a SUBTYPE of the array's element type.
    // This read `(elem $e func $f)` — element type `(ref func)` — against an
    // array of `(ref null $ft)`, which V8 rejects. It passed anyway because
    // this suite only asked whether `wat2wasm` returned bytes; see the
    // V8-validity assertion below, added so a fixture cannot drift into
    // invalidity unnoticed again.
    'array.new_elem $t $e',
    '(module (type $ft (func)) (func $f (type $ft)) (type $t (array (ref null $ft))) (elem $e (ref null $ft) (ref.func $f)) (func (drop (array.new_elem $t $e (i32.const 0) (i32.const 1)))))',
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
    // `br_on_cast` branches WITH the cast value, so its target needs arity >= 1.
    // The target here was a bare `(block $l)`, which V8 rejects outright.
    'br_on_cast $l (ref $t)',
    '(module (type $t (struct)) (func (param anyref) (drop (block $l (result anyref) (drop (br_on_cast $l anyref (ref $t) (local.get 0))) (ref.null any)))))',
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
      assertV8Accepts(binary, name, src);
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

// ---------------------------------------------------------------------------
// Second axis: a named reference inside the OPERANDS.
// ---------------------------------------------------------------------------
//
// Everything above varies WHERE the name appears — the table slot, the memory
// slot, the tag slot, the catch target — and holds every operand fixed as a
// literal (`(i32.const 0)`, `(ref.null func)`). That is one axis, and T13.11
// lived on the other one:
//
//     (table.get $t (i32.const 0))       <- case 67 above, always passed
//     (table.get $t (global.get $g))     <- failed to encode at all
//
// `resolveNames` had `table.get` sharing a `case` label with the genuine leaf
// `table.size`, so it never recursed into its index. The name in the OPERAND
// was never resolved, and the writer's fail-loud `writeVar` threw. A guard is
// only as wide as the axis it varies, so this table varies the other one:
// every instruction that takes sub-expressions gets a named reference in its
// operand slots.
//
// `$decoy` is deliberately global 0. Any resolution that silently fell back to
// index 0 would pick the decoy, so these cases stay meaningful even for the
// immediates whose writer path is fail-SOFT (`writeMemoryVarUnlessZero`)
// rather than fail-loud.
//
// Sensitivity, measured not assumed: reverting the T13.11 fix turns
// `table.get index` red here, and nothing else — which is also the evidence
// that the rest of this axis is genuinely clean rather than untested.

const P = `(global $decoy i32 (i32.const 7)) (global $g i32 (i32.const 0))
  (global $decoy64 i64 (i64.const 7)) (global $g64 i64 (i64.const 0))
  (global $decoyf f32 (f32.const 7)) (global $gf f32 (f32.const 0))
  (global $decoyd f64 (f64.const 7)) (global $gd f64 (f64.const 0))`;

const OPERAND_CASES: [string, string][] = [
  ['drop value', `(module ${P} (func (drop (global.get $g))))`],
  [
    'select val1/val2/cond',
    `(module ${P} (func (drop (select (global.get $g) (global.get $g) (global.get $g)))))`,
  ],
  ['block body', `(module ${P} (func (block (drop (global.get $g)))))`],
  ['loop body', `(module ${P} (func (loop (drop (global.get $g)))))`],
  [
    'if cond+arms',
    `(module ${P} (func (if (global.get $g) (then (drop (global.get $g))) (else (drop (global.get $g))))))`,
  ],
  ['br value', `(module ${P} (func (result i32) (block $l (result i32) (br $l (global.get $g)))))`],
  ['br_if cond', `(module ${P} (func (block $l (br_if $l (global.get $g)))))`],
  [
    'br_if value+cond',
    `(module ${P} (func (result i32) (block $l (result i32) (br_if $l (global.get $g) (global.get $g)))))`,
  ],
  ['br_table index', `(module ${P} (func (block $l (br_table $l (global.get $g)))))`],
  ['local.set value', `(module ${P} (func (local $x i32) (local.set $x (global.get $g))))`],
  ['local.tee value', `(module ${P} (func (local $x i32) (drop (local.tee $x (global.get $g)))))`],
  [
    'global.set value',
    `(module ${P} (global $m (mut i32) (i32.const 0)) (func (global.set $m (global.get $g))))`,
  ],
  ['unary operand', `(module ${P} (func (drop (i32.eqz (global.get $g)))))`],
  ['binary left+right', `(module ${P} (func (drop (i32.add (global.get $g) (global.get $g)))))`],
  ['compare left+right', `(module ${P} (func (drop (i32.eq (global.get $g) (global.get $g)))))`],
  ['convert operand', `(module ${P} (func (drop (i64.extend_i32_s (global.get $g)))))`],
  ['load address', `(module ${P} (memory 1) (func (drop (i32.load (global.get $g)))))`],
  [
    'store address+value',
    `(module ${P} (memory 1) (func (i32.store (global.get $g) (global.get $g))))`,
  ],
  ['memory.grow delta', `(module ${P} (memory 1) (func (drop (memory.grow (global.get $g)))))`],
  [
    'memory.copy operands',
    `(module ${P} (memory 1) (func (memory.copy (global.get $g) (global.get $g) (global.get $g))))`,
  ],
  [
    'memory.fill operands',
    `(module ${P} (memory 1) (func (memory.fill (global.get $g) (global.get $g) (global.get $g))))`,
  ],
  [
    'memory.init operands',
    `(module ${P} (memory 1) (data $d "x") (func (memory.init $d (global.get $g) (global.get $g) (global.get $g))))`,
  ],
  ['call args', `(module ${P} (func $f (param i32)) (func (call $f (global.get $g))))`],
  [
    'call_indirect args+callee',
    `(module ${P} (type $s (func (param i32))) (table 1 funcref) (func (call_indirect (type $s) (global.get $g) (global.get $g))))`,
  ],
  [
    'return_call args',
    `(module ${P} (func $f (param i32)) (func (return_call $f (global.get $g))))`,
  ],
  [
    'return_call_indirect args+callee',
    `(module ${P} (type $s (func (param i32))) (table 1 funcref) (func (return_call_indirect (type $s) (global.get $g) (global.get $g))))`,
  ],
  ['return values', `(module ${P} (func (result i32) (return (global.get $g))))`],

  // The family T13.11 lived in.
  [
    'table.get index',
    `(module ${P} (table $t 1 funcref) (func (drop (table.get $t (global.get $g)))))`,
  ],
  [
    'table.set index+value',
    `(module ${P} (func $f) (elem declare func $f) (table $t 1 funcref) (func (table.set $t (global.get $g) (ref.func $f))))`,
  ],
  [
    'table.grow init+delta',
    `(module ${P} (func $f) (elem declare func $f) (table $t 1 funcref) (func (drop (table.grow $t (ref.func $f) (global.get $g)))))`,
  ],
  [
    'table.fill operands',
    `(module ${P} (func $f) (elem declare func $f) (table $t 1 funcref) (func (table.fill $t (global.get $g) (ref.func $f) (global.get $g))))`,
  ],
  [
    'table.copy operands',
    `(module ${P} (table $a 1 funcref) (table $b 1 funcref) (func (table.copy $a $b (global.get $g) (global.get $g) (global.get $g))))`,
  ],
  [
    'table.init operands',
    `(module ${P} (func $f) (table $t 1 funcref) (elem $e func $f) (func (table.init $t $e (global.get $g) (global.get $g) (global.get $g))))`,
  ],

  // Reference / GC.
  [
    'ref.is_null value',
    `(module ${P} (func $f) (elem declare func $f) (func (drop (ref.is_null (ref.func $f)))))`,
  ],
  [
    'struct.new operands',
    `(module ${P} (type $t (struct (field i32))) (func (drop (struct.new $t (global.get $g)))))`,
  ],
  [
    'struct.set ref+value',
    `(module ${P} (type $t (struct (field $fl (mut i32)))) (func (param (ref $t)) (struct.set $t $fl (local.get 0) (global.get $g))))`,
  ],
  [
    'array.new init+length',
    `(module ${P} (type $t (array i32)) (func (drop (array.new $t (global.get $g) (global.get $g)))))`,
  ],
  [
    'array.get ref+index',
    `(module ${P} (type $t (array i32)) (func (param (ref $t)) (drop (array.get $t (local.get 0) (global.get $g)))))`,
  ],
  [
    'array.set operands',
    `(module ${P} (type $t (array (mut i32))) (func (param (ref $t)) (array.set $t (local.get 0) (global.get $g) (global.get $g))))`,
  ],
  [
    'array.fill operands',
    `(module ${P} (type $t (array (mut i32))) (func (param (ref $t)) (array.fill $t (local.get 0) (global.get $g) (global.get $g) (global.get $g))))`,
  ],
  [
    'array.copy operands',
    `(module ${P} (type $t (array (mut i32))) (func (param (ref $t) (ref $t)) (array.copy $t $t (local.get 0) (global.get $g) (local.get 1) (global.get $g) (global.get $g))))`,
  ],
  [
    'array.new_data operands',
    `(module ${P} (type $t (array i8)) (data $d "x") (func (drop (array.new_data $t $d (global.get $g) (global.get $g)))))`,
  ],
  [
    'array.new_elem operands',
    `(module ${P} (type $ft (func)) (func $f (type $ft)) (type $t (array (ref null $ft))) (elem $e (ref null $ft) (ref.func $f)) (func (drop (array.new_elem $t $e (global.get $g) (global.get $g)))))`,
  ],
  [
    'array.init_data operands',
    `(module ${P} (type $t (array (mut i8))) (data $d "x") (func (param (ref $t)) (array.init_data $t $d (local.get 0) (global.get $g) (global.get $g) (global.get $g))))`,
  ],
  [
    'array.len ref',
    `(module ${P} (type $t (array i32)) (func (param (ref $t)) (drop (array.len (local.get 0)))))`,
  ],
  [
    'ref.test ref',
    `(module ${P} (type $t (struct)) (func (param anyref) (drop (ref.test (ref $t) (local.get 0)))))`,
  ],
  [
    'ref.cast ref',
    `(module ${P} (type $t (struct)) (func (param anyref) (drop (ref.cast (ref $t) (local.get 0)))))`,
  ],
  [
    'br_on_cast value',
    `(module ${P} (type $t (struct)) (func (param anyref) (drop (block $l (result anyref) (drop (br_on_cast $l anyref (ref $t) (local.get 0))) (ref.null any)))))`,
  ],
  [
    'ref.eq left+right',
    `(module ${P} (func (param eqref eqref) (drop (ref.eq (local.get 0) (local.get 1)))))`,
  ],
  [
    'call_ref args+callee',
    `(module ${P} (type $s (func (param i32))) (func (param (ref $s)) (call_ref $s (global.get $g) (local.get 0))))`,
  ],
  [
    'any.convert_extern / extern.convert_any',
    `(module ${P} (func (param anyref) (drop (any.convert_extern (extern.convert_any (local.get 0))))))`,
  ],

  // Exceptions.
  ['throw args', `(module ${P} (tag $e (param i32)) (func (throw $e (global.get $g))))`],
  ['throw_ref exnref', `(module ${P} (func (param exnref) (throw_ref (local.get 0))))`],
  [
    'try_table body',
    `(module ${P} (tag $e) (func (block $h (try_table (catch $e $h) (drop (global.get $g))))))`,
  ],
  [
    'legacy try body+catch',
    `(module ${P} (tag $e) (func (try (do (drop (global.get $g))) (catch $e (drop (global.get $g))))))`,
  ],

  // Atomics — the proposal the spec-testsuite snapshot does not contain at all.
  [
    'atomic.load address',
    `(module ${P} (memory 1 1 shared) (func (drop (i32.atomic.load (global.get $g)))))`,
  ],
  [
    'atomic.store addr+value',
    `(module ${P} (memory 1 1 shared) (func (i32.atomic.store (global.get $g) (global.get $g))))`,
  ],
  [
    'atomic.rmw addr+value',
    `(module ${P} (memory 1 1 shared) (func (drop (i32.atomic.rmw.add (global.get $g) (global.get $g)))))`,
  ],
  [
    'atomic.cmpxchg operands',
    `(module ${P} (memory 1 1 shared) (func (drop (i32.atomic.rmw.cmpxchg (global.get $g) (global.get $g) (global.get $g)))))`,
  ],
  [
    'atomic.wait operands',
    `(module ${P} (memory 1 1 shared) (func (drop (memory.atomic.wait32 (global.get $g) (global.get $g) (global.get $g64)))))`,
  ],
  [
    'atomic.notify operands',
    `(module ${P} (memory 1 1 shared) (func (drop (memory.atomic.notify (global.get $g) (global.get $g)))))`,
  ],

  // SIMD.
  ['simd splat operand', `(module ${P} (func (drop (i8x16.splat (global.get $g)))))`],
  [
    'simd replace_lane value',
    `(module ${P} (func (param v128) (drop (i32x4.replace_lane 0 (local.get 0) (global.get $g)))))`,
  ],
  [
    'simd extract_lane operand',
    `(module ${P} (func (param v128) (drop (i32x4.extract_lane 0 (local.get 0)))))`,
  ],
  [
    'simd shuffle left+right',
    `(module ${P} (func (param v128 v128) (drop (i8x16.shuffle 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 (local.get 0) (local.get 1)))))`,
  ],
  [
    'simd load_lane addr+vec',
    `(module ${P} (memory 1) (func (param v128) (drop (v128.load8_lane 0 (global.get $g) (local.get 0)))))`,
  ],
  [
    'simd store_lane addr+vec',
    `(module ${P} (memory 1) (func (param v128) (v128.store8_lane 0 (global.get $g) (local.get 0))))`,
  ],
  [
    'simd load_splat address',
    `(module ${P} (memory 1) (func (drop (v128.load8_splat (global.get $g)))))`,
  ],
  [
    'simd load_zero address',
    `(module ${P} (memory 1) (func (drop (v128.load32_zero (global.get $g)))))`,
  ],
];

describe('T13.11 - a named reference in every OPERAND slot encodes', () => {
  for (const [name, src] of OPERAND_CASES) {
    it(`encodes ${name}`, () => {
      let binary: Uint8Array | undefined;
      try {
        const r = wat2wasm(src);
        assert(!hasErrors(r.errors), `rejected:\n${src}\n${formatErrors(r.errors)}`);
        binary = r.binary;
      } catch (x) {
        // The T13.11 signature: an operand's name-var reached the writer.
        throw new Error(`threw while encoding ${name}: ${String((x as Error).message)}\n${src}`);
      }
      assert(binary && binary.length > 8, `empty binary for ${name}`);
      assertV8Accepts(binary, name, src);
    });
  }
});

describe('T13.11 - and each survives a round trip back through the numeric form', () => {
  it('re-encodes byte-identically from its own disassembly', () => {
    const differ: string[] = [];
    for (const [name, src] of OPERAND_CASES) {
      const first = wat2wasm(src);
      if (hasErrors(first.errors) || !first.binary) {
        differ.push(`${name}: first encode failed`);
        continue;
      }
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
