// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Semantic-correctness fixes found by measuring V8 VALIDITY rather than parse
// success. "Parses clean" had been the yardstick for the tranche work, but a
// module can parse perfectly and still encode to bytes V8 rejects -- at the
// time of writing, 230 of 257 spec-testsuite files parsed clean while only
// 180 had every module V8-validate. These are three of that gap's causes.
//
//   1. PACKED TYPES ENCODED WITH THE WRONG BYTES. `Type.I8` / `Type.I16` were
//      0x7a / 0x79, chosen by continuing the numeric value-type sequence
//      (v128 = 0x7b). The GC proposal does not continue it there: i8 is -0x08
//      (0x78) and i16 is -0x09 (0x77). wabt-ts's own binary writer therefore
//      emitted packed struct/array fields V8 rejects outright with "invalid
//      value type 0x7a". It was invisible through the bridge because
//      binaryen-ts re-encodes its own way, and invisible to the parse metric
//      because the text parsed fine.
//
//   2. `br_table` NEVER RESOLVED ITS INDEX EXPRESSION. The case resolved the
//      label targets but did not recurse into `e.value`, the i32 index. The
//      visitor DOES walk it, so the writer reached names the resolver never
//      touched -- emitting index 0, or throwing on the fail-loud guard. Same
//      class as the br_if.value fix (Bug F).
//
//   3. `try_table` NEVER RESOLVED ITS CATCH CLAUSES. Body only. A
//      `try_table (catch $e $l)` emitted tag 0 and label 0, silently
//      dispatching the wrong tag to the wrong block. Per the spec the catch
//      clauses are checked in the context extended with the try_table's own
//      label, so they resolve inside the label push.
//
// The final test is a standing guard for the whole class: after resolveNames,
// no name-var may survive anywhere in the IR.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWastScript, parseWatModule } from '../../src/parser/wast-parser.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/core/error.ts';
import { heapTypeNameToType, Type } from '../../src/core/types.ts';
import type { Module } from '../../src/ir/ir.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(binary: Uint8Array): boolean {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

describe('packed GC storage types use the spec wire bytes', () => {
  it('Type.I8 is 0x78 and Type.I16 is 0x77', () => {
    // The enum values ARE the wire encodings elsewhere in this codebase, so
    // pin them: 0x7a / 0x79 produced binaries V8 rejected outright.
    assertEquals(Type.I8, 0x78);
    assertEquals(Type.I16, 0x77);
  });

  const cases: ReadonlyArray<readonly [string, string, number]> = [
    ['struct i8', '(module (type $s (struct (field (mut i8)))))', 0x78],
    ['struct i16', '(module (type $s (struct (field (mut i16)))))', 0x77],
    ['array i8', '(module (type $a (array (mut i8))))', 0x78],
    ['array i16', '(module (type $a (array (mut i16))))', 0x77],
  ];
  for (const [name, wat, byte] of cases) {
    it(`${name} encodes ${byte.toString(16)} and V8 accepts it`, () => {
      const binary = compile(wat);
      assert(binary.includes(byte), `expected 0x${byte.toString(16)} in the type section`);
      assert(v8Accepts(binary), `V8 rejected ${name}`);
    });
  }

  it('a mixed struct keeps every field type distinct', () => {
    const binary = compile('(module (type $s (struct (field i8) (field i16) (field i32))))');
    assert(v8Accepts(binary));
    assert(binary.includes(0x78) && binary.includes(0x77) && binary.includes(0x7f));
  });
});

describe('br_table resolves its index expression', () => {
  it('a call in the index position keeps its function reference', async () => {
    // $pick is function index 0; an unresolved name-var here emitted index 0
    // by luck or threw on the writer's guard. Make $pick index 1 so a
    // silently-emitted 0 would call the wrong function.
    const binary = compile(`(module
      (func $decoy (result i32) (i32.const 0))
      (func $pick (result i32) (i32.const 1))
      (func (export "f") (result i32)
        (block $a
          (block $b
            ;; targets are [$b], default $a -- index 0 goes to $b, else $a
            (br_table $b $a (call $pick)))
          (return (i32.const 111)))
        (i32.const 222)))`);
    assert(v8Accepts(binary));
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    // $pick returns 1 -> default target $a -> 222. Had the index expression
    // silently resolved to func 0 ($decoy, returning 0) it would hit $b -> 111.
    assertEquals((instance.exports.f as () => number)(), 222);
  });

  it('resolveNames leaves no name-var in br_table.value', () => {
    const { module, errors } = parseWatModule(`(module
      (func $decoy (result i32) (i32.const 0))
      (func $pick (result i32) (i32.const 1))
      (func (block $a (block $b (br_table $b $a (call $pick))))))`);
    assert(!hasErrors(errors), formatErrors(errors));
    resolveNames(module, errors);
    assert(!hasErrors(errors), formatErrors(errors));
    const f = module.funcs[2]!;
    const json = JSON.stringify(f.body);
    assert(!json.includes('"name":"$pick"'), 'br_table.value still holds a name-var');
  });
});

describe('try_table resolves its catch clauses', () => {
  it('dispatches the named tag to the named block', async () => {
    // $e2 is tag index 1, so emitting tag 0 would dispatch the wrong tag.
    const binary = compile(`(module
      (tag $e1 (param i32))
      (tag $e2 (param i32))
      (func (export "f") (param i32) (result i32)
        (block $outer (result i32)
          (block $inner (result i32)
            (try_table (result i32) (catch $e2 $outer)
              (if (i32.eq (local.get 0) (i32.const 1))
                (then (throw $e2 (i32.const 99))))
              (i32.const 5))))))`);
    assert(v8Accepts(binary));
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    const f = instance.exports.f as (n: number) => number;
    assertEquals(f(0), 5, 'no throw path');
    assertEquals(f(1), 99, 'thrown $e2 caught and routed to $outer');
  });

  it('routes a caught exception past an intervening block', async () => {
    // NOTE: this case does NOT by itself pin the depth convention -- it was
    // checked against both conventions and passes under either, because the
    // candidate targets are type-compatible. The test below is the one that
    // actually discriminates; this one covers the nesting behaviour.
    const binary = compile(`(module
      (tag $e (param i32))
      (func (export "f") (param i32) (result i32)
        (block $outer (result i32)
          (i32.add
            (block $inner (result i32)
              (try_table (result i32) (catch $e $outer)
                (if (local.get 0) (then (throw $e (i32.const 5))))
                (i32.const 1)))
            (i32.const 100)))))`);
    assert(v8Accepts(binary));
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    const f = instance.exports.f as (n: number) => number;
    assertEquals(f(1), 5, 'caught at $outer; 105 would mean it hit $inner');
    assertEquals(f(0), 101, 'no throw: 1 + 100');
  });

  it('a catch targeting the immediately enclosing block encodes depth 0', () => {
    // THE discriminating case, and the spec-testsuite shape that exposed the
    // off-by-one. Catch targets resolve in the ENCLOSING scope, with the
    // try_table's own label NOT pushed. Verified against V8 by emitting
    // depths 0/1/2 for this shape: only 0 is accepted. Confirmed to fail if
    // the resolution order is reverted.
    assert(v8Accepts(compile(`(module
      (tag $e0)
      (func (export "f") (param i32) (result i32)
        (block $h
          (try_table (result i32) (catch $e0 $h)
            (if (i32.eqz (local.get 0)) (then (throw $e0)) (else))
            (i32.const 42))
          (return))
        (i32.const 23)))`)));
  });
});

describe('resolveNames leaves no unresolved name-var (standing guard)', () => {
  /**
   * Walk an object graph and collect every `{ kind: 'name' }` Var still
   * present, keyed by `<exprKind>.<field>`.
   *
   * `ref.null`'s refType is excluded BY DESIGN: an abstract heap-type keyword
   * (`func`, `any`, …) is not a name in any index space and stays a name-var
   * for `writeHeapType` to encode as a single negative byte.
   */
  function survivors(node: unknown, kind: string, out: Set<string>): void {
    if (node === null || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (typeof o.kind === 'string' && 'loc' in o) kind = o.kind as string;
    for (const [k, v] of Object.entries(o)) {
      if (v === null || typeof v !== 'object') continue;
      const vv = v as Record<string, unknown>;
      if (vv.kind === 'name' && typeof vv.name === 'string') {
        // An ABSTRACT heap-type keyword (`func`, `any`, `array`, …) is not a
        // name in any index space — it stays a name-var for the writer to
        // encode as a single negative byte. Only a `$T` reference to a
        // user-defined type must resolve. Keying this off the KEYWORD rather
        // than the field name is what makes it correct for `ref.null.refType`,
        // `ref.test`/`ref.cast` heap types, and typed-ref value types alike.
        if (heapTypeNameToType(vv.name) !== null) continue;
        out.add(`${kind}.${k}`);
        continue;
      }
      if (Array.isArray(v)) {
        for (const item of v) survivors(item, kind, out);
        continue;
      }
      survivors(v, kind, out);
    }
  }

  /**
   * Walk the WHOLE module, not just function bodies.
   *
   * The body-only version missed `(sub $super)` supertypes entirely — they
   * live on a type-section entry — and the writer's fail-loud guard caught
   * that instead. A guard scoped narrower than the thing it guards is a guard
   * with a blind spot.
   */
  function moduleSurvivors(module: Module) {
    const out = new Set<string>();
    for (const [key, v] of Object.entries(module)) {
      if (key !== 'funcs' && Array.isArray(v)) {
        for (const item of v) survivors(item, key, out);
      }
    }
    for (const f of module.funcs) for (const b of f.body) survivors(b, 'body', out);
    return out;
  }

  it('holds across a spread of name-bearing constructs', () => {
    const wat = `(module
      (type $ft (func (param i32) (result i32)))
      (rec (type $ra (sub (struct (field i32))))
           (type $rb (sub $ra (struct (field i32) (field i64)))))
      (tag $e (param i32))
      (memory $mem 1)
      (table $tab 4 funcref)
      (global $g (mut i32) (i32.const 0))
      (data $d "abcd")
      (elem $el func $callee)
      (func $callee (type $ft) (local.get 0))
      (func (export "f") (param $p i32) (result i32)
        (local $l i32)
        (global.set $g (local.get $p))
        (local.set $l (call $callee (global.get $g)))
        (i32.store $mem (i32.const 0) (local.get $l))
        (memory.init $mem $d (i32.const 0) (i32.const 0) (i32.const 4))
        (table.init $tab $el (i32.const 0) (i32.const 0) (i32.const 1))
        (drop (call_indirect $tab (type $ft) (i32.const 1) (i32.const 0)))
        (block $out (result i32)
          (block $b
            (br_table $b $out (call $callee (i32.const 1))))
          (try_table (result i32) (catch $e $out)
            (throw $e (i32.const 7)))))
      )`;
    const { module, errors } = parseWatModule(wat);
    assert(!hasErrors(errors), formatErrors(errors));
    resolveNames(module, errors);
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals([...moduleSurvivors(module)], [], 'unresolved name-vars survived resolveNames');
  });

  it('holds across the whole spec testsuite', () => {
    // `wasmtk/` is a gitignored sibling checkout; skip when absent.
    const dir = 'wasmtk/tests/module/wasm_wast/testsuite-main';
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch {
      return;
    }
    const out = new Set<string>();
    for (const e of entries) {
      if (!e.name.endsWith('.wast')) continue;
      let script;
      try {
        const r = parseWastScript(Deno.readTextFileSync(`${dir}/${e.name}`));
        if (hasErrors(r.errors)) continue;
        script = r.script;
      } catch {
        continue;
      }
      for (const cmd of script.commands) {
        if (cmd.kind !== 'module' || cmd.scriptModule.kind !== 'text') continue;
        const errs = makeErrorList();
        try {
          resolveNames(cmd.scriptModule.module, errs);
        } catch {
          continue;
        }
        if (hasErrors(errs)) continue;
        for (const [k, v] of Object.entries(cmd.scriptModule.module)) {
          if (Array.isArray(v) && k !== 'funcs') { for (const item of v) survivors(item, k, out); }
        }
        for (const f of cmd.scriptModule.module.funcs) {
          for (const b of f.body) survivors(b, 'body', out);
        }
      }
    }
    assertEquals([...out].sort(), [], 'unresolved name-vars survived resolveNames');
  });
});
