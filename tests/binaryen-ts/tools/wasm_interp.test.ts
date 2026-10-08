// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 23, E4: `wasm-interp` — the interpreter as a CLI. The interpreter
// itself is held by `deno task interp` and `interpreter.test.ts`; this pins the
// tool's own surface: which exports run, how an argument is read, how a
// result, a trap and a stop are printed.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { interpModule, showInvocation } from '../../../src/binaryen-ts/tools/wasm-interp.ts';

const MOD = readForPasses(
  wat2wasm(
    `(module
      (import "env" "f" (func $f (result i32)))
      (func (export "add") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
      (func (export "div") (param i32 i32) (result i32) (i32.div_s (local.get 0) (local.get 1)))
      (func (export "half") (param f64) (result f64) (f64.mul (local.get 0) (f64.const 0.5)))
      (func (export "host") (result i32) (call $f))
      (global (export "g") i32 (i32.const 1)))`,
    { textForm: false },
  ).binary,
);

const lines = (r: ReturnType<typeof interpModule>) => r.map(showInvocation);

describe('wasm-interp', () => {
  it('runs one export with written arguments', () => {
    expect(lines(interpModule(MOD, { runExport: 'add', args: ['2', '-3'] }))).toEqual([
      'add(i32:2, i32:-3) => i32:-1',
    ]);
    expect(lines(interpModule(MOD, { runExport: 'half', args: ['5'] }))).toEqual([
      'half(f64:5) => f64:2.5',
    ]);
    expect(() => interpModule(MOD, { runExport: 'nope' })).toThrow('no exported function "nope"');
  });

  it('runs every function export with zeros; a trap and a stop are named, never a value', () => {
    expect(lines(interpModule(MOD, { runAllExports: true }))).toEqual([
      'add(i32:0, i32:0) => i32:0',
      'div(i32:0, i32:0) => trap: integer divide by zero',
      'half(f64:0) => f64:0',
      'host() => stopped: host: env.f',
    ]);
    expect(lines(interpModule(MOD, { runExport: 'host', dummyImportFunc: true }))).toEqual([
      'host() => i32:0',
    ]);
  });
});
