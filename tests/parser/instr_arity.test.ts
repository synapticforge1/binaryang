// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.8 - `instrInputCount` must agree with how `buildPlainExpr` reads operands.
//
// design-decisions.md has carried this invariant since the Bug D work, with the
// failure mode spelled out: "an entry that disagrees ... will either drop
// operands (count too low) or pull bogus nops (count too high)". Three entries
// disagreed, and the consequence was worse than "bogus nops":
//
//   AtomicStore        listed 3, reads op0/op1        -> 2
//   AtomicRmw          listed 3, reads op0/op1        -> 2
//   AtomicRmwCmpxchg   listed 4, reads op0/op1/op2    -> 3
//
// The LINEAR-form parser pops `nInputs` off the operand stack. One too many
// meant it took a PLACEHOLDER into the address slot and left a real operand
// unconsumed - and a placeholder emits nothing (T10.8), so the operand was
// simply gone. `wasm2wat` emits linear form, so:
//
//   (i32.atomic.store (i32.const 0) (i32.const 5))
//   (drop (i32.atomic.rmw.add (i32.const 0) (i32.const 37)))
//   (i32.atomic.load (i32.const 0))          -- computes 42
//
// round-tripped through `wasm2wat` -> `wat2wasm` and came back **rejected by
// V8**. Every module using an atomic store or RMW disassembled to invalid wasm.
//
// **No conformance metric could see it.** parse-clean stops at the parser;
// round-trip over the spec testsuite never reaches these (its atomic modules do
// not survive to that metric); everything else starts from bytes. Found by the
// differential below, four days before a release.
//
// THE METHOD, which is the durable part: write the instruction FOLDED, where
// operands are inline children and the arity table is not consulted for them;
// disassemble to LINEAR, where the table is what pops them; re-encode; compare
// bytes. Any disagreement between the two halves shows up as a difference.
// Adding a case is one line, and every instruction that takes operands belongs
// here.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

const SHARED = '(memory $m 1 1 shared)';
const MEM = '(memory 1)';

const CASES: [string, string][] = [
  // --- atomics: the family the round trip flagged ---
  ['i32.atomic.load', `(module ${SHARED} (func (drop (i32.atomic.load (i32.const 0)))))`],
  ['i64.atomic.load', `(module ${SHARED} (func (drop (i64.atomic.load (i32.const 0)))))`],
  ['i32.atomic.store', `(module ${SHARED} (func (i32.atomic.store (i32.const 0) (i32.const 1))))`],
  ['i64.atomic.store', `(module ${SHARED} (func (i64.atomic.store (i32.const 0) (i64.const 1))))`],
  [
    'i32.atomic.rmw.add',
    `(module ${SHARED} (func (drop (i32.atomic.rmw.add (i32.const 0) (i32.const 1)))))`,
  ],
  [
    'i32.atomic.rmw.xchg',
    `(module ${SHARED} (func (drop (i32.atomic.rmw.xchg (i32.const 0) (i32.const 1)))))`,
  ],
  [
    'i64.atomic.rmw.and',
    `(module ${SHARED} (func (drop (i64.atomic.rmw.and (i32.const 0) (i64.const 1)))))`,
  ],
  [
    'i32.atomic.rmw8.add_u',
    `(module ${SHARED} (func (drop (i32.atomic.rmw8.add_u (i32.const 0) (i32.const 1)))))`,
  ],
  [
    'i32.atomic.rmw.cmpxchg',
    `(module ${SHARED} (func (drop (i32.atomic.rmw.cmpxchg (i32.const 0) (i32.const 1) (i32.const 2)))))`,
  ],
  [
    'i64.atomic.rmw.cmpxchg',
    `(module ${SHARED} (func (drop (i64.atomic.rmw.cmpxchg (i32.const 0) (i64.const 1) (i64.const 2)))))`,
  ],
  [
    'memory.atomic.wait32',
    `(module ${SHARED} (func (drop (memory.atomic.wait32 (i32.const 0) (i32.const 1) (i64.const 2)))))`,
  ],
  [
    'memory.atomic.wait64',
    `(module ${SHARED} (func (drop (memory.atomic.wait64 (i32.const 0) (i64.const 1) (i64.const 2)))))`,
  ],
  [
    'memory.atomic.notify',
    `(module ${SHARED} (func (drop (memory.atomic.notify (i32.const 0) (i32.const 1)))))`,
  ],
  ['atomic.fence', `(module ${SHARED} (func (atomic.fence)))`],

  // --- memory / table bulk ---
  ['memory.fill', `(module ${MEM} (func (memory.fill (i32.const 0) (i32.const 0) (i32.const 0))))`],
  ['memory.copy', `(module ${MEM} (func (memory.copy (i32.const 0) (i32.const 0) (i32.const 0))))`],
  [
    'memory.init',
    `(module ${MEM} (data $d "x") (func (memory.init $d (i32.const 0) (i32.const 0) (i32.const 0))))`,
  ],
  [
    'table.fill',
    '(module (table $t 1 funcref) (func (table.fill $t (i32.const 0) (ref.null func) (i32.const 0))))',
  ],
  [
    'table.copy',
    '(module (table $a 1 funcref) (table $b 1 funcref) (func (table.copy $a $b (i32.const 0) (i32.const 0) (i32.const 0))))',
  ],
  [
    'table.init',
    '(module (func $f) (table $t 1 funcref) (elem $e func $f) (func (table.init $t $e (i32.const 0) (i32.const 0) (i32.const 0))))',
  ],
  [
    'table.grow',
    '(module (table $t 1 funcref) (func (drop (table.grow $t (ref.null func) (i32.const 1)))))',
  ],
  [
    'table.set',
    '(module (table $t 1 funcref) (func (table.set $t (i32.const 0) (ref.null func))))',
  ],

  // --- core ---
  ['i32.store', `(module ${MEM} (func (i32.store (i32.const 0) (i32.const 1))))`],
  ['i32.load', `(module ${MEM} (func (drop (i32.load (i32.const 0)))))`],
  ['i32.add', '(module (func (drop (i32.add (i32.const 1) (i32.const 2)))))'],
  ['select', '(module (func (drop (select (i32.const 1) (i32.const 2) (i32.const 0)))))'],
  ['i32.eqz', '(module (func (drop (i32.eqz (i32.const 0)))))'],

  // --- SIMD ---
  [
    'i8x16.shuffle',
    `(module (func (drop (i8x16.shuffle 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0)))))`,
  ],
  [
    'v128.load8_lane',
    `(module ${MEM} (func (drop (v128.load8_lane 0 (i32.const 0) (v128.const i32x4 0 0 0 0)))))`,
  ],
  [
    'v128.store8_lane',
    `(module ${MEM} (func (v128.store8_lane 0 (i32.const 0) (v128.const i32x4 0 0 0 0))))`,
  ],
  [
    'i8x16.extract_lane_s',
    '(module (func (drop (i8x16.extract_lane_s 0 (v128.const i32x4 0 0 0 0)))))',
  ],
  [
    'i8x16.replace_lane',
    '(module (func (drop (i8x16.replace_lane 0 (v128.const i32x4 0 0 0 0) (i32.const 1)))))',
  ],
  [
    'v128.bitselect',
    '(module (func (drop (v128.bitselect (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0)))))',
  ],

  // --- GC ---
  [
    'struct.new',
    '(module (type $t (struct (field i32))) (func (drop (struct.new $t (i32.const 1)))))',
  ],
  [
    'struct.set',
    '(module (type $t (struct (field (mut i32)))) (func (param (ref $t)) (struct.set $t 0 (local.get 0) (i32.const 1))))',
  ],
  [
    'array.new',
    '(module (type $t (array i32)) (func (drop (array.new $t (i32.const 1) (i32.const 2)))))',
  ],
  [
    'array.set',
    '(module (type $t (array (mut i32))) (func (param (ref $t)) (array.set $t (local.get 0) (i32.const 0) (i32.const 1))))',
  ],
  [
    'array.get',
    '(module (type $t (array i32)) (func (param (ref $t)) (drop (array.get $t (local.get 0) (i32.const 0)))))',
  ],
  [
    'array.fill',
    '(module (type $t (array (mut i32))) (func (param (ref $t)) (array.fill $t (local.get 0) (i32.const 0) (i32.const 1) (i32.const 2))))',
  ],
  [
    'array.copy',
    '(module (type $t (array (mut i32))) (func (param (ref $t)) (array.copy $t $t (local.get 0) (i32.const 0) (local.get 0) (i32.const 0) (i32.const 1))))',
  ],
  [
    'array.new_data',
    '(module (type $t (array i8)) (data $d "x") (func (drop (array.new_data $t $d (i32.const 0) (i32.const 1)))))',
  ],
  ['ref.eq', '(module (func (param eqref eqref) (drop (ref.eq (local.get 0) (local.get 1)))))'],
  ['call', '(module (func $g (param i32)) (func (call $g (i32.const 1))))'],
  [
    'call_indirect',
    '(module (type $s (func (param i32))) (table 1 funcref) (func (call_indirect (type $s) (i32.const 1) (i32.const 0))))',
  ],
  ['return_call', '(module (func $g (param i32)) (func (return_call $g (i32.const 1))))'],
  [
    'return_call_indirect',
    '(module (type $s (func)) (table 1 funcref) (func (return_call_indirect (type $s) (i32.const 0))))',
  ],
  [
    'call_ref',
    '(module (type $s (func (param i32))) (func (param (ref $s)) (call_ref $s (i32.const 1) (local.get 0))))',
  ],
  [
    'br_if with value',
    '(module (func (result i32) (block $l (result i32) (br_if $l (i32.const 7) (i32.const 1)) (i32.const 9))))',
  ],
  ['br_table', '(module (func (block $a (block $b (br_table $a $b $a (i32.const 0))))))'],
  ['br with value', '(module (func (result i32) (block $l (result i32) (br $l (i32.const 7)))))'],
  [
    'throw with args',
    '(module (tag $e (param i32 i32)) (func (throw $e (i32.const 1) (i32.const 2))))',
  ],
  ['local.tee', '(module (func (local $x i32) (drop (local.tee $x (i32.const 1)))))'],
  [
    'global.set',
    '(module (global $g (mut i32) (i32.const 0)) (func (global.set $g (i32.const 1))))',
  ],
  ['memory.grow', '(module (memory 1) (func (drop (memory.grow (i32.const 1)))))'],
  ['memory.size', '(module (memory 1) (func (drop (memory.size))))'],
  [
    'struct.get',
    '(module (type $t (struct (field i32))) (func (param (ref $t)) (drop (struct.get $t 0 (local.get 0)))))',
  ],
  [
    'array.len',
    '(module (type $t (array i32)) (func (param (ref $t)) (drop (array.len (local.get 0)))))',
  ],
  [
    'array.new_fixed',
    '(module (type $t (array i32)) (func (drop (array.new_fixed $t 2 (i32.const 1) (i32.const 2)))))',
  ],
  [
    'array.new_default',
    '(module (type $t (array i32)) (func (drop (array.new_default $t (i32.const 2)))))',
  ],
  [
    'struct.new_default',
    '(module (type $t (struct (field i32))) (func (drop (struct.new_default $t))))',
  ],
  ['ref.i31 / i31.get_s', '(module (func (result i32) (i31.get_s (ref.i31 (i32.const 1)))))'],
  [
    'ref.test',
    '(module (type $t (struct)) (func (param anyref) (drop (ref.test (ref $t) (local.get 0)))))',
  ],
  ['ref.is_null', '(module (func (param anyref) (drop (ref.is_null (local.get 0)))))'],
  [
    'br_on_null',
    '(module (func (param (ref null func)) (block $l (drop (br_on_null $l (local.get 0))))))',
  ],
  [
    'br_on_non_null',
    '(module (func (param (ref null func)) (block $l (br_on_non_null $l (local.get 0)))))',
  ],
  [
    'ref.as_non_null',
    '(module (func (param (ref null func)) (drop (ref.as_non_null (local.get 0)))))',
  ],
  ['i32.trunc_f64_s', '(module (func (drop (i32.trunc_f64_s (f64.const 1)))))'],
  ['i32.trunc_sat_f32_u', '(module (func (drop (i32.trunc_sat_f32_u (f32.const 1)))))'],
  ['v128.load32_zero', '(module (memory 1) (func (drop (v128.load32_zero (i32.const 0)))))'],
  ['v128.load8_splat', '(module (memory 1) (func (drop (v128.load8_splat (i32.const 0)))))'],
  ['i8x16.splat', '(module (func (drop (i8x16.splat (i32.const 1)))))'],
  [
    'f32x4.relaxed_madd',
    '(module (func (drop (f32x4.relaxed_madd (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0)))))',
  ],
  [
    'i32.add128',
    '(module (func (result i64) (local i64) (drop (i64.add128 (i64.const 1) (i64.const 2) (i64.const 3) (i64.const 4))) (i64.const 0)))',
  ],
  ['throw_ref', '(module (func (param exnref) (throw_ref (local.get 0))))'],
];

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

describe('T13.8 - folded and linear forms encode identically', () => {
  for (const [name, src] of CASES) {
    it(`${name} survives folded -> linear -> folded`, () => {
      const first = wat2wasm(src);
      assert(
        !hasErrors(first.errors) && first.binary,
        `folded form rejected:\n${src}\n${formatErrors(first.errors)}`,
      );
      const text = wasm2wat(first.binary).text;
      assert(text, `wasm2wat produced nothing for ${name}`);
      const again = wat2wasm(text);
      assert(
        !hasErrors(again.errors) && again.binary,
        `linear re-parse rejected ${name}:\n${text}\n${formatErrors(again.errors)}`,
      );
      const a = again.binary, b = first.binary;
      assert(
        a.length === b.length && a.every((x, i) => x === b[i]),
        `ARITY MISMATCH for ${name}\n  folded: ${hex(b)}\n  linear: ${hex(a)}\n${text}`,
      );
    });
  }
});

describe('T13.8 - and the round trip still COMPUTES the same thing', () => {
  it('keeps an atomic store/rmw/load sequence at 42', async () => {
    // The regression in its original form: this returned 42, and its own
    // disassembly was rejected by V8 because the rmw had lost an operand.
    const src = `(module (memory $m (export "mem") 1 1 shared)
      (func (export "f") (result i32)
        (i32.atomic.store (i32.const 0) (i32.const 5))
        (drop (i32.atomic.rmw.add (i32.const 0) (i32.const 37)))
        (i32.atomic.load (i32.const 0))))`;
    const run = async (bytes: Uint8Array): Promise<number> => {
      const buf = new ArrayBuffer(bytes.length);
      new Uint8Array(buf).set(bytes);
      const { instance } = await WebAssembly.instantiate(buf, {});
      return (instance.exports.f as () => number)();
    };
    const first = wat2wasm(src);
    assert(!hasErrors(first.errors) && first.binary, formatErrors(first.errors));
    assert(await run(first.binary) === 42, 'the original does not compute 42');

    const again = wat2wasm(wasm2wat(first.binary).text!);
    assert(!hasErrors(again.errors) && again.binary, formatErrors(again.errors));
    assert(await run(again.binary) === 42, 'the round trip changed what the program computes');
  });
});
