// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Regression: `resolveNames` must recurse into the optional carried *value* of
 * `br` / `br_if`, not just their `cond`.
 *
 * Reported by wasmtk's on-demand stdlib bundling track (the RegExp / generic
 * loop-condition capability). The flat (linear) WAT emitted by wasmmerge can
 * route a whole sub-expression into `br_if.value`: a loop whose exit test is
 *
 *   loop block
 *     <cond>
 *     if (result i32) … call $f … else i32.const 0 end
 *     i32.eqz
 *     br_if 2          ;; the (if…) value lands in br_if.value, not cond
 *     …
 *   end end
 *
 * `resolveNames` resolved `br_if.cond` but skipped `br_if.value`, so any
 * func/global/local *name* nested inside the carried expression (here the
 * `call $f`) was never mapped to an index and the writer emitted `call 0`
 * (and, because the wrong-arity call mis-drained the operand stack, scrambled
 * the operands too). The module still *validated* — it just called the wrong
 * function (typically the first import) and silently mis-ran after a wasmmerge
 * splice. A plain validate gate can't catch it; this test executes the result.
 */

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';

// A flat-form module mirroring the wasmmerge output shape: two imports (so the
// real call targets are NOT index 0), two helper funcs called by name from
// inside an `(if (result i32))` whose value feeds `i32.eqz` → `br_if`.
const WAT = `(module
  (import "wasi" "proc_exit" (func $proc_exit (param i32)))
  (import "wasi" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  (func $charAt (param i32 i32 i32) (result i32)
    local.get 0 local.get 2 i32.add i32.load8_u)
  (func $isLower (param i32) (result i32)
    local.get 0 i32.const 97 i32.ge_s)
  (func $countLeadingLower (export "countLeadingLower") (param i32 i32) (result i32)
    (local i32) (local i32)
    local.get 1 local.set 2
    i32.const 0 local.set 3
    block loop block
      local.get 3 local.get 2 i32.lt_s
      if (result i32)
        local.get 0 local.get 1 local.get 3 call $charAt call $isLower
        i32.const 1 i32.eq
      else
        i32.const 0
      end
      i32.eqz
      br_if 2
      local.get 3 i32.const 1 i32.add local.set 3
      br 1
    end end end
    local.get 3 return))`;

describe('regression: resolveNames recurses into br_if.value', () => {
  it('resolves named calls carried in br_if.value and runs correctly', async () => {
    const { binary, errors } = wat2wasm(WAT);
    if (hasErrors(errors)) throw new Error(`wat2wasm:\n${formatErrors(errors)}`);
    assert(binary, 'expected a binary');

    // Module must validate AND execute with the right semantics.
    const mod = await WebAssembly.instantiate(binary as BufferSource, {
      wasi: {
        proc_exit() {},
        fd_write() {
          return 0;
        },
      },
    });
    const exports = mod.instance.exports as Record<string, unknown>;
    const mem = new Uint8Array((exports.memory as WebAssembly.Memory).buffer);
    const count = exports.countLeadingLower as (p: number, l: number) => number;

    // "abcXY" → 3 leading lowercase letters.
    mem.set([97, 98, 99, 88, 89], 0);
    assertEquals(count(0, 5), 3);

    // "abc" (all lowercase) → 3; the i==len iteration must short-circuit and
    // NOT mis-call proc_exit (which would terminate / mis-count).
    mem.set([97, 98, 99], 0);
    assertEquals(count(0, 3), 3);

    // "XYZ" → 0 leading lowercase.
    mem.set([88, 89, 90], 0);
    assertEquals(count(0, 3), 0);
  });
});

void Result;
