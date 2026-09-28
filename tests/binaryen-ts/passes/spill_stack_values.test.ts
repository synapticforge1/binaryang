// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A value the wabt-ts reader left on the operand stack is reachable only THROUGH
// the stack, so a pass that puts a block boundary between it and the `pop` that
// takes it loses it (One front end, stage 2, R11'). `PassRunner` makes those
// values explicit before the first pass runs — and only then, so a plain
// read-and-write stays byte-exact.
//
// 🔧 What it fixes, measured before the fix: route B emitted INVALID modules at
// -O3 for `spec/br/br.0.wasm` and `spec/nop/nop.0.wasm` — "not enough arguments
// on the stack for local.set" — because `Inlining` wrapped the code in a block
// while the value stayed outside it.
//
// ⚠️ What it must NOT touch, and each of these broke a real test when it did: a
// value produced by a SIBLING OPERAND (`i32.sub(pop, call)` — 10 multi-value
// tests trapped), an ENTRY value (a parameter or a caught payload), and a
// MULTI-result producer (one local cannot hold a tuple).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { prepareForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/encoder/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { spillStackValues } from '../../../src/binaryen-ts/passes/spill-stack-values.ts';
import { ExpressionKind, typeOf } from '../../../src/binaryen-ts/ir/expressions.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import type { Expression } from '../../../src/binaryen-ts/ir/expressions.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';

const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors) && r.binary.length > 0, `assembles: ${JSON.stringify(r.errors)}`);
  assert(WebAssembly.validate(r.binary as BufferSource), 'the engine accepts the fixture');
  return r.binary;
};
/** The reader route: byte-faithful tree, then made ready for the passes. */
const routeB = (bytes: Uint8Array): WasmModule =>
  prepareForPasses(readBinaryIr(bytes, makeErrorList(), { readDebugNames: true })) as WasmModule;
const pops = (m: WasmModule) => {
  let n = 0;
  for (const f of m.functions) {
    walkExpression(f.body as unknown as Expression, (e) => {
      if (e.kind === ExpressionKind.Pop) n++;
    });
  }
  return n;
};
const results = (bytes: Uint8Array) => [0, 7, -3].map((arg) => call(bytes, arg));
const call = (bytes: Uint8Array, arg: number) => {
  try {
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports;
    return (x.f as (v: number) => number)(arg);
  } catch (e) {
    return `threw: ${(e as Error).message.slice(0, 60)}`;
  }
};

// A value drained to a statement by the instructions after it, taken later by a
// `return` — the shape `spec/nop/nop.0.wasm` has, in a callee so `Inlining` moves
// it into the caller's block.
const INLINED = `(module
  (func $helper (param i32) (result i32)
    local.get 0
    nop
    nop
    return)
  (func (export "f") (param i32) (result i32) (call $helper (local.get 0))))`;

describe("a stack-held value survives the passes (R11')", () => {
  const bytes = asm(INLINED);

  it('the reader really does leave a `pop` here — the fixture discriminates', () => {
    const m = routeB(bytes);
    assert(pops(m) > 0, 'the tree holds a placeholder for a stack-held value');
  });

  it('-O3 gives a VALID module that computes the same', () => {
    const m = routeB(bytes);
    new PassRunner(m, { optimizeLevel: 3, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'the optimized module is valid');
    for (const arg of [0, 7, -3]) assertEquals(call(out, arg), call(bytes, arg), `f(${arg})`);
  });

  it('`Flatten` no longer refuses the tree — it has no `pop` to refuse', () => {
    // ⚠️ This is the assertion that DISCRIMINATES at the pass level: `Flatten`
    // throws "flatten: pop is not yet supported by this port" on a tree that
    // holds one, so route B could not be flattened at all. The two spec modules
    // that motivated this fix (`br.0`, `nop.0` at -O3, through `Inlining`) need
    // their whole module to reproduce — several attempts at a small fixture for
    // that came out valid either way, so the corpus measurement is the evidence
    // there and this is the fixture-sized proof.
    // The body of `spec/nop/nop.0.wasm`'s function 38, which is where this began.
    const m = routeB(asm(`(module
      (func (export "f") (param i32) (result i32) nop nop local.get 0 nop nop return))`));
    assert(pops(m) > 0, 'the fixture holds a placeholder before the runner touches it');
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).add('Flatten').run();
    // 🔧 What it produces is a separate, pre-existing matter: `Flatten` emits an
    // invalid module for a body ending in `return` on BOTH routes (recorded in
    // open-work.md). This test is about not being refused for holding a `pop`.
    assertEquals(pops(m), 0, 'the pops were gone before Flatten saw the tree');
  });

  it('the value is explicit before the passes run: no `pop` left to lose', () => {
    const m = routeB(bytes);
    assert(spillStackValues(m) > 0, 'a function was rewritten');
    assertEquals(pops(m), 0, 'nothing is left depending on the stack');
    // And the rewrite is faithful: the module still computes what it did.
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource));
    for (const arg of [0, 7, -3]) assertEquals(call(out, arg), call(bytes, arg), `f(${arg})`);
  });

  it('with NO pass queued nothing is rewritten — a plain round trip is byte-exact', () => {
    const m = routeB(bytes);
    new PassRunner(m).run();
    assert(pops(m) > 0, 'the placeholders are still there');
    assertEquals([...writeWasm(m)], [...bytes], 'byte-identical');
  });
});

describe('a CHAIN of values, each taken by the next statement', () => {
  it('every link is kept — none is deleted with the node it moved into', () => {
    // 🔧 A producer moved into its consumer was inserted as it STOOD, so when
    // that consumer was itself moved into the next statement, the next statement
    // got the original node, whose `pop` still waited for a producer no longer
    // anywhere: the first link was DELETED. Latent until the block-parameter
    // lowering (R15) left such chains; `spec/br_on_cast` lost a whole block.
    // The reader nests adjacent statements itself, so the chain is built by
    // hand, from the nested form:  local.get 0 · i32.eqz (pop) · return (pop).
    const bytes = asm(`(module
      (func (export "f") (param i32) (result i32) (return (i32.eqz (local.get 0)))))`);
    const m = routeB(bytes);
    const body = m.functions[0]!.body as unknown as { children: Expression[] };
    const ret = body.children[0] as Expression & { values: Expression[] };
    const eqz = ret.values[0] as Expression & { value: Expression };
    assertEquals([ret.kind, eqz.kind], [ExpressionKind.Return, ExpressionKind.Unary]);
    const pop = (type: unknown) => ({ kind: ExpressionKind.Pop, type }) as Expression;
    body.children = [
      eqz.value,
      { ...eqz, value: pop(typeOf(eqz.value)) } as Expression,
      { ...ret, values: [pop(typeOf(eqz))] } as Expression,
    ];
    const chained = writeWasm(m);
    assertEquals(results(chained), results(bytes), 'the hand-built chain is the same program');
    assert(pops(m) === 2, 'the fixture holds the chain');

    assert(spillStackValues(m) > 0);
    assertEquals(pops(m), 0, 'both links were nested');
    assertEquals(results(writeWasm(m)), results(bytes), 'valid, and nothing was lost');
  });
});

describe('what the spill must leave alone', () => {
  it('a value from a SIBLING OPERAND: `i32.sub(pop, call)` stays', () => {
    // The two-result call pushes both values; the `pop` is its first result and
    // the `i32.sub` takes both. Nothing can come between them.
    const bytes = asm(`(module
      (func $pair (param i32) (result i32 i32) (i32.const 9) (local.get 0))
      (func (export "f") (param i32) (result i32) (call $pair (local.get 0)) (i32.sub)))`);
    const m = routeB(bytes);
    const before = pops(m);
    // `locals` is the one index space, PARAMS FIRST, so count it before and after
    // rather than expecting a number.
    const slotsBefore = m.functions.reduce((n, f) => n + f.locals.length, 0);
    assert(before > 0, 'the fixture has a placeholder');
    spillStackValues(m);
    assertEquals(pops(m), before, 'left exactly as it was');
    assertEquals(
      m.functions.reduce((n, f) => n + f.locals.length, 0),
      slotsBefore,
      'and no local was added',
    );
  });

  it('an ENTRY value: a caught payload stays a `pop`', () => {
    const bytes = asm(`(module
      (tag $t (param i32))
      (func (export "f") (param i32) (result i32)
        (try (result i32)
          (do (i32.const 1))
          (catch $t))))`);
    const m = routeB(bytes);
    const before = pops(m);
    assertEquals(before, 1, 'the handler holds the payload');
    spillStackValues(m);
    assertEquals(pops(m), 1, 'still a `pop` — no instruction produced it');
  });

  it('a MULTI-result producer whose values a later statement takes stays', () => {
    const bytes = asm(`(module
      (func $pair (result i32 i32) (i32.const 4) (i32.const 6))
      (func (export "f") (param i32) (result i32) (local $a i32) (local $b i32)
        call $pair
        local.set $b
        local.set $a
        (i32.sub (local.get $a) (local.get $b))))`);
    const m = routeB(bytes);
    const before = pops(m);
    assert(before > 0, 'the fixture has a placeholder for the pair');
    spillStackValues(m);
    assertEquals(pops(m), before, 'a tuple has no single node to spill');
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource));
    assertEquals(call(out, 0), call(bytes, 0));
  });

  it('a module with no `pop` at all is not even walked for types', () => {
    // The guard matters: a hand-built module can name a function it does not
    // contain, which type derivation refuses — 6 tests failed that way.
    const bytes = asm(`(module (func (export "f") (param i32) (result i32) (local.get 0)))`);
    const m = routeB(bytes);
    assertEquals(pops(m), 0);
    assertEquals(spillStackValues(m), 0, 'nothing to do, nothing done');
  });
});

describe('a `pop` with nothing behind it becomes `unreachable`', () => {
  it('in stack-polymorphic code, which is the only place it is legal', () => {
    // After `unreachable` the validator lets an instruction take values that were
    // never pushed. `unreachable` IS that phantom value, and it is self-contained.
    const bytes = asm(`(module
      (func (export "f") (param i32) (result i32)
        unreachable
        i32.add))`);
    const m = routeB(bytes);
    assert(pops(m) > 0, 'the fixture has placeholders');
    spillStackValues(m);
    let unreachables = 0;
    for (const f of m.functions) {
      walkExpression(f.body as unknown as Expression, (e) => {
        if (e.kind === ExpressionKind.Unreachable) unreachables++;
      });
    }
    assert(unreachables >= 2, `the phantom values became unreachable (${unreachables})`);
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'and the module is still valid');
  });
});
