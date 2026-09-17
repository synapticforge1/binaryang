/**
 * @module binaryen-ts/tests/api/index_test
 *
 * Tests for the high-level `createModule` / `Module` API in `src/binaryen-ts/api/index.ts`.
 *
 * @license MIT
 */

import { assert, assertThrows } from '@std/assert';
import { createModule } from '../../../src/binaryen-ts/api/index.ts';
import {
  asRegion,
  makeBlock,
  makeF64Const,
  makeI32Const,
  makeI64Const,
  makeLoop,
  makeNop,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { None, ValType } from '../../../src/binaryen-ts/ir/types.ts';
import '../../../src/binaryen-ts/passes/index.ts'; // register built-in passes

Deno.test('toWat: unsupported expression kind throws instead of a silent (;; TODO ;) placeholder', () => {
  // The WAT serializer handles only a subset of expression kinds; `Loop` is not
  // among them. It used to emit a `(;; TODO ;)` comment — which, fed to the
  // hybrid optimizer subprocess, would silently optimize a different program.
  // It must now fail loudly.
  const mod = createModule(() => {});
  mod.ir.functions.push({
    name: '$f',
    params: [],
    results: [],
    locals: [],
    body: asRegion(makeLoop('l', makeNop(), None)),
  });
  assertThrows(() => mod.toWat(), Error, 'unsupported expression kind');
});

Deno.test('Module.optimize honors the -O level (was hardcoded to 2)', async () => {
  // A removable `nop` followed by the real result: Vacuum (level ≥ 1) drops it,
  // so -Oz output is strictly smaller than -O0 (which now runs NO passes). Before
  // the fix, optimizeLevel was hardcoded to 2 and `-O0` produced identical bytes.
  const build = () => {
    const mod = createModule(() => {});
    mod.ir.functions.push({
      name: '$f',
      params: [],
      results: [ValType.I32],
      locals: [],
      body: asRegion(makeBlock([makeNop(), makeI32Const(5)], null)),
    });
    return mod;
  };
  const o0 = await build().optimize('-O0');
  const oz = await build().optimize('-Oz');
  assert(o0.length > oz.length, `expected -O0 (${o0.length}) > -Oz (${oz.length})`);
});

Deno.test('toWat: value types print as their NAMES, not as the bytes that represent them', () => {
  // S6 step 5, stage V1: `ValType` holds the wire bytes now (`I32 = 0x7f`). This
  // serializer interpolated types straight into the text -- `(param $p0 ${t})` --
  // which compiles either way and would have printed `(param $p0 127)`. No test
  // read its output, so nothing said so; a type-aware sweep found it.
  const mod = createModule(() => {});
  mod.ir.globals.push(
    {
      name: '$g',
      type: ValType.F64,
      mutable: true,
      init: asRegion(makeF64Const(1.5)),
    } as (typeof mod.ir.globals)[number],
  );
  mod.ir.functions.push({
    name: '$f',
    params: [ValType.I32],
    results: [ValType.I64],
    locals: [{ type: ValType.I32 }, { type: ValType.F32, name: '$x' }],
    body: asRegion(makeBlock([makeI64Const(7n)], null, ValType.I64)),
  });
  const wat = mod.toWat();
  for (
    const want of ['(param $p0 i32)', '(result i64)', '(mut f64)', '(local $x f32)', '(result i64)']
  ) {
    assert(wat.includes(want), `expected ${want} in:\n${wat}`);
  }
  assert(
    !/\b(1[0-2][0-9])\b/.test(wat.replace(/\$\w+/g, '')),
    `a type printed as a byte in:\n${wat}`,
  );
});
