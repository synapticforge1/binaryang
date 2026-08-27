// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Tranche 2 of the spec-testsuite parse-gap scope: six small grammar gaps.
//
//   1. Every `table.*` table index is OPTIONAL (defaults to table 0). These
//      called parseVar() unconditionally, which REPORTS an error when the
//      next token isn't a var, so bare `table.size` and
//      `(table.fill (i32.const 0) ...)` failed despite the `?? varIndex(0)`
//      fallback producing the right index.
//   2. `table.init`'s one-var form names the ELEM segment, and the two-var
//      form is `table.init $tableidx $elemidx` -- so the indices must SWAP
//      when a second var appears. The old code read segment-then-table with
//      no swap, silently transposing them (upstream wabt documents this).
//   3. `(module quote "a" "b")` concatenates its text pieces, exactly as
//      `(module binary ...)` already did. Reading a single string choked on
//      the second with "expected ), got Text".
//   4. `(either r1 r2)` alternative results -- the token and upstream's
//      ParseEither both existed, but nothing here consumed it.
//   5. `(data (global.get $g) "...")` -- the bare offset branch required
//      `(X.const ...)` specifically, so a global base fell through.
//   6. `(ref struct)` / `(ref array)` / `(ref exn)` in type position -- these
//      keywords have dedicated token types and were rejected outright.
//
// Plus the four GC array bulk instructions, which did not exist at all:
// array.fill / copy / init_data / init_elem (0xfb 0x10-0x13).
//
// Testsuite: 145 -> 179/257 clean, zero regressions, matching the projection.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWastScript } from '../../src/parser/wast-parser.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';
import { GcOpcode, PREFIX_GC } from '../../src/core/opcode.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function parses(src: string): boolean {
  return !hasErrors(parseWastScript(src).errors);
}

describe('table instructions - optional table index', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['table.size (linear)', '(module (table 1 funcref) (func (result i32) table.size))'],
    ['table.size (folded)', '(module (table 1 funcref) (func (result i32) (table.size)))'],
    [
      'table.get',
      '(module (table 1 funcref) (func (param i32) (result funcref) (table.get (local.get 0))))',
    ],
    [
      'table.set',
      '(module (table 1 externref) (func (table.set (i32.const 0) (ref.null extern))))',
    ],
    [
      'table.fill',
      '(module (table 1 externref) (func (table.fill (i32.const 0) (ref.null extern) (i32.const 1))))',
    ],
    [
      'table.grow',
      '(module (table 1 externref) (func (result i32) (table.grow (ref.null extern) (i32.const 1))))',
    ],
    [
      'table.copy',
      '(module (table 1 funcref) (func (table.copy (i32.const 0) (i32.const 0) (i32.const 0))))',
    ],
    [
      'explicit index still works',
      '(module (table $t 1 funcref) (func (result i32) (table.size $t)))',
    ],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      compile(wat);
    });
  }
});

describe('table.init index order', () => {
  const MOD = (init: string) =>
    `(module
       (func $a (result i32) (i32.const 11))
       (func $b (result i32) (i32.const 22))
       (table $t0 (export "t0") 2 funcref)
       (table $t1 (export "t1") 2 funcref)
       (elem $e0 funcref (ref.func $a))
       (elem $e1 funcref (ref.func $b))
       (func (export "go") ${init}))`;

  async function run(init: string) {
    const binary = compile(MOD(init));
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    (instance.exports.go as () => void)();
    const read = (t: WebAssembly.Table) => {
      const f = t.get(0) as (() => number) | null;
      return f === null ? null : f();
    };
    return {
      t0: read(instance.exports.t0 as WebAssembly.Table),
      t1: read(instance.exports.t1 as WebAssembly.Table),
    };
  }

  it('two-var form is (table, elem) - not transposed', async () => {
    const r = await run('(table.init $t1 $e1 (i32.const 0) (i32.const 0) (i32.const 1))');
    assertEquals(r.t1, 22, 'table 1 should hold elem 1');
    assertEquals(r.t0, null, 'table 0 must be untouched');
  });

  it('one-var form names the ELEM segment, table defaults to 0', async () => {
    const r = await run('(table.init $e1 (i32.const 0) (i32.const 0) (i32.const 1))');
    assertEquals(r.t0, 22);
    assertEquals(r.t1, null);
  });
});

describe('(module quote ...) with multiple text pieces', () => {
  it('concatenates the pieces', () => {
    assert(parses(
      '(assert_malformed (module quote "(memory 1)" "(func (drop (i32.load (i32.const 0))))") "x")',
    ));
  });
  it('single piece still works', () => {
    assert(parses('(assert_malformed (module quote "(func)") "x")'));
  });
  it('(module binary ...) multi-piece still works', () => {
    assert(parses('(assert_malformed (module binary "a" "b") "x")'));
  });
});

describe('(either ...) alternative results', () => {
  it('parses and records every alternative', () => {
    const { script, errors } = parseWastScript(
      `(module (func (export "f") (result i32) (i32.const 1)))
       (assert_return (invoke "f") (either (i32.const 1) (i32.const 2) (i32.const 3)))`,
    );
    assert(!hasErrors(errors), formatErrors(errors));
    const cmd = script.commands.find((c) => c.kind === 'assert_return');
    assert(cmd && cmd.kind === 'assert_return');
    const e = cmd.expected[0];
    assert(e && e.kind === 'either');
    assertEquals(e.alternatives.length, 3);
    assert(e.alternatives.every((a) => a.kind === 'value'));
  });
});

describe('data segment offsets', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    [
      'global.get base',
      '(module (import "e" "g" (global $g i32)) (memory 1) (data (global.get $g) "abc"))',
    ],
    ['i32.const base', '(module (memory 1) (data (i32.const 0) "abc"))'],
    ['(offset ...) form', '(module (memory 1) (data (offset (i32.const 0)) "abc"))'],
    ['(memory 0) form', '(module (memory 1) (data (memory 0) (i32.const 0) "abc"))'],
    ['passive', '(module (memory 1) (data "abc"))'],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      compile(wat);
    });
  }
});

describe('(ref H) in type position', () => {
  for (const h of ['struct', 'array', 'exn', 'any', 'eq', 'i31', 'func', 'extern', 'none']) {
    it(`(ref ${h})`, () => {
      compile(`(module (type (array (ref ${h}))))`);
    });
  }
  it('(ref null $T) still works', () => {
    compile('(module (type $T (func)) (type (array (ref null $T))))');
  });
});

describe('GC array bulk instructions', () => {
  const MOD = `(module
    (type $a (array (mut i32)))
    (type $b (array (mut i32)))
    (data $d "xyz")
    (elem $e func)
    (func (param $r (ref null $a)) (param $s (ref null $b))
      (array.fill $a (local.get $r) (i32.const 0) (i32.const 1) (i32.const 2))
      (array.copy $a $b (local.get $r) (i32.const 0) (local.get $s) (i32.const 0) (i32.const 1))
      (array.init_data $a $d (local.get $r) (i32.const 0) (i32.const 0) (i32.const 1))
      (array.init_elem $a $e (local.get $r) (i32.const 0) (i32.const 0) (i32.const 1))))`;

  function hasSeq(b: Uint8Array, ...bytes: number[]): boolean {
    outer: for (let i = 0; i + bytes.length <= b.length; i++) {
      for (let j = 0; j < bytes.length; j++) if (b[i + j] !== bytes[j]) continue outer;
      return true;
    }
    return false;
  }

  // V8 round-trip is not available for typed-ref GC code through this path --
  // `(ref $T)` coarsens to structref in the flat IR (see CLAUDE.md), so these
  // verify binary encoding, matching the GC tier tests' convention.
  it('encodes each opcode with its immediates', () => {
    const b = compile(MOD);
    assert(hasSeq(b, PREFIX_GC, GcOpcode.ArrayFill, 0), 'array.fill $a');
    assert(hasSeq(b, PREFIX_GC, GcOpcode.ArrayCopy, 0, 1), 'array.copy $a $b - dest type first');
    assert(hasSeq(b, PREFIX_GC, GcOpcode.ArrayInitData, 0, 0), 'array.init_data $a $d');
    assert(hasSeq(b, PREFIX_GC, GcOpcode.ArrayInitElem, 0, 0), 'array.init_elem $a $e');
  });

  it('round-trips through wasm2wat', () => {
    const { text, errors } = wasm2wat(compile(MOD));
    if (hasErrors(errors)) throw new Error(formatErrors(errors));
    assert(text);
    for (const op of ['array.fill', 'array.copy', 'array.init_data', 'array.init_elem']) {
      assert(text.includes(op), `${op} missing from wasm2wat output`);
    }
    compile(text); // reparses
  });
});
