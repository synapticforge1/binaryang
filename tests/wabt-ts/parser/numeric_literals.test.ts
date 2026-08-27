// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Tranche 1 of the spec-testsuite parse-gap scope: two numeric-literal bugs.
//
//   1. NEGATIVE HEX INTEGERS did not parse. `parseNatText` called
//      `BigInt('-0x7fffffff')`, which THROWS — JS accepts a sign only on
//      decimal literals and a radix prefix only unsigned. The function's own
//      comment claimed the opposite ("BigInt already understands the 0x/+/-
//      prefixes"), so the throw was caught and turned into null, surfacing as
//      "expected i32 constant". This affected i32/i64 consts, v128 integer
//      lanes, and invoke arguments alike.
//
//   2. HEX FLOATS REQUIRED A `p` EXPONENT. The grammar makes it optional:
//        hexfloat ::= '0x' hexnum '.'? hexfrac? (('p'|'P') sign? num)?
//      so `0x1.5` and the `0x0123456789ABCDEF.` form (trailing dot, no
//      fraction digits) used to be rejected outright.
//
// Together these moved the spec testsuite from 120/257 to 145/257 clean with
// no regressions — exactly the +25 the scope predicted.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWastScript } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { Type } from '../../../src/wabt-ts/core/types.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

async function callF(wat: string): Promise<number> {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  const { instance } = await WebAssembly.instantiate(buf);
  return (instance.exports.f as () => number)();
}

describe('negative hex integer literals', () => {
  const i32Cases: ReadonlyArray<readonly [string, number]> = [
    ['-0x1', -1],
    ['-0x7fffffff', -2147483647],
    ['-0x80000000', -2147483648],
    ['-0x4000_0000', -1073741824], // sign + radix + digit separators
    ['0xffffffff', -1], // positive form still works
    ['-2147483648', -2147483648], // decimal still works
  ];
  for (const [lit, want] of i32Cases) {
    it(`i32.const ${lit} === ${want}`, async () => {
      assertEquals(
        await callF(`(module (func (export "f") (result i32) (i32.const ${lit})))`),
        want,
      );
    });
  }

  it('i64.const -0x7fffffffffffffff', async () => {
    const { binary, errors } = wat2wasm(
      '(module (func (export "f") (result i64) (i64.const -0x7fffffffffffffff)))',
    );
    if (hasErrors(errors)) throw new Error(formatErrors(errors));
    assert(binary);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    assertEquals((instance.exports.f as () => bigint)(), -9223372036854775807n);
  });

  it('works in a v128 lane', () => {
    const { errors } = wat2wasm(
      `(module (func (result v128) (v128.const i8x16 ${'-0x80 '.repeat(16).trim()})))`,
    );
    assert(!hasErrors(errors), formatErrors(errors));
  });

  it('works as an invoke argument', () => {
    const { script, errors } = parseWastScript(
      `(module (func (export "f") (param i32)))
       (assert_return (invoke "f" (i32.const -0x40)))`,
    );
    assert(!hasErrors(errors), formatErrors(errors));
    const cmd = script.commands.find((c) => c.kind === 'assert_return');
    assert(cmd && cmd.kind === 'assert_return' && cmd.action.kind === 'invoke');
    const arg = cmd.action.args[0];
    assert(arg && arg.kind === 'value' && arg.value.type === Type.I32);
    assertEquals(arg.value.value, -64);
  });

  it('still rejects a malformed literal', () => {
    const { errors } = wat2wasm('(module (func (result i32) (i32.const -0xzz)))');
    assert(hasErrors(errors), 'expected -0xzz to be rejected');
  });
});

describe('hex floats without an exponent', () => {
  const cases: ReadonlyArray<readonly [string, number]> = [
    ['0x1.', 1],
    ['-0x1.', -1],
    ['0x1.5', 1.3125],
    ['0x0123456789ABCDEF.', 81985529216486900],
    ['0x1p0', 1], // explicit exponent still works
    ['0x1.8p1', 3],
    ['0x1.921fb54442d18p+2', 6.283185307179586],
  ];
  for (const [lit, want] of cases) {
    it(`f64.const ${lit} === ${want}`, async () => {
      assertEquals(
        await callF(`(module (func (export "f") (result f64) (f64.const ${lit})))`),
        want,
      );
    });
  }

  it('rejects a hex float with no digits at all', () => {
    for (const bad of ['0x.', '0xp0']) {
      const { errors } = wat2wasm(`(module (func (result f64) (f64.const ${bad})))`);
      assert(hasErrors(errors), `expected ${bad} to be rejected`);
    }
  });
});
