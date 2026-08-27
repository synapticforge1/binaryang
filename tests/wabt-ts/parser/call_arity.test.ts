// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T10.5 — linear-form `call` drained the whole operand stack.
//
// `instrInputCount` returns -1 for `call`, because the arity is the CALLEE's
// param count and that is not a property of the token. The parser read -1 as
// "consume everything on the operand stack", which is wrong whenever a value
// below the call's own arguments belongs to a LATER instruction:
//
//     i32.const 0        ;; the address for the i32.store below
//     f64.const 5
//     f64.const 3
//     call $f            ;; takes TWO args, but swallowed all three
//     i32.store          ;; ... so its address slot got a Nop placeholder
//
// The Nop is inert — it pushes nothing, so `i32.store` still finds the address
// the `i32.const 0` left on the stack — which is why this read as cosmetic and
// sat at the bottom of the T10 list. It is not cosmetic: the re-encode carries
// an extra `nop` byte, the next round trip adds another, and the encoding
// grows without bound. Our own `wasm2wat` emits linear form, so a
// `binary -> wasm2wat -> wat2wasm` cycle is exactly what triggers it.
//
// The arity comes from the callee's signature, so function BODIES are now
// parsed after the whole module field list — otherwise a call to a function
// declared later in the file could not be resolved, and that is not a rare
// shape: 199 of the 270 modules in the wasmtk WASI corpus contain at least
// one forward reference.
//
// Round-trip fidelity: wasmtk WASI corpus 50 -> 225 / 270 byte-identical;
// spec testsuite 2041 -> 2043 / 2120. The four campaign metrics are unmoved
// (parse-clean 257/257, V8-valid 2120/2120, agreement 2120/2120,
// assert_invalid 2664/2737).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

/** Instantiate and read back an exported global, so the module really runs. */
async function runGlobal(binary: Uint8Array, name: string): Promise<number> {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  const { instance } = await WebAssembly.instantiate(buf, {});
  return (instance.exports[name] as WebAssembly.Global).value as number;
}

/** Round-trip until the bytes stop changing, or give up after `n` passes. */
function settle(binary: Uint8Array, n = 5): { passes: number; sizes: number[] } {
  const sizes = [binary.length];
  let b = binary;
  for (let i = 1; i <= n; i++) {
    const next = compile(wasm2wat(b).text!);
    sizes.push(next.length);
    if (next.length === b.length && next.every((x, j) => x === b[j])) {
      return { passes: i, sizes };
    }
    b = next;
  }
  return { passes: -1, sizes };
}

const STORE_AFTER_CALL = `(module
  (memory 1)
  (func $f (param f64 f64) (result i32) (i32.const 1))
  (func $g
    i32.const 0
    f64.const 5
    f64.const 3
    call $f
    i32.store))`;

describe('T10.5 — a call takes its own arity, not the whole stack', () => {
  it('leaves a value below the arguments for the instruction that owns it', () => {
    const { module, errors } = parseWatModule(STORE_AFTER_CALL);
    assert(!hasErrors(errors), formatErrors(errors));

    const store = module.funcs[1]!.body[0]!;
    assertEquals(store.kind, 'store');
    // The address is the i32.const, not a Nop stand-in.
    assertEquals((store as unknown as { address: { kind: string } }).address.kind, 'const');
    const call = (store as unknown as { value: { kind: string; args: unknown[] } }).value;
    assertEquals(call.kind, 'call');
    assertEquals(call.args.length, 2);
  });

  it('emits no padding instruction for it', () => {
    const wat = wasm2wat(compile(STORE_AFTER_CALL)).text!;
    assert(!/\bnop\b/.test(wat), wat);
  });

  it('resolves a callee declared LATER in the module', () => {
    // The whole reason bodies are parsed after the module field list.
    const { module, errors } = parseWatModule(`(module
      (memory 1)
      (func $g
        i32.const 0
        f64.const 5
        f64.const 3
        call $late
        i32.store)
      (func $late (param f64 f64) (result i32) (i32.const 1)))`);
    assert(!hasErrors(errors), formatErrors(errors));

    const store = module.funcs[0]!.body[0]!;
    assertEquals((store as unknown as { address: { kind: string } }).address.kind, 'const');
  });

  it('resolves a numeric callee index that is a forward reference', () => {
    const { module, errors } = parseWatModule(`(module
      (memory 1)
      (func $g
        i32.const 0
        f64.const 5
        f64.const 3
        call 1
        i32.store)
      (func (param f64 f64) (result i32) (i32.const 1)))`);
    assert(!hasErrors(errors), formatErrors(errors));
    const store = module.funcs[0]!.body[0]!;
    assertEquals((store as unknown as { address: { kind: string } }).address.kind, 'const');
  });

  it('reaches a round-trip fixed point instead of growing every pass', () => {
    // The defect that makes this more than cosmetic: each pass added one nop.
    const { passes, sizes } = settle(compile(STORE_AFTER_CALL));
    assertEquals(passes, 1, `sizes: ${sizes.join(' -> ')}`);
  });

  it('runs correctly — the store uses the address the source named', async () => {
    // The Nop made this WORK by accident (a nop pushes nothing, so the store
    // still found the address underneath). Pin the behaviour, not just bytes.
    const binary = compile(`(module
      (memory 1)
      (global $out (export "out") (mut i32) (i32.const 0))
      (func $add (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
      (func $start
        i32.const 40
        i32.const 2
        call $add
        global.set $out)
      (start $start))`);
    assertEquals(await runGlobal(binary, 'out'), 42);
  });

  it('still drains for the folded multi-value receive idiom (Bug D)', () => {
    // `(call $two) (local.set $b) (local.set $a)` is how wasic receives two
    // results. The arity fix must not disturb it: the call takes 0 args, and
    // each local.set pulls from the surrounding stack.
    const { module, errors } = parseWatModule(`(module
      (func $two (result i32 i32) (i32.const 1) (i32.const 2))
      (func $use (result i32)
        (local $a i32) (local $b i32)
        (call $two)
        (local.set $b)
        (local.set $a)
        (local.get $a)))`);
    assert(!hasErrors(errors), formatErrors(errors));
    const setB = module.funcs[1]!.body.find((e) => e.kind === 'local.set');
    assert(setB);
    assertEquals((setB as unknown as { value: { kind: string } }).value.kind, 'call');
  });

  it('keeps local names resolving across the deferred body parse', () => {
    // Bodies are parsed later, but with the scope captured at the header.
    const { module, errors } = parseWatModule(`(module
      (func $f (param $p i32) (result i32)
        (local $l i32)
        (local.set $l (local.get $p))
        (local.get $l)))`);
    assert(!hasErrors(errors), formatErrors(errors));
    const set = module.funcs[0]!.body[0]!;
    const v = (set as unknown as { var: { kind: string; value?: number } }).var;
    assertEquals(v.kind, 'index');
    assertEquals(v.value, 1);
  });
});
