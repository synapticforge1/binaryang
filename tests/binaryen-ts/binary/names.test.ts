// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// N1 steps P4–P5 (cmem/names.md): binaryen-ts reads the name section, and
// writes it back.
//
// The decoder SKIPPED the section and built every reference name from its index
// on the spot — `$func${i}` at thirteen sites, `$global`, `$table`, `$tag`,
// `$data`, `$elem` at the rest — so `$helper` came back `$func1`. The encoder
// wrote no section, so decode → encode lost every name; and 7b(i)'s
// block-parameter lowering, which re-decodes the encoder's own output, refused
// every named module with parameters because the names came back different.
//
// Over the corpus: our named bytes decode and re-encode BYTE-IDENTICALLY,
// 421/421; every function upstream `wat2wasm --debug-names` names carries that
// name in binaryen-ts, 8,298/8,298; and upstream's name section survives
// decode → encode exactly, 421/421.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertNotEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
/** Whether the binary has a custom section named `name`. */
function hasNameSection(b: Uint8Array): boolean {
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id === 0 && b[i] === 4 && new TextDecoder().decode(b.subarray(i + 1, i + 5)) === 'name') {
      return true;
    }
    i += size;
  }
  return false;
}
/** Every name the function's body refers to or binds, as `kind:name`. */
function refsIn(m: WasmModule, fn: string): string[] {
  const out: string[] = [];
  const f = m.functions.find((x) => x.name === fn)!;
  walkExpression(f.body, (e) => {
    const o = e as unknown as Record<string, unknown>;
    for (const k of ['target', 'name', 'tag', 'var']) {
      const v = o[k];
      if (typeof v === 'string') out.push(`${e.kind}:${v}`);
      else if (v && typeof v === 'object' && 'name' in v) {
        out.push(`${e.kind}:${(v as { name: string }).name}`);
      }
    }
  });
  return out;
}

const PROBE = `(module $mod
  (import "env" "log" (func $log (param $msg i32)))
  (import "env" "t" (tag $oops (param i32)))
  (global $counter (mut i32) (i32.const 0))
  (memory $mem 1)
  (table $tab 1 funcref)
  (func $helper (param $x i32) (result i32) (local $tmp i32)
    (local.set $tmp (i32.add (local.get $x) (i32.const 1)))
    (block $done (br_if $done (i32.eqz (local.get $tmp))) (call $log (local.get $tmp)))
    (if (block $cond (result i32) (i32.const 1)) (then (throw $oops (local.get $tmp))))
    (local.get $tmp))
  (func $main (export "main") (param $n i32) (result i32)
    (global.set $counter (call $helper (local.get $n)))
    (global.get $counter))
  (elem $e (i32.const 0) func $helper)
  (data $d (i32.const 0) "hi")
  (start $init)
  (func $init))`;

describe('P4 — the decoder names every entity from the name section', () => {
  const m = parseWasm(assemble(PROBE));

  it('functions, imported and defined; globals, memories, tables, segments', () => {
    assertEquals(m.imports.map((i) => i.name), ['$log', '$oops']);
    assertEquals(m.functions.map((f) => f.name), ['$helper', '$main', '$init']);
    assertEquals(m.globals.map((g) => g.name), ['$counter']);
    assertEquals(m.memories.map((x) => x.name), ['$mem']);
    assertEquals(m.tables.map((t) => t.name), ['$tab']);
    assertEquals(m.elements.map((e) => e.name), ['$e']);
    assertEquals(m.dataSegments.map((d) => d.name), ['$d']);
  });

  it('every reference site uses the same name as the definition', () => {
    assertEquals(m.start, '$init');
    assertEquals(m.exports.find((e) => e.name === 'main')?.value, '$main');
    assertEquals(m.elements[0]!.data, ['$helper']);
    const main = refsIn(m, '$main');
    assert(main.includes('call:$helper'), main.join(' '));
    assert(main.some((r) => r.endsWith(':$counter')), main.join(' '));
    const helper = refsIn(m, '$helper');
    assert(helper.includes('call:$log'), helper.join(' '));
    assert(helper.some((r) => r.endsWith(':$oops')), helper.join(' '));
  });

  it("params and locals, as Local names; an import's params in explicitNames", () => {
    const helper = m.functions[0]!;
    assertEquals(helper.locals.map((l) => l.name), ['$x', '$tmp']);
    assertEquals([...m.explicitNames!.importParams.get('$log')!], [[0, '$msg']]);
  });

  it('labels, by binary order — the condition block before the if', () => {
    const labels: string[] = [];
    const branches: string[] = [];
    walkExpression(m.functions[0]!.body, (e) => {
      // A carrier's OWN label is `name`; a branch's REFERENCE is `target`.
      // They used to share the field name, which is what the label-reference
      // rename separated — reading one field could not tell them apart.
      const own = (e as { name?: string | null }).name;
      const ref = (e as { target?: string | null }).target;
      if (['block', 'loop', 'if', 'try', 'try_table'].includes(e.kind)) {
        if (typeof own === 'string' && !own.startsWith('$l')) {
          labels.push(`${e.kind}:${own}`); // `$l…` are made up
        }
      } else if (typeof ref === 'string') {
        branches.push(`${e.kind}:${ref}`);
      }
    });
    assertEquals(labels.sort(), ['block:$cond', 'block:$done']);
    assertEquals(branches, ['br:$done'], 'the br_if targets the named block by its name');
    assertEquals([...m.explicitNames!.labels.get('$helper')!].sort(), ['$cond', '$done']);
  });

  it('records which names are REAL — the module name too', () => {
    const x = m.explicitNames!;
    assertEquals(x.module, '$mod');
    assertEquals([...x.functions].sort(), ['$helper', '$init', '$log', '$main']);
  });
});

describe('P4 — what the section does not name', () => {
  it('an unnamed entity keeps the name the decoder always gave it', () => {
    const m = parseWasm(
      assemble('(module (func (export "a")) (func $b) (memory 1) (global i32 (i32.const 0)))'),
    );
    assertEquals(m.functions.map((f) => f.name), ['$func0', '$b']);
    assertEquals(m.memories.map((x) => x.name), ['mem0']);
    assertEquals(m.globals.map((g) => g.name), ['$global0']);
    assert(!m.explicitNames!.functions.has('$func0'), 'a made-up name is not a real one');
  });

  it('…unless the section already uses that name for something else', () => {
    // func 1 is REALLY named `func0`; the unnamed func 0 must not collide with it.
    const m = parseWasm(assemble('(module (func (export "a")) (func $func0))'));
    assertEquals(m.functions.map((f) => f.name), ['$func0.1', '$func0']);
  });

  it('a duplicate name is disambiguated, as upstream wabt does', () => {
    // wat2wasm cannot write two `$dup`s, so the section is built by hand.
    const m = parseWasm(withFuncNames(2, ['dup', 'dup']));
    assertEquals(m.functions.map((f) => f.name), ['$dup', '$dup.1']);
  });

  it('a binary with NO name section decodes as before and gains none', () => {
    const bare = withFuncNames(2, null);
    const m = parseWasm(bare);
    assertEquals(m.explicitNames, undefined);
    assertEquals(m.functions.map((f) => f.name), ['$func0', '$func1']);
    assert(same(encodeWasm(m), bare));
  });
});

/** `n` empty functions of type `() -> ()`, with a name section naming them `names` — or none. */
function withFuncNames(n: number, names: string[] | null): Uint8Array {
  const leb = (v: number) => {
    const o: number[] = [];
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v) b |= 0x80;
      o.push(b);
    } while (v);
    return o;
  };
  const str = (s: string) => [...leb(s.length), ...new TextEncoder().encode(s)];
  const sec = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
  const bodies = Array.from({ length: n }, () => [2, 0, 0x0b]).flat();
  const out = [
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...sec(1, [1, 0x60, 0, 0]),
    ...sec(3, [n, ...Array(n).fill(0)]),
    ...sec(10, [n, ...bodies]),
  ];
  if (names !== null) {
    const map = [...leb(names.length), ...names.flatMap((s, i) => [...leb(i), ...str(s)])];
    out.push(...sec(0, [...str('name'), 1, ...leb(map.length), ...map]));
  }
  return new Uint8Array(out);
}

describe('P5 — the encoder writes the names back', () => {
  it('decode → encode is byte-identical on a named module: every kind, labels too', () => {
    const bytes = assemble(PROBE);
    assert(same(encodeWasm(parseWasm(bytes)), bytes));
  });

  it('…and GC type and field names', () => {
    const bytes = assemble(`(module
      (type $point (struct (field $x i32) (field i32) (field $z f64)))
      (type $vec (array (mut i32)))
      (func $mk (result (ref $point)) (struct.new $point (i32.const 1) (i32.const 2) (f64.const 3))))`);
    const m = parseWasm(bytes);
    assertEquals([...m.explicitNames!.types.values()], ['$point', '$vec']);
    assert(same(encodeWasm(m), bytes));
  });

  it('never writes a made-up name', () => {
    const bytes = assemble('(module (func (export "a")) (func $b))');
    const back = encodeWasm(parseWasm(bytes));
    assert(same(back, bytes)); // `$func0` would have been written as "func0"
  });
});

describe('P5 — names follow -g once a pass has run', () => {
  const run = (debugInfo: boolean, passes: boolean) => {
    const m = parseWasm(assemble(PROBE));
    const runner = new PassRunner(m, { optimizeLevel: 2, debugInfo });
    if (passes) runner.addDefaultOptimizationPasses();
    runner.run();
    return encodeWasm(m);
  };

  it('optimized without -g: no name section, as upstream', () => {
    assert(!hasNameSection(run(false, true)));
  });

  it('optimized with -g: kept', () => {
    assert(hasNameSection(run(true, true)));
  });

  it('with no pass run it is still a plain read-and-write: kept', () => {
    assert(hasNameSection(run(false, false)));
  });

  it("block-parameter lowering works on a named module — it re-decodes the encoder's output", () => {
    const m = parseWasm(assemble(`(module
      (func $f (export "f") (param $a i32) (result i32)
        (local.get $a)
        (block $b (param i32) (result i32) (i32.const 1) (i32.add))))`));
    new PassRunner(m, { optimizeLevel: 2, debugInfo: true }).addDefaultOptimizationPasses().run();
    const out = encodeWasm(m);
    assert(WebAssembly.validate(out as BufferSource));
    assertEquals(m.functions[0]!.name, '$f');
  });
});

describe('P6 — `$foo` through the text route', () => {
  it('readWat: WAT → wabt-ts → bytes → decoder keeps the names', () => {
    const m = readWat('(module (func $foo (export "foo") (param $p i32) (local $q i32)))');
    assertEquals(m.functions[0]!.name, '$foo');
    assertEquals(m.functions[0]!.locals.map((l) => l.name), ['$p', '$q']);
  });
});

describe('found alongside: imported memories named by index', () => {
  it('an imported and a defined memory get different names, and exports stay put', () => {
    const m = parseWasm(assemble(`(module
      (import "env" "m" (memory 1))
      (memory 1)
      (export "a" (memory 0)) (export "b" (memory 1)))`));
    const names = [
      ...m.imports.filter((i) => i.kind === 'memory').map((i) => i.name),
      ...m.memories.map((x) => x.name),
    ];
    assertEquals(names, ['mem0', 'mem1']);
    assertNotEquals(names[0], names[1]);
    assertEquals(m.exports.map((e) => e.value), ['mem0', 'mem1']);
  });
});
