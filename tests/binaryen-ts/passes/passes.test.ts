/**
 * @module binaryen-ts/tests/passes/passes_test
 *
 * Tests for all Phase 4 optimization passes.
 *
 * @license MIT
 */

import { assertEquals, assertNotEquals } from '@std/assert';

import {
  asRegion,
  BinaryOp,
  type ConstExpr,
  type Expression,
  ExpressionKind,
  makeBinary,
  makeBlock,
  makeBreak,
  makeCall,
  makeCallIndirect,
  makeDrop,
  makeI32Const,
  makeI64Const,
  makeIf,
  makeLoad,
  makeLocalGet,
  makeLocalSet,
  makeLocalTee,
  makeLoop,
  makeNop,
  makeRethrow,
  makeReturn,
  makeThrow,
  makeTry,
  makeTryTable,
  makeUnary,
  makeUnreachable,
  tryCatch,
  type TryExpr,
  type TryTableExpr,
  UnaryOp,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import {
  ModuleBuilder,
  type WasmFunction,
  type WasmModule,
} from '../../../src/binaryen-ts/ir/module.ts';
import { None, ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { listPasses, PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { varIndex } from '../../../src/wabt-ts/ir/ir.ts';
import { varName } from '../../../src/wabt-ts/ir/ir.ts';
import { Opcode } from '../../../src/wabt-ts/core/opcode.ts';
import { region, soleInstr, soleOf } from '../region_helpers.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestFn(name: string, body: ReturnType<typeof makeBlock>): WasmFunction {
  return {
    name,
    params: [],
    results: [],
    locals: [],
    body: asRegion(body),
  };
}

function emptyModule(): WasmModule {
  return {
    functions: [],
    globals: [],
    memories: [],
    tables: [],
    tags: [],
    elements: [],
    dataSegments: [],
    imports: [],
    exports: [],
    start: null,
    hasExceptionHandling: false,
    hasMemory64: false,
    hasMultiMemory: false,
    heapTypes: [],
    hasGC: false,
  };
}

// ---------------------------------------------------------------------------
// Pass registry
// ---------------------------------------------------------------------------

Deno.test('listPasses: all Phase 4 passes are registered', () => {
  const passes = listPasses();
  const expected = [
    'CoalesceLocals',
    'DCE',
    'LocalCSE',
    'OptimizeInstructions',
    'PickLoadSigns',
    'RemoveUnusedBrs',
    'RemoveUnusedModuleElements',
    'SimplifyLocals',
    'Vacuum',
  ];
  for (const name of expected) {
    assertEquals(passes.includes(name), true, `Expected pass "${name}" to be registered`);
  }
});

// ---------------------------------------------------------------------------
// Vacuum pass
// ---------------------------------------------------------------------------

Deno.test('Vacuum: removes nop from block children', () => {
  const mod = emptyModule();
  const body = makeBlock([makeNop(), makeI32Const(42), makeNop()]);
  mod.functions.push(makeTestFn('f', body));

  new PassRunner(mod).add('Vacuum').run();

  // The body is a region; its nops are filtered out, leaving the const.
  assertEquals(region(mod.functions[0].body).children.map((c) => c.kind), [ExpressionKind.Const]);
});

Deno.test('Vacuum: an all-nop body vacuums to an EMPTY region', () => {
  const mod = emptyModule();
  const body = makeBlock([makeNop(), makeNop()]);
  mod.functions.push(makeTestFn('f', body));

  new PassRunner(mod).add('Vacuum').run();

  assertEquals(region(mod.functions[0].body).children.length, 0);
});

Deno.test('Vacuum: drop(const) becomes nop', () => {
  const mod = emptyModule();
  // Block with drop(const) which should become nop → then block collapses
  const body = makeBlock([makeDrop(makeI32Const(5))]);
  mod.functions.push(makeTestFn('f', body));

  new PassRunner(mod).add('Vacuum').run();

  assertEquals(region(mod.functions[0].body).children.length, 0);
});

Deno.test('Vacuum: drop(local.get) becomes nop', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [ValType.I32],
    results: [],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeBlock([makeDrop(makeLocalGet(varIndex(0), ValType.I32))])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('Vacuum').run();

  assertEquals(region(mod.functions[0].body).children.length, 0);
});

Deno.test('Vacuum: unnamed single-child block collapses', () => {
  const mod = emptyModule();
  const inner = makeI32Const(7);
  // The block under test must be a real one INSIDE the body: an unnamed block
  // handed over as the body itself is already flattened into the region by
  // `asRegion`, and Vacuum would never see it.
  const body = makeBlock([makeBlock([inner])]); // unnamed, single child
  mod.functions.push(makeTestFn('f', body));

  new PassRunner(mod).add('Vacuum').run();

  assertEquals(soleInstr(mod.functions[0].body).kind, ExpressionKind.Const);
});

// ⚠️ The test above does not actually reach Vacuum's rule: a region whose SOLE
// child is an unnamed block is flattened by `asRegion`, which `mapExpression`
// applies to every region slot it rebuilds — so the block is gone before
// `_simplifyBlock` could decide anything. Measured: inverting Vacuum's
// "unnamed?" test to one that is never true left the whole suite green.
// A region with a SECOND child cannot be flattened that way, so only Vacuum can
// collapse the block, and this fixture holds it to that.
Deno.test('Vacuum: an unnamed single-child block collapses among SIBLINGS too', () => {
  const mod = emptyModule();
  const set = () => makeLocalSet(varIndex(0), makeI32Const(7));
  mod.functions.push(makeTestFn('f', makeBlock([set(), makeBlock([set()])])));

  new PassRunner(mod).add('Vacuum').run();

  assertEquals(
    region(mod.functions[0].body).children.map((c) => c.kind),
    [ExpressionKind.LocalSet, ExpressionKind.LocalSet],
  );
});

Deno.test('Vacuum: a NAMED single-child block among siblings is kept', () => {
  const mod = emptyModule();
  const set = () => makeLocalSet(varIndex(0), makeI32Const(7));
  mod.functions.push(makeTestFn('f', makeBlock([set(), makeBlock([set()], '$keep')])));

  new PassRunner(mod).add('Vacuum').run();

  assertEquals(
    region(mod.functions[0].body).children.map((c) => c.kind),
    [ExpressionKind.LocalSet, ExpressionKind.Block],
  );
});

// ---------------------------------------------------------------------------
// OptimizeInstructions — algebraic identities
// ---------------------------------------------------------------------------

Deno.test('OptimizeInstructions: add(x, 0) → x', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [ValType.I32],
    results: [ValType.I32],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeReturn(
        [makeBinary(BinaryOp.AddI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(0))],
      ),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('OptimizeInstructions').run();

  const ret = soleOf(mod.functions[0].body, ExpressionKind.Return);
  // The return's value should now be local.get(0), not a binary
  assertEquals(ret.values[0]?.kind, ExpressionKind.LocalGet);
});

Deno.test('OptimizeInstructions: mul(x, 1) → x', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [ValType.I32],
    results: [ValType.I32],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeReturn(
      [makeBinary(BinaryOp.MulI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(1))],
    )),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('OptimizeInstructions').run();

  const ret = soleOf(mod.functions[0].body, ExpressionKind.Return);
  assertEquals(ret.values[0]?.kind, ExpressionKind.LocalGet);
});

Deno.test('OptimizeInstructions: constant folding i32.add(3, 4) → 7', () => {
  const mod = emptyModule();
  mod.functions.push({
    name: 'f',
    params: [],
    results: [ValType.I32],
    locals: [],
    body: asRegion(makeReturn([makeBinary(BinaryOp.AddI32, makeI32Const(3), makeI32Const(4))])),
  });

  new PassRunner(mod).add('OptimizeInstructions').run();

  const ret = soleOf(mod.functions[0].body, ExpressionKind.Return);
  assertEquals(ret.values[0]?.kind, ExpressionKind.Const);
  assertEquals(((ret.values[0] as ConstExpr).value as { value: number }).value, 7);
});

Deno.test('OptimizeInstructions: constant folding i32.mul(6, 7) → 42', () => {
  const mod = emptyModule();
  mod.functions.push({
    name: 'f',
    params: [],
    results: [ValType.I32],
    locals: [],
    body: asRegion(makeReturn([makeBinary(BinaryOp.MulI32, makeI32Const(6), makeI32Const(7))])),
  });

  new PassRunner(mod).add('OptimizeInstructions').run();

  const ret = soleOf(mod.functions[0].body, ExpressionKind.Return);
  assertEquals(ret.values[0]?.kind, ExpressionKind.Const);
  assertEquals(((ret.values[0] as ConstExpr).value as { value: number }).value, 42);
});

Deno.test('OptimizeInstructions: constant folding i32.eqz(0) → 1', () => {
  const mod = emptyModule();
  mod.functions.push({
    name: 'f',
    params: [],
    results: [ValType.I32],
    locals: [],
    body: asRegion(makeReturn([makeUnary(UnaryOp.EqzI32, makeI32Const(0))])),
  });

  new PassRunner(mod).add('OptimizeInstructions').run();

  const ret = soleOf(mod.functions[0].body, ExpressionKind.Return);
  assertEquals(ret.values[0]?.kind, ExpressionKind.Const);
  assertEquals(((ret.values[0] as ConstExpr).value as { value: number }).value, 1);
});

Deno.test('OptimizeInstructions: and(x, -1) → x', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [ValType.I32],
    results: [ValType.I32],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeReturn(
      [makeBinary(BinaryOp.AndI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(-1))],
    )),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('OptimizeInstructions').run();

  const ret = soleOf(mod.functions[0].body, ExpressionKind.Return);
  assertEquals(ret.values[0]?.kind, ExpressionKind.LocalGet);
});

Deno.test('OptimizeInstructions: i64 add(x, 0) → x', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [ValType.I64],
    results: [ValType.I64],
    locals: [{ type: ValType.I64 }],
    body: asRegion(makeReturn(
      [makeBinary(BinaryOp.AddI64, makeLocalGet(varIndex(0), ValType.I64), makeI64Const(0n))],
    )),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('OptimizeInstructions').run();

  const ret = soleOf(mod.functions[0].body, ExpressionKind.Return);
  assertEquals(ret.values[0]?.kind, ExpressionKind.LocalGet);
});

// ---------------------------------------------------------------------------
// RemoveUnusedBrs pass
// ---------------------------------------------------------------------------

Deno.test('RemoveUnusedBrs: br at tail of own block is removed', () => {
  // (block $B (nop) (br $B))  →  (block $B (nop))  →  nop (via Vacuum)
  const mod = emptyModule();
  const nop = makeNop();
  const br = makeBreak('$B');
  const body: ReturnType<typeof makeBlock> = {
    kind: ExpressionKind.Block,
    type: None,
    label: '$B',
    children: [nop, br],
  };
  mod.functions.push(makeTestFn('f', body));

  new PassRunner(mod).add('RemoveUnusedBrs').run();

  // br should be gone — and this used to be skipped entirely if the body was
  // not a Block, asserting nothing.
  for (const child of soleOf(mod.functions[0].body, ExpressionKind.Block).children) {
    assertNotEquals(child.kind, ExpressionKind.Break);
  }
});

Deno.test('RemoveUnusedBrs: solo br to own block → nop', () => {
  const mod = emptyModule();
  const body: ReturnType<typeof makeBlock> = {
    kind: ExpressionKind.Block,
    type: None,
    label: '$B',
    children: [makeBreak('$B')],
  };
  mod.functions.push(makeTestFn('f', body));

  new PassRunner(mod).add('RemoveUnusedBrs').run();

  assertEquals(soleInstr(mod.functions[0].body).kind, ExpressionKind.Nop);
});

// ---------------------------------------------------------------------------
// SimplifyLocals pass
// ---------------------------------------------------------------------------

Deno.test('SimplifyLocals: local.set + local.get → local.tee', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [ValType.I32],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(42)),
      makeLocalGet(varIndex(0), ValType.I32),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('SimplifyLocals').run();

  // A region of one tee — no longer "a tee, or a block of one tee".
  soleOf(mod.functions[0].body, ExpressionKind.LocalTee);
});

Deno.test('SimplifyLocals: non-matching indices are not merged', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [ValType.I32],
    locals: [{ type: ValType.I32 }, { type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(1)),
      makeLocalGet(varIndex(1), ValType.I32), // different index
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('SimplifyLocals').run();

  // Was guarded by `if (body.kind === Block)` — vacuous for any other body.
  assertEquals(region(mod.functions[0].body).children.map((c) => c.kind), [
    ExpressionKind.LocalSet,
    ExpressionKind.LocalGet,
  ]);
});

// ---------------------------------------------------------------------------
// CoalesceLocals pass — dead-write elimination
// ---------------------------------------------------------------------------

Deno.test('CoalesceLocals: dead local.set becomes drop', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [],
    // local 0 is set but never read
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeBlock([makeLocalSet(varIndex(0), makeI32Const(99))])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // The set should have been replaced with drop(const(99))
  soleOf(mod.functions[0].body, ExpressionKind.Drop);
});

Deno.test('CoalesceLocals: used local.set is preserved', () => {
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [ValType.I32],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(5)),
      makeLocalGet(varIndex(0), ValType.I32),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // local 0 is read, so the set must be preserved
  // This searched Blocks only, so a region body would have hidden the set.
  assertEquals(
    region(mod.functions[0].body).children.some((c) => c.kind === ExpressionKind.LocalSet),
    true,
  );
});

Deno.test('CoalesceLocals: two locals with disjoint live ranges coalesce', () => {
  // Two locals used in sequence:
  //   local.set $a 1
  //   call $use $a
  //   local.set $b 2
  //   call $use $b
  // `$a` is dead after its single use; `$b` is defined after that. Linear-scan
  // with live holes recognizes the gap and assigns both to the same slot.
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [],
    locals: [{ type: ValType.I32 }, { type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(1)),
      makeDrop(makeLocalGet(varIndex(0), ValType.I32)),
      makeLocalSet(varIndex(1), makeI32Const(2)),
      makeDrop(makeLocalGet(varIndex(1), ValType.I32)),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // Both locals should map to slot 0 — only one local remains.
  assertEquals(mod.functions[0].locals.length, 1);
});

Deno.test('CoalesceLocals: two locals with overlapping live ranges stay distinct', () => {
  // Both live simultaneously: $a's set + use brackets $b's set + use.
  //   set $a 1; set $b 2; use $a; use $b
  // Can't coalesce.
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [],
    locals: [{ type: ValType.I32 }, { type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(1)),
      makeLocalSet(varIndex(1), makeI32Const(2)),
      makeDrop(makeLocalGet(varIndex(0), ValType.I32)),
      makeDrop(makeLocalGet(varIndex(1), ValType.I32)),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // Both locals are live simultaneously between their two reads — must stay
  // separate.
  assertEquals(mod.functions[0].locals.length, 2);
});

Deno.test("CoalesceLocals: single local with two value lifetimes doesn't blow up", () => {
  // Same local written twice — two separate value lifetimes for the same
  // slot. After coalescing, just one local should remain (mapped to itself).
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(1)),
      makeDrop(makeLocalGet(varIndex(0), ValType.I32)),
      makeLocalSet(varIndex(0), makeI32Const(2)),
      makeDrop(makeLocalGet(varIndex(0), ValType.I32)),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  assertEquals(mod.functions[0].locals.length, 1);
});

// ---------------------------------------------------------------------------
// CoalesceLocals — exception-handling liveness (EH-aware CFG)
// ---------------------------------------------------------------------------

Deno.test('CoalesceLocals: throwing call in try body keeps the pre-try value live', () => {
  // `let r = -1; try { r = mayThrow() } catch {} return r`
  // If `mayThrow()` throws, the inner `set $r` never completes, so `r` keeps -1
  // and the catch falls through to `return r` (= -1). The body's `set $r` must
  // NOT make the entry `set $r = -1` dead: the exceptional edge branches off the
  // call BEFORE the set, so the -1 is live on the handler path. A buggy CFG that
  // ignores the exceptional edge drops `set $r = -1` (→ r reads 0).
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [ValType.I32],
    locals: [{ type: ValType.I32 }], // $r
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(-1)),
      makeTry(
        null,
        makeLocalSet(varIndex(0), makeCall(varName('mayThrow'), [], ValType.I32)),
        [tryCatch(varName('t'), makeNop())],
        null,
        None,
      ),
      makeReturn([makeLocalGet(varIndex(0), ValType.I32)]),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // The entry `set $r = -1` must survive (not be turned into a drop).
  assertEquals(region(mod.functions[0].body).children[0]!.kind, ExpressionKind.LocalSet);
});

Deno.test('CoalesceLocals: nested rethrow keeps an outer local distinct from the inner catch var', () => {
  // Mirrors 15_LexicalShadowing_Stress:
  //   e = 100
  //   try { try { throw t(200) } catch { catchE = 200; rethrow } }
  //   catch { outerErr = 300; use(e) }   // reads the OUTER e
  // The inner catch's `rethrow` transfers to the OUTER catch, which reads `e`,
  // so `e` is live where `catchE` is set → they must NOT share a slot. A buggy
  // CFG (rethrow has no edge to the outer handler) coalesces them, so the
  // rethrow path's `catchE = 200` clobbers `e` and `use(e)` reads 200.
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [],
    locals: [{ type: ValType.I32 }, { type: ValType.I32 }, { type: ValType.I32 }], // e, catchE, outerErr
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(100)), // e = 100
      makeTry(
        null,
        makeTry(
          null,
          makeThrow(varName('t'), [makeI32Const(200)]),
          // inner catch: catchE = 200; use(catchE); rethrow. The use() makes the
          // set effective (otherwise it's a dead drop and the coalesce question is moot).
          [tryCatch(
            varName('t'),
            makeBlock([
              makeLocalSet(varIndex(1), makeI32Const(200)),
              makeDrop(makeLocalGet(varIndex(1), ValType.I32)),
              makeRethrow('0'),
            ]),
          )],
          null,
          None,
        ),
        // outer catch: outerErr = 300; use(e)
        [tryCatch(
          varName('t'),
          makeBlock([
            makeLocalSet(varIndex(2), makeI32Const(300)),
            makeDrop(makeLocalGet(varIndex(0), ValType.I32)),
          ]),
        )],
        null,
        None,
      ),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // Navigate the rewritten IR: inner-catch `set` index vs outer-catch `get` index.
  const body = region(mod.functions[0].body);
  const outerTry = body.children[1] as Extract<Expression, { kind: ExpressionKind.Try }>;
  const innerTry = soleOf(outerTry.body, ExpressionKind.Try);
  const innerCatch = region(innerTry.catches[0]!.body);
  const outerCatch = region(outerTry.catches[0]!.body);
  const innerSet = innerCatch.children[0] as Extract<Expression, { kind: ExpressionKind.LocalSet }>;
  const outerGet = (outerCatch.children[1] as Extract<Expression, { kind: ExpressionKind.Drop }>)
    .value as Extract<Expression, { kind: ExpressionKind.LocalGet }>;
  // `e` (read in the outer catch) must not occupy the slot written by the inner catch.
  assertNotEquals(outerGet.var, innerSet.var);
});

// ---------------------------------------------------------------------------
// CoalesceLocals — CFG-based liveness (loop back-edge cases)
// ---------------------------------------------------------------------------

Deno.test('CoalesceLocals: loop-carried value interferes via back-edge', () => {
  // $A is set before the loop and read at the loop top every iteration.
  // $B is set/used entirely inside the body, source-order AFTER $A's read.
  // With strictly-sequential ordinals the two ranges look disjoint, but $A's
  // value flows around the back-edge — coalescing would corrupt it on iter 2+.
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [],
    locals: [{ type: ValType.I32 }, { type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(42)),
      makeLoop(
        'L',
        makeBlock([
          makeDrop(makeLocalGet(varIndex(0), ValType.I32)),
          makeLocalSet(varIndex(1), makeI32Const(5)),
          makeDrop(makeLocalGet(varIndex(1), ValType.I32)),
          makeBreak('L', makeI32Const(0)),
        ]),
      ),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // $A and $B must remain distinct — $A's value has to survive the back-edge.
  assertEquals(mod.functions[0].locals.length, 2);
});

Deno.test(
  'CoalesceLocals: two locals entirely within loop body coalesce when ranges are disjoint',
  () => {
    // $A and $B are both confined to one iteration; their live ranges don't
    // overlap (use-A before set-B, B never alive at the same time as A within
    // the iteration). Should still coalesce — CFG liveness shouldn't be more
    // pessimistic than the simple disjoint case.
    const mod = emptyModule();
    const fn: WasmFunction = {
      name: 'f',
      params: [],
      results: [],
      locals: [{ type: ValType.I32 }, { type: ValType.I32 }],
      body: asRegion(makeBlock([
        makeLoop(
          'L',
          makeBlock([
            makeLocalSet(varIndex(0), makeI32Const(1)),
            makeDrop(makeLocalGet(varIndex(0), ValType.I32)),
            makeLocalSet(varIndex(1), makeI32Const(2)),
            makeDrop(makeLocalGet(varIndex(1), ValType.I32)),
            makeBreak('L', makeI32Const(0)),
          ]),
        ),
      ])),
    };
    mod.functions.push(fn);

    new PassRunner(mod).add('CoalesceLocals').run();

    assertEquals(mod.functions[0].locals.length, 1);
  },
);

Deno.test('CoalesceLocals: loop counter live across back-edge stays distinct from temp', () => {
  // Classic counter pattern: $i is the loop counter (set outside, read +
  // mutated inside, used as the back-edge condition); $tmp is a single-
  // iteration scratch that comes after the counter update. Reading $i for
  // the counter test means $i must be live on every iteration — coalescing
  // it with $tmp would clobber the counter.
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [],
    locals: [{ type: ValType.I32 }, { type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLocalSet(varIndex(0), makeI32Const(0)),
      makeLoop(
        'L',
        makeBlock([
          // increment counter: $i = $i + 1
          makeLocalSet(
            varIndex(0),
            makeBinary(BinaryOp.AddI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(1)),
          ),
          // set + use a scratch value
          makeLocalSet(varIndex(1), makeI32Const(99)),
          makeDrop(makeLocalGet(varIndex(1), ValType.I32)),
          // loop while $i < 10
          makeBreak(
            'L',
            makeBinary(BinaryOp.LtSI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(10)),
          ),
        ]),
      ),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // $i (slot 0) is loop-carried; $tmp (slot 1) cannot coalesce into it.
  assertEquals(mod.functions[0].locals.length, 2);
});

Deno.test('CoalesceLocals: if-else with overlapping liveness on merge stays distinct', () => {
  // $A is set in the then-branch and read on the merge path; $B is set in
  // the else-branch and read on the same merge path. Both arrive at the
  // merge live (their values flow from one of the two branches). The merge-
  // block read means both are live at the same program point — they must
  // not coalesce.
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [ValType.I32],
    results: [],
    locals: [{ type: ValType.I32 }, { type: ValType.I32 }, { type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeIf(
        makeLocalGet(varIndex(0), ValType.I32),
        makeBlock([
          makeLocalSet(varIndex(1), makeI32Const(1)), // $A
          makeLocalSet(varIndex(2), makeI32Const(2)), // $B
        ]),
        makeBlock([
          makeLocalSet(varIndex(1), makeI32Const(3)), // $A again
          makeLocalSet(varIndex(2), makeI32Const(4)), // $B again
        ]),
      ),
      // After the if both $A and $B are live — they must stay separate.
      makeDrop(makeLocalGet(varIndex(1), ValType.I32)),
      makeDrop(makeLocalGet(varIndex(2), ValType.I32)),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // Param is at slot 0; $A and $B (slots 1, 2) must remain distinct.
  assertEquals(mod.functions[0].locals.length, 3);
});

Deno.test('CoalesceLocals: dead set inside loop is replaced with drop', () => {
  // A local set inside a loop whose value is never read should still be
  // identified as ineffective by CFG-based liveness — same outcome as the
  // straight-line case, just verifying the CFG path doesn't lose this.
  const mod = emptyModule();
  const fn: WasmFunction = {
    name: 'f',
    params: [],
    results: [],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeLoop(
        'L',
        makeBlock([
          makeLocalSet(varIndex(0), makeI32Const(99)),
          makeBreak('L', makeI32Const(0)),
        ]),
      ),
    ])),
  };
  mod.functions.push(fn);

  new PassRunner(mod).add('CoalesceLocals').run();

  // The dead set should have been replaced with drop(const).
  let foundDrop = false;
  function walk(e: Expression): void {
    if (e.kind === ExpressionKind.Drop) foundDrop = true;
    if (e.kind === ExpressionKind.Block || e.kind === ExpressionKind.Region) {
      e.children.forEach(walk);
    }
    if (e.kind === ExpressionKind.Loop) walk(e.body);
  }
  walk(mod.functions[0].body);
  assertEquals(foundDrop, true);
});

// ---------------------------------------------------------------------------
// RemoveUnusedModuleElements pass
// ---------------------------------------------------------------------------

Deno.test('RemoveUnusedModuleElements: unreachable function is removed', () => {
  const mod: WasmModule = {
    functions: [
      {
        name: 'exported',
        params: [],
        results: [],
        locals: [],
        body: asRegion(makeNop()),
      },
      {
        name: 'dead',
        params: [],
        results: [],
        locals: [],
        body: asRegion(makeNop()),
      },
    ],
    globals: [],
    memories: [],
    tables: [],
    tags: [],
    elements: [],
    dataSegments: [],
    imports: [],
    exports: [{ name: 'exported', value: 'exported', kind: 'function' }],
    start: null,
    hasExceptionHandling: false,
    hasMemory64: false,
    hasMultiMemory: false,
    heapTypes: [],
    hasGC: false,
  };

  new PassRunner(mod).add('RemoveUnusedModuleElements').run();

  assertEquals(mod.functions.length, 1);
  assertEquals(mod.functions[0].name, 'exported');
});

Deno.test('RemoveUnusedModuleElements: callee of exported function is kept', () => {
  const mod: WasmModule = {
    functions: [
      {
        name: 'root',
        params: [],
        results: [],
        locals: [],
        body: asRegion(makeBlock([
          {
            kind: ExpressionKind.Call,
            type: None,
            func: varName('helper'),
            operands: [],
            isReturn: false,
          },
        ])),
      },
      {
        name: 'helper',
        params: [],
        results: [],
        locals: [],
        body: asRegion(makeNop()),
      },
    ],
    globals: [],
    memories: [],
    tables: [],
    tags: [],
    elements: [],
    dataSegments: [],
    imports: [],
    exports: [{ name: 'root', value: 'root', kind: 'function' }],
    start: null,
    hasExceptionHandling: false,
    hasMemory64: false,
    hasMultiMemory: false,
    heapTypes: [],
    hasGC: false,
  };

  new PassRunner(mod).add('RemoveUnusedModuleElements').run();

  const names = mod.functions.map((f) => f.name);
  assertEquals(names.includes('root'), true);
  assertEquals(names.includes('helper'), true);
});

Deno.test('RemoveUnusedModuleElements: dead global is removed', () => {
  const mod: WasmModule = {
    functions: [
      {
        name: 'f',
        params: [],
        results: [],
        locals: [],
        body: asRegion(makeNop()),
      },
    ],
    globals: [
      { name: 'g_used', type: ValType.I32, mutable: false, init: makeI32Const(1) },
      { name: 'g_dead', type: ValType.I32, mutable: false, init: makeI32Const(2) },
    ],
    memories: [],
    tables: [],
    tags: [],
    elements: [],
    dataSegments: [],
    imports: [],
    exports: [
      { name: 'f', value: 'f', kind: 'function' },
      { name: 'g_used', value: 'g_used', kind: 'global' },
    ],
    start: null,
    hasExceptionHandling: false,
    hasMemory64: false,
    hasMultiMemory: false,
    heapTypes: [],
    hasGC: false,
  };

  new PassRunner(mod).add('RemoveUnusedModuleElements').run();

  const gNames = mod.globals.map((g) => g.name);
  assertEquals(gNames.includes('g_used'), true);
  assertEquals(gNames.includes('g_dead'), false);
});

// ---------------------------------------------------------------------------
// LocalCSE pass
// ---------------------------------------------------------------------------

Deno.test('LocalCSE: repeated pure expression is extracted to local', () => {
  const mod = emptyModule();
  // Two occurrences of add(local.get(0), 1) in a block
  const fn: WasmFunction = {
    name: 'f',
    params: [ValType.I32],
    results: [],
    locals: [{ type: ValType.I32 }],
    body: asRegion(makeBlock([
      makeDrop(
        makeBinary(BinaryOp.AddI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(1)),
      ),
      makeDrop(
        makeBinary(BinaryOp.AddI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(1)),
      ),
    ])),
  };
  mod.functions.push(fn);
  const originalLocalCount = fn.locals.length;

  new PassRunner(mod).add('LocalCSE').run();

  // A new local should have been introduced for the CSE
  assertEquals(mod.functions[0].locals.length > originalLocalCount, true);
});

Deno.test("LocalCSE: caches only what upstream's isRelevant would (divergence C1)", () => {
  // Upstream LocalCSE.cpp `isRelevant`: never a local.get or a constant; then
  // size >= 3 when shrinking, size >= 2 when not. The port cached a bare
  // local.get and a constant too — teeing a read only to read the tee back —
  // which is what grew -Oz output once regions exposed single-instruction bodies.
  const newLocals = (repeated: () => Expression, shrinkLevel: 0 | 2): number => {
    const mod = emptyModule();
    mod.functions.push({
      name: 'f',
      params: [ValType.I32],
      results: [],
      locals: [],
      body: asRegion(makeBlock([makeDrop(repeated()), makeDrop(repeated()), makeDrop(repeated())])),
    });
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel }).add('LocalCSE').run();
    return mod.functions[0]!.locals.length;
  };
  const get = () => makeLocalGet(varIndex(0), ValType.I32);
  const eqz = () => makeUnary(UnaryOp.EqzI32, get()); // size 2
  const add = () => makeBinary(BinaryOp.AddI32, get(), makeI32Const(1)); // size 3

  for (const shrink of [0, 2] as const) {
    assertEquals(newLocals(get, shrink), 0, `a bare local.get is never cached (shrink ${shrink})`);
    assertEquals(
      newLocals(() => makeI32Const(7), shrink),
      0,
      `a constant is never cached (shrink ${shrink})`,
    );
    assertEquals(newLocals(add, shrink), 1, `size 3 is cached (shrink ${shrink})`);
  }
  assertEquals(newLocals(eqz, 0), 1, 'size 2 is cached when not shrinking');
  assertEquals(newLocals(eqz, 2), 0, 'size 2 is not cached when shrinking');
});

// ---------------------------------------------------------------------------
// PickLoadSigns pass (no-opcode when no narrow loads present)
// ---------------------------------------------------------------------------

Deno.test('PickLoadSigns: no crash on empty module', () => {
  const mod = emptyModule();
  // Should run without errors even with no functions
  new PassRunner(mod).add('PickLoadSigns').run();
  assertEquals(mod.functions.length, 0);
});

// ---------------------------------------------------------------------------
// PassRunner integration: DCE + Vacuum chain
// ---------------------------------------------------------------------------

Deno.test('PassRunner: DCE + Vacuum chain removes unreachable code', () => {
  const mod = emptyModule();
  mod.functions.push({
    name: 'f',
    params: [],
    results: [],
    locals: [],
    body: asRegion(makeBlock([
      makeUnreachable(),
      makeI32Const(999), // dead after unreachable
      makeNop(),
    ])),
  });

  new PassRunner(mod).add('DCE').add('Vacuum').run();

  const body = mod.functions[0].body;
  // After DCE only the unreachable remains; the body is a region of that one
  assertEquals(soleInstr(body).kind, ExpressionKind.Unreachable);
});

Deno.test('Vacuum: single-child unnamed block keeps its declared type on a concrete-type mismatch', () => {
  // A result-typed (i32) unnamed block whose only non-nop child is void-typed
  // (a `local.set`). Collapsing to that child would present `none` where `i32`
  // was declared, silently changing the type the block's parent relies on.
  // Vacuum must keep the wrapper to preserve `block.type`. (Collapsing IS still
  // done when the child matches the block type or is `unreachable` — see the
  // DCE+Vacuum test above.)
  const mod = emptyModule();
  const block = {
    kind: ExpressionKind.Block,
    type: ValType.I32,
    label: '',
    children: [makeNop(), makeLocalSet(varIndex(0), makeI32Const(0))],
  } as unknown as Expression;
  mod.functions.push({
    name: 'f',
    params: [],
    results: [ValType.I32],
    locals: [{ type: ValType.I32 }],
    body: asRegion(block),
  });

  new PassRunner(mod).add('Vacuum').run();

  // Old (unguarded) collapse returned the void `local.set`, making the body
  // `none`; the guard keeps the i32 type.
  assertEquals(mod.functions[0].body.type, ValType.I32);
});

// ---------------------------------------------------------------------------
// Phase 8.1b — DCE recurses into Try / TryTable
// ---------------------------------------------------------------------------

Deno.test('DCE: recurses into TryTable body — dead tail after throw is trimmed', () => {
  const mod = emptyModule();
  // try_table body = (block [throw $e, i32.const 99 /* dead */])
  const innerBlock = makeBlock([
    makeThrow(varName('$e'), []),
    makeI32Const(99),
  ]);
  const tt = makeTryTable(null, innerBlock, [], None);
  mod.functions.push(makeTestFn('f', makeBlock([tt])));

  new PassRunner(mod).add('DCE').run();

  const ttOut = region(mod.functions[0].body).children[0] as TryTableExpr;
  // The try_table's body is a region now — there is no wrapper block to find.
  assertEquals(ttOut.body.kind, ExpressionKind.Region);
  // Dead i32.const should have been dropped — body now ends at throw
  assertEquals(ttOut.body.children.length, 1);
  assertEquals(ttOut.body.children[0].kind, ExpressionKind.Throw);
});

Deno.test('DCE: recurses into Try body — dead tail after throw is trimmed', () => {
  const mod = emptyModule();
  const innerBlock = makeBlock([
    makeThrow(varName('$e'), []),
    makeI32Const(42), // dead
  ]);
  const t = makeTry(null, innerBlock, [], null, None);
  mod.functions.push(makeTestFn('f', makeBlock([t])));

  new PassRunner(mod).add('DCE').run();

  const tOut = region(mod.functions[0].body).children[0] as TryExpr;
  assertEquals(tOut.body.children.length, 1);
  assertEquals(tOut.body.children[0].kind, ExpressionKind.Throw);
});

// ---------------------------------------------------------------------------
// CoalesceLocals — call_indirect operand/index evaluation-order regression
// ---------------------------------------------------------------------------

Deno.test('CoalesceLocals: a local.tee in a call_indirect operand feeding the index is preserved', async () => {
  // wasm evaluates call_indirect operands BEFORE the table index. The CFG used
  // to visit the index (`target`) first, so a `local.tee $t` in an operand —
  // whose written value is consumed only by the index expression of the SAME
  // call — looked dead and got eliminated. The index then read a stale slot,
  // dispatching to the wrong (wrong-signature) function: at runtime V8 throws
  // "function signature mismatch". (Reported by the wasmtk team against
  // binaryen-ts 1.2.7; surfaced on a wasic closure/struct-method dispatch.)
  //
  //   (func $dispatch (param $obj i32) (result i32) (local $t i32)
  //     (call_indirect (type $sig)
  //       (local.tee $t (local.get $obj))   ;; operand: $t = obj, arg = obj
  //       (i32.load (local.get $t))))         ;; index  = mem[$t]
  //
  // If the tee's write is dropped, $t stays 0 and the index is always mem[0].
  const SIG_P = [ValType.I32];
  const SIG_R = [ValType.I32];
  const b = new ModuleBuilder();
  b.addMemory('mem0', 1);
  // mem[0] = 1 (→ index 1 → $f1), mem[4] = 0 (→ index 0 → $f0)
  b.addDataSegment('d', makeI32Const(0), new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]));
  b.addFunction(
    '$f0',
    SIG_P,
    SIG_R,
    makeReturn(
      [makeBinary(BinaryOp.AddI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(100))],
    ),
  );
  b.addFunction(
    '$f1',
    SIG_P,
    SIG_R,
    makeReturn(
      [makeBinary(BinaryOp.MulI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(2))],
    ),
  );
  b.addTable('$t0', ValType.FuncRef, 2, 2);
  b.addElement({
    name: '$e',
    mode: 'active',
    table: '$t0',
    offset: makeI32Const(0),
    data: ['$f0', '$f1'],
  });
  // $dispatch: local 0 = param $obj, local 1 = $t
  b.addFunction(
    '$dispatch',
    [ValType.I32],
    [ValType.I32],
    makeCallIndirect(
      varName('$t0'),
      makeLoad(Opcode.I32Load, BigInt(0), 2, makeLocalGet(varIndex(1), ValType.I32)), // index = mem[$t]
      [makeLocalTee(varIndex(1), makeLocalGet(varIndex(0), ValType.I32), ValType.I32)], // arg = ($t := obj)
      { params: SIG_P, results: SIG_R },
    ),
    [{ type: ValType.I32 }],
  );
  b.addExport('dispatch', '$dispatch', 'function');
  const mod = b.build();

  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).add('CoalesceLocals').run();

  const inst = new WebAssembly.Instance(
    await WebAssembly.compile(encodeWasm(mod) as BufferSource),
  );
  const dispatch = inst.exports.dispatch as (obj: number) => number;
  // obj=0 → $t=0 → index mem[0]=1 → $f1(0)=0
  assertEquals(dispatch(0), 0);
  // obj=4 → $t=4 → index mem[4]=0 → $f0(4)=104  (with the bug: $t=0 → $f1(4)=8)
  assertEquals(dispatch(4), 104);
});

Deno.test('DCE: recurses into Try catch bodies — dead tail after throw is trimmed', () => {
  const mod = emptyModule();
  const catchBody = makeBlock([
    makeThrow(varName('$e'), []),
    makeNop(), // dead
    makeI32Const(7), // dead
  ]);
  const t = makeTry(null, makeNop(), [tryCatch(varName('$e'), catchBody)], null, None);
  mod.functions.push(makeTestFn('f', makeBlock([t])));

  new PassRunner(mod).add('DCE').run();

  const tOut = region(mod.functions[0].body).children[0] as TryExpr;
  assertEquals(tOut.catches.length, 1);
  assertEquals(region(tOut.catches[0]!.body).children.length, 1);
  assertEquals(region(tOut.catches[0]!.body).children[0]!.kind, ExpressionKind.Throw);
});

Deno.test('DCE: Try expression itself is preserved (recursion does not strip the node)', () => {
  const mod = emptyModule();
  const t = makeTry(null, makeNop(), [], null, None);
  mod.functions.push(makeTestFn('f', makeBlock([t, makeI32Const(1)])));

  new PassRunner(mod).add('DCE').run();

  const outer = region(mod.functions[0].body);
  // The Try itself has type=none (not unreachable), so the i32.const survives.
  assertEquals(outer.children.length, 2);
  assertEquals(outer.children[0].kind, ExpressionKind.Try);
});

// ---------------------------------------------------------------------------
// Phase 8.1c — StripEH pass
// ---------------------------------------------------------------------------

Deno.test('StripEH: registered in pass registry', () => {
  assertEquals(listPasses().includes('StripEH'), true);
});

Deno.test('StripEH: throw becomes unreachable, operands wrapped in drop', () => {
  const mod = emptyModule();
  // throw $e (i32.const 42)
  mod.functions.push(makeTestFn('f', makeBlock([makeThrow(varName('$e'), [makeI32Const(42)])])));
  mod.tags.push({ name: '$e', params: [ValType.I32] });
  mod.hasExceptionHandling = true;

  new PassRunner(mod).add('StripEH').run();

  // The throw was replaced by an unnamed block [drop(i32.const 42), unreachable].
  // It was the body's only instruction, so the region takes its contents — the
  // shape the encoder used to produce by inlining it.
  assertEquals(region(mod.functions[0].body).children.map((c) => c.kind), [
    ExpressionKind.Drop,
    ExpressionKind.Unreachable,
  ]);
});

Deno.test('StripEH: throw with no operands becomes bare unreachable', () => {
  const mod = emptyModule();
  mod.functions.push(makeTestFn('f', makeBlock([makeThrow(varName('$e'), [])])));
  mod.tags.push({ name: '$e', params: [] });
  mod.hasExceptionHandling = true;

  new PassRunner(mod).add('StripEH').run();

  const outer = region(mod.functions[0].body);
  assertEquals(outer.children[0].kind, ExpressionKind.Unreachable);
});

Deno.test('StripEH: try is replaced by its body; catch is discarded', () => {
  const mod = emptyModule();
  const tryBody = makeI32Const(1);
  const catchBody = makeI32Const(99);
  const t = makeTry(null, tryBody, [tryCatch(varName('$e'), catchBody)], null, ValType.I32);
  mod.functions.push(makeTestFn('f', makeBlock([t])));
  mod.tags.push({ name: '$e', params: [] });
  mod.hasExceptionHandling = true;

  new PassRunner(mod).add('StripEH').run();

  const outer = region(mod.functions[0].body);
  // The try was substituted by its body (the i32.const 1).
  assertEquals(outer.children[0].kind, ExpressionKind.Const);
  assertEquals((outer.children[0] as { value: { value: number } }).value.value, 1);
});

Deno.test('StripEH: try_table is replaced by its body', () => {
  const mod = emptyModule();
  const tt = makeTryTable(null, makeI32Const(7), [], ValType.I32);
  mod.functions.push(makeTestFn('f', makeBlock([tt])));
  mod.tags.push({ name: '$e', params: [] });
  mod.hasExceptionHandling = true;

  new PassRunner(mod).add('StripEH').run();

  const outer = region(mod.functions[0].body);
  assertEquals(outer.children[0].kind, ExpressionKind.Const);
  assertEquals((outer.children[0] as { value: { value: number } }).value.value, 7);
});

Deno.test('StripEH: module.tags cleared and hasExceptionHandling reset', () => {
  const mod = emptyModule();
  mod.functions.push(makeTestFn('f', makeBlock([makeNop()])));
  mod.tags.push({ name: '$e', params: [ValType.I32] });
  mod.tags.push({ name: '$f', params: [] });
  mod.hasExceptionHandling = true;

  new PassRunner(mod).add('StripEH').run();

  assertEquals(mod.tags.length, 0);
  assertEquals(mod.hasExceptionHandling, false);
});

// ---------------------------------------------------------------------------
// ModuleBuilder + OptimizeInstructions round-trip
// ---------------------------------------------------------------------------

Deno.test('ModuleBuilder + OptimizeInstructions: add(x, 0) optimized', () => {
  const mod = new ModuleBuilder()
    .addFunction(
      'identity',
      [ValType.I32],
      [ValType.I32],
      makeReturn(
        [makeBinary(BinaryOp.AddI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(0))],
      ),
    )
    .addExport('identity', 'identity')
    .build();

  new PassRunner(mod).add('OptimizeInstructions').run();

  const ret = soleOf(mod.functions[0].body, ExpressionKind.Return);
  assertEquals(ret.values[0]?.kind, ExpressionKind.LocalGet);
});
