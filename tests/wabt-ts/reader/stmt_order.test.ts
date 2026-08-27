// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T9.1 — the binary READER had no `pushStmt`, so `wasm2wat` silently changed
// what a module means.
//
// The decoder keeps two per-frame lists: `stack` holds values a following
// instruction might still consume, `stmts` holds committed statements. At
// `end`, `Frame.flush` concatenated them as `[...stmts, ...stack]` — so a
// value nobody ended up consuming was emitted AFTER every statement that
// followed it in the original code.
//
//   (block (result i32) (global.get $g) (global.set $g (i32.const 9)))
//
// `global.get` went on the stack, `global.set` was a statement, and the block
// came back out of `wasm2wat` as `global.set; global.get`. The function
// returned 1 before the round-trip and 9 after it — no error, no warning,
// just a different program.
//
// This is the same defect the PARSER fixed in v1.3.0, on the other side of
// the round-trip, and the fix is the same shape: drain pending values into
// `stmts` before committing a statement.
//
// A pending value is NOT always dead — it may be consumed after the
// statement. Draining commits it anyway, and the later consumer then decodes
// with `Nop` operands: an inaccurate TREE but a correct BINARY, because the
// drained values are emitted in order and stay on the runtime operand stack
// while the Nops encode to nothing that disturbs it. Ordering, by contrast,
// is not recoverable once lost — which is why draining is the right trade.
// Both halves of that are asserted below.
//
// Neither campaign metric would ever have caught this. Parse-clean and
// V8-validity both measure the ENCODE path, and a reordered module is still
// perfectly valid wasm. Spec-testsuite round-trip fidelity — the metric that
// does see it — went 1942 -> 1954 of 2105 modules byte-identical, 76 -> 70
// files affected, no regressions.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
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

/** binary -> wat -> binary, which is where the reordering happened. */
function roundTrip(binary: Uint8Array): Uint8Array {
  const { text, errors } = wasm2wat(binary);
  if (hasErrors(errors) || !text) throw new Error('wasm2wat:\n' + formatErrors(errors));
  return compile(text);
}

async function callF(binary: Uint8Array): Promise<unknown> {
  const { instance } = await WebAssembly.instantiate(toBuf(binary));
  return (instance.exports.f as () => unknown)();
}

/**
 * Run `f` on the module and on its round-trip, and require the answer to
 * survive. Behaviour is the property that matters; byte-identity is a
 * stricter proxy that pins down WHERE a regression happened, so it is
 * asserted too unless a separate known gap perturbs the encoding.
 */
async function survivesRoundTrip(
  wat: string,
  expected: unknown,
  exactBytes = true,
): Promise<void> {
  const first = compile(wat);
  assertEquals(await callF(first), expected, 'the original module is wrong — bad test input');
  const second = roundTrip(first);
  assertEquals(await callF(second), expected, 'round-trip changed what the module computes');
  if (exactBytes) assertEquals([...second], [...first], 'round-trip changed the encoding');
}

describe('T9.1 — a pending value is not sunk past the statements after it', () => {
  it('a global read before its write keeps reading the OLD value', async () => {
    // The reported case. Reordered, this returns 9.
    await survivesRoundTrip(
      `(module
        (global $g (mut i32) (i32.const 1))
        (func (export "f") (result i32)
          (block (result i32)
            (global.get $g)
            (global.set $g (i32.const 9)))))`,
      1,
    );
  });

  it('a memory read before its write keeps reading the OLD value', async () => {
    await survivesRoundTrip(
      `(module
        (memory 1)
        (func (export "f") (result i32)
          (i32.store (i32.const 0) (i32.const 1))
          (block (result i32)
            (i32.load (i32.const 0))
            (i32.store (i32.const 0) (i32.const 9)))))`,
      1,
    );
  });

  it('a local read before its write keeps reading the OLD value', async () => {
    await survivesRoundTrip(
      `(module
        (func (export "f") (result i32) (local $x i32)
          (local.set $x (i32.const 1))
          (block (result i32)
            (local.get $x)
            (local.set $x (i32.const 9)))))`,
      1,
    );
  });

  it('holds across several pending values', async () => {
    // Two values pending when the statement lands; both must stay ahead of
    // it AND keep their order relative to each other.
    //
    // Bytes are NOT compared here: the reader cannot model a multi-value
    // block result as N separate operand-stack values, so the `i32.add`
    // after `end` decodes with Nop operands and the re-encode carries three
    // extra `nop`s. Inert at runtime — the answer is still 11 — but a
    // separate gap from the one under test, and not one this test should
    // fail on.
    await survivesRoundTrip(
      `(module
        (global $g (mut i32) (i32.const 1))
        (func (export "f") (result i32)
          (block (result i32 i32)
            (global.get $g)
            (i32.const 10)
            (global.set $g (i32.const 9)))
          (i32.add)))`,
      11,
      false,
    );
  });

  it('a pending value consumed AFTER the statement still computes correctly', async () => {
    // Draining commits both pending values as statements, so the `i32.add`
    // gets Nop operands — an inaccurate tree. The binary is still right:
    // the drained values are emitted in order and stay on the runtime
    // operand stack, and the Nops encode to nothing that disturbs it.
    await survivesRoundTrip(
      `(module
        (global $g (mut i32) (i32.const 1))
        (func (export "f") (result i32)
          (block (result i32)
            (global.get $g)
            (i32.const 10)
            (global.set $g (i32.const 9))
            (i32.add))))`,
      11,
      false,
    );
  });

  it('holds in a nested block', async () => {
    await survivesRoundTrip(
      `(module
        (global $g (mut i32) (i32.const 1))
        (func (export "f") (result i32)
          (block (result i32)
            (block (result i32)
              (global.get $g)
              (global.set $g (i32.const 9))))))`,
      1,
    );
  });

  it('holds when the pending value comes from a call', async () => {
    await survivesRoundTrip(
      `(module
        (global $g (mut i32) (i32.const 1))
        (func $read (result i32) (global.get $g))
        (func $bump (global.set $g (i32.const 9)))
        (func (export "f") (result i32)
          (block (result i32)
            (call $read)
            (call $bump))))`,
      1,
    );
  });

  it('an ordinary nested operand is untouched', async () => {
    // The control: with no statement between producer and consumer there is
    // nothing to drain, and the operand stays nested exactly as before.
    await survivesRoundTrip(
      `(module
        (global $g (mut i32) (i32.const 4))
        (func (export "f") (result i32)
          (i32.add (global.get $g) (i32.const 3))))`,
      7,
    );
  });
});

describe('T9.1 — the reordering is visible in wasm2wat output', () => {
  it('prints the read before the write', () => {
    const { text } = wasm2wat(compile(
      `(module
        (global $g (mut i32) (i32.const 1))
        (func (export "f") (result i32)
          (block (result i32)
            (global.get $g)
            (global.set $g (i32.const 9)))))`,
    ));
    assert(text);
    const body = text.slice(text.indexOf('block'), text.indexOf('end'));
    assert(
      body.indexOf('global.get') < body.indexOf('global.set'),
      `the read sank past the write:\n${body}`,
    );
  });
});
