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

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readBinaryIr } from '../../../src/reader/binary-reader.ts';
import { hasErrors, makeErrorList } from '../../../src/core/error.ts';
import { prepareForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { spillStackValues } from '../../../src/passes/spill-stack-values.ts';
import { deriveTypes, type Discarded } from '../../../src/ir/derive-types.ts';
import { ExpressionKind, typeOf } from '../../../src/ir/expressions.ts';
import { walkExpression } from '../../../src/ir/walk.ts';
import type { Expression } from '../../../src/ir/expressions.ts';
import type { WasmModule } from '../../../src/ir/module.ts';

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

// 🔧 Found by open-work 23 E4 (2026-10-08): upstream `wasm-ctor-eval`'s output
// through our -Oz, which V8 refused — "local.tee[0] expected type f64, found
// local.get of type i32". The shape, as binaryen writes it: an i32 left on the
// stack, then a TWO-result call whose last result a `local.set` takes and whose
// first a later `local.tee` takes, then the i32 consumed. The tree: `i32.add
// (pop) (i32.trunc_f64_s (f64.add (local.tee $a (pop)) …))`. The first pop's
// value (the i32, a statement of its own) was spilled to a local and the pop
// became `local.get`; the second (the call's first result — a tuple's, which
// stays on the stack) stayed a pop. But the `local.get` is evaluated BEFORE
// the `local.tee`, so it pushed the i32 on top of the f64 the tee was to take.
describe('a pop that stays keeps every pop evaluated before it on the stack too', () => {
  const bytes = asm(`(module
    (func $two (param f64) (result f64 f64) (local.get 0) (f64.add (local.get 0) (f64.const 1)))
    (func (export "f") (param i32) (result i32) (local $a f64) (local $b f64)
      local.get 0
      f64.const 100
      call $two
      local.set $b
      local.tee $a
      local.get $b
      f64.add
      i32.trunc_f64_s
      i32.add))`);

  it('the fixture holds both pops, in that order', () => {
    assertEquals(pops(routeB(bytes)), 2);
  });

  it('the spill leaves the module valid, computing the same', () => {
    const m = routeB(bytes);
    spillStackValues(m);
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'valid after the spill');
    assertEquals(results(out), results(bytes));
  });

  it('and so does -Oz', () => {
    const m = routeB(bytes);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 2 }).addDefaultOptimizationPasses().run();
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'valid after -Oz');
    assertEquals(results(out), results(bytes));
  });
});

const drops = (m: WasmModule) => {
  let n = 0;
  for (const f of m.functions) {
    walkExpression(f.body as unknown as Expression, (e) => {
      if (e.kind === ExpressionKind.Drop) n++;
    });
  }
  return n;
};

// Values NOTHING takes: still on the stack when an `unreachable` made it
// polymorphic, which discards them. Valid wasm, and the reader keeps them as
// bare statements. 🔧 They were left so, and a pass that wraps the code after
// them in a block ends the polymorphism at their level: `Inlining` turned the
// call below (an `unreachable` operand) into a typed block, and the `then` arm
// ended with two values on its stack — "type mismatch at end of end", from
// ours and from V8 (open-work 13, the code lens: a valid mutant of a wasmtk
// producer binary, `i32.shl` → `unreachable`). They are dropped now, as
// binaryen's reader reads them.
describe('a value nothing takes is dropped where it stands', () => {
  const bytes = asm(`(module
    (memory 1)
    (func $alloc (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
    (func $grow (param i32 i32) (result i32) (local i32) (local i32)
      (local.set 2 (i32.load (local.get 0)))
      (local.set 3 (i32.load offset=4 (local.get 0)))
      (if (i32.ge_u (local.get 2) (local.get 3))
        (then
          local.get 0
          i32.const 8
          local.get 3
          i32.const 1
          unreachable
          local.get 3
          i32.eqz
          select
          call $alloc
          local.set 0))
      (i32.store (i32.add (local.get 0) (i32.const 8)) (local.get 1))
      (local.get 0))
    (func (export "f") (param i32) (result i32) (call $grow (local.get 0) (i32.const 5))))`);

  it('the spill drops every discarded value — the fixture discriminates', () => {
    const m = routeB(bytes);
    const before = drops(m);
    spillStackValues(m);
    // `local.get 0`, `i32.const 8` (statements), `local.get 3`, `i32.const 1`
    // (operands of the `call` and the `select`, which never run and are taken
    // apart), and the `select`'s condition, evaluated after the `unreachable`.
    assertEquals(drops(m) - before, 5);
    const then = (m.functions[1]!.body.children[2] as unknown as {
      ifTrue: { children: Expression[] };
    }).ifTrue.children;
    assertEquals(
      then.slice(0, 5).map((c) => c.kind),
      ['drop', 'drop', 'drop', 'drop', 'unreachable'],
      'the four values, evaluated in order, then the trap — where the bytes trap',
    );
  });

  it('`Inlining` alone gives a VALID module that computes the same', () => {
    const m = routeB(bytes);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).add('Inlining').run();
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'valid after Inlining');
    assertEquals(results(out), results(bytes));
  });

  it('and so does -O2', () => {
    const m = routeB(bytes);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'valid after -O2');
    assertEquals(results(out), results(bytes));
  });

  it('a plain read-and-write is still byte-exact — no pass, no drop', () => {
    const m = routeB(bytes);
    new PassRunner(m).run();
    assertEquals(writeWasm(m), bytes);
  });
});

// A discarded value the reader made an OPERAND: `i32.shl …; unreachable;
// i32.load; i64.extend_i32_u; i64.add` reads as `(i64.add (i32.shl …)
// (i64.extend_i32_u (i32.load (unreachable))))` — byte-faithful, and an i64.add
// of an i32, since the add really takes the bottom value. 🔧 Left whole, it looked
// live, and after twelve -O2 passes `OptimizeInstructions` rewrote it into
// reachable, invalid code (open-work 13, the code lens: a valid mutant of a
// wasmtk producer binary). The consumer never runs; it is taken apart.
describe('a consumer of a discarded operand is taken apart', () => {
  const bytes = asm(`(module
    (memory 1)
    (func (export "f") (param i32) (result i32) (local i64)
      local.get 0
      i32.const 2
      i32.shl
      unreachable
      i32.load
      i64.extend_i32_u
      i64.add
      local.set 1
      local.get 0))`);

  const adds = (m: WasmModule) => {
    let n = 0;
    walkExpression(m.functions[0]!.body as unknown as Expression, (e) => {
      if (e.kind === ExpressionKind.Binary) n++;
    });
    return n;
  };

  it('the reader really does give the `i64.add` the `i32.shl` — the fixture discriminates', () => {
    assertEquals(adds(routeB(bytes)), 2, 'the add and the shift');
  });

  it('after the spill only the shift is left, evaluated, then the trap', () => {
    const m = routeB(bytes);
    spillStackValues(m);
    assertEquals(adds(m), 1, 'the i64.add is gone: it never ran');
    const kinds = m.functions[0]!.body.children.map((c) => c.kind);
    assertEquals(kinds.slice(0, 2), ['drop', 'drop'], 'the shift, then the extend, evaluated');
    assert(kinds.includes('unreachable'), 'then the trap');
  });

  it('-O2 gives a valid module that traps as the original does', () => {
    const m = routeB(bytes);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'valid after -O2');
    assertEquals(results(out), results(bytes));
  });
});

// ⚠️ A value a BRANCH carries is not one nothing takes. The reader gives a
// transfer its carried values as operands, so a value below one is rare — but a
// linear `br_table`'s values are preceding statements by the IR's own account,
// and a tree built through the API may hold them so. Dropped, the branch would
// find no value. The derivation must not list it.
describe('a value a branch takes from beneath its operands is not discarded', () => {
  it('a `br_table` with its value as the statement before it', () => {
    const m = routeB(asm(`(module
      (func (export "f") (param i32) (result i32)
        (block (result i32) (br_table 0 0 (i32.const 7) (local.get 0)))))`));
    const block = (m.functions[0]!.body.children[0]!) as unknown as {
      children: Expression[];
    };
    const table = block.children[0] as unknown as { values: Expression[] };
    assertEquals(table.values.length, 1, 'the reader gives the value as an operand');
    const value = table.values[0]!;
    block.children = [value, { ...(table as object), values: [] } as unknown as Expression];
    const discarded: Discarded = new Set();
    deriveTypes(m, new Map(), discarded);
    assert(!discarded.has(value), 'the value the br_table carries is not discarded');
  });

  it('control: the same value before a bare `unreachable` IS discarded', () => {
    const m = routeB(asm(`(module
      (func (export "f") (param i32) (result i32)
        (block (result i32) (br_table 0 0 (i32.const 7) (local.get 0)))))`));
    const block = (m.functions[0]!.body.children[0]!) as unknown as {
      children: Expression[];
    };
    const value = (block.children[0] as unknown as { values: Expression[] }).values[0]!;
    block.children = [value, { kind: ExpressionKind.Unreachable } as unknown as Expression];
    const discarded: Discarded = new Set();
    deriveTypes(m, new Map(), discarded);
    assert(discarded.has(value), 'nothing takes it');
  });
});

// A value under a `br_on`: the reader gives it as the branch's operand, and
// what falls through is discarded by the `unreachable`. Nothing may be dropped
// that the branch needs, and a `br_on` statement is never wrapped in a `drop`
// (its node type is its reference alone).
describe('a value a `br_on` carries is not dropped', () => {
  const bytes = asm(`(module
    (func (export "f") (param i32) (result i32)
      (block (result i32)
        local.get 0
        ref.null func
        br_on_null 0
        drop
        unreachable)))`);

  it('the spill drops nothing here', () => {
    const m = routeB(bytes);
    const before = drops(m);
    spillStackValues(m);
    assertEquals(drops(m), before);
  });

  it('-O2 gives a valid module that returns its argument', () => {
    const m = routeB(bytes);
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    const out = writeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), 'valid after -O2');
    assertEquals(results(out), [0, 7, -3]);
  });
});
