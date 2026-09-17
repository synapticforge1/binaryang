// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, stage (c1): a block-type carrier's ENTRY VALUES are children of the
// carrier — `params: { types, values }`, binaryen-ts's shape (decision 7b(i)).
//
// 🔧 wabt-ts left them OUTSIDE the construct, as the preceding siblings a linear
// body happens to have: `i32.const 7; block (param i32) … end` read as two
// statements, a constant and a block that consumed nothing it owned. Every
// other operand in the tree is a child of the node that consumes it, branch
// values included (decision 6A); these were the one exception.
//
// The bytes do not move — which is why nothing else in the suite noticed. So
// this pins the SHAPE on every producer (binary reader, linear text, folded
// text) and that every consumer still reads it: the binary writer (bytes and
// V8), the folded text writer (its output parses back to the same bytes), name
// resolution inside an entry value, and generated label names.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import type { Expr } from '../../../src/wabt-ts/ir/ir.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';

function compile(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  assert(r.binary);
  return r.binary;
}

/** Run export `f` and return its result. */
function run(bytes: Uint8Array): unknown {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), {});
  return (inst.exports.f as () => unknown)();
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

type Carrier = Extract<Expr, { kind: 'block' | 'loop' | 'if' | 'try' | 'try_table' }>;

/** Function 0's body, from the binary and from the text. */
function bodies(wat: string): [string, readonly Expr[]][] {
  const errors = makeErrorList();
  const fromBinary = readBinaryIr(compile(wat), errors);
  assert(!hasErrors(errors), formatErrors(errors));
  const text = parseWatModule(wat);
  assert(!hasErrors(text.errors), formatErrors(text.errors));
  return [['binary reader', fromBinary.funcs[0]!.body.children], [
    'text parser',
    text.module.funcs[0]!.body.children,
  ]];
}

const TYPE = '(type $p (func (param i32) (result i32)))';

// Each fixture's function body is ONE carrier whose entry value is `i32.const 7`
// (for `if`, `i32.const 5` beneath a constant condition), and each returns a
// known answer.
const FIXTURES: { name: string; kind: Carrier['kind']; wat: string; answer: number }[] = [
  {
    name: 'block, linear',
    kind: 'block',
    wat: '(module (func (export "f") (result i32) i32.const 7 block (param i32) (result i32) end))',
    answer: 7,
  },
  {
    name: 'block, folded sibling',
    kind: 'block',
    wat: '(module (func (export "f") (result i32) (i32.const 7) (block (param i32) (result i32))))',
    answer: 7,
  },
  {
    name: 'block, named type',
    kind: 'block',
    wat: `(module ${TYPE} (func (export "f") (result i32) i32.const 7 block (type $p) end))`,
    answer: 7,
  },
  {
    name: 'loop, linear',
    kind: 'loop',
    wat: '(module (func (export "f") (result i32) i32.const 7 loop (param i32) (result i32) end))',
    answer: 7,
  },
  {
    name: 'if, linear — the value is BENEATH the condition',
    kind: 'if',
    wat: '(module (func (export "f") (result i32) i32.const 5 i32.const 0' +
      ' if (param i32) (result i32) else i32.const 4 i32.add end))',
    answer: 9,
  },
  {
    name: 'if, folded — the value is folded inside, before the condition',
    kind: 'if',
    wat: '(module (func (export "f") (result i32) (if (param i32) (result i32)' +
      ' (i32.const 5) (i32.const 0) (then) (else (i32.const 4) (i32.add)))))',
    answer: 9,
  },
  {
    name: 'try_table, linear',
    kind: 'try_table',
    wat:
      '(module (func (export "f") (result i32) i32.const 7 try_table (param i32) (result i32) end))',
    answer: 7,
  },
  {
    name: 'legacy try, linear',
    kind: 'try',
    wat: '(module (func (export "f") (result i32) i32.const 7 try (param i32) (result i32) end))',
    answer: 7,
  },
];

describe('a carrier OWNS its entry values', () => {
  for (const fx of FIXTURES) {
    it(`${fx.name}: one statement, and the value is inside it`, () => {
      for (const [path, body] of bodies(fx.wat)) {
        assertEquals(body.length, 1, `${path}: ${body.map((e) => e.kind).join(', ')}`);
        const c = body[0] as Carrier;
        assertEquals(c.kind, fx.kind, path);
        assertEquals(c.params?.types.length, 1, path);
        assertEquals(c.params?.values.map((v) => v.kind), ['const'], path);
      }
    });

    it(`${fx.name}: the bytes run, and the folded text re-assembles to them`, () => {
      const bytes = compile(fx.wat);
      assertEquals(run(bytes), fx.answer);
      const folded = wasm2wat(bytes, { fold: true }).text!;
      assert(same(compile(folded), bytes), folded);
      const linear = wasm2wat(bytes, { fold: false }).text!;
      assert(same(compile(linear), bytes), linear);
    });
  }

  it('an `if` keeps its value and its condition apart', () => {
    for (const [path, body] of bodies(FIXTURES[4]!.wat)) {
      const c = body[0] as Extract<Expr, { kind: 'if' }>;
      const [value] = c.params!.values as Extract<Expr, { kind: 'const' }>[];
      const cond = c.condition as Extract<Expr, { kind: 'const' }>;
      assertEquals(
        [
          (value!.value as { value: number }).value,
          (cond.value as { value: number }).value,
        ],
        [5, 0],
        path,
      );
    }
  });

  it('a carrier with no parameters gains no `params` key', () => {
    for (const [path, body] of bodies('(module (func (block (nop))))')) {
      assert(!('params' in body[0]!), path);
    }
  });
});

describe('what lives inside an entry value is still reached', () => {
  // The entry value is a labelled block that branches to its own label: name
  // resolution has to walk into `params.values`, in the ENCLOSING scope.
  const NESTED = '(module (func (export "f") (result i32)' +
    ' (block $v (result i32) (br $v (i32.const 7)))' +
    ' (block (param i32) (result i32))))';

  it('name resolution: `br $v` inside the value assembles to depth 0 and runs', () => {
    const bytes = compile(NESTED);
    assertEquals(run(bytes), 7);
  });

  // ⚠️ A LABEL name alone cannot show `resolveNames` walked the values: the
  // binary writer resolves label names itself, so a mutant dropping the resolved
  // values survived the whole suite. A FUNCTION name has no such fallback — the
  // writer refuses an unresolved `$seven`. One per carrier, since each is
  // rebuilt by its own arm.
  const SEVEN = '(func $seven (result i32) i32.const 7)';
  for (
    const [kind, body] of [
      ['block', '(call $seven) (block (param i32) (result i32))'],
      ['loop', '(call $seven) (loop (param i32) (result i32))'],
      ['if', '(if (param i32) (result i32) (call $seven) (i32.const 1) (then) (else))'],
      ['try', 'call $seven try (param i32) (result i32) end'],
      ['try_table', 'call $seven try_table (param i32) (result i32) end'],
      [
        'try … delegate',
        'block (result i32) call $seven try (param i32) (result i32) delegate 0 end',
      ],
    ] as const
  ) {
    it(`name resolution reaches a function name in a ${kind}'s entry value`, () => {
      assertEquals(run(compile(`(module ${SEVEN} (func (export "f") (result i32) ${body}))`)), 7);
    });
  }

  it('generated label names still reach a block inside the value, and number it first', () => {
    // UNNAMED blocks, so the names are generated: the value's block comes first
    // in the text, as it did when it was a sibling.
    const unnamed = '(module (func (export "f") (result i32)' +
      ' block (result i32) i32.const 7 br 0 end block (param i32) (result i32) end))';
    const text = wasm2wat(compile(unnamed), { generateNames: true, fold: false }).text!;
    assert(/block \$B0 \(result i32\)/.test(text), text);
    assert(/block \$B1 \(type 1\)/.test(text), text);
  });
});
