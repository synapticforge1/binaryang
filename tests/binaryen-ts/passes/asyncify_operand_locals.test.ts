/**
 * @module binaryen-ts/tests/passes/asyncify_operand_locals_test
 *
 * A rewind skips the code before a paused call but EXECUTES the call again, so
 * what the call's operands read must be restored, not only what is live after
 * it. In flat IR an operand is a `local.get` of a temp whose `local.set` the
 * rewind skipped. Until 2026-10-13 the save set was "live just after the call"
 * alone: a temp read only by the call was never saved. wasmtk found it with
 * TinyGo 0.43's nested-goroutine program, whose defer code loads a
 * `call_indirect`'s table index from memory; the rewind dispatched through
 * slot 0 and trapped "uninitialized element" (upstream's output runs).
 *
 * The index is the case that SHOWS: a lost direct-call argument is masked when
 * the callee restores its own parameters on its rewind.
 *
 * @license MIT
 */

import { assertEquals } from '@std/assert';
import { test } from 'node:test';

import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { readWat } from '../../../src/tools/read-wat.ts';
import { driveOnce } from './asyncify_helpers.ts';

// The table index lives in memory (offset 2048 holds 1; below 1024 is the
// driver's asyncify data and stack). Slot 0 is a decoy that answers 1000, so a
// lost index gives a WRONG ANSWER rather than only a trap.
const INDEX_FROM_MEMORY = `(module
  (import "env" "get" (func $get (result i32)))
  (memory 1)
  (export "memory" (memory 0))
  (data (i32.const 2048) "\\01\\00\\00\\00")
  (type $t (func (param i32) (result i32)))
  (table 2 funcref)
  (elem (i32.const 0) $decoy $suspends)
  (func $decoy (type $t) (param $x i32) (result i32)
    (i32.const 1000))
  (func $suspends (type $t) (param $x i32) (result i32)
    (i32.add (local.get $x) (call $get)))
  (func $main (export "main") (param $x i32) (result i32)
    (call_indirect (type $t)
      (local.get $x)
      (i32.load (i32.const 2048)))))`;

test('asyncify — a call_indirect index read from memory survives the rewind', () => {
  const mod = readWat(INDEX_FROM_MEMORY);
  new PassRunner(mod).add('Asyncify').run();
  // main(10) = suspends(10) = 10 + get() = 52 with get → 42; the decoy says 1000.
  assertEquals(driveOnce(writeWasm(mod), 'main', [10], 'get', 42), 52);
});
