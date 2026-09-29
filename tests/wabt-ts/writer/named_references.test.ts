// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `wasm2wat` prints a reference by its target's NAME (2026-09-29).
//
// Definitions printed their names since N1, but every reference printed an
// index — `call 15` beside `(func $__str_char_at …)`. Upstream `wasm2wat` runs
// `ApplyNames` for exactly this, and `wasm-tools print` agrees. The writer now
// resolves each reference through the SAME rule its definition prints by
// (`shown`), with the index space said at every call site, so:
//   - every index space is covered (the compiler names each site);
//   - a reference never names something the text does not declare;
//   - a name two entities of one space would both print is not used, so a
//     printed name can never re-assemble to a different entity;
//   - text PARSED by the caller keeps the author's indices (`toText()`), as
//     N8 does for labels.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertStringIncludes } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { writeWatModule } from '../../../src/wabt-ts/writer/wat-writer.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { formatErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import wabt from '../../../src/wabt-ts/api/wabt-compat.ts';

/** Every known section, as `id: hex` — custom sections (names, text-form) aside. */
function sections(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let i = 8;
  while (i < bytes.length) {
    const id = bytes[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const b = bytes[i++]!;
      size += (b & 0x7f) * 2 ** s;
      if ((b & 0x80) === 0) break;
    }
    if (id !== 0) {
      out.push(
        `${id}: ${
          [...bytes.subarray(i, i + size)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
        }`,
      );
    }
    i += size;
  }
  return out;
}

function asm(text: string): Uint8Array {
  const r = wat2wasm(text, { textForm: false });
  assertEquals(r.errors.length, 0, formatErrors(r.errors));
  return r.binary;
}

/** One module with a NAMED entity in every index space, referenced from every kind of site. */
const ALL_SPACES = `(module
  (type $sig (func (param i32) (result i32)))
  (type $pair (struct (field $left (mut i32)) (field $right (mut i32))))
  (import "env" "imp" (func $imp (type $sig)))
  (table $tab0 1 funcref) ;; table 0, whose index the writer omits — so $tab is PRINTED
  (table $tab 2 funcref)
  (memory $mem 1)
  (memory $mem2 1)
  (global $g (mut i32) (i32.const 0))
  (tag $err (param i32))
  (func $f (type $sig) (param $x i32) (result i32)
    (local $p (ref null $pair))
    (local.set $p (struct.new $pair (local.get $x) (i32.const 2)))
    (struct.set $pair $right (local.get $p) (i32.const 3))
    (global.set $g (struct.get $pair $left (local.get $p)))
    (block $b (type $sig) (local.get $x))
    (drop)
    (i32.store $mem2 (i32.const 0) (i32.const 1))
    (memory.init $mem2 $d (i32.const 0) (i32.const 0) (i32.const 1))
    (data.drop $d)
    (table.init $tab $e (i32.const 0) (i32.const 0) (i32.const 1))
    (elem.drop $e)
    (drop (ref.cast (ref null $pair) (local.get $p)))
    (drop (ref.null $sig))
    (call_indirect $tab (type $sig) (global.get $g) (i32.const 0)))
  (func $thrower (param i32) (throw $err (local.get 0)))
  (func $start)
  (start $start)
  (export "f" (func $f))
  (export "g" (global $g))
  (export "mem" (memory $mem))
  (export "tab" (table $tab))
  (export "err" (tag $err))
  (elem $e (table $tab) (i32.const 0) func $f $imp)
  (data $d (memory $mem) (i32.const 0) "x"))`;

describe('wasm2wat names every kind of reference by its target', () => {
  const bytes = asm(ALL_SPACES);
  const text = wasm2wat(bytes, { fold: true }).text.replace(/\s+/g, ' ');

  for (
    const [space, want] of [
      ['func: call_indirect, a func type use', '(type $sig)'],
      ['func: an export', '(export "f" (func $f))'],
      ['func: the start function', '(start $start)'],
      ['func: an elem segment', 'func $f $imp'],
      ['global: global.set / global.get', '(global.set $g'],
      ['global: an export', '(export "g" (global $g))'],
      ['table: call_indirect', 'call_indirect $tab (type $sig)'],
      ['table: table.init', '(table.init $tab $e'],
      ['table: an elem segment', '(elem $e (table $tab)'],
      ['memory: a store', '(i32.store $mem2'],
      ['memory: memory.init, memory first', '(memory.init $mem2 $d'],
      ['memory: an export', '(export "mem" (memory $mem))'],
      ['tag: throw', '(throw $err'],
      ['tag: an export', '(export "err" (tag $err))'],
      ['type: a heap type inside a local', '(local $p (ref null $pair))'],
      ['type: struct.new', '(struct.new $pair'],
      ['type: ref.cast', '(ref.cast (ref null $pair)'],
      ['type: ref.null', '(ref.null $sig)'],
      ['type: a block type', 'block $b (type $sig)'],
      ['field: struct.set', '(struct.set $pair $right'],
      ['field: struct.get', '(struct.get $pair $left'],
      ['data: data.drop', '(data.drop $d)'],
      ['elem: elem.drop', '(elem.drop $e)'],
    ] as const
  ) {
    it(space, () => assertStringIncludes(text, want));
  }

  it('prints no numeric reference to a named entity', () => {
    for (
      const bad of [
        'call_indirect 0',
        '(type 0)',
        '(type 1)',
        'global.get 0',
        'global.set 0',
        '(ref null 1)',
        '(start 3)',
        '(throw 0',
        'data.drop 0',
        'elem.drop 0',
      ]
    ) {
      assert(!text.includes(bad), `found "${bad}" in:\n${text}`);
    }
  });

  it('re-assembles to the same bytes — every name resolved to the same entity', () => {
    for (const fold of [true, false]) {
      const back = asm(wasm2wat(bytes, { fold }).text);
      assertEquals(sections(back), sections(bytes), `fold: ${fold}`);
    }
  });
});

describe('duplicate names never re-assemble to the wrong entity', () => {
  // Two functions both named "f" in the name section; function 1 calls 0.
  // The reader keeps the section raw (it cannot hold it exactly — C5, N7) and
  // names them $f / $f.1, as upstream wabt's GetUniqueName does.
  const H = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const sec = (id: number, body: number[]) => [id, body.length, ...body];
  const str = (s: string) => [s.length, ...new TextEncoder().encode(s)];
  const funcNames = [2, 0, ...str('f'), 1, ...str('f')];
  const bytes = new Uint8Array([
    ...H,
    ...sec(1, [1, 0x60, 0, 0]),
    ...sec(3, [2, 0, 0]),
    ...sec(10, [2, 2, 0, 0x0b, 4, 0, 0x10, 0x00, 0x0b]),
    ...sec(0, [...str('name'), 1, funcNames.length, ...funcNames]),
  ]);

  it('prints each by its own unique name', () => {
    const text = wasm2wat(bytes, { fold: false }).text;
    assertStringIncludes(text, '(func $f (type 0))');
    assertStringIncludes(text, 'call $f');
  });

  it('and gives back the same bytes, name section included', () => {
    const back = wat2wasm(wasm2wat(bytes).text, { textForm: false }).binary;
    assertEquals([...back], [...bytes]);
  });

  it('a name two entities would both print is not used for either (the guard)', () => {
    // Reachable only if a reader ever failed to make names unique: force it.
    const errors = makeErrorList();
    const m = readBinaryIr(asm('(module (func $a) (func $b (call $a)))'), errors);
    m.functions[1]!.name = '$a';
    const text = writeWatModule(m, { namedReferences: true, fold: false });
    assertStringIncludes(text, 'call 0');
  });
});

describe('what is NOT named', () => {
  it("text the caller PARSED keeps the author's indices (toText)", async () => {
    const w = await wabt();
    const text = w.parseWat('t.wat', '(module (func $f) (func (call 0)))').toText();
    assertStringIncludes(text, 'call 0');
  });

  it('an entity with no name prints its index — nothing is invented', () => {
    const text = wasm2wat(
      asm('(module (type (func)) (func (call 0)) (global i32 (i32.const 1)))'),
    ).text;
    assertStringIncludes(text, 'call 0');
    assert(!text.includes('$'), text);
  });

  it('without the name section every reference is an index', () => {
    const text = wasm2wat(asm(ALL_SPACES), { readDebugNames: false }).text;
    assert(!/\$(f|g|sig|pair|tab|mem|err|d|e)\b/.test(text), text);
  });
});
