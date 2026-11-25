// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Hand-written modules `bun run direct-behaviour` runs beside the corpus, one per way the
 * comparison used to be blind (security review round 4, R2 fidelity):
 *
 * - **the sign of a zero**: a result of `-0` and one of `+0` printed alike (`String(-0)` is
 *   `"0"`), so a pass that folded `0 * -1` to `+0` read as agreeing. The probes give the
 *   optimizer a `-0` to FOLD (constants), one to PRESERVE (an argument, sampled as `-0`) and the
 *   `+0` controls.
 * - **calls to imports**: the stand-ins returned 0 and nobody looked at the calls, so a pass that
 *   dropped, duplicated or reordered a call to an import changed nothing a return value showed.
 *   Each probe calls an import in a shape a pass is tempted by: a call whose result is dropped,
 *   two calls whose order the sum hides, a call in a loop, in a branch, in an inlinable
 *   function, and one from the start function.
 *
 * The corpus has none of these shapes on purpose or by luck; a gate is evidence about what it
 * reaches.
 */

import type { DirectInput } from '../direct-inputs.ts';

export const PROBES: DirectInput[] = [
  {
    name: 'probe#negative-zero',
    wat: `(module
      (func (export "mul") (result f64) (f64.mul (f64.const -1) (f64.const 0)))
      (func (export "neg") (result f64) (f64.neg (f64.const 0)))
      (func (export "sub") (result f64) (f64.sub (f64.const -0) (f64.const 0)))
      (func (export "ceil") (result f64) (f64.ceil (f64.const -0.5)))
      (func (export "nearest") (result f64) (f64.nearest (f64.const -0.25)))
      (func (export "sqrt") (result f64) (f64.sqrt (f64.const -0)))
      (func (export "copysign") (result f64) (f64.copysign (f64.const 0) (f64.const -1)))
      (func (export "fmul") (result f32) (f32.mul (f32.const -1) (f32.const 0)))
      (func (export "fneg") (result f32) (f32.neg (f32.const 0)))
      (func (export "fceil") (result f32) (f32.ceil (f32.const -0.5)))
      (func (export "pos") (result f64) (f64.sub (f64.const 0) (f64.const 0)))
      (func (export "fpos") (result f32) (f32.add (f32.const -0) (f32.const 0)))
      (func (export "demote") (result f32) (f32.demote_f64 (f64.const -0)))
      (func (export "promote") (result f64) (f64.promote_f32 (f32.const -0)))
      (func (export "convert") (result f64) (f64.convert_i32_s (i32.const 0)))
      (func (export "div") (result f64) (f64.div (f64.const 0) (f64.const -1))))`,
  },
  {
    name: 'probe#preserved-zero-sign',
    wat: `(module
      (func (export "id") (param f64) (result f64) (local.get 0))
      (func (export "add0") (param f64) (result f64) (f64.add (local.get 0) (f64.const 0)))
      (func (export "sub0") (param f64) (result f64) (f64.sub (local.get 0) (f64.const 0)))
      (func (export "mul1") (param f64) (result f64) (f64.mul (local.get 0) (f64.const 1)))
      (func (export "neg") (param f64) (result f64) (f64.neg (local.get 0)))
      (func (export "abs") (param f64) (result f64) (f64.abs (local.get 0)))
      (func (export "min") (param f64) (result f64) (f64.min (local.get 0) (f64.const 0)))
      (func (export "max") (param f64) (result f64) (f64.max (local.get 0) (f64.const -0)))
      (func (export "fadd0") (param f32) (result f32) (f32.add (local.get 0) (f32.const 0)))
      (func (export "fneg") (param f32) (result f32) (f32.neg (local.get 0)))
      (func (export "viaGlobal") (param f64) (result f64)
        (global.set $g (local.get 0)) (global.get $g))
      (global $g (mut f64) (f64.const 0))
      (func (export "viaMem") (param f64) (result f64)
        (f64.store (i32.const 8) (local.get 0)) (f64.load (i32.const 8)))
      (memory 1))`,
  },
  {
    name: 'probe#import-calls',
    wat: `(module
      (import "env" "log" (func $log (param i32)))
      (import "env" "logf" (func $logf (param f64)))
      (import "env" "get" (func $get (result i32)))
      (import "env" "get2" (func $get2 (result i32)))
      (global $n (mut i32) (i32.const 0))
      (func $helper (param i32) (call $log (local.get 0)))
      (func (export "dropped") (result i32)
        (drop (call $get)) (i32.const 7))
      (func (export "twice") (result i32)
        (call $log (i32.const 1)) (call $log (i32.const 2)) (i32.const 0))
      (func (export "order") (result i32)
        (i32.sub (call $get) (call $get2)))
      (func (export "sum") (result i32)
        (i32.add (call $get) (call $get2)))
      (func (export "order2") (result i32)
        (local $a i32)
        (local.set $a (call $get2))
        (i32.sub (call $get) (local.get $a)))
      (func (export "loop") (param i32) (result i32)
        (local $i i32)
        (block $out
          (loop $l
            (br_if $out (i32.ge_u (local.get $i) (i32.and (local.get 0) (i32.const 3))))
            (call $log (local.get $i))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l)))
        (local.get $i))
      (func (export "branch") (param i32) (result i32)
        (if (local.get 0) (then (call $log (i32.const 10))) (else (call $log (i32.const 20))))
        (i32.const 1))
      (func (export "inlined") (param i32) (result i32)
        (call $helper (local.get 0)) (call $helper (i32.add (local.get 0) (i32.const 1)))
        (i32.const 0))
      (func (export "float") (param f64) (result i32)
        (call $logf (local.get 0)) (call $logf (f64.const -0)) (i32.const 0))
      (func (export "twiceSame") (result i32)
        (call $log (i32.const 5)) (call $log (i32.const 5)) (i32.const 0))
      (func (export "deadValue") (result i32)
        (local $x i32)
        (local.set $x (call $get))
        (i32.const 3))
      (func $start (global.set $n (call $get)) (call $log (global.get $n)))
      (start $start))`,
  },
];
