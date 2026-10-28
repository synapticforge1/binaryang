// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 23, E4: `wasm-interp` — the interpreter as a CLI. The interpreter
// itself is held by `bun run interp` and `interpreter.test.ts`; this pins the
// tool's own surface: which exports run, how an argument is read, how a
// result, a trap and a stop are printed.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { interpModule, showInvocation } from '../../../src/tools/wasm-interp.ts';

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

// `MOD` imports a function, which only `--dummy-import-func` supplies: without it the module is
// refused before anything runs, as upstream (divergence CL10, 2026-10-28).
const dummy = { dummyImportFunc: true } as const;

describe('wasm-interp', () => {
  it('runs one export with written arguments', () => {
    expect(lines(interpModule(MOD, { ...dummy, runExport: 'add', args: ['2', '-3'] }))).toEqual([
      // Unsigned, as upstream (divergence CL11): -3 and -1 as 32-bit patterns.
      'add(i32:2, i32:4294967293) => i32:4294967295',
    ]);
    expect(lines(interpModule(MOD, { ...dummy, runExport: 'half', args: ['5'] }))).toEqual([
      'half(f64:5) => f64:2.5',
    ]);
    expect(() => interpModule(MOD, { ...dummy, runExport: 'nope' })).toThrow(
      'no exported function "nope"',
    );
  });

  it('refuses an import it cannot supply before running anything, as upstream', () => {
    expect(() => interpModule(MOD, { runExport: 'add', args: ['1', '2'] })).toThrow(
      'error initializing module: invalid import "env.f"',
    );
  });

  it('--run-all-exports runs the exports that take no arguments; a trap is named, never a value', () => {
    // add, div and half take parameters: skipped, as upstream (they ran with zeros — CL10).
    expect(lines(interpModule(MOD, { ...dummy, runAllExports: true }))).toEqual([
      'host() => i32:0',
    ]);
    expect(lines(interpModule(MOD, { ...dummy, runExport: 'div', args: ['1', '0'] }))).toEqual([
      'div(i32:1, i32:0) => trap: integer divide by zero',
    ]);
  });

  // 🔧 A v128 default was `ref.null`: every export taking a v128, and every
  // stand-in import returning one, stopped as `invalid` on a valid module
  // (open-work 13, the code lens: the spec's relaxed-SIMD modules, run whole).
  it('defaults a v128 argument, and a stand-in v128 result, to zero', () => {
    const simd = readForPasses(
      wat2wasm(
        `(module
          (import "env" "v" (func $v (result v128)))
          (func (export "not") (param v128) (result v128) (v128.not (local.get 0)))
          (func (export "host") (result v128) (call $v)))`,
        { textForm: false },
      ).binary,
    );
    // `not` takes an argument, so it is run by name; its v128 defaults to zero.
    expect(lines(interpModule(simd, { runExport: 'not', ...dummy }))).toEqual([
      'not(v128:0x00000000000000000000000000000000) => v128:0xffffffffffffffffffffffffffffffff',
    ]);
    expect(lines(interpModule(simd, { runAllExports: true, ...dummy }))).toEqual([
      'host() => v128:0x00000000000000000000000000000000',
    ]);
  });

  // 🔧 `ref.null` was passed for a NON-NULLABLE reference, and a stand-in import
  // returned it for one: results no valid execution has (spec `local_init`,
  // against V8, which refuses the call with a TypeError).
  it('does not invent a null for a non-nullable reference: the export stops', () => {
    const refs = readForPasses(
      wat2wasm(
        `(module
          (import "env" "r" (func $r (result (ref extern))))
          (func (export "id") (param (ref extern)) (result (ref extern)) (local.get 0))
          (func (export "host") (result (ref extern)) (call $r))
          (func (export "nullable") (param externref) (result i32) (ref.is_null (local.get 0))))`,
        { textForm: false },
      ).binary,
    );
    // Exports with parameters are run by name (--run-all-exports skips them, as upstream).
    const out = ['id', 'host', 'nullable'].flatMap((name) =>
      interpModule(refs, { runExport: name, ...dummy })
    );
    expect(out.map((i) => [i.name, Object.keys(i.outcome)[0]])).toEqual([
      ['id', 'stop'],
      ['host', 'stop'],
      ['nullable', 'values'],
    ]);
    expect(lines(out)[2]).toBe('nullable(ref.null) => i32:1');
  });
});
