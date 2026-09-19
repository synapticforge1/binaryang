// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8d (cmem/ir-convergence.md, item 6 M8): `deriveTypes` sets every node's
// `type` over a whole module, as binaryen-ts's factories and decoder type it —
// what the bridge did by rebuilding the tree. Over the bridge corpus it agrees
// with the bridged tree on every node except the bridge's own defects, and over
// the 2,490 V8-valid spec binaries with binaryen-ts's decoder except the
// decoder's (recorded in cmem). These tests hold the rules one by one.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import type * as W from '../../../src/wabt-ts/ir/ir.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { nameReferences } from '../../../src/wabt-ts/ir/name-references.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { deriveTypes } from '../../../src/binaryen-ts/ir/derive-types.ts';
import { None, Unreachable, ValType } from '../../../src/binaryen-ts/ir/types.ts';

/** The optimizer route from text: parse, resolve, synthesize, name, derive. */
function fromText(wat: string, derive = true): W.Module {
  const p = parseWatModule(wat);
  assert(p.module, 'the module parses');
  resolveNames(p.module);
  synthesizeTypes(p.module);
  nameReferences(p.module);
  if (derive) deriveTypes(p.module);
  return p.module;
}

/** The same from a BINARY, read by wabt-ts's reader — whose tree shapes differ from text's. */
function fromBinary(wat: string): W.Module {
  const { binary } = wat2wasm(wat);
  assert(binary, 'the module assembles');
  const m = readBinaryIr(binary, makeErrorList(), { readDebugNames: true });
  nameReferences(m);
  deriveTypes(m);
  return m;
}

/**
 * Lift the operand in `slot` of `list[i]` out as the sibling BEFORE it, leaving
 * a `pop` behind in a `value`, and NOTHING in a branch's `values` (the value
 * drops out, as the binary reader's tree had it) — the tree a front end builds
 * when it does not know a value is there. Neither does so for a `br_if` since
 * post-M8 fixes 4 (the binary reader) and 5 (the WAT parser), except the reader
 * for a branch to the FUNCTION label (divergence W9) — so the shapes
 * `deriveTypes`' stack rule exists for are built here by hand.
 */
function lift(list: unknown[], i: number, slot: 'value' | 'values'): void {
  // deno-lint-ignore no-explicit-any
  const node = list[i] as any;
  const operand = slot === 'value' ? node.value : node.values[0];
  const pop = { kind: 'pop', loc: node.loc };
  const rest = slot === 'value' ? { ...node, value: pop } : { ...node, values: [] };
  list.splice(i, 1, operand, rest);
}

/** The children of function `f`'s outermost block. */
function blockOf(m: W.Module, f = 0): unknown[] {
  const b = m.functions[f]!.body.children.find((e) => e.kind === 'block');
  assert(b?.kind === 'block');
  return b.children;
}

/** Every node of `kind` under `root`, in document order. */
// deno-lint-ignore no-explicit-any
function all(root: unknown, kind: string): any[] {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if ((v as { kind?: unknown }).kind === kind) out.push(v);
    for (const [k, x] of Object.entries(v)) if (k !== 'loc') walk(x);
  };
  walk(root);
  return out;
}

/** Every expression node under `root` that has no `type`. */
function untyped(root: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    const k = (v as { kind?: unknown }).kind;
    if (
      typeof k === 'string' && k.includes('.') || k === 'region' || k === 'const' || k === 'call'
    ) {
      if ((v as { type?: unknown }).type === undefined) out.push(k as string);
    }
    for (const [key, x] of Object.entries(v)) if (key !== 'loc') walk(x);
  };
  walk(root);
  return out;
}

const I31_REF = { heapType: { kind: 'abstract', name: 'i31' }, nullable: false };

describe('M8d — deriveTypes: every node, every body and constant expression', () => {
  it('leaves no node untyped', () => {
    const m = fromText(`(module (global $g (mut i32) (i32.const 0)) (memory 1)
      (func (param i32) (result i32) (local i64)
        (local.set 1 (i64.extend_i32_u (local.get 0)))
        (global.set $g (i32.load (local.get 0)))
        (if (result i32) (local.get 0) (then (i32.const 1)) (else (global.get $g)))))`);
    assertEquals(untyped(m.functions), []);
    assertEquals(untyped(m.globals), []);
    assertEquals(m.functions[0]!.body.type, ValType.I32, "a region: its last instruction's type");
    assertEquals(m.globals[0]!.init!.type, ValType.I32, 'a constant expression is a region too');
  });

  it('reads context types as the decoder does: locals, globals, calls, tables', () => {
    const m = fromText(`(module
      (type $s (struct (field i32)))
      (global $r (mut (ref null $s)) (ref.null $s))
      (table 1 externref)
      (func $two (result i32 f64) (i32.const 1) (f64.const 2))
      (func (param (ref null $s))
        (drop (local.get 0))
        (drop (global.get $r))
        (drop (table.get 0 (i32.const 0)))
        (call $two) (drop) (drop)))`);
    const f = m.functions[1]!.body;
    const typed = { heapType: { kind: 'index', value: 0 }, nullable: true };
    assertEquals(
      all(f, 'local.get')[0].type,
      typed,
      'a typed-reference local is PRECISE (the bridge coarsened it)',
    );
    assertEquals(all(f, 'global.get')[0].type, typed);
    assertEquals(
      all(f, 'table.get')[0].type,
      ValType.ExternRef,
      "the table's element type (the decoder defaulted to funcref)",
    );
    assertEquals(all(f, 'call')[0].type, [ValType.I32, ValType.F64], 'every result');
  });

  it('a multi-value call_indirect is typed by every result, as call is', () => {
    const m = fromText(`(module (table 1 funcref)
      (func (result i32 f64) (call_indirect (result i32 f64) (i32.const 0))))`);
    assertEquals(all(m.functions[0]!.body, 'call_indirect')[0].type, [ValType.I32, ValType.F64]);
  });

  it('references and GC, as the decoder types them', () => {
    const m = fromText(`(module
      (type $s (struct (field i8) (field (ref null $s))))
      (type $a (array (mut i16)))
      (func $f)
      (func (param (ref null $s)) (param anyref) (param (ref null $a))
        (drop (ref.null func))
        (drop (ref.null $s))
        (drop (ref.func $f))
        (drop (ref.i31 (i32.const 1)))
        (drop (ref.as_non_null (local.get 0)))
        (drop (ref.cast (ref $s) (local.get 1)))
        (drop (struct.new_default $s))
        (drop (struct.get_s $s 0 (local.get 0)))
        (drop (struct.get $s 1 (local.get 0)))
        (drop (array.get_u $a (local.get 2) (i32.const 0)))
        (drop (any.convert_extern (extern.convert_any (local.get 1))))))`);
    const f = m.functions[1]!.body;
    const refS = (nullable: boolean) => ({ heapType: { kind: 'index', value: 0 }, nullable });
    assertEquals(all(f, 'ref.null').map((n) => n.type), [ValType.FuncRef, refS(true)]);
    assertEquals(all(f, 'ref.func')[0].type, ValType.FuncRef);
    assertEquals(all(f, 'ref.i31')[0].type, I31_REF, 'non-null (the bridge made it nullable)');
    assertEquals(all(f, 'ref.as')[0].type, refS(false), 'the operand made non-null');
    assertEquals(all(f, 'ref.cast')[0].type, refS(false));
    assertEquals(all(f, 'struct.new')[0].type, refS(false));
    assertEquals(
      all(f, 'struct.get').map((n) => n.type),
      [ValType.I32, refS(true)],
      'a packed field is i32',
    );
    assertEquals(all(f, 'array.get')[0].type, ValType.I32);
    assertEquals(all(f, 'any.convert_extern')[0].type, {
      heapType: { kind: 'abstract', name: 'any' },
      nullable: true,
    });
  });

  it("SIMD, atomics and memory: the factories' rules", () => {
    const m = fromText(`(module (memory 1 1 shared)
      (func
        (drop (f64x2.extract_lane 1 (v128.const i64x2 0 0)))
        (drop (v128.load8_splat (i32.const 0)))
        (drop (i64.atomic.rmw.add (i32.const 0) (i64.const 1)))
        (drop (memory.size))))`);
    const f = m.functions[0]!.body;
    assertEquals(all(f, 'simd.extract')[0].type, ValType.F64);
    const splat = [...all(f, 'load'), ...all(f, 'simd.load')][0];
    assertEquals(splat.type, ValType.V128, 'a SIMD load written as text is v128');
    assertEquals(all(f, 'atomic.rmw')[0].type, ValType.I64);
    assertEquals(all(f, 'memory.size')[0].type, ValType.I32);
  });
});

describe('M8d — deriveTypes: `pop`, typed by the value stack', () => {
  it('the extra result of a multi-value call', () => {
    const m = fromText(`(module
      (func $two (result i32 f64) (i32.const 1) (f64.const 2))
      (func (local i32) (local f64)
        call $two
        local.set 1
        local.set 0))`);
    const pops = all(m.functions[1]!.body, 'pop');
    assertEquals(
      pops.map((p) => p.type),
      [ValType.I32],
      'the DEEPER result (the bridge said i32 for every pop)',
    );
    const m2 = fromText(`(module
      (func $two (result f64 i32) (f64.const 1) (i32.const 2))
      (func (local f64) (local i32)
        call $two
        local.set 1
        local.set 0))`);
    assertEquals(all(m2.functions[1]!.body, 'pop')[0].type, ValType.F64);
  });

  it("a value an earlier instruction left: a br_if's fall-through", () => {
    const m = fromText(
      `(module (func (param i32) (result i64)
      block (result i64)
        i64.const 48
        local.get 0
        br_if 0
        drop
        i64.const 1
      end))`,
      false,
    );
    lift(blockOf(m), 0, 'value'); // drop (br_if …) -> br_if …; drop (pop)
    deriveTypes(m);
    assertEquals(all(m.functions[0]!.body, 'pop')[0].type, ValType.I64);
  });

  it("a caught exception's values, and a block's params", () => {
    const m = fromText(`(module (tag $e (param f32))
      (func
        try
          nop
        catch $e
          drop
        end
        f64.const 1
        block (param f64)
          drop
        end))`);
    assertEquals(all(m.functions[0]!.body, 'pop').map((p) => p.type), [ValType.F32, ValType.F64]);
  });

  it('in unreachable code the stack is polymorphic: `unreachable`', () => {
    const m = fromText('(module (func unreachable drop))');
    assertEquals(all(m.functions[0]!.body, 'pop')[0].type, Unreachable);
  });

  it('reachable, with nothing on the stack: refused, naming the line', () => {
    // No such module is valid; build one past the parser.
    const m = fromText('(module (func (local i32) nop))', false);
    const body = m.functions[0]!.body as { children: unknown[] };
    body.children = [{
      kind: 'local.set',
      var: { kind: 'index', value: 0 },
      value: { kind: 'pop' },
      loc: { line: 7 },
    }];
    assertThrows(
      () => deriveTypes(m),
      Error,
      'local.set at line 7 consumes 1 value(s) and the stack holds 0',
    );
  });

  it("a void call among a br's values claims no value", () => {
    const m = fromText(`(module (func $v) (func
      block
        call $v
        br 0
      end))`);
    assertEquals(all(m.functions[1]!.body, 'br')[0].type, Unreachable);
  });
});

describe("M8d — deriveTypes: branches follow wasm's rule where the tree shape differs", () => {
  it("a br_if whose value the tree left as a sibling falls through with its target's values", () => {
    // The inner br_if as a sibling, not the outer's value: built by hand (see
    // `lift`). It came from the binary reader until post-M8 fix 4, then from
    // the WAT parser on linear text until fix 5.
    const m = fromText(
      `(module (func (result i32)
      (block (result i32)
        (drop (br_if 0 (br_if 0 (i32.const 1) (i32.const 2)) (i32.const 3)))
        (i32.const 4))))`,
      false,
    );
    lift(blockOf(m), 0, 'value'); // drop (br_if …) -> br_if …; drop (pop)
    lift(blockOf(m), 0, 'values'); // br_if (br_if …) … -> br_if …; br_if …
    deriveTypes(m);
    assertEquals(blockOf(m).map((e) => (e as { kind: string }).kind), [
      'br',
      'br',
      'drop',
      'const',
    ]);
    const brs = all(m.functions[0]!.body, 'br');
    assertEquals(brs.map((b) => b.type), [ValType.I32, ValType.I32]);
    assertEquals(all(m.functions[0]!.body, 'pop').map((p) => p.type), [ValType.I32]);
  });

  it('both front ends nest that br_if as the value: the same types, and no pop', () => {
    const folded = `(module (func (result i32)
      (block (result i32)
        (drop (br_if 0 (br_if 0 (i32.const 1) (i32.const 2)) (i32.const 3)))
        (i32.const 4))))`;
    const linear = `(module (func (result i32)
      (block (result i32)
        i32.const 1
        i32.const 2
        br_if 0
        i32.const 3
        br_if 0
        drop
        i32.const 4)))`;
    for (const m of [fromBinary(folded), fromText(folded), fromText(linear)]) {
      const brs = all(m.functions[0]!.body, 'br');
      assertEquals(brs.map((b) => b.type), [ValType.I32, ValType.I32]);
      assertEquals(all(m.functions[0]!.body, 'pop'), []);
    }
  });

  it('br_on_null falls through with its carried values AND the ref', () => {
    const m = fromBinary(`(module (type $t (func (param i32) (result i32)))
      (func (param $x i32) (param $f (ref null $t)) (result i32)
        (block $l (result i32)
          (return (call_ref $t (br_on_null $l (local.get $x) (local.get $f)))))))`);
    assertEquals(all(m.functions[0]!.body, 'pop').map((p) => p.type), [ValType.I32]);
  });

  it('a branch to the function frame carries the results', () => {
    const m = fromText('(module (func (result i32) i32.const 1 i32.const 0 br_if 0))');
    assertEquals(all(m.functions[0]!.body, 'br')[0].type, ValType.I32);
  });

  it('control flow: unconditional transfers are unreachable; a void br_if is none', () => {
    const m = fromText(`(module (func (param i32)
      block
        local.get 0
        br_if 0
        br 0
      end
      return))`);
    const f = m.functions[0]!.body;
    assertEquals(all(f, 'br').map((b) => b.type), [None, Unreachable]);
    assertEquals(all(f, 'return')[0].type, Unreachable);
  });

  it("a br_if removes its target's values even when the tree does not hold them", () => {
    // With the inner br_if a sibling (built by hand, as above), the outer
    // br_if still consumes its value, so the second drop reaches the i64 below.
    const m = fromText(
      `(module (func (result i32)
      (block (result i32)
        i64.const 9
        i32.const 1
        i32.const 2
        br_if 0
        i32.const 3
        br_if 0
        drop
        drop
        i32.const 4)))`,
      false,
    );
    // [i64.const, drop (br_if (br_if …) …), drop, …] -> the inner br_if a
    // sibling and the outer one holding no value (see `lift`).
    lift(blockOf(m), 1, 'value');
    lift(blockOf(m), 1, 'values');
    deriveTypes(m);
    assertEquals(blockOf(m).map((e) => (e as { kind: string }).kind), [
      'const',
      'br',
      'br',
      'drop',
      'drop',
      'const',
    ]);
    assertEquals(all(m.functions[0]!.body, 'pop').map((p) => p.type), [ValType.I32, ValType.I64]);
  });

  it("a br_if to a LOOP carries the loop's params, not its results", () => {
    const m = fromText(`(module (func (param i32) (result i32)
      loop (result i32)
        local.get 0
        br_if 0
        i32.const 1
      end))`);
    assertEquals(all(m.functions[0]!.body, 'br')[0].type, None);
  });

  it('br_on_non_null falls through with its carried values only — the ref goes to the target', () => {
    const m = fromText(`(module (func (param i32 externref) (result i32 (ref extern))
      block (result i32 (ref extern))
        local.get 0
        local.get 1
        br_on_non_null 0
        drop
        unreachable
      end))`);
    assertEquals(all(m.functions[0]!.body, 'pop').map((p) => p.type), [ValType.I32]);
  });

  it('a field read that invalid code only can make is refused, not typed', () => {
    const packed = fromText(
      `(module (type $s (struct (field i8)))
      (func (param (ref $s)) (drop (struct.get $s 0 (local.get 0)))))`,
      false,
    );
    assertThrows(
      () => deriveTypes(packed),
      Error,
      'struct.get reads a packed field without a sign',
    );
    const missing = fromText(
      `(module (type $s (struct (field i32)))
      (func (param (ref $s)) (drop (struct.get $s 0 (local.get 0)))))`,
      false,
    );
    const get = all(missing.functions[0]!.body, 'struct.get')[0];
    get.fieldVar = { kind: 'index', value: 5 };
    assertThrows(() => deriveTypes(missing), Error, 'struct.get names no such field');
  });
});
