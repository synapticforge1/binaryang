// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T10.8 — a synthesized operand slot-filler was written out as a real `nop`.
//
// Both decoders build a TREE from a stack machine, so every operand slot has
// to be filled with something. When the value that belongs in a slot is not on
// the decoder's operand stack, the slot got a bare `{ kind: 'nop' }`. The
// commonest reason is a multi-result producer: `call $two`, whatever number of
// values it pushes, is ONE node on that stack, so the first `local.set` takes
// the call and the second is left with nothing.
//
//     call $two          ;; two results
//     local.set 5        ;; takes the call node
//     local.set 4        ;; ... and this got a Nop stand-in
//
// The stand-in is inert — a nop pushes nothing, so at runtime the second
// `local.set` still takes the value the call left — which is why this read as
// cosmetic. It is a byte that was not in the input, and the next round trip
// adds another: `1_regular-expressions.wat` went 3855 → 3857 → 3859 → 3861,
// +2 every pass with no bound.
//
// A placeholder now says so (`NopExpr.placeholder`), and neither writer emits
// one: it means "the value is already on the stack", which wasm spells by
// writing nothing. A `nop` the source actually wrote is unmarked and still
// emitted — the difference matters, because `(local.set $x (nop))` is invalid
// wasm and an encoder must never repair its input (T11).
//
// Round-trip fidelity: wasmtk WASI corpus 225 → **270 / 270**, spec testsuite
// 2043 → 2074 / 2120. The four campaign metrics are unmoved (parse-clean
// 257/257, V8-valid 2120/2120, agreement 2120/2120, assert_invalid 2664/2737).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Round-trip until the bytes stop changing, or give up after `n` passes. */
function settle(binary: Uint8Array, n = 5): { passes: number; sizes: number[] } {
  const sizes = [binary.length];
  let b = binary;
  for (let i = 1; i <= n; i++) {
    const next = compile(wasm2wat(b).text!);
    sizes.push(next.length);
    if (sameBytes(next, b)) return { passes: i, sizes };
    b = next;
  }
  return { passes: -1, sizes };
}

function accepts(binary: Uint8Array): boolean {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

// A multi-result call whose two results feed two separate local.sets — the
// shape wasic emits, and the one the tree IR cannot attribute.
const MULTI_VALUE = `(module
  (func $two (result i32 i32) (i32.const 1) (i32.const 2))
  (func $use (export "use") (result i32)
    (local $a i32) (local $b i32)
    (call $two)
    (local.set $b)
    (local.set $a)
    (i32.sub (local.get $a) (local.get $b))))`;

describe('T10.8 — a synthesized operand slot-filler is not an instruction', () => {
  it('marks the parser-made placeholder as one', () => {
    const { module, errors } = parseWatModule(MULTI_VALUE);
    assert(!hasErrors(errors), formatErrors(errors));
    const sets = module.funcs[1]!.body.filter((e) => e.kind === 'local.set');
    assertEquals(sets.length, 2);
    // The first local.set in source order takes the call; the second is left
    // with nothing, and that stand-in must say it is one.
    const starved = sets
      .map((e) => (e as unknown as { value: { kind: string; placeholder?: boolean } }).value)
      .find((v) => v.kind === 'nop');
    assert(starved, 'expected one starved local.set');
    assertEquals(starved.placeholder, true);
  });

  it('marks the binary reader’s placeholder as one', () => {
    // The reader has the same problem from the other direction, and had ~95
    // copies of the same `stack.pop() ?? nop` idiom.
    const errs = makeErrorList();
    const module = readBinaryIr(compile(MULTI_VALUE), errs);
    assert(!hasErrors(errs), formatErrors(errs));
    assert(module);
    const starved = module.funcs[1]!.body
      .filter((e) => e.kind === 'local.set')
      .map((e) => (e as unknown as { value: { kind: string; placeholder?: boolean } }).value)
      .find((v) => v.kind === 'nop');
    assert(starved, 'expected one starved local.set');
    assertEquals(starved.placeholder, true);
  });

  it('emits no padding byte for it', () => {
    const wat = wasm2wat(compile(MULTI_VALUE)).text!;
    assert(!/\bnop\b/.test(wat), wat);
  });

  it('reaches a round-trip fixed point instead of growing every pass', () => {
    const { passes, sizes } = settle(compile(MULTI_VALUE));
    assertEquals(passes, 1, `sizes: ${sizes.join(' -> ')}`);
  });

  it('still computes the right answer', async () => {
    // The stand-in worked by accident; make sure removing it kept the
    // semantics — $a takes the FIRST result, $b the second, so 1 - 2 = -1.
    const binary = compile(MULTI_VALUE);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf, {});
    assertEquals((instance.exports.use as () => number)(), -1);
  });

  it('keeps a `nop` the source really wrote', () => {
    const src = '(module (func $f (result i32) nop nop i32.const 7 nop))';
    const first = compile(src);
    const text = wasm2wat(first).text!;
    assertEquals((text.match(/\bnop\b/g) ?? []).length, 3);
    assert(sameBytes(compile(text), first));
  });
});

describe('T10.8 — dropping the placeholder does not repair invalid input', () => {
  // The T11 rule: an encoder must never turn a module the spec calls invalid
  // into one an engine accepts. A placeholder stands for "the value is already
  // on the stack"; when there is genuinely nothing there, writing nothing
  // leaves the same stack underflow that writing `nop` did.
  const cases: [string, string][] = [
    ['a starved local.set', '(module (func (local $x i32) (local.set $x)))'],
    ['an explicit (nop) operand', '(module (func (local $x i32) (local.set $x (nop))))'],
    ['a starved i32.add', '(module (func (result i32) (i32.add (i32.const 1))))'],
  ];

  for (const [name, src] of cases) {
    it(`leaves ${name} invalid`, () => {
      const binary = compile(src);
      assertEquals(accepts(binary), false, 'V8 must still reject');
      assertEquals(
        wasmValidate(binary, { features: allFeatures() }).result,
        Result.Error,
        'our validator must still reject',
      );
    });
  }
});
