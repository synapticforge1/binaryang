// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, item 5 (5): binaryen-ts represents the threads proposal's atomics
// and `call_ref` / `return_call_ref` — divergence K1, a port gap.
//
// Before, the decoder REFUSED them (`unknown opcode 0xfe` / `0x14`), and six of
// the eight kinds were enum members with no node behind them. They now take
// wabt-ts's shapes field for field (S6 Bucket B), so the two IRs share 84 kinds
// and differ in one (`code_metadata`, wabt-ts's alone — owner, 2026-09-16).
//
// A new kind is not done when it round-trips: every pass that switches on kinds
// with a quiet `default` has to be asked whether the new one belongs in a case.
// Two did, and each is pinned here by the miscompile it prevents.

import { assert, assertEquals, assertThrows } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import {
  type Expression,
  ExpressionKind,
  makeCallRef,
  makeDrop,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { mapExpression, walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  assert(WebAssembly.validate(r.binary as BufferSource), 'the fixture is valid wasm');
  return r.binary;
}

function run(bytes: Uint8Array, ...args: number[]): number | string {
  const f = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    ...a: number[]
  ) => number;
  try {
    return f(...args);
  } catch (e) {
    return e instanceof WebAssembly.RuntimeError ? 'trap' : 'exception';
  }
}

function kinds(mod: WasmModule): Set<string> {
  const out = new Set<string>();
  for (const fn of mod.functions) walkExpression(fn.body, (e) => out.add(e.kind));
  return out;
}

const FIX: Record<string, { wat: string; kinds: string[]; args: number[]; want: number }> = {
  atomics: {
    wat: `(module (memory (export "m") 1 1 shared)
      (func (export "f") (param i32) (result i32)
        (i32.atomic.store (i32.const 0) (local.get 0))
        (i64.atomic.store8 (i32.const 8) (i64.const 7))
        (drop (i64.atomic.load8_u (i32.const 8)))
        (drop (i32.atomic.rmw.add (i32.const 0) (i32.const 5)))
        (drop (i64.atomic.rmw32.xchg_u (i32.const 16) (i64.const 3)))
        (drop (i32.atomic.rmw16.cmpxchg_u (i32.const 0) (i32.const 0) (i32.const 1)))
        (drop (memory.atomic.notify (i32.const 0) (i32.const 0)))
        (atomic.fence)
        (i32.add (i32.atomic.load (i32.const 0)) (i32.atomic.load8_u (i32.const 8)))))`,
    kinds: [
      'atomic.store',
      'atomic.load',
      'atomic.rmw',
      'atomic.cmpxchg',
      'atomic.notify',
      'atomic.fence',
    ],
    args: [30],
    want: 42, // store 30, +5 → 35; load 35 + load8 7
  },
  wait: {
    wat: `(module (memory 1 1 shared)
      (func (export "f") (param i32) (result i32)
        (i32.add (memory.atomic.wait32 (i32.const 0) (i32.const 1) (i64.const 0))
                 (memory.atomic.wait64 (i32.const 8) (i64.const 1) (i64.const 0)))))`,
    kinds: ['atomic.wait'],
    args: [0],
    want: 2, // both "not-equal" (1): memory holds 0
  },
  call_ref: {
    wat: `(module (type $t (func (param i32) (result i32)))
      (func $dbl (type $t) (i32.mul (local.get 0) (i32.const 2)))
      (elem declare func $dbl)
      (func (export "f") (param i32) (result i32)
        (call_ref $t (local.get 0) (ref.func $dbl))))`,
    kinds: ['call_ref'],
    args: [21],
    want: 42,
  },
  return_call_ref: {
    wat: `(module (type $t (func (param i32) (result i32)))
      (func $inc (type $t) (i32.add (local.get 0) (i32.const 1)))
      (elem declare func $inc)
      (func (export "f") (param i32) (result i32)
        (return_call_ref $t (local.get 0) (ref.func $inc))))`,
    kinds: ['call_ref'],
    args: [41],
    want: 42,
  },
  'call_ref, two results': {
    wat: `(module (type $t (func (param i32) (result i32 i32)))
      (func $two (type $t) (local.get 0) (i32.const 10))
      (elem declare func $two)
      (func (export "f") (param i32) (result i32)
        (i32.sub (call_ref $t (local.get 0) (ref.func $two)))))`,
    kinds: ['call_ref'],
    args: [52],
    want: 42,
  },
};

for (const [name, fx] of Object.entries(FIX)) {
  Deno.test(`${name}: decoded to its nodes, and re-encoded byte for byte`, () => {
    const bytes = assemble(fx.wat);
    const mod = parseWasm(bytes);
    const seen = kinds(mod);
    for (const k of fx.kinds) assert(seen.has(k), `${k} decoded (saw ${[...seen].join(', ')})`);
    assertEquals(encodeWasm(mod), bytes);
    assertEquals(run(bytes, ...fx.args), fx.want, 'the fixture computes what it says');
  });

  Deno.test(`${name}: every -O level validates and computes the same`, () => {
    const bytes = assemble(fx.wat);
    for (const [o, s] of [[1, 0], [2, 0], [3, 0], [2, 1], [2, 2]] as const) {
      const mod = parseWasm(bytes);
      new PassRunner(mod, { optimizeLevel: o, shrinkLevel: s }).addDefaultOptimizationPasses()
        .run();
      const out = encodeWasm(mod);
      assert(WebAssembly.validate(out as BufferSource), `-O${o}/${s} validates`);
      assertEquals(run(out, ...fx.args), fx.want, `-O${o}/${s}`);
    }
  });
}

Deno.test('the walkers reach every operand of every atomic, in order', () => {
  const mod = parseWasm(assemble(FIX.atomics!.wat));
  const body = mod.functions[0]!.body;
  const walked: string[] = [];
  walkExpression(body, (e) => {
    if (e.kind === ExpressionKind.Const && 'value' in e.value) walked.push(String(e.value.value));
  });
  // Every constant operand, in push order — none hidden behind an atomic.
  assertEquals(walked, [
    '0',
    '8',
    '7',
    '8',
    '0',
    '5',
    '16',
    '3',
    '0',
    '0',
    '1',
    '0',
    '0',
    '0',
    '8',
  ]);
  let mapped = 0;
  mapExpression(body, (e: Expression) => {
    if (e.kind === ExpressionKind.Const) mapped++;
    return e;
  });
  assertEquals(mapped, walked.length);

  // `wait` has three operands, `notify` two: the timeout is the last one pushed.
  const wait = parseWasm(assemble(FIX.wait!.wat)).functions[0]!.body;
  const consts: string[] = [];
  walkExpression(wait, (e) => {
    if (e.kind === ExpressionKind.Const && 'value' in e.value) consts.push(String(e.value.value));
  });
  assertEquals(consts, ['0', '1', '0', '8', '1', '0']);
  let waitMapped = 0;
  mapExpression(wait, (e: Expression) => {
    if (e.kind === ExpressionKind.Const) waitMapped++;
    return e;
  });
  assertEquals(waitMapped, consts.length);
});

Deno.test("each atomic's type is its instruction's result — i64 for an i64 instruction", () => {
  const types = new Map<string, unknown[]>();
  for (const fx of [FIX.atomics!, FIX.wait!]) {
    walkExpression(parseWasm(assemble(fx.wat)).functions[0]!.body, (e) => {
      if (!e.kind.startsWith('atomic.')) return;
      types.set(e.kind, [...(types.get(e.kind) ?? []), e.type]);
    });
  }
  assertEquals(Object.fromEntries(types), {
    'atomic.store': ['none', 'none'],
    'atomic.load': [ValType.I64, ValType.I32, ValType.I32], // i64.load8_u; i32.load; i32.load8_u
    'atomic.rmw': [ValType.I32, ValType.I64], // i32.rmw.add; i64.rmw32.xchg_u
    'atomic.cmpxchg': [ValType.I32],
    'atomic.notify': [ValType.I32],
    'atomic.fence': ['none'],
    'atomic.wait': [ValType.I32, ValType.I32],
  });
});

Deno.test("call_ref's type is its signature's results — a tuple for several", () => {
  const types: unknown[] = [];
  for (const fx of [FIX.call_ref!, FIX['call_ref, two results']!]) {
    walkExpression(parseWasm(assemble(fx.wat)).functions.at(-1)!.body, (e) => {
      if (e.kind === ExpressionKind.CallRef) types.push(e.type);
    });
  }
  assertEquals(types, [ValType.I32, [ValType.I32, ValType.I32]]);
});

Deno.test('LocalCSE: a global read is not reused across a call_ref that writes it', () => {
  // The callee sets $g to 42 between two identical `global.get $g + x`. Reusing
  // the first sum gives 2; the module computes 44. LocalCSE evicted on `call`
  // and `call_indirect` and knew nothing of `call_ref`.
  const bytes = assemble(`(module (global $g (mut i32) (i32.const 0))
    (type $w (func))
    (func $bump (global.set $g (i32.const 42)))
    (elem declare func $bump)
    (func (export "f") (param i32) (result i32) (local i32 i32)
      (local.set 1 (i32.add (global.get $g) (local.get 0)))
      (call_ref $w (ref.func $bump))
      (local.set 2 (i32.add (global.get $g) (local.get 0)))
      (i32.add (local.get 1) (local.get 2))))`);
  const mod = parseWasm(bytes);
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).add('LocalCSE').run();
  assertEquals([run(bytes, 1), run(encodeWasm(mod), 1)], [44, 44]);
});

Deno.test('CoalesceLocals: a throwing call_ref in a try keeps the pre-try value live', () => {
  // `r = -1; try { r = call_ref mayThrow } catch {} return r` — the CFG's
  // exceptional edge leaves the call BEFORE the set, so -1 is live on the
  // handler path. Without a `call_ref` case the CFG drew no edge, the entry
  // set was dropped, and the function returned 0.
  const bytes = assemble(`(module (tag $e) (type $t (func (result i32)))
    (func $mayThrow (type $t) (throw $e))
    (elem declare func $mayThrow)
    (func (export "f") (result i32) (local i32)
      (local.set 0 (i32.const -1))
      (try (do (local.set 0 (call_ref $t (ref.func $mayThrow)))) (catch $e))
      (return (local.get 0))))`);
  const mod = parseWasm(bytes);
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).add('CoalesceLocals').run();
  assertEquals([run(bytes), run(encodeWasm(mod))], [-1, -1]);
});

Deno.test('Asyncify refuses call_ref rather than leaving it uninstrumented', () => {
  const mod = parseWasm(assemble(FIX.call_ref!.wat));
  assertThrows(
    () => new PassRunner(mod, { optimizeLevel: 0, shrinkLevel: 0 }).add('asyncify').run(),
    Error,
    'call_ref is not yet supported',
  );
});

Deno.test('Flatten refuses a call_ref with several results rather than hoisting a tuple', () => {
  // Built, not decoded: the decoder puts a `pop` beside a multi-value call, and
  // Flatten refuses `pop` first. A pass or builder can make the call itself.
  const mod = parseWasm(assemble(FIX.call_ref!.wat));
  const f = mod.functions[1]!;
  f.body = mapExpression(
    f.body,
    (e) =>
      e.kind === ExpressionKind.CallRef
        ? makeDrop(makeCallRef(e.sigType, e.callee, e.operands, [ValType.I32, ValType.I32]))
        : e,
  );
  assertThrows(
    () => new PassRunner(mod, { optimizeLevel: 0, shrinkLevel: 0 }).add('Flatten').run(),
    Error,
    'call_ref returns 2 values',
  );
});

Deno.test('an unknown 0xfe sub-opcode is still refused, naming it', () => {
  const bytes = assemble(
    '(module (memory 1 1 shared) (func (drop (i32.atomic.load (i32.const 0)))))',
  );
  const at = bytes.findIndex((b, i) => b === 0xfe && bytes[i + 1] === 0x10);
  assert(at > 0, 'found the atomic load');
  const broken = bytes.slice();
  broken[at + 1] = 0x7f;
  assertThrows(() => parseWasm(broken), Error, 'unknown atomic opcode 0xfe 0x7f');
});
