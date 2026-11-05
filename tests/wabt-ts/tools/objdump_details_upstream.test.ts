// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Divergence CL7 (owner, 2026-11-05: upstream's flags and lines): the details lines we print are
// upstream wabt 1.0.41's `wasm-objdump -x` lines, character for character. The expected text below
// is the oracle's output for the same modules (assembled by upstream `wat2wasm --debug-names`).
// They were `-> ()` / `-> (i32)`, `sig=?`, `<$add>`, `mutable` with no value, limits without their
// maximum or `i64`, and exports without the function's name.
//
// Not covered, as not yet printed: upstream's Table, Memory, Global, Start, Elem, Code, Data,
// Tag and Custom details (CL7's remaining part).

import { describe, it } from 'node:test';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmObjdump } from '../../../src/tools/wasm-objdump.ts';
import { allFeatures } from '../../../src/core/feature.ts';

const details = (wat: string): string[] => {
  const bytes = wat2wasm(wat, { features: allFeatures() }).binary;
  const text = wasmObjdump(bytes, { headers: false, details: true }).text;
  return text.split('\n').slice(text.split('\n').indexOf('Section Details:') + 2)
    .filter((l) => l !== '');
};

describe('CL7 — wasm-objdump -x prints upstream’s lines', () => {
  it('types, imports of every kind, functions and exports, with a name section', () => {
    const wat = `(module
      (type $t0 (func (param i32 i64) (result i32)))
      (type $t1 (func))
      (type $t2 (func (param f32) (result f64 i32)))
      (import "env" "imp" (func $imp (type $t1)))
      (import "env" "imp2" (func (type $t0)))
      (import "env" "tab" (table 2 10 funcref))
      (import "env" "tab2" (table i64 1 externref))
      (import "env" "mem" (memory 1 4))
      (import "env" "mem64" (memory i64 2))
      (import "env" "g" (global $g (mut i32)))
      (import "env" "g2" (global f64))
      (import "env" "tg" (tag (param i32)))
      (func $add (type $t0) (i32.add (local.get 0) (i32.wrap_i64 (local.get 1))))
      (func (type $t1))
      (func $three (type $t2) (f64.const 0) (i32.const 1))
      (export "add" (func $add))
      (export "anon" (func 3))
      (export "gexp" (global $g))
      (export "m" (memory 0))
      (export "t" (table 0))
      (export "ex" (tag 0)))`;
    assertEquals(details(wat), [
      'Type[4]:',
      ' - type[0] (i32, i64) -> i32',
      ' - type[1] () -> nil',
      ' - type[2] (f32) -> (f64, i32)',
      ' - type[3] (i32) -> nil',
      'Import[9]:',
      ' - func[0] sig=1 <imp> <- env.imp',
      ' - func[1] sig=0 <env.imp2> <- env.imp2',
      ' - table[0] type=funcref initial=2 max=10 <- env.tab',
      ' - table[1] type=externref initial=1 i64 <- env.tab2',
      ' - memory[0] pages: initial=1 max=4 <- env.mem',
      ' - memory[1] pages: initial=2 i64 <- env.mem64',
      ' - global[0] i32 mutable=1 <- env.g',
      ' - global[1] f64 mutable=0 <- env.g2',
      ' - tag[0] sig=3 <env.tg> <- env.tg',
      'Function[3]:',
      ' - func[2] sig=0 <add>',
      ' - func[3] sig=1 <anon>',
      ' - func[4] sig=2 <three>',
      'Export[6]:',
      ' - func[2] <add> -> "add"',
      ' - func[3] <anon> -> "anon"',
      ' - global[0] -> "gexp"',
      ' - memory[0] -> "m"',
      ' - table[0] -> "t"',
      ' - tag[0] -> "ex"',
    ]);
  });

  it('shared and custom-page-size memories; the last export names a function', () => {
    const wat = `(module
      (import "a" "f" (func (param i32)))
      (import "a" "m" (memory 1 2 shared))
      (import "a" "p" (memory 3 (pagesize 1)))
      (import "a" "t" (tag (param i64 f32)))
      (func (export "first") (export "second") (result i32 i64) (i32.const 0) (i64.const 0))
      (func (export "g") (param i32) (local.get 0) (call 0))
      (func))`;
    assertEquals(details(wat), [
      'Type[4]:',
      ' - type[0] (i32) -> nil',
      ' - type[1] (i64, f32) -> nil',
      ' - type[2] () -> (i32, i64)',
      ' - type[3] () -> nil',
      'Import[4]:',
      ' - func[0] sig=0 <a.f> <- a.f',
      ' - memory[0] pages: initial=1 max=2 shared <- a.m',
      ' - memory[1] pages: initial=3 (pagesize 1) <- a.p',
      ' - tag[0] sig=1 <a.t> <- a.t',
      'Function[3]:',
      ' - func[1] sig=2 <second>',
      ' - func[2] sig=0 <g>',
      ' - func[3] sig=3',
      'Export[3]:',
      ' - func[1] <second> -> "first"',
      ' - func[1] <second> -> "second"',
      ' - func[2] <g> -> "g"',
    ]);
  });
});
