/**
 * @module binaryen-ts/tests/passes/flatten_test
 *
 * Tests for the Flatten pass (Asyncify Stage 3a prerequisite). Two layers:
 *
 *  1. **Behavioral equivalence** — the primary correctness gate. Each fixture is
 *     parsed twice; one copy is flattened. Both are encoded, instantiated, and
 *     run over sample inputs; the results must be bit-identical. (Flatten is a
 *     semantics-preserving normalization, so any divergence is a bug.)
 *  2. **Flatness invariants** — the output must actually BE flat: no
 *     `local.tee`, `if`/`loop` conditions are trivial, and the operands of
 *     value operations (calls, binaries, loads, stores) are trivial. These are
 *     exactly the properties the Asyncify flow transform relies on.
 *
 * @license MIT
 */

import { assert, assertEquals, assertThrows } from '@std/assert';

import {
  type Expression,
  ExpressionKind,
  makeBlock,
  makeCall,
  makeCallIndirect,
  makeI32Const,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import {
  mapChildrenShallow,
  visitChildren,
  walkExpression,
} from '../../../src/binaryen-ts/ir/walk.ts';
import { None, ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { buildCallResultTypes, FlattenPass } from '../../../src/binaryen-ts/passes/flatten.ts';
import type { PassOptions } from '../../../src/binaryen-ts/passes/pass.ts';
import { ModuleBuilder, type WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { varName } from '../../../src/wabt-ts/ir/ir.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/encoder/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Imports = WebAssembly.Imports;

/** Default pass options for the direct `FlattenPass.run` calls below. */
const FLATTEN_OPTS: PassOptions = {
  optimizeLevel: 0,
  shrinkLevel: 0,
  debugInfo: false,
  closedWorld: false,
  passArgs: {},
  partialInliningIfs: 0,
};

function instantiate(mod: WasmModule, imports?: Imports): WebAssembly.Instance {
  const bytes = writeWasm(mod);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), imports);
}

/** Parse `wat` twice; flatten the second; run both `fn(...args)` and compare. */
function assertEquivalent(
  wat: string,
  fn: string,
  argSets: number[][],
  imports?: Imports,
): void {
  const original = instantiate(readWat(wat), imports);
  const flatMod = readWat(wat);
  new FlattenPass().run(flatMod, {
    optimizeLevel: 0,
    shrinkLevel: 0,
    debugInfo: false,
    closedWorld: false,
    passArgs: {},
    partialInliningIfs: 0,
  });
  const flattened = instantiate(flatMod, imports);

  const of = original.exports[fn] as (...a: number[]) => number;
  const ff = flattened.exports[fn] as (...a: number[]) => number;
  for (const args of argSets) {
    assertEquals(ff(...args), of(...args), `${fn}(${args.join(',')}) diverged after flatten`);
  }
}

const TRIVIAL = new Set<ExpressionKind>([
  ExpressionKind.Const,
  ExpressionKind.LocalGet,
  ExpressionKind.RefNull,
  ExpressionKind.RefFunc,
  ExpressionKind.Unreachable,
  ExpressionKind.Nop,
]);

/** Assert the flattened module satisfies the flat-IR invariants. */
function assertFlat(mod: WasmModule): void {
  for (const func of mod.functions) {
    walkExpression(func.body, (e: Expression) => {
      assert(e.kind !== ExpressionKind.LocalTee, 'flat IR must not contain local.tee');

      if (e.kind === ExpressionKind.If) {
        assert(TRIVIAL.has(e.condition.kind), `if condition not trivial: ${e.condition.kind}`);
      }
      // Operands of value operations must be trivial.
      const checkOperands = (ops: Expression[]) => {
        for (const opcode of ops) {
          assert(TRIVIAL.has(opcode.kind), `non-trivial operand ${opcode.kind} under ${e.kind}`);
        }
      };
      switch (e.kind) {
        case ExpressionKind.Call:
          checkOperands(e.operands);
          break;
        case ExpressionKind.CallIndirect:
          checkOperands(e.operands);
          assert(TRIVIAL.has(e.callee.kind), 'call_indirect callee not trivial');
          break;
        case ExpressionKind.Binary:
          checkOperands([e.left, e.right]);
          break;
        case ExpressionKind.Unary:
          checkOperands([e.value]);
          break;
        case ExpressionKind.Load:
          checkOperands([e.address]);
          break;
        case ExpressionKind.Store:
          checkOperands([e.address, e.value]);
          break;
      }
    });
  }
}

function flattenParsed(wat: string): WasmModule {
  const mod = readWat(wat);
  new FlattenPass().run(mod, {
    optimizeLevel: 0,
    shrinkLevel: 0,
    debugInfo: false,
    closedWorld: false,
    passArgs: {},
    partialInliningIfs: 0,
  });
  return mod;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARITH = `(module
  (func (export "f") (param $x i32) (param $y i32) (result i32)
    (i32.sub (i32.mul (i32.add (local.get $x) (local.get $y)) (i32.const 2)) (local.get $x))))`;

const IFELSE = `(module
  (func (export "f") (param $x i32) (result i32)
    (if (result i32) (i32.lt_s (local.get $x) (i32.const 10))
      (then (i32.mul (local.get $x) (i32.const 2)))
      (else (i32.add (local.get $x) (i32.const 100))))))`;

const LOOP_SUM = `(module
  (func (export "f") (param $n i32) (result i32)
    (local $i i32) (local $acc i32)
    (block $done
      (loop $lp
        (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $acc (i32.add (local.get $acc) (local.get $i)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $lp)))
    (local.get $acc)))`;

const NESTED_CALLS = `(module
  (func $g (param $x i32) (result i32) (i32.add (local.get $x) (i32.const 1)))
  (func (export "f") (param $x i32) (result i32)
    (i32.mul (call $g (call $g (local.get $x))) (call $g (local.get $x)))))`;

const FACTORIAL = `(module
  (func $fac (export "f") (param $n i32) (result i32)
    (if (result i32) (i32.lt_s (local.get $n) (i32.const 2))
      (then (i32.const 1))
      (else (i32.mul (local.get $n) (call $fac (i32.sub (local.get $n) (i32.const 1))))))))`;

const IMPORT_CALL = `(module
  (import "env" "dbl" (func $dbl (param i32) (result i32)))
  (func (export "f") (param $x i32) (result i32)
    (i32.add (call $dbl (local.get $x)) (call $dbl (i32.add (local.get $x) (i32.const 1))))))`;

const VOID_STORE = `(module
  (memory 1)
  (func (export "f") (param $x i32) (result i32)
    (i32.store (i32.const 0) (i32.add (local.get $x) (i32.const 7)))
    (i32.load (i32.const 0))))`;

// ---------------------------------------------------------------------------
// Behavioral equivalence
// ---------------------------------------------------------------------------

Deno.test('flatten preserves semantics — arithmetic', () => {
  assertEquivalent(ARITH, 'f', [[3, 4], [0, 0], [-5, 9], [100, -100]]);
});

Deno.test('flatten preserves semantics — if/else', () => {
  assertEquivalent(IFELSE, 'f', [[3], [10], [11], [-1], [9]]);
});

Deno.test('flatten preserves semantics — loop (sum 0..n)', () => {
  assertEquivalent(LOOP_SUM, 'f', [[0], [1], [5], [10], [100]]);
});

Deno.test('flatten preserves semantics — nested defined-function calls', () => {
  assertEquivalent(NESTED_CALLS, 'f', [[0], [5], [-3], [42]]);
});

Deno.test('flatten preserves semantics — recursion (factorial)', () => {
  assertEquivalent(FACTORIAL, 'f', [[0], [1], [5], [7], [10]]);
});

Deno.test('flatten preserves semantics — import calls with eval order', () => {
  const imports = { env: { dbl: (x: number) => x * 2 } };
  assertEquivalent(IMPORT_CALL, 'f', [[3], [0], [-4]], imports);
});

Deno.test('flatten preserves semantics — void store then load', () => {
  assertEquivalent(VOID_STORE, 'f', [[3], [0], [35]]);
});

// ---------------------------------------------------------------------------
// Flatness invariants
// ---------------------------------------------------------------------------

Deno.test('flatten output is flat — no local.tee, trivial conditions & operands', () => {
  for (const wat of [ARITH, IFELSE, LOOP_SUM, NESTED_CALLS, FACTORIAL, IMPORT_CALL, VOID_STORE]) {
    assertFlat(flattenParsed(wat));
  }
});

Deno.test('flatten hoists every call to a standalone statement operand set', () => {
  // The Asyncify-critical property: no call is nested inside another value
  // expression — each call's operands are trivial (checked by assertFlat), so a
  // call only ever appears as the RHS of a local.set / drop / return.
  const mod = flattenParsed(NESTED_CALLS);
  assertFlat(mod);
  let calls = 0;
  for (const f of mod.functions) {
    walkExpression(f.body, (e) => {
      if (e.kind === ExpressionKind.Call) calls++;
    });
  }
  assert(calls >= 3, 'expected the 3 nested calls to survive flattening');
});

// Regression: a local.tee whose result is read by a parent must survive a later
// sibling operand that writes the SAME local. Before the fix, flatten returned
// `local.get tee.index` (the original local), which the second tee's prelude
// clobbered → both operands read the second value. (sub(10,3)=7, not 3-3=0.)
Deno.test('flatten — two tees to the same local as sibling operands are not clobbered', () => {
  assertEquivalent(
    `(module (func $f (export "f") (result i32) (local $t i32)
      (i32.sub (local.tee $t (i32.const 10)) (local.tee $t (i32.const 3)))))`,
    'f',
    [[]],
  );
});

// Regression: `call_indirect` evaluates its operands BEFORE the table index
// (target). walk's child-mapper had them reversed, so flatten hoisted the
// target's prelude first. Here the target `(call $pick)` clobbers $g and the
// operand `(global.get $g)` reads it: correct order → operand sees 7; buggy
// order → $pick runs first and the operand sees 99. Original (unflattened)
// semantics return 7, so any flatten reordering diverges.
// Regression (walk.ts): `call_indirect` evaluates its operands BEFORE the table
// index (target) — the order the encoder emits and that Flatten's prelude
// hoisting (via mapChildrenShallow) relies on. The child mapper/visitor had them
// reversed, so Flatten would hoist a side-effecting target ahead of the operands,
// silently miscompiling any interface/func-value call whose target and operands
// interact. Assert both the map primitive and the visitor yield operand→target.
Deno.test('walk — call_indirect visits operands before the table index', () => {
  const ci = makeCallIndirect(
    varName('$t'),
    makeI32Const(200), // target (table index) — must be visited LAST
    [makeI32Const(100)], // operand — must be visited FIRST
    { params: [ValType.I32], results: [ValType.I32] },
  );
  const readVal = (c: Expression) => (c as { value: { value: number } }).value.value;

  const mapOrder: number[] = [];
  mapChildrenShallow(ci, (c) => {
    mapOrder.push(readVal(c));
    return c;
  });
  assertEquals(mapOrder, [100, 200], 'mapChildrenShallow: operand must precede target');

  const visitOrder: number[] = [];
  visitChildren(ci, (c) => visitOrder.push(readVal(c)));
  assertEquals(visitOrder, [100, 200], 'visitChildren: operand must precede target');
});

// Regression: a non-last `unreachable` inside a block is trivial with an empty
// prelude, so the old flattenBlock appended it nowhere and the trap vanished —
// letting control fall through. It must survive flattening.
Deno.test('flatten — a non-last unreachable inside a block is preserved', () => {
  const mod = flattenParsed(
    `(module (func $f (export "f") (result i32) (local $x i32)
      (block
        (unreachable)
        (local.set $x (i32.const 5)))
      (local.get $x)))`,
  );
  let unreachables = 0;
  for (const f of mod.functions) {
    walkExpression(f.body, (e) => {
      if (e.kind === ExpressionKind.Unreachable) unreachables++;
    });
  }
  assert(unreachables >= 1, 'flatten dropped the non-last unreachable (trap elided)');
});

Deno.test('Flatten: buildCallResultTypes keeps a multi-result signature whole', () => {
  // It used to record `results[0]`, so a 2-result function looked like a plain
  // i32 function. `callEffectiveType` would then hoist the call into ONE local
  // and silently drop the second value.
  const mod = new ModuleBuilder()
    .addFunction('two', [], [ValType.I32, ValType.I32], makeI32Const(0))
    .addFunction('one', [], [ValType.I32], makeI32Const(0))
    .addFunction('none', [], [], makeI32Const(0))
    .build();

  const map = buildCallResultTypes(mod);
  assertEquals(map.get('two'), [ValType.I32, ValType.I32]);
  assertEquals(map.get('one'), ValType.I32);
  assertEquals(map.get('none'), None);
});

Deno.test('Flatten: a multi-result call fails loudly instead of losing values', () => {
  // Flatten hoists a value into ONE temporary local, which cannot hold N
  // values. Taking the first result would leave the operand stack short, so
  // this must throw rather than mis-hoist.
  const mod = new ModuleBuilder()
    .addFunction('two', [], [ValType.I32, ValType.I32], makeI32Const(0))
    .addFunction(
      'caller',
      [],
      [ValType.I32],
      makeBlock([makeCall(varName('two'), [], [ValType.I32, ValType.I32])]),
    )
    .build();

  assertThrows(
    () => new FlattenPass().run(mod, FLATTEN_OPTS),
    Error,
    'multi-result calls cannot be hoisted',
  );
});

Deno.test('Flatten: an unresolvable call target fails loudly instead of typing it void', () => {
  // `buildCallResultTypes` registers every import and defined function, so a
  // miss means a dangling target. Typing it `none` silently discarded the
  // call's value — the same defect the WAT parser's `inferFuncResultType` stub
  // produced.
  const mod = new ModuleBuilder()
    .addFunction('caller', [], [], makeBlock([makeCall(varName('$nope'), [], None)]))
    .build();

  assertThrows(() => new FlattenPass().run(mod, FLATTEN_OPTS), Error, 'unresolved call target');
});

Deno.test('Flatten: an `if` keeps its label, so a `br` to the `if` still resolves', () => {
  // Flatten rebuilt the `if` as a literal without `name`. The `br $l` inside
  // then named a label no enclosing construct carried, and the encoder threw
  // "unresolved branch label" on a valid module. The binary decoder labels
  // every `if`, so any decoded `br` to an `if` hit this.
  assertEquivalent(
    `(module (func (export "f") (param i32) (result i32)
       (if $l (local.get 0)
         (then (local.set 0 (i32.const 5)) (br $l) (local.set 0 (i32.const 7))))
       (local.get 0)))`,
    'f',
    [[0], [1]],
  );
});

// ---------------------------------------------------------------------------
// Item 5 (2026-09-28): what `wasm-opt --flatten` did over 2,919 modules —
// through the reader and the one writer, the route that survives the bump.
// ---------------------------------------------------------------------------

/** `wat` → wat2wasm → readForPasses → Flatten → writeWasm. */
function flattenRouteB(wat: string): Uint8Array {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const m = readForPasses(r.binary);
  new PassRunner(m, { optimizeLevel: 0, shrinkLevel: 0 }).add('Flatten').run();
  return writeWasm(m);
}

const callF = (bytes: Uint8Array, ...args: number[]) =>
  (new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    ...a: number[]
  ) => number)(...args);

Deno.test('Flatten: a result-typed body that never falls through stays valid', () => {
  // 🔧 A body ending in `return` was flattened as a VOID statement, and the
  // function then ended on a void block: "expected 1 elements on the stack for
  // fallthru" — 131 of 2,919 modules came out INVALID, silently. The shapes of
  // `spec/comments/comments.4` (values left under a `return`) and
  // `spec/memory_fill/memory_fill.3` (a loop, then `return`).
  for (
    const wat of [
      `(module (func (export "f") (param i32) (result i32)
        i32.const 1
        local.get 0
        i32.const 2
        i32.add
        return))`,
      `(module (func (export "f") (param i32) (result i32)
        (loop $l
          (br_if $l (i32.lt_u (local.tee 0 (i32.add (local.get 0) (i32.const 1))) (i32.const 5))))
        (return (local.get 0))))`,
    ]
  ) {
    const out = flattenRouteB(wat);
    assert(WebAssembly.validate(out as BufferSource), 'valid');
    const original = wat2wasm(wat).binary;
    for (const x of [0, 3, 9]) assertEquals(callF(out, x), callF(original, x), `f(${x})`);
  }
});

Deno.test('Flatten: a multi-value body is refused by name, not a crash in the writer', () => {
  // 🔧 A tuple temp was allocated — a local no value type can spell — and the
  // one writer's resolver met it as "Cannot read properties of undefined" (47
  // modules). `spec/array_new_data/array_new_data.2`'s shape.
  assertThrows(
    () =>
      flattenRouteB('(module (func (export "f") (result i32 i32) (i32.const 1) (i32.const 2)))'),
    Error,
    'a 2-value result cannot be hoisted into a single local',
  );
});

Deno.test('flatten preserves semantics — a value if whose arms are several instructions', () => {
  // A multi-instruction arm flattens as a block DECLARING the arm's value type
  // (S6 step 5 item 5 (3)); declared void, its value is lost to the result temp.
  assertEquivalent(
    `(module (func (export "f") (param i32) (result i32)
      (if (result i32) (local.get 0)
        (then (drop (i32.const 0)) (i32.const 11))
        (else (nop) (i32.const 22)))))`,
    'f',
    [[0], [1]],
  );
});

// ---------------------------------------------------------------------------
// Value-carrying branches (2026-09-28): upstream Flatten's shape — the value
// goes into the target's result temp, and the branch goes without it.
// ---------------------------------------------------------------------------

/** `f(x)`'s result, or `trap` — so a lost trap shows as a difference. */
const outcome = (bytes: Uint8Array, x: number): number | 'trap' => {
  try {
    return callF(bytes, x);
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) return 'trap';
    throw e;
  }
};

/** Route B's output is valid and computes what the original does, on 0..3. */
function assertFlattensSame(wat: string): void {
  const out = flattenRouteB(wat);
  assert(WebAssembly.validate(out as BufferSource), 'valid');
  const original = wat2wasm(wat, { textForm: false }).binary;
  for (const x of [0, 1, 2, 3]) assertEquals(outcome(out, x), outcome(original, x), `f(${x})`);
}

Deno.test('Flatten: br, br_if and br_table carrying a value', () => {
  for (
    const wat of [
      '(module (func (export "f") (param i32) (result i32) (block (result i32) (br 0 (i32.add (local.get 0) (i32.const 1))))))',
      // Taken or not; and the value used when NOT taken.
      '(module (func (export "f") (param i32) (result i32) (block (result i32) (drop (br_if 0 (i32.const 7) (local.get 0))) (i32.const 9))))',
      '(module (func (export "f") (param i32) (result i32) (block (result i32) (i32.add (br_if 0 (i32.const 7) (local.get 0)) (i32.const 100)))))',
      '(module (func (export "f") (param i32) (result i32) (i32.add (block (result i32) (block (result i32) (br_table 0 1 (i32.const 5) (local.get 0)))) (i32.const 1))))',
      // To an `if`'s label.
      '(module (func (export "f") (param i32) (result i32) (if (result i32) (local.get 0) (then (br 0 (i32.const 3))) (else (i32.const 4)))))',
      // The condition itself branches to the same block: its write to the temp
      // must not be clobbered by the outer branch's.
      '(module (func (export "f") (param i32) (result i32) (block $b (result i32) (drop (br_if $b (i32.const 1) (block (result i32) (drop (br_if $b (i32.const 2) (i32.eq (local.get 0) (i32.const 2)))) (local.get 0)))) (i32.const 3))))',
    ]
  ) assertFlattensSame(wat);
});

Deno.test('Flatten: a value branch to the function frame becomes a return', () => {
  assertFlattensSame(
    '(module (func (export "f") (param i32) (result i32) (drop (br_if 0 (i32.const 11) (local.get 0))) (i32.const 22)))',
  );
  assertFlattensSame(
    '(module (func (export "f") (param i32) (result i32) (if (local.get 0) (then (br 1 (i32.const 11)))) (i32.const 22)))',
  );
  assertThrows(
    () =>
      flattenRouteB(
        '(module (func (export "f") (param i32) (result i32) (br_table 0 0 (i32.const 1) (local.get 0))))',
      ),
    Error,
    'value-carrying br_table to the function frame',
  );
});

Deno.test("Flatten: a block's value may sit under trailing void statements", () => {
  // 🔧 The block's LAST child was always taken as its value, writing
  // `local.set $tmp (nop)` — invalid (`spec/nop/nop.0`).
  assertFlattensSame(
    '(module (func (export "f") (param i32) (result i32) (block (result i32) local.get 0 nop nop)))',
  );
});

Deno.test('Flatten: a value taken from the stack by a later instruction is refused by name', () => {
  // Stack-form code the reader keeps (`br_if` shows no value: it takes the
  // `local.get` below it). Flat IR has no stack; discarding it lost an operand.
  assertThrows(
    () =>
      flattenRouteB(
        '(module (func (export "f") (param i32) (result i32) (block (result i32) local.get 0 nop local.get 0 br_if 0)))',
      ),
    Error,
    'a value left on the stack for a later instruction',
  );
  // 🔧 A `br`/`br_table` that shows no value but targets a result block takes
  // it from the stack: not abandoned. Read as a trap that discards it, the
  // output was VALID and returned the result temp's zero.
  for (
    const wat of [
      '(module (func (export "f") (param i32) (result i32) (block (result i32) local.get 0 nop br 0)))',
      '(module (func (export "f") (param i32) (result i32) (block (result i32) local.get 0 nop local.get 0 br_table 0 0)))',
      '(module (func (export "f") (param i32) (result i32) local.get 0 nop br 0))',
    ]
  ) {
    assertThrows(
      () => flattenRouteB(wat),
      Error,
      'a value left on the stack for a later instruction',
    );
  }
  // A `pop` operand is spilled to a local before Flatten runs: flattened.
  assertFlattensSame(
    '(module (func (export "f") (param i32) (result i32) local.get 0 nop i32.eqz unreachable))',
  );
  assertFlattensSame(
    '(module (func (export "f") (param i32) (result i32) local.get 0 nop return))',
  );
  // A value ABANDONED under a trap is not taken by anything: flattened.
  assertFlattensSame(
    '(module (func (export "f") (param i32) (result i32) local.get 0 i32.eqz local.get 0 i32.eqz unreachable))',
  );
});

Deno.test('Flatten: an arm or loop of one `unreachable` still traps', () => {
  // 🔧 The arm kept only a concrete value; the trivial `unreachable` was
  // dropped and the arm fell through (`spec/unreachable` "as-if-then").
  assertFlattensSame(
    '(module (func (export "f") (param i32) (result i32) (if (result i32) (local.get 0) (then (unreachable)) (else (local.get 0)))))',
  );
  assertFlattensSame(
    '(module (func (export "f") (param i32) (result i32) (if (local.get 0) (then (loop (unreachable)))) (i32.const 5)))',
  );
});
