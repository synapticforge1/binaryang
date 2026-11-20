// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// C-R2-5 (security review round 4): the spec behaviour check used V8's run of the ORIGINAL as its
// oracle, never the script's own `assert_return` / `assert_trap` values. `scripts/spec-behaviour/
// expected.ts` compares a run with those values (as wabt's spectest-interp does) and
// `script-run.ts` runs a whole script — modules in order, `register`, `get`, the shared spectest —
// under the original bytes and every variant binaryang writes. These tests pin both: a WRONG
// expected value must be reported (on the original and on every variant), a right one must not, and
// the rules (NaN classes, `either`, the v128 lanes, the exact NaN payload through the bit wrapper)
// hold. Measured over the suite on 2026-11-20: 57,986 assertions, 521,734 variant checks, 0
// disagreements of binaryang; the one of V8 is its 2^48-page memory limit (ENGINE_LIMITS).

import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import {
  type Expect,
  type ExpectedValue,
  f32Bits,
  meets,
  type Raw,
} from '../../../scripts/spec-behaviour/expected.ts';
import type { CheckHooks } from '../../../scripts/spec-behaviour/differential.ts';
import {
  checkScript,
  typeErrorCause,
  VARIANTS,
} from '../../../scripts/spec-behaviour/script-run.ts';
import * as fsx from '../../test_fs.ts';
import { test } from 'node:test';

const ok = (...values: unknown[]): Raw => ({ ok: true, values, wrapped: false });
const bits = (...values: unknown[]): Raw => ({ ok: true, values, wrapped: true, bits: true });
const val = (type: string, value?: unknown, lane_type?: string): ExpectedValue => ({
  type,
  ...(value !== undefined ? { value } : {}),
  ...(lane_type !== undefined ? { lane_type } : {}),
});
const ret = (...values: ExpectedValue[]): Expect => ({ kind: 'return', values });

test('integers are compared by bits, as the manifest spells them (unsigned decimal)', () => {
  assertEquals(meets(ret(val('i32', '4294967295')), ok(-1)).problem, undefined);
  assert(meets(ret(val('i32', '4294967295')), ok(1)).problem !== undefined);
  assertEquals(meets(ret(val('i64', '18446744073709551615')), ok(-1n)).problem, undefined);
  assert(meets(ret(val('i64', '1')), ok(1)).problem !== undefined); // a number is not an i64
  assert(meets(ret(val('i32', '1')), ok(1, 2)).problem !== undefined); // an extra result
  assert(meets(ret(val('i32', '1')), ok()).problem !== undefined); // a missing one
});

test('NaN: canonical, arithmetic and literal payloads, through the bit wrapper', () => {
  const f32 = (b: number) => bits(b | 0);
  assertEquals(meets(ret(val('f32', 'nan:canonical')), f32(0x7fc00000)).problem, undefined);
  assertEquals(meets(ret(val('f32', 'nan:canonical')), f32(0xffc00000)).problem, undefined);
  assert(meets(ret(val('f32', 'nan:canonical')), f32(0x7fc00001)).problem !== undefined);
  assertEquals(meets(ret(val('f32', 'nan:arithmetic')), f32(0x7fc00001)).problem, undefined);
  assert(meets(ret(val('f32', 'nan:arithmetic')), f32(0x7fa00000)).problem !== undefined);
  assert(meets(ret(val('f32', 'nan:canonical')), f32(0x3f800000)).problem !== undefined);
  // A literal bit pattern is EXACT: a signalling NaN is not its quieted self.
  assertEquals(meets(ret(val('f32', '2141192192')), f32(0x7fa00000)).problem, undefined);
  assert(meets(ret(val('f32', '2141192192')), f32(0x7fe00000)).problem !== undefined);
  assertEquals(
    meets(ret(val('f64', 'nan:canonical')), bits(0x7ff8000000000000n)).problem,
    undefined,
  );
  assert(meets(ret(val('f64', 'nan:canonical')), bits(0x7ff8000000000001n)).problem !== undefined);
  // 0xfff8000000000000 as an i64: a negative quiet NaN is arithmetic.
  assertEquals(
    meets(ret(val('f64', 'nan:arithmetic')), bits(BigInt.asIntN(64, 0xfff8000000000000n))).problem,
    undefined,
  );
  // Unwrapped (a JS number) a literal NaN payload cannot be told: any NaN meets it, COUNTED.
  const v = meets(ret(val('f32', '2141192192')), ok(NaN));
  assertEquals(v.problem, undefined);
  assertEquals(v.nanBoundary, true);
  assert(meets(ret(val('f32', '2141192192')), ok(1)).problem !== undefined);
});

test('a literal NaN met unwrapped must be of the expected SIGN (the JS API may quiet the payload)', () => {
  // NaN here is a positive quiet NaN in every engine. A NEGATIVE signalling NaN expected is not met
  // by it (f32 0xffa00000, f64 0xfff0000000000001); a positive one is, COUNTED.
  assert(meets(ret(val('f32', '4288413696')), ok(NaN)).problem !== undefined);
  assert(meets(ret(val('f64', '18442240474082181121')), ok(NaN)).problem !== undefined);
  const pos32 = meets(ret(val('f32', '2141192192')), ok(NaN)); // 0x7fa00000
  assertEquals([pos32.problem, pos32.nanBoundary], [undefined, true]);
  const pos64 = meets(ret(val('f64', '9218868437227405313')), ok(NaN)); // 0x7ff0000000000001
  assertEquals([pos64.problem, pos64.nanBoundary], [undefined, true]);
  // A negative NaN meets a negative expectation wherever the engine lets its sign through (V8 does;
  // JavaScriptCore quiets it to a positive one), and never a positive one.
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, 0xffc00000);
  const neg32 = view.getFloat32(0);
  const seen = f32Bits(neg32) >>> 31 === 1;
  assertEquals(meets(ret(val('f32', '4288413696')), ok(neg32)).problem === undefined, seen);
  assertEquals(meets(ret(val('f32', '2141192192')), ok(neg32)).problem !== undefined, seen);
});

test('v128 by lanes, and `either` (relaxed SIMD) by any one alternative', () => {
  const lanes = (lo: bigint, hi: bigint) => ok(lo, hi);
  const want = val('v128', ['1', '2', '3', '4294967295'], 'i32');
  assertEquals(
    meets(ret(want), lanes((2n << 32n) | 1n, (0xffffffffn << 32n) | 3n)).problem,
    undefined,
  );
  assert(
    meets(ret(want), lanes((2n << 32n) | 1n, (0xfffffffen << 32n) | 3n)).problem !== undefined,
  );
  const f = val('v128', ['nan:canonical', '1065353216', '0', '0'], 'f32');
  assertEquals(meets(ret(f), lanes((0x3f800000n << 32n) | 0x7fc00000n, 0n)).problem, undefined);
  assert(meets(ret(f), lanes((0x3f800000n << 32n) | 0x7fc00001n, 0n)).problem !== undefined);
  const a = val('v128', ['1', '0'], 'i64');
  const b = val('v128', ['2', '0'], 'i64');
  const either: Expect = { kind: 'return', values: [], either: [a, b] };
  assertEquals(meets(either, lanes(2n, 0n)).problem, undefined);
  assert(meets(either, lanes(3n, 0n)).problem !== undefined);
});

test('a trap, exhaustion and exception are told apart; an action must complete', () => {
  const trap: Raw = { ok: false, kind: 'trap', detail: 'unreachable' };
  const exh: Raw = { ok: false, kind: 'exhaustion', detail: '' };
  assertEquals(meets({ kind: 'trap' }, trap).problem, undefined);
  assert(meets({ kind: 'trap' }, exh).problem !== undefined);
  assert(meets({ kind: 'trap' }, ok(1)).problem !== undefined); // a return is not a trap
  assertEquals(meets({ kind: 'exhaustion' }, exh).problem, undefined);
  assert(meets(ret(val('i32', '1')), trap).problem !== undefined); // a trap is not a return
  assertEquals(meets({ kind: 'complete' }, ok()).problem, undefined);
  assert(meets({ kind: 'complete' }, trap).problem !== undefined);
});

test('references: null, a function, the host value the call made', () => {
  assertEquals(meets(ret(val('externref', 'null')), ok(null)).problem, undefined);
  assert(meets(ret(val('externref', 'null')), ok({ extern: '1' })).problem !== undefined);
  assertEquals(meets(ret(val('externref', '1')), ok({ extern: '1' })).problem, undefined);
  assert(meets(ret(val('externref', '2')), ok({ extern: '1' })).problem !== undefined);
  assertEquals(meets(ret(val('funcref')), ok(() => {})).problem, undefined);
  assert(meets(ret(val('funcref')), ok(null)).problem !== undefined);
  assertEquals(meets(ret(val('refnull')), ok(null)).problem, undefined);
});

// --- A whole script, run under the original and every variant ----------------------------------

const asm = (wat: string) => wat2wasm(wat, { textForm: false }).binary;

/** Writes the modules as `m<i>.wasm` into a temp folder and runs `commands` against them. */
async function run(
  modules: string[],
  commands: Record<string, unknown>[],
  hooks?: CheckHooks,
) {
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-spec-expected-' });
  try {
    for (const [i, wat] of modules.entries()) await fsx.writeFile(`${dir}/m${i}.wasm`, asm(wat));
    return checkScript({ name: 'synthetic', dir, commands }, hooks);
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
}

const mod = (i: number, extra: Record<string, unknown> = {}) => ({
  type: 'module',
  line: 1,
  filename: `m${i}.wasm`,
  ...extra,
});
const invoke = (field: string, args: unknown[] = [], module?: string) => ({
  type: 'invoke',
  field,
  args,
  ...(module !== undefined ? { module } : {}),
});

const BASIC = `(module
  (global $g (export "g") (mut i32) (i32.const 7))
  (func (export "add") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
  (func (export "set") (param i32) (global.set $g (local.get 0)))
  (func (export "boom") (result i32) unreachable)
  (func $deep (export "deep") (result i32) (call $deep))
  (func (export "id32") (param f32) (result f32) (local.get 0))
  (func (export "id64") (param f64) (result f64) (local.get 0))
  (func (export "vadd") (param v128 v128) (result v128) (i32x4.add (local.get 0) (local.get 1))))`;

const GOOD: Record<string, unknown>[] = [
  mod(0),
  {
    type: 'assert_return',
    line: 2,
    action: invoke('add', [{ type: 'i32', value: '2' }, { type: 'i32', value: '4294967295' }]),
    expected: [{ type: 'i32', value: '1' }],
  },
  { type: 'action', line: 3, action: invoke('set', [{ type: 'i32', value: '9' }]), expected: [] },
  {
    type: 'assert_return',
    line: 4,
    action: { type: 'get', field: 'g' },
    expected: [{ type: 'i32', value: '9' }],
  },
  {
    type: 'assert_trap',
    line: 5,
    action: invoke('boom'),
    text: 'unreachable',
    expected: [{ type: 'i32' }],
  },
  {
    type: 'assert_exhaustion',
    line: 6,
    action: invoke('deep'),
    text: 'call stack exhausted',
    expected: [],
  },
  {
    // A signalling NaN goes in and comes out with its payload: only the bit wrapper can say so.
    type: 'assert_return',
    line: 7,
    action: invoke('id32', [{ type: 'f32', value: '2141192192' }]),
    expected: [{ type: 'f32', value: '2141192192' }],
  },
  {
    type: 'assert_return',
    line: 8,
    action: invoke('id64', [{ type: 'f64', value: '9219994337134247936' }]),
    expected: [{ type: 'f64', value: '9219994337134247936' }],
  },
  {
    type: 'assert_return',
    line: 9,
    action: invoke('vadd', [
      { type: 'v128', lane_type: 'i32', value: ['1', '2', '3', '4'] },
      { type: 'v128', lane_type: 'i32', value: ['10', '20', '30', '4294967295'] },
    ]),
    expected: [{ type: 'v128', lane_type: 'i32', value: ['11', '22', '33', '3'] }],
  },
];

test('a script whose expectations are right: every assertion run, on every variant, no finding', async () => {
  const row = await run([BASIC], GOOD);
  assertEquals(row.original, []);
  assertEquals(row.variant, []);
  assertEquals(row.refused, []);
  assertEquals(row.modules, ['synthetic/m0.wasm']);
  assertEquals(row.unchecked, {});
  // 7 assertions and 1 action: the NaN ones ran (through the wrapper, not skipped).
  assertEquals(row.asserted, 8);
  assertEquals(row.variantChecks, 8 * (VARIANTS.length - 1));
});

test('a variant the pipeline refuses, of a module the engine ACCEPTS, is reported (F1)', async () => {
  // A pipeline bug planted at -O2: the variant throws while being made. The script has no later
  // invocation the differential would replay, so this row is the only place it can show.
  const hooks: CheckHooks = {
    afterPasses: (level) => {
      if (level === '-O2') throw new Error('planted pipeline bug');
    },
  };
  const row = await run([BASIC], [mod(0)], hooks);
  assertEquals(row.refused, ['synthetic/m0.wasm -O2']);
  assertEquals(row.modules, ['synthetic/m0.wasm']);
  assertEquals((await run([BASIC], [mod(0)])).refused, []); // no bug, no refusal
});

test('a module the engine refuses as the ORIGINAL is not counted as a pipeline refusal', async () => {
  // Type-invalid code: V8 refuses the original; whatever the pipeline then does is not ours to pin.
  const invalid = '(module (func (export "f") (result i32) f32.const 0))';
  const hooks: CheckHooks = {
    afterPasses: () => {
      throw new Error('planted pipeline bug');
    },
  };
  const row = await run([invalid], [mod(0)], hooks);
  assertEquals(row.refused, []);
});

test('a JS API TypeError is counted by cause with its numbers made N, and no letter d touched', () => {
  assertEquals(
    typeErrorCause('Cannot convert 12 to a BigInt'),
    'JS API TypeError: Cannot convert N to a BigInt',
  );
  // Every digit run goes, wherever it is; the letter d stays (it was being replaced before).
  assertEquals(typeErrorCause('bad 7 and 300'), 'JS API TypeError: bad N and N');
});

test('a WRONG expected value is reported on the original and on every variant', async () => {
  const wrong = GOOD.map((c) => ({ ...c }));
  wrong[1] = { ...wrong[1]!, expected: [{ type: 'i32', value: '2' }] }; // 2 + -1 is 1, not 2
  const row = await run([BASIC], wrong);
  assertEquals(row.original.length, 1);
  assert(row.original[0]!.includes('line 2 add'), row.original[0]);
  // One per variant (the minify variant included: its map is applied).
  assertEquals(row.variant.length, VARIANTS.length - 1);
  assert(row.variant.every((v) => v.includes('line 2 add: want i32 2')));
});

test('a trap the script expects but the module does not make is reported', async () => {
  const cmds = [mod(0), {
    type: 'assert_trap',
    line: 2,
    action: invoke('add', [{ type: 'i32', value: '1' }, { type: 'i32', value: '1' }]),
    text: 'unreachable',
    expected: [{ type: 'i32' }],
  }];
  const row = await run([BASIC], cmds);
  assertEquals(row.original.length, 1);
  assertEquals(row.variant.length, VARIANTS.length - 1);
});

test('register: a later module imports what an earlier one exports, through every variant', async () => {
  const provider = `(module (func (export "five") (result i32) (i32.const 5)))`;
  const user = `(module
    (import "P" "five" (func $five (result i32)))
    (func (export "ten") (result i32) (i32.add (call $five) (call $five))))`;
  const cmds = [
    mod(0, { name: '$P' }),
    { type: 'register', line: 2, name: '$P', as: 'P' },
    mod(1),
    {
      type: 'assert_return',
      line: 4,
      action: invoke('ten'),
      expected: [{ type: 'i32', value: '10' }],
    },
    {
      type: 'assert_return',
      line: 5,
      action: invoke('five', [], '$P'),
      expected: [{ type: 'i32', value: '5' }],
    },
  ];
  const row = await run([provider, user], cmds);
  assertEquals(row.original, []);
  assertEquals(row.variant, []);
  assertEquals(row.asserted, 2);
});

test('an import of a module the script never registered is COUNTED, not passed over', async () => {
  const user = `(module
    (import "P" "five" (func $five (result i32)))
    (func (export "ten") (result i32) (call $five)))`;
  const cmds = [mod(0), {
    type: 'assert_return',
    line: 2,
    action: invoke('ten'),
    expected: [{ type: 'i32', value: '10' }],
  }];
  const row = await run([user], cmds);
  assertEquals(row.asserted, 0);
  assertEquals(Object.values(row.unchecked).reduce((a, b) => a + b, 0), 1);
});
