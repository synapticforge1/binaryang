// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8c (cmem/ir-convergence.md, item 6 M8): `nameReferences` turns every
// reference binaryen-ts's passes read by name into that name — what the bridge
// did while rebuilding the module. Over the corpus it agrees with the bridge on
// all 49,335 references (scratch comparison, recorded in cmem); these tests
// hold the cases the corpus never reaches: `delegate`, `br_on_*`, `try_table`
// catch targets, `start`, a branch to the function frame, a branch to an `if`.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import type * as W from '../../src/wabt-ts/ir/ir.ts';
import { varIndex } from '../../src/wabt-ts/ir/ir.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../src/wabt-ts/ir/synthesize-types.ts';
import { nameEveryEntity } from '../../src/wabt-ts/ir/made-up-names.ts';
import { nameReferences } from '../../src/wabt-ts/ir/name-references.ts';

/** The optimizer route up to M8c: parse, resolve, synthesize, name. */
function load(wat: string, name = true): W.Module {
  const p = parseWatModule(wat);
  assert(p.module, 'the module parses');
  resolveNames(p.module);
  synthesizeTypes(p.module);
  if (name) nameReferences(p.module);
  return p.module;
}

/** Every node of `kind` under `root`, in document order. */
// deno-lint-ignore no-explicit-any
function all(root: unknown, kind: string): any[] {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== 'object') return;
    if ((v as { kind?: unknown }).kind === kind) out.push(v);
    for (const [k, x] of Object.entries(v)) if (k !== 'loc') walk(x);
  };
  walk(root);
  return out;
}

const name = (v: W.Var): string => {
  assertEquals(v.kind, 'name', `expected a name, got ${JSON.stringify(v)}`);
  return (v as { name: string }).name;
};

describe('M8c — nameReferences: entities', () => {
  const m = load(`(module
    (import "m" "f" (func))
    (import "m" "g" (global (mut i32)))
    (tag)
    (table 1 funcref)
    (memory 1)
    (global $g2 (mut i32) (i32.const 0))
    (elem (i32.const 0) func $named)
    (func $named)
    (func
      call 0
      call $named
      global.get 0
      global.set $g2
      i32.const 0
      call_indirect
      ref.func $named
      drop
      throw 0)
    (start 2)
    (export "f" (func 2))
    (export "g" (global 0))
    (export "t" (table 0))
    (export "m" (memory 0))
    (export "e" (tag 0)))`);
  const body = m.functions[1]!.body;

  it('names the entities text left unnamed, with the made-up scheme', () => {
    assertEquals(m.functions.map((f) => f.name), ['$named', '$func2']);
    assertEquals(m.tags[0]!.name, '$tag0');
    assertEquals(m.tables[0]!.name, '$table0');
    assertEquals(m.memories[0]!.name, 'mem0');
  });

  it('records only the names text wrote as real', () => {
    const r = m.explicitNames!;
    assertEquals([...r.functions], ['$named']);
    assertEquals([...r.globals], ['$g2']);
    assertEquals(r.tags.size, 0);
    // Every function is listed for its locals, as `wat2wasm --debug-names` lists them.
    assertEquals([...r.localsListed!].sort(), ['$func0', '$func2', '$named']);
  });

  it('calls, ref.func, globals, call_indirect tables and tags become names', () => {
    assertEquals(all(body, 'call').map((c) => name(c.func)), ['$func0', '$named']);
    assertEquals(all(body, 'ref.func').map((c) => name(c.func)), ['$named']);
    assertEquals(name(all(body, 'global.get')[0].var), '$global0');
    assertEquals(name(all(body, 'global.set')[0].var), '$g2');
    assertEquals(name(all(body, 'call_indirect')[0].table), '$table0');
    assertEquals(name(all(body, 'throw')[0].tag), '$tag0');
  });

  it("start, every export, and an active segment's table and entries become names", () => {
    assertEquals(name(m.start!), '$func2');
    assertEquals(m.exports.map((e) => name(e.var)), [
      '$func2',
      '$global0',
      '$table0',
      'mem0',
      '$tag0',
    ]);
    const seg = m.elements[0]!;
    assert(seg.kind === 'active');
    assertEquals(name(seg.tableVar), '$table0');
    assertEquals(all(seg.elemExprs, 'ref.func').map((c) => name(c.func)), ['$named']);
  });

  it('memories, locals and types stay indices, as the bridge left them', () => {
    const t = load(`(module (memory 1) (table 1 funcref) (type $t (func)) (func (local i32)
      i32.const 0 i32.load drop local.get 0 drop i32.const 0 call_indirect (type $t)))`);
    const body = t.functions[0]!.body;
    assertEquals(all(body, 'local.get')[0].var, varIndex(0));
    assertEquals(all(body, 'load')[0].memidx, varIndex(0));
    assertEquals(all(body, 'call_indirect')[0].typeVar, varIndex(0));
  });

  it("a module that already has a record (a binary's) is not named again", () => {
    const t = load('(module (func) (func $b call 0))', false);
    nameEveryEntity(t, null);
    const record = t.explicitNames;
    nameReferences(t);
    assert(t.explicitNames === record, "the reader's record is kept, not remade");
    assert(!t.explicitNames!.functions.has('$func0'), 'a made-up name must not become real');
    assertEquals(name(all(t.functions[1]!.body, 'call')[0].func), '$func0');
  });

  it('imports come first in every space; constant expressions are named too', () => {
    const t = load(`(module
      (import "m" "g" (global i32))
      (import "m" "mem" (memory 1))
      (memory 1)
      (func $f)
      (global i32 (global.get 0))
      (table 1 funcref (ref.func $f))
      (data (global.get 0) "")
      (export "m" (memory 1)))`);
    assertEquals(name(t.exports[0]!.var), 'mem1', 'the defined memory follows the imported one');
    assertEquals(name(all(t.globals[0]!.init, 'global.get')[0].var), '$global0');
    assertEquals(name(all(t.tables[0]!.init, 'ref.func')[0].func), '$f');
    assertEquals(name(all(t.dataSegments[0]!.offset, 'global.get')[0].var), '$global0');
  });

  it('an index out of range is refused, never guessed', () => {
    const t = load('(module (func))', false);
    t.functions[0]!.body.children.push({ kind: 'call', func: varIndex(9), operands: [] } as never);
    assertThrows(() => nameReferences(t), Error, 'call index 9 is out of range');
  });
});

describe('M8c — nameReferences: labels', () => {
  it('a branch names the carrier its depth reaches; the frame is `bodyFrameLabel`', () => {
    const m = load(`(module (func (param i32)
      block
        block $b
          local.get 0
          br_if 1
          br 0
          br 2
        end
      end
      local.get 0
      if
        br 0
      end))`);
    const f = m.functions[0]!;
    const [outer, inner] = all(f.body, 'block');
    assertEquals(inner.label, '$b');
    assert(outer.label !== '', 'every carrier is named');
    assertEquals(f.bodyFrameLabel, '$l0_frame');
    const brs = all(f.body, 'br').map((b) => name(b.target));
    const ifLabel = all(f.body, 'if')[0].label;
    assert(ifLabel !== '', 'an if is named, so a branch to it is expressible');
    assertEquals(brs, [outer.label, '$b', '$l0_frame', ifLabel]);
    // A made-up label is not real: it is never written.
    assertEquals(m.explicitNames!.labels.get(f.name), new Set(['$b']));
  });

  it('the frame label is clear of every label the function has', () => {
    const f = load('(module (func block $l0_frame br 1 br 0 end))').functions[0]!;
    assertEquals(f.bodyFrameLabel, '$l0_frame.1');
    assertEquals(all(f.body, 'br').map((b) => name(b.target)), ['$l0_frame.1', '$l0_frame']);
  });

  it('the frame label is numbered by the function index space, imports first', () => {
    const m = load('(module (import "m" "f" (func)) (func br 0))');
    assertEquals(m.functions[0]!.bodyFrameLabel, '$l1_frame');
  });

  it('br_table names every target and the default', () => {
    const f = load(`(module (func (param i32)
      block $a block $b local.get 0 br_table 0 1 2 end end))`).functions[0]!;
    const bt = all(f.body, 'br_table')[0];
    assertEquals(bt.targets.map(name), ['$b', '$a']);
    assertEquals(name(bt.defaultTarget), '$l0_frame');
  });

  it('br_on_* names its target', () => {
    const f = load(`(module (func (param externref)
      block $x local.get 0 br_on_null 0 drop end))`).functions[0]!;
    assertEquals(
      name(all(f.body, 'br_on_null')[0]?.target ?? all(f.body, 'br_on')[0].target),
      '$x',
    );
  });

  it("a try_table's catch targets resolve OUTSIDE its own label", () => {
    const f = load(`(module (tag $e) (func
      block $h
        try_table $tt (catch $e 0) (catch_all 0)
          br 0
        end
      end))`).functions[0]!;
    const tt = all(f.body, 'try_table')[0];
    assertEquals(tt.catches.map((c: W.TableCatch) => name(c.target)), ['$h', '$h']);
    assertEquals(name(tt.catches[0].tag), '$e');
    assertEquals(
      name(all(tt.body, 'br')[0].target),
      '$tt',
      'inside the body, depth 0 is the try_table',
    );
  });

  it('a delegate resolves OUTSIDE its try; a catch body is INSIDE it', () => {
    const f = load(`(module (tag $e) (func
      block $outer
        try $t
          try throw $e delegate 0
          try throw $e delegate 1
        catch $e
          rethrow 0
        end
      end))`).functions[0]!;
    const tries = all(f.body, 'try');
    assertEquals(tries[0].label, '$t');
    assertEquals(name(tries[1].delegate), '$t');
    assertEquals(name(tries[2].delegate), '$outer');
    assertEquals(name(all(f.body, 'rethrow')[0].target), '$t');
    assertEquals(name(tries[0].catches[0].tag), '$e');
  });
});
