// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The WAT parser knows a branch TARGET's arity (post-M8 fix 5, found by M8d).
//
// It did not: in linear text `br` and `return` drained the whole operand stack,
// and `br_if` / `br_on_*` took a fixed two operands and dropped the padding. So
//   - a `br` carried values that belonged to earlier instructions, and a void
//     `call` (every call was pushed as a value) as though it were one;
//   - a value-less `br_if` took a stray value from below its condition;
//   - a `br_if` value from OUTSIDE the region (a block parameter) dropped out;
//   - a `br_if` carrying one value was a statement, so its consumer found
//     nothing (the reader's defect, post-M8 fix 4).
// Every one of those wrote the right BYTES — a placeholder writes nothing, and
// siblings are emitted in order — so assert the TREE; and check each module is
// valid, runs, and round-trips.
//
// `br_table` is not covered: it still takes only its index, as the binary
// reader does (divergence W9; its filter is post-M8 fix 6).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import type { Expr, Module } from '../../../src/wabt-ts/ir/ir.ts';

function parse(wat: string): Module {
  const p = parseWatModule(wat);
  assert(p.module, 'the module parses');
  return p.module;
}

/** The statements of function `f`'s outermost block, or its body when it has none. */
function stmts(m: Module, f: number): Expr[] {
  const body = m.functions[f]!.body.children;
  const b = body.find((e) => e.kind === 'block' || e.kind === 'loop');
  if (b?.kind === 'block') return b.children;
  if (b?.kind === 'loop') return b.body.children;
  return body;
}

const kinds = (es: readonly Expr[]) => es.map((e) => e.kind);

/** Valid, the same bytes through both text forms, and the export's answers. */
function runs(wat: string, calls: [string, unknown[], number][]): void {
  const bytes = wat2wasm(wat, { filename: 't.wat' }).binary;
  assert(bytes !== undefined && WebAssembly.validate(bytes as BufferSource), 'the module is valid');
  for (const fold of [true, false]) {
    const back = wat2wasm(wasm2wat(bytes, { fold }).text, { filename: 'b.wat' }).binary;
    assertEquals(back, bytes, `fold: ${fold}`);
  }
  const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {})
    .exports as Record<string, (...a: unknown[]) => number>;
  for (const [name, args, want] of calls) assertEquals(x[name]!(...args), want, name);
}

describe('the WAT parser gives a branch its target’s values', () => {
  it('a br takes only its target’s values, not the whole stack', () => {
    const wat = `(module (func (export "f") (result i32)
      block (result i32)
        i32.const 5
        i32.const 6
        br 0
      end))`;
    const [five, br] = stmts(parse(wat), 0);
    assertEquals(five?.kind, 'const');
    assert(br?.kind === 'br');
    assertEquals(kinds(br.values), ['const']);
    runs(wat, [['f', [], 6]]);
  });

  it('a void call is a statement, never a carried value', () => {
    const wat = `(module (func $v) (func (export "f") (result i32)
      block (result i32)
        i32.const 1
        call $v
        br 0
      end))`;
    const s = stmts(parse(wat), 1);
    assertEquals(kinds(s), ['const', 'call', 'br']);
    const br = s[2]!;
    assert(br.kind === 'br');
    assertEquals(kinds(br.values), ['pop'], 'the value the call left beneath it');
    runs(wat, [['f', [], 1]]);
  });

  it('a call to a function typed by a LATER (type …) is not taken for void', () => {
    const wat = `(module
      (func $one (type $t) i32.const 1)
      (func (export "f") (result i32) call $one drop i32.const 2)
      (type $t (func (result i32))))`;
    const [drop] = stmts(parse(wat), 1);
    assert(drop?.kind === 'drop');
    assertEquals(drop.value.kind, 'call');
    runs(wat, [['f', [], 2]]);
  });

  it('a value-less br_if takes no stray value from below its condition', () => {
    const wat = `(module (func (export "f") (param i32) (result i32)
      block
        i32.const 9
        local.get 0
        br_if 0
        drop
      end
      i32.const 3))`;
    const s = stmts(parse(wat), 0);
    const br = s.find((e) => e.kind === 'br');
    assert(br?.kind === 'br');
    assertEquals(br.values, []);
    runs(wat, [['f', [0], 3], ['f', [1], 3]]);
  });

  it('a br_if value from outside the region stays, as a pop', () => {
    const wat = `(module (type $p (func (param i32) (result i32)))
      (func (export "f") (param i32) (result i32)
        i32.const 4
        block (type $p)
          local.get 0
          br_if 0
          i32.const 1
          i32.add
        end))`;
    const s = stmts(parse(wat), 0);
    const add = s.find((e) => e.kind === 'binary');
    assert(add?.kind === 'binary' && add.left.kind === 'br');
    assertEquals(kinds(add.left.values), ['pop'], 'the block parameter');
    runs(wat, [['f', [0], 5], ['f', [1], 4]]);
  });

  it('a br and a return whose values are the block’s PARAMS hold them as pops', () => {
    const wat = `(module
      (type $p (func (param i32) (result i32)))
      (type $pv (func (param i32)))
      (func (export "br") (result i32)
        i32.const 4
        block (type $p)
          br 0
        end)
      (func (export "ret") (result i32)
        i32.const 6
        block (type $pv)
          return
        end
        i32.const 0))`;
    const m = parse(wat);
    const [br] = stmts(m, 0);
    assert(br?.kind === 'br');
    assertEquals(kinds(br.values), ['pop']);
    const [ret] = stmts(m, 1);
    assert(ret?.kind === 'return');
    assertEquals(kinds(ret.values), ['pop']);
    runs(wat, [['br', [], 4], ['ret', [], 6]]);
  });

  it('…and so do the FOLDED br, br_if and return, which find no child for them', () => {
    // Linear text pads while popping; the folded form takes only what it
    // finds, so the padding is `carried`'s.
    const wat = `(module
      (type $p (func (param i32) (result i32)))
      (type $pv (func (param i32)))
      (func (export "br") (result i32)
        (i32.const 4)
        (block (type $p) (br 0)))
      (func (export "brif") (param i32) (result i32)
        (i32.const 5)
        (block (type $p) (br_if 0 (local.get 0)) (i32.const 1) (i32.add)))
      (func (export "ret") (result i32)
        (i32.const 6)
        (block (type $pv) (return))
        (i32.const 0)))`;
    const m = parse(wat);
    const block = (f: number) => {
      const b = m.functions[f]!.body.children.find((e) => e.kind === 'block');
      assert(b?.kind === 'block');
      return b.children;
    };
    const [br] = block(0);
    assert(br?.kind === 'br');
    assertEquals(kinds(br.values), ['pop']);
    const add = block(1).find((e) => e.kind === 'binary');
    assert(add?.kind === 'binary' && add.left.kind === 'br');
    assertEquals(kinds(add.left.values), ['pop']);
    const [ret] = block(2);
    assert(ret?.kind === 'return');
    assertEquals(kinds(ret.values), ['pop']);
    runs(wat, [['br', [], 4], ['brif', [0], 6], ['brif', [1], 5], ['ret', [], 6]]);
  });

  it('a br_on_non_null carries all its target’s values but the last, the ref', () => {
    const wat = `(module (func (export "f") (param externref) (result i32)
      block (result (ref extern))
        local.get 0
        br_on_non_null 0
        i32.const 0
        return
      end
      drop
      i32.const 1))`;
    // The block is the drop's operand.
    const [drop] = parse(wat).functions[0]!.body.children;
    assert(drop?.kind === 'drop' && drop.value.kind === 'block');
    const br = drop.value.children.find((e) => e.kind === 'br_on');
    assert(br?.kind === 'br_on');
    assertEquals(br.values, []);
    assertEquals(br.ref.kind, 'local.get');
    runs(wat, [['f', [null], 0], ['f', [{}], 1]]);
  });

  it('a br_if carrying one value is an operand, in linear text as in folded', () => {
    const linear = `(module (func (export "f") (param i32) (result i32)
      block (result i32)
        i32.const 1
        local.get 0
        br_if 0
        i32.const 10
        i32.add
      end))`;
    const [add] = stmts(parse(linear), 0);
    assert(add?.kind === 'binary' && add.left.kind === 'br');
    runs(linear, [['f', [0], 11], ['f', [1], 1]]);
  });

  it('a return takes only the FUNCTION’s results, however deep it sits', () => {
    const wat = `(module (func (export "f") (result i32)
      block
        i32.const 1
        i32.const 2
        return
      end
      i32.const 0))`;
    const s = stmts(parse(wat), 0);
    const ret = s.find((e) => e.kind === 'return');
    assert(ret?.kind === 'return');
    assertEquals(kinds(ret.values), ['const']);
    assertEquals(kinds(s), ['const', 'return']);
    runs(wat, [['f', [], 2]]);
  });

  // Every carrier, in both forms, takes its label out of scope at its end: a
  // `br 0` AFTER it targets the function (one i32), not the void carrier.
  const CARRIERS: [string, string][] = [
    ['block', 'block end'],
    ['loop', 'loop end'],
    ['if', 'i32.const 0 if nop else nop end'],
    ['try', 'try nop catch_all end'],
    ['try_table', 'try_table end'],
    ['folded block', '(block)'],
    ['folded loop', '(loop)'],
    ['folded if', '(if (i32.const 0) (then) (else))'],
    ['folded try', '(try (do) (catch_all))'],
    ['folded try_table', '(try_table)'],
  ];
  for (const [name, carrier] of CARRIERS) {
    it(`a ${name} ends its label’s scope`, () => {
      const wat = `(module (func (export "f") (result i32) ${carrier} i32.const 3 br 0))`;
      const body = parse(wat).functions[0]!.body.children;
      const br = body[body.length - 1];
      assert(br?.kind === 'br');
      assertEquals(kinds(br.values), ['const']);
      runs(wat, [['f', [], 3]]);
    });
  }

  it('a br_on_null to a void target falls through with the ref: an operand', () => {
    const wat = `(module (func (export "f") (param externref) (result i32)
      block
        local.get 0
        br_on_null 0
        drop
        i32.const 1
        return
      end
      i32.const 0))`;
    const [drop] = stmts(parse(wat), 0);
    assert(drop?.kind === 'drop');
    assertEquals(drop.value.kind, 'br_on');
    runs(wat, [['f', [null], 0], ['f', [{}], 1]]);
  });

  it('a label is found by NAME, the innermost of that name; by depth likewise', () => {
    // Two labels named $out: the outer block carries one i32, the inner loop
    // nothing. `br_if $out` is the LOOP's, so it carries nothing; `br 1` is
    // the block's, so it carries the 7.
    const wat = `(module (func (export "f") (result i32)
      block $out (result i32)
        loop $out
          i32.const 0
          br_if $out
          i32.const 7
          br 1
        end
        i32.const 8
      end))`;
    const loop = stmts(parse(wat), 0).find((e) => e.kind === 'loop');
    assert(loop?.kind === 'loop');
    const [byName, byDepth] = loop.body.children.filter((e) => e.kind === 'br');
    assert(byName?.kind === 'br' && byDepth?.kind === 'br');
    assertEquals(byName.values, []);
    assertEquals(kinds(byDepth.values), ['const']);
    runs(wat, [['f', [], 7]]);
  });

  it('a loop’s label carries its PARAMS, not its results', () => {
    // One param, no results: a branch back carries one value, and the
    // fall-through carries none.
    const wat = `(module (type $q (func (param i32)))
      (func (export "f") (param i32) (result i32)
        i32.const 0
        loop $l (type $q)
          i32.const 1
          i32.add
          local.get 0
          br_if $l
          drop
        end
        i32.const 5))`;
    const loop = parse(wat).functions[0]!.body.children.find((e) => e.kind === 'loop');
    assert(loop?.kind === 'loop');
    const [drop] = loop.body.children;
    assert(drop?.kind === 'drop' && drop.value.kind === 'br');
    assertEquals(kinds(drop.value.values), ['binary']);
    runs(wat, [['f', [0], 5]]);
  });

  it('a br by name to a loop takes the loop’s params', () => {
    const wat = `(module (type $p (func (param i32) (result i32)))
      (func (export "f") (param i32) (result i32)
        i32.const 0
        loop $l (type $p)
          i32.const 1
          i32.add
          local.get 0
          br_if $l
          local.get 0
          drop
        end))`;
    const loop = parse(wat).functions[0]!.body.children.find((e) => e.kind === 'loop');
    assert(loop?.kind === 'loop');
    const br = loop.body.children.find((e) => e.kind === 'br');
    assert(br?.kind === 'br');
    assertEquals(kinds(br.values), ['binary']);
    runs(wat, [['f', [0], 1]]);
  });
});
