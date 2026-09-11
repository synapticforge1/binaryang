// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// N1 step P3 (cmem/names.md): the reader reads the name section, and
// WAT → wat2wasm → wasm2wat gives the WAT's names back — the owner's test.
//
// The reader had never read a name: it parsed the section from BEFORE its own
// name, so the string "name" was read as subsections and nothing was found. It
// knew only subsections 0 and 1 anyway, defined functions only. And wasm2wat
// invented `$f0`, `$t0`, … for every unnamed entity, which the next wat2wasm
// wrote into the name section as if the author had.
//
// Over the corpus: 63,930 of 63,930 names come back — functions, params and
// locals, labels, types, tables, memories, globals, segments, tags — and the
// round trip is a byte fixed point on all 421 modules, folded and linear.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import type { Module } from '../../../src/wabt-ts/ir/ir.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
function read(bytes: Uint8Array): Module {
  const errors = makeErrorList();
  const m = readBinaryIr(bytes, errors, { readDebugNames: true });
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  return m;
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const leb = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const str = (s: string) => {
  const b = [...new TextEncoder().encode(s)];
  return [...leb(b.length), ...b];
};
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
/**
 * Five `() -> ()` functions, the last calling the first, with the given
 * name-section payload — or no name section at all for `null`.
 */
function withNames(payload: number[] | null): Uint8Array {
  const body = (code: number[]) => [...leb(code.length + 2), 0, ...code, 0x0b];
  return new Uint8Array([
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(3, [5, 0, 0, 0, 0, 0]),
    ...section(10, [5, ...body([]), ...body([]), ...body([]), ...body([]), ...body([0x10, 0])]),
    ...(payload === null ? [] : section(0, [...str('name'), ...payload])),
  ]);
}
const funcNames = (entries: [number, string][]) => {
  const map = [...leb(entries.length), ...entries.flatMap(([i, n]) => [...leb(i), ...str(n)])];
  return [1, ...leb(map.length), ...map];
};

const PROBE = `(module $mod
  (type $sig (func (param i32) (result i32)))
  (import "env" "f" (func $imp (param $ip i32)))
  (import "env" "g" (global $ig i32))
  (import "env" "m" (memory $im 1))
  (import "env" "t" (table $it 1 funcref))
  (table $tab 1 funcref)
  (global $glob (mut i32) (i32.const 0))
  (tag $tg)
  (type $s (struct (field $x i32) (field $y i64)))
  (func $named (param $a i32) (param i32) (result i32) (local $x i32) (local i64)
    (block $outer (loop $in (br_if $outer (local.get $a)) (br $in)))
    (if (block $cond (result i32) (i32.const 1)) (then (block $inner)))
    (local.get $x))
  (func (param i32))
  (elem $e func $named)
  (data $d "hi"))`;

describe('the reader gives the name section to the module', () => {
  it('every kind, imports included, onto the definitions', () => {
    const m = read(assemble(PROBE));
    assertEquals(m.name, '$mod');
    assertEquals(
      m.imports.map((i) =>
        ('func' in i
          ? i.func
          : 'global' in i
          ? i.global
          : 'memory' in i
          ? i.memory
          : 'table' in i
          ? i.table
          : i.tag).name
      ),
      [
        '$imp',
        '$ig',
        '$im',
        '$it',
      ],
    );
    assertEquals(m.funcs.map((f) => f.name), ['$named', '']);
    assertEquals([...(m.funcs[0]!.localNames ?? [])], [[0, '$a'], [2, '$x']]);
    assertEquals(m.types.map((t) => t.name).filter((n) => n !== ''), ['$sig', '$s']);
    const s = m.types.find((t) => t.name === '$s')!;
    assert(s.kind === 'struct');
    assertEquals(s.fields.map((f) => f.name), ['$x', '$y']);
    assertEquals([m.tables[0]!.name, m.globals[0]!.name, m.tags[0]!.name], [
      '$tab',
      '$glob',
      '$tg',
    ]);
    assertEquals([m.elemSegments[0]!.name, m.dataSegments[0]!.name], ['$e', '$d']);
  });

  it("labels, by the writer's binary-order index — a folded if's condition block first", () => {
    const m = read(assemble(PROBE));
    const labels: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { for (const x of v) walk(x); }
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.label === 'string') labels.push(`${o.kind}:${o.label}`);
        for (const [k, x] of Object.entries(o)) if (k !== 'loc') walk(x);
      }
    };
    walk(m.funcs[0]!.body);
    assertEquals(
      labels.sort(),
      ['block:$cond', 'block:$inner', 'block:$outer', 'if:', 'loop:$in'].sort(),
    );
  });
});

describe("the owner's test: WAT → wat2wasm → wasm2wat gives the WAT back", () => {
  for (const fold of [true, false]) {
    it(`names come back, and the round trip is a byte fixed point (${fold ? 'folded' : 'linear'})`, () => {
      const bytes = assemble(PROBE);
      const text = wasm2wat(bytes, { fold }).text;
      for (
        const n of [
          '$mod',
          '$sig',
          '$imp',
          '$ip',
          '$named',
          '$a',
          '$x',
          '$outer',
          '$in',
          '$cond',
          '$inner',
          '$s',
          '$y',
          '$tab',
          '$glob',
          '$tg',
          '$e',
          '$d',
        ]
      ) {
        assert(text.includes(n), `lost ${n}:\n${text}`);
      }
      assert(same(assemble(text), bytes), `not a fixed point:\n${text}`);
    });
  }

  it('invents no name the WAT did not have', () => {
    const text =
      wasm2wat(assemble('(module (func (param i32) (local i32)) (global i32 (i32.const 0)))')).text;
    assert(!/\$[a-zA-Z]/.test(text), text);
    assert(text.includes('(func (;0;)'), text);
  });

  it('still invents them when asked, as upstream --generate-names', () => {
    const text = wasm2wat(assemble('(module (func))'), { generateNames: true }).text;
    assert(text.includes('$f0'), text);
  });
});

describe('names the text format cannot spell plainly', () => {
  it('print quoted, and come back as the same name', () => {
    const bytes = withNames([...funcNames([[0, 'foo bar'], [1, 'a(b)c']]), 2, 1, 0]);
    const text = wasm2wat(bytes).text;
    assert(text.includes('(func $"foo bar"') && text.includes('(func $"a(b)c"'), text);
    const back = read(assemble(text));
    assertEquals(back.funcs.slice(0, 2).map((f) => f.name), ['$foo bar', '$a(b)c']);
  });

  it('a duplicate is disambiguated as upstream does — and the section is kept as it was', () => {
    const bytes = withNames(funcNames([[2, 'dup'], [3, 'dup']]));
    const m = read(bytes);
    assertEquals(m.funcs.slice(2, 4).map((f) => f.name), ['$dup', '$dup.1']);
    // The module cannot hold two funcs named `dup`, so the section is kept raw
    // and a binary round trip writes it back exactly.
    assert(same(writeBinaryIr(m), bytes));
  });
});

describe('a binary round trip keeps what it was given', () => {
  it('a binary WITHOUT a name section does not gain one', () => {
    const bytes = withNames(null);
    assert(!new TextDecoder().decode(bytes).includes('name'));
    assert(same(writeBinaryIr(read(bytes)), bytes));
  });

  it('a name section with a subsection beyond the twelve is kept, and its names still read', () => {
    const bytes = withNames([...funcNames([[0, 'kept']]), 0x20, 0x01, 0x00]);
    const m = read(bytes);
    assertEquals(m.funcs[0]!.name, '$kept');
    assert(same(writeBinaryIr(m), bytes));
  });

  it('a malformed name section is kept as bytes, and names nothing', () => {
    const bytes = withNames([0x01, 0x05, 0x01, 0x00, 0x09]); // a name running past its subsection
    const m = read(bytes);
    assertEquals(m.funcs.map((f) => f.name), ['', '', '', '', '']);
    assert(same(writeBinaryIr(m), bytes));
  });
});
